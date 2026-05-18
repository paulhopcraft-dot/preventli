import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
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
import { Pause, AlertTriangle, Bot } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface SuppressionRow {
  id: string;
  workerId: string;
  reason: string;
  source: string; // "clinician" | "alex"
  unpausedAt: string | null;
  createdAt: string | null;
}

interface SuppressionResponse {
  data: SuppressionRow[];
  activeCount: number;
}

interface ContactSuppressionBadgeProps {
  workerId: string;
  className?: string;
}

export default function ContactSuppressionBadge({
  workerId,
  className,
}: ContactSuppressionBadgeProps): JSX.Element | null {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [pauseOpen, setPauseOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [pauseReason, setPauseReason] = useState("");
  const [resumeReason, setResumeReason] = useState("");

  const { data, isLoading } = useQuery<SuppressionResponse>({
    queryKey: [`/api/workers/${workerId}/contact-suppressions`],
    enabled: !!workerId,
  });

  const activeSuppression = data?.data.find(
    (s: SuppressionRow) => !s.unpausedAt
  ) ?? null;

  const pauseMutation = useMutation({
    mutationFn: async (reason: string) => {
      const res = await apiRequest(
        "POST",
        `/api/workers/${workerId}/contact-suppressions`,
        { reason }
      );
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Outreach paused",
        description: "Outreach to this worker has been paused and documented.",
      });
      setPauseOpen(false);
      setPauseReason("");
      qc.invalidateQueries({
        queryKey: [`/api/workers/${workerId}/contact-suppressions`],
      });
    },
    onError: () => {
      toast({
        title: "Failed to pause outreach",
        description: "Please try again or contact support.",
        variant: "destructive",
      });
    },
  });

  const resumeMutation = useMutation({
    mutationFn: async ({
      suppressionId,
      reason,
    }: {
      suppressionId: string;
      reason: string;
    }) => {
      const res = await apiRequest(
        "DELETE",
        `/api/contact-suppressions/${suppressionId}`,
        { reason }
      );
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Outreach resumed",
        description: "Outreach has been resumed and the reason has been recorded.",
      });
      setResumeOpen(false);
      setResumeReason("");
      qc.invalidateQueries({
        queryKey: [`/api/workers/${workerId}/contact-suppressions`],
      });
    },
    onError: () => {
      toast({
        title: "Failed to resume outreach",
        description: "Please try again or contact support.",
        variant: "destructive",
      });
    },
  });

  function handlePauseSubmit(): void {
    if (pauseReason.trim().length < 5) return;
    pauseMutation.mutate(pauseReason.trim());
  }

  function handleResumeSubmit(): void {
    if (!activeSuppression || resumeReason.trim().length < 5) return;
    resumeMutation.mutate({
      suppressionId: activeSuppression.id,
      reason: resumeReason.trim(),
    });
  }

  function formatDate(value: string | null): string {
    if (!value) return "—";
    return new Date(value).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  if (isLoading) return null;

  if (!activeSuppression) {
    return (
      <>
        <Button
          variant="outline"
          size="sm"
          className={cn("gap-1.5 text-xs", className)}
          onClick={() => setPauseOpen(true)}
        >
          <Pause className="w-3 h-3" />
          Pause outreach
        </Button>

        <Dialog open={pauseOpen} onOpenChange={setPauseOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Pause outreach for this worker</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Document why outreach should be paused. This record is required for
              mental-injury defensibility.
            </p>
            <Textarea
              placeholder="Reason (min. 5 characters)..."
              value={pauseReason}
              onChange={(e) => setPauseReason(e.target.value)}
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPauseOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handlePauseSubmit}
                disabled={
                  pauseReason.trim().length < 5 || pauseMutation.isPending
                }
              >
                {pauseMutation.isPending ? "Saving..." : "Pause outreach"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  // Active suppression — show amber badge with tooltip + resume button
  const isAlexDetected = activeSuppression.source === "alex";

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              className={cn(
                "gap-1.5 cursor-default select-none",
                "bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-100",
                className
              )}
            >
              {isAlexDetected ? (
                <Bot className="w-3 h-3" />
              ) : (
                <AlertTriangle className="w-3 h-3" />
              )}
              Outreach paused
            </Badge>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs space-y-1">
            <p className="font-semibold text-xs">{activeSuppression.reason}</p>
            <p className="text-xs text-muted-foreground">
              {isAlexDetected ? "Detected by Alex" : "Marked by clinician"} &middot;{" "}
              {formatDate(activeSuppression.createdAt)}
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Button
        variant="outline"
        size="sm"
        className="text-xs"
        onClick={() => setResumeOpen(true)}
      >
        Resume
      </Button>

      <Dialog open={resumeOpen} onOpenChange={setResumeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resume outreach for this worker</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Why are you resuming outreach? This reason will be recorded in the
            audit trail.
          </p>
          <Textarea
            placeholder="Reason (min. 5 characters)..."
            value={resumeReason}
            onChange={(e) => setResumeReason(e.target.value)}
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setResumeOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleResumeSubmit}
              disabled={
                resumeReason.trim().length < 5 || resumeMutation.isPending
              }
            >
              {resumeMutation.isPending ? "Saving..." : "Resume outreach"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
