import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { FileText, Bot, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AuditEventDB } from "@shared/schema";

interface AuditTrailLinkProps {
  caseId: string;
  className?: string;
}

interface AuditEventsResponse {
  data: AuditEventDB[];
  count: number;
}

function formatRelative(value: Date | string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function formatFull(value: Date | string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function PayloadCell({ payload }: { payload: Record<string, unknown> | null | undefined }) {
  const [expanded, setExpanded] = useState(false);
  if (!payload) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="max-w-[200px]">
      <button
        className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
        onClick={() => setExpanded((v) => !v)}
        type="button"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {expanded ? "Hide" : "View"}
      </button>
      {expanded && (
        <pre className="mt-1 text-xs bg-muted rounded p-2 overflow-auto max-h-40 whitespace-pre-wrap break-all">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function AuditTrailLink({ caseId, className }: AuditTrailLinkProps): JSX.Element | null {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  // Admin-only — return null for non-admin users
  if (user?.role !== "admin") return null;

  const shortId = caseId.slice(0, 8);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={cn("gap-1.5 text-xs", className)}
        onClick={() => setOpen(true)}
      >
        <FileText className="w-3 h-3" />
        View audit trail
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Audit trail — case {shortId}</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto flex-1">
            <AuditEventsTable caseId={caseId} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function AuditEventsTable({ caseId }: { caseId: string }) {
  const { data, isLoading } = useQuery<AuditEventsResponse>({
    queryKey: [`/api/admin/audit-events`, { caseId, limit: 200 }],
    queryFn: () =>
      fetch(`/api/admin/audit-events?caseId=${encodeURIComponent(caseId)}&limit=200`).then((r) => {
        if (!r.ok) throw new Error("Failed to fetch audit events");
        return r.json();
      }),
    enabled: true,
  });

  if (isLoading) {
    return (
      <div className="space-y-2 p-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  const rows = data?.data ?? [];

  if (rows.length === 0) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        No audit events for this case yet.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-32">Time</TableHead>
          <TableHead>Event type</TableHead>
          <TableHead className="w-32">Actor</TableHead>
          <TableHead className="w-40">Payload</TableHead>
          <TableHead className="w-12 text-center">LLM</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="text-xs">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-default">{formatRelative(row.timestamp)}</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <span className="text-xs">{formatFull(row.timestamp)}</span>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </TableCell>
            <TableCell className="text-xs">
              <Badge variant="outline" className="text-xs font-mono">
                {row.eventType}
              </Badge>
            </TableCell>
            <TableCell className="text-xs font-mono truncate max-w-[120px]">
              {row.actor ?? row.userId ?? "—"}
            </TableCell>
            <TableCell>
              <PayloadCell payload={row.payload as Record<string, unknown> | null | undefined} />
            </TableCell>
            <TableCell className="text-center">
              {row.llmModel ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Bot className="w-4 h-4 text-violet-600 mx-auto" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      <span className="text-xs">AI decision — model: {row.llmModel}</span>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
