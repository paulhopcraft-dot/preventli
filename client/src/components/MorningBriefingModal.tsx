import { useEffect, useState } from "react";
import { X, AlertCircle, Clock, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

interface Action {
  id: string;
  title: string;
  description?: string;
  priorityLevel?: string;
  workerName?: string;
  actionType?: string;
}

interface BriefingData {
  summary: string | null;
  generatedAt: string | null;
  overdueActions: Action[];
  pendingActions: Action[];
  hasData: boolean;
}

function getTodayKey(userId: string): string {
  const today = new Date().toISOString().split("T")[0];
  return `alex_briefing_shown_${userId}_${today}`;
}

function getPriorityColor(priority?: string): string {
  switch (priority) {
    case "critical": return "text-red-600 bg-red-50 border-red-200";
    case "high": return "text-orange-600 bg-orange-50 border-orange-200";
    case "medium": return "text-yellow-600 bg-yellow-50 border-yellow-200";
    default: return "text-blue-600 bg-blue-50 border-blue-200";
  }
}

export function MorningBriefingModal() {
  const { user, isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    const key = getTodayKey(user.id);
    const alreadyShown = sessionStorage.getItem(key);
    if (alreadyShown) return;

    fetchBriefing();
  }, [isAuthenticated, user]);

  async function fetchBriefing() {
    setLoading(true);
    try {
      const res = await fetch("/api/morning-briefing", { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success && json.data?.hasData) {
        setBriefing(json.data);
        setOpen(true);
      }
    } catch {
      // Silently fail — don't block the user if briefing is unavailable
    } finally {
      setLoading(false);
    }
  }

  function dismiss() {
    if (user) {
      sessionStorage.setItem(getTodayKey(user.id), "1");
    }
    setOpen(false);
  }

  if (!open || !briefing) return null;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const allActions = [
    ...briefing.overdueActions.map(a => ({ ...a, isOverdue: true })),
    ...briefing.pendingActions.map(a => ({ ...a, isOverdue: false })),
  ].slice(0, 5);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={dismiss}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-primary px-6 py-5 flex items-start justify-between">
          <div>
            <p className="text-primary-foreground/70 text-xs font-medium uppercase tracking-wide mb-1">
              Alex
            </p>
            <h2 className="text-primary-foreground text-xl font-semibold">
              {greeting} 👋
            </h2>
            <p className="text-primary-foreground/80 text-sm mt-1">
              Here's what's on your plate today.
            </p>
          </div>
          <button
            onClick={dismiss}
            className="text-primary-foreground/60 hover:text-primary-foreground transition-colors mt-1"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
          {/* Alex's narrative summary */}
          {briefing.summary && (
            <div className="bg-muted/50 rounded-xl px-4 py-4">
              <p className="text-sm text-foreground leading-relaxed">
                {briefing.summary}
              </p>
              {briefing.generatedAt && (
                <p className="text-xs text-muted-foreground mt-2">
                  Reviewed at {new Date(briefing.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
            </div>
          )}

          {/* Action cards */}
          {allActions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {briefing.overdueActions.length > 0
                  ? `${briefing.overdueActions.length} overdue · ${briefing.pendingActions.length} pending`
                  : `${briefing.pendingActions.length} pending`}
              </p>
              {allActions.map((action) => (
                <div
                  key={action.id}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border px-4 py-3",
                    action.isOverdue
                      ? "bg-red-50 border-red-200"
                      : "bg-muted/30 border-border"
                  )}
                >
                  {action.isOverdue ? (
                    <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                  ) : (
                    <Clock className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className={cn(
                      "text-sm font-medium",
                      action.isOverdue ? "text-red-700" : "text-foreground"
                    )}>
                      {action.title}
                    </p>
                    {action.workerName && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {action.workerName}
                      </p>
                    )}
                    {action.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {action.description}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* No actions fallback */}
          {allActions.length === 0 && briefing.summary && (
            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
              <p className="text-sm text-green-700">No urgent actions — you're on top of it.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Ask Alex anything about your cases below
          </p>
          <button
            onClick={dismiss}
            className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
