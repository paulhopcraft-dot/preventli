import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { fetchWithCsrf } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import type { CaseAction } from "@shared/schema";
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Bot,
  Send,
  ChevronDown,
  ChevronUp,
  Zap,
  User,
  Activity,
  FileText,
  RefreshCw,
  MessageSquare,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CaseActionPanelProps {
  caseId: string;
  workerId?: string;
  organizationId?: string;
  nextStep?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getActionStatusStyle(action: CaseAction): string {
  if (action.status === "done") return "text-gray-400";
  if (action.failed) return "text-gray-400";
  if (action.dueDate && new Date(action.dueDate) < new Date()) return "text-red-600";
  return "text-blue-600";
}

function isEmployerFeedback(action: CaseAction): boolean {
  return !!action.notes?.includes("Employer requested");
}

function getLeftBorderClass(action: CaseAction): string {
  if (action.status === "done") return "border-l-4 border-green-400";
  if (action.failed) return "border-l-4 border-gray-300";
  if (isEmployerFeedback(action)) return "border-l-4 border-amber-400";
  if (action.dueDate && new Date(action.dueDate) < new Date())
    return "border-l-4 border-red-400";
  return "border-l-4 border-blue-400";
}

function formatRelativeDate(dateStr?: string): string {
  if (!dateStr) return "No due date";
  const due = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return due.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function getActionIcon(action: CaseAction): React.ReactElement {
  if (action.status === "done") return <CheckCircle2 className="w-4 h-4 text-green-500" />;
  if (isEmployerFeedback(action)) return <MessageSquare className="w-4 h-4 text-amber-500" />;
  if (action.dueDate && new Date(action.dueDate) < new Date())
    return <AlertTriangle className="w-4 h-4 text-red-500" />;
  switch (action.type) {
    case "chase_certificate":
      return <FileText className="w-4 h-4 text-blue-500" />;
    case "review_case":
      return <Activity className="w-4 h-4 text-blue-500" />;
    default:
      return <Clock className="w-4 h-4 text-blue-500" />;
  }
}

function isAutomated(action: CaseAction): boolean {
  return (
    action.source === "compliance" ||
    action.source === "clinical" ||
    action.source === "rtw" ||
    action.source === "ai_recommendation"
  );
}

// ─── Section: Last Actions ────────────────────────────────────────────────────

function LastActionsSection({ actions }: { actions: CaseAction[] }): React.ReactElement {
  const recent = [...actions]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  if (recent.length === 0) {
    return (
      <div className="py-3 text-center text-sm text-muted-foreground">
        No actions yet for this case.
      </div>
    );
  }

  return (
    <ScrollArea className="max-h-52">
      <div className="space-y-2 pr-1">
        {recent.map((action) => (
          <div
            key={action.id}
            className={cn(
              "rounded-md px-3 py-2 bg-muted/40",
              getLeftBorderClass(action)
            )}
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex-shrink-0">{getActionIcon(action)}</span>
              <div className="flex-1 min-w-0">
                <p
                  className={cn(
                    "text-xs font-medium truncate",
                    isEmployerFeedback(action) ? "text-amber-700 dark:text-amber-400" : getActionStatusStyle(action)
                  )}
                >
                  {isEmployerFeedback(action) ? "Employer feedback — changes requested" : (action.title || action.type.replace(/_/g, " "))}
                </p>
                {action.notes && (
                  <p className={cn("text-xs mt-0.5", isEmployerFeedback(action) ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground line-clamp-1")}>
                    {action.notes}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <span>{formatRelativeDate(action.dueDate)}</span>
                  {action.assignedToName && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {action.assignedToName}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}

// ─── Section: Next Recommended Action ─────────────────────────────────────────

interface NextActionSectionProps {
  actions: CaseAction[];
  caseId: string;
  onMarkDone: (actionId: string) => void;
  isMarkingDone: boolean;
  nextStep?: string;
}

function NextActionSection({
  actions,
  caseId,
  onMarkDone,
  isMarkingDone,
  nextStep,
}: NextActionSectionProps): React.ReactElement {
  const now = new Date();

  // Top pending/overdue action: overdue first, then by priority number ascending
  const next = [...actions]
    .filter((a) => a.status !== "done" && !a.failed && a.status !== "cancelled")
    .sort((a, b) => {
      const aOverdue = a.dueDate && new Date(a.dueDate) < now;
      const bOverdue = b.dueDate && new Date(b.dueDate) < now;
      if (aOverdue && !bOverdue) return -1;
      if (!aOverdue && bOverdue) return 1;
      return (a.priority ?? 99) - (b.priority ?? 99);
    })[0];

  if (!next) {
    // Fall back to the case's nextStep field if available
    if (nextStep) {
      return (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-700">
          <p className="font-medium">{nextStep}</p>
          <p className="text-xs text-blue-500 mt-1">From case management system</p>
        </div>
      );
    }
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-3 text-sm text-green-700 flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
        All actions complete. No pending work for this case.
      </div>
    );
  }

  const automated = isAutomated(next);
  const overdue = next.dueDate && new Date(next.dueDate) < now;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-3 space-y-2",
        overdue
          ? "border-red-200 bg-red-50"
          : "border-blue-200 bg-blue-50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          {overdue ? (
            <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          ) : (
            <Zap className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <p className={cn("text-sm font-semibold", overdue ? "text-red-700" : "text-blue-700")}>
              {next.title || next.type.replace(/_/g, " ")}
            </p>
            {next.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{next.description}</p>
            )}
            {next.notes && !next.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{next.notes}</p>
            )}
          </div>
        </div>

        {automated ? (
          <Badge className="bg-purple-100 text-purple-700 border-purple-200 text-xs flex-shrink-0">
            <Bot className="w-3 h-3 mr-1" />
            Auto
          </Badge>
        ) : (
          <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-xs flex-shrink-0">
            Action required
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {next.dueDate && (
          <span className={cn("flex items-center gap-1", overdue && "text-red-600 font-medium")}>
            <Clock className="w-3 h-3" />
            {formatRelativeDate(next.dueDate)}
          </span>
        )}
        {next.assignedToName && (
          <span className="flex items-center gap-1">
            <User className="w-3 h-3" />
            {next.assignedToName}
          </span>
        )}
      </div>

      {automated ? (
        <p className="text-xs text-purple-600 italic">
          System will send automatically
        </p>
      ) : (
        <Button
          size="sm"
          variant="default"
          className="w-full h-7 text-xs mt-1"
          onClick={() => onMarkDone(next.id)}
          disabled={isMarkingDone}
        >
          {isMarkingDone ? (
            <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
          ) : (
            <CheckCircle2 className="w-3 h-3 mr-1" />
          )}
          Mark done
        </Button>
      )}
    </div>
  );
}

// ─── Section: Chat Box ────────────────────────────────────────────────────────

interface ChatBoxSectionProps {
  caseId: string;
  workerId?: string;
  organizationId?: string;
}

function ChatBoxSection({ caseId, workerId, organizationId }: ChatBoxSectionProps): React.ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionId = useRef(`panel-${caseId}-${Date.now()}`).current;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendMessage = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: trimmed,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    try {
      const response = await fetchWithCsrf("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          sessionId,
          context: {
            caseId,
            workerId,
            organizationId,
          },
        }),
      });

      const data = await response.json();
      const reply = data.message || data.data?.response || "No response received.";

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content: reply,
          timestamp: new Date(),
        },
      ]);
    } catch (err) {
      console.error("[CaseActionPanel] Chat error:", err);
      setMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: "assistant",
          content: "Sorry, something went wrong. Please try again.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // Show last 3 when collapsed, all when expanded
  const visibleMessages = expanded ? messages : messages.slice(-3);
  const hasMore = messages.length > 3 && !expanded;

  return (
    <div className="space-y-2">
      {messages.length > 0 && (
        <>
          {hasMore && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="w-full text-xs text-muted-foreground flex items-center justify-center gap-1 py-1 hover:text-foreground transition-colors"
            >
              <ChevronUp className="w-3 h-3" />
              View full chat ({messages.length} messages)
            </button>
          )}
          {expanded && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="w-full text-xs text-muted-foreground flex items-center justify-center gap-1 py-1 hover:text-foreground transition-colors"
            >
              <ChevronDown className="w-3 h-3" />
              Show less
            </button>
          )}

          <ScrollArea className={cn(expanded ? "max-h-64" : "max-h-40")} ref={scrollRef}>
            <div className="space-y-2 pr-1">
              {visibleMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn("flex gap-2", msg.role === "user" ? "justify-end" : "justify-start")}
                >
                  {msg.role === "assistant" && (
                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                      <Bot className="w-3 h-3 text-primary-foreground" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "rounded-lg px-2.5 py-1.5 max-w-[85%] text-xs",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    )}
                  >
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  </div>
                </div>
              ))}

              {isLoading && (
                <div className="flex gap-2 justify-start">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                    <Bot className="w-3 h-3 text-primary-foreground" />
                  </div>
                  <div className="bg-muted rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground flex items-center gap-1">
                    <RefreshCw className="w-3 h-3 animate-spin" />
                    Thinking…
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </>
      )}

      <div className="flex gap-2 items-end">
        <Textarea
          placeholder="Ask about this case…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          rows={2}
          className="flex-1 text-xs resize-none min-h-0"
        />
        <Button
          size="icon"
          className="flex-shrink-0 h-9 w-9"
          onClick={() => sendMessage(input)}
          disabled={isLoading || !input.trim()}
          aria-label="Send message"
        >
          <Send className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function CaseActionPanel({ caseId, workerId, organizationId, nextStep }: CaseActionPanelProps): React.ReactElement {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: actionsData, isLoading } = useQuery<CaseAction[]>({
    queryKey: [`/api/actions/case/${caseId}`],
    queryFn: async (): Promise<CaseAction[]> => {
      const res = await fetch(`/api/actions/case/${caseId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch case actions");
      const json = await res.json();
      // Route returns { actions: CaseAction[] } or CaseAction[]
      return Array.isArray(json) ? json : (json.actions ?? []);
    },
    enabled: !!caseId,
  });

  const { mutate: markDone, isPending: isMarkingDone } = useMutation({
    mutationFn: async (actionId: string): Promise<void> => {
      const res = await fetchWithCsrf(
        `/api/actions/case/${caseId}/actions/${actionId}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      if (!res.ok) throw new Error("Failed to complete action");
    },
    onSuccess: () => {
      toast({ title: "Action marked as done" });
      queryClient.invalidateQueries({ queryKey: [`/api/actions/case/${caseId}`] });
    },
    onError: (err) => {
      console.error("[CaseActionPanel] Mark done error:", err);
      toast({ variant: "destructive", title: "Error", description: "Could not mark action as done." });
    },
  });

  const actions = actionsData ?? [];

  return (
    <div className="w-80 flex-shrink-0 space-y-4">
      {/* ── Last Actions ── */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            Last Actions
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-md bg-muted animate-pulse" />
              ))}
            </div>
          ) : (
            <LastActionsSection actions={actions} />
          )}
        </CardContent>
      </Card>

      {/* ── Next Recommended Action ── */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4 text-muted-foreground" />
            Next Recommended Action
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          {isLoading ? (
            <div className="h-20 rounded-lg bg-muted animate-pulse" />
          ) : (
            <NextActionSection
              actions={actions}
              caseId={caseId}
              onMarkDone={(id) => markDone(id)}
              isMarkingDone={isMarkingDone}
              nextStep={nextStep}
            />
          )}
        </CardContent>
      </Card>

      {/* ── Chat Box ── */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Bot className="w-4 h-4 text-muted-foreground" />
            Ask Alex
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <ChatBoxSection
            caseId={caseId}
            workerId={workerId}
            organizationId={organizationId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
