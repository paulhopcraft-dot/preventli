import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertTriangle, Send } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface EngagementScoreResponse {
  workerId: string;
  score: number | null;
  components: Record<string, number>;
  calculatedAt: string | null;
  noData: boolean;
  thresholdAtTrigger: number;
  canEscalate: boolean;
}

interface EscalateToInsurerButtonProps {
  caseId: string;
  workerId: string;
  workerName: string;
  className?: string;
}

const PLACEHOLDER =
  "Worker has missed [N] cert renewals and [N] appointments over the past 30 days. Engagement score is [score], below the < 40 threshold. Requesting insurer support to re-engage.";

export default function EscalateToInsurerButton({
  caseId,
  workerId,
  workerName,
  className,
}: EscalateToInsurerButtonProps): JSX.Element {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [messageBody, setMessageBody] = useState("");

  const { data } = useQuery<EngagementScoreResponse>({
    queryKey: ["/api/workers", workerId, "engagement-score"],
    queryFn: async () => {
      const res = await fetch(`/api/workers/${workerId}/engagement-score`);
      if (!res.ok) throw new Error("Failed to fetch engagement score");
      return res.json();
    },
    enabled: !!workerId,
  });

  const escalateMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await apiRequest(
        "POST",
        `/api/cases/${caseId}/escalate-to-insurer`,
        { messageBody: body }
      );
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Escalation logged — insurer follow-up via existing channels",
      });
      setDialogOpen(false);
      setMessageBody("");
      qc.invalidateQueries({
        queryKey: ["/api/workers", workerId, "engagement-score"],
      });
    },
    onError: async (err: unknown) => {
      let description = "Please try again or contact support.";
      if (err instanceof Response) {
        try {
          const json = await err.json();
          if (json?.error) description = json.error;
        } catch {
          // ignore parse errors
        }
      }
      toast({
        title: "Escalation failed",
        description,
        variant: "destructive",
      });
    },
  });

  function handleClose(): void {
    setDialogOpen(false);
    setMessageBody("");
  }

  function handleSubmit(): void {
    if (messageBody.trim().length < 20 || escalateMutation.isPending) return;
    escalateMutation.mutate(messageBody.trim());
  }

  const canEscalate = data?.canEscalate === true && data?.noData !== true;
  const score = data?.score ?? null;
  const threshold = data?.thresholdAtTrigger ?? 40;

  const disabledReason =
    data?.noData || score === null
      ? "No engagement data yet — score required before escalation is enabled."
      : `Current score (${score}) is above the < ${threshold} threshold. Escalation is not available.`;

  if (!canEscalate) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className={cn("inline-flex", className)}>
              <Button
                variant="outline"
                size="sm"
                disabled
                className="gap-1.5 text-xs cursor-not-allowed opacity-60"
              >
                <AlertTriangle className="w-3.5 h-3.5" />
                Escalate to insurer (score above threshold)
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <p className="text-xs">{disabledReason}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <>
      <Button
        variant="destructive"
        size="sm"
        className={cn("gap-1.5 text-xs", className)}
        onClick={() => setDialogOpen(true)}
      >
        <AlertTriangle className="w-3.5 h-3.5" />
        Escalate to insurer
      </Button>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) handleClose();
          else setDialogOpen(true);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Escalate {workerName} to insurer</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Current engagement score: {score}. Threshold: &lt; {threshold}.
          </p>
          <Textarea
            placeholder={PLACEHOLDER}
            value={messageBody}
            onChange={(e) => setMessageBody(e.target.value)}
            rows={5}
          />
          {messageBody.trim().length > 0 && messageBody.trim().length < 20 && (
            <p className="text-xs text-destructive">
              Message must be at least 20 characters ({messageBody.trim().length}/20).
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                messageBody.trim().length < 20 || escalateMutation.isPending
              }
            >
              <Send className="w-3.5 h-3.5 mr-1.5" />
              {escalateMutation.isPending ? "Escalating..." : "Escalate"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
