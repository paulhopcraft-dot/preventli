/**
 * AutoDraftButton
 *
 * Triggers backend auto-draft of an RTW plan for a case.
 * - Queries eligibility (GET /api/cases/:caseId/auto-draft-eligibility)
 * - Mutates POST /api/cases/:caseId/auto-draft-rtw-plan
 * - Disabled with tooltip explaining reason when ineligible or active draft exists
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { fetchWithCsrf } from "@/lib/queryClient";

interface Props {
  caseId: string;
}

interface EligibilityResponse {
  eligible: boolean;
  hasActiveDraft: boolean;
  reason?: string;
}

interface AutoDraftResponse {
  planId?: string;
  success?: boolean;
  data?: { planId: string };
}

export function AutoDraftButton({ caseId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: eligibility, isLoading: eligibilityLoading } = useQuery<EligibilityResponse>({
    queryKey: [`/api/cases/${caseId}/auto-draft-eligibility`],
    enabled: !!caseId,
  });

  const draftMutation = useMutation({
    mutationFn: async () => {
      const response = await fetchWithCsrf(`/api/cases/${caseId}/auto-draft-rtw-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const json = (await response.json()) as AutoDraftResponse;
      return json;
    },
    onSuccess: () => {
      toast({
        title: "Draft RTW Plan ready",
        description: "Review the auto-generated plan before approving.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: [`/api/rtw-plans?caseId=${caseId}`] });
      queryClient.invalidateQueries({ queryKey: ["rtw-plans", caseId] });
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/auto-draft-eligibility`] });
    },
    onError: (error: Error) => {
      toast({
        title: "Auto-draft failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const isPending = draftMutation.isPending;
  const isLoading = eligibilityLoading;
  const eligible = !!eligibility?.eligible;
  const hasActiveDraft = !!eligibility?.hasActiveDraft;
  const disabled = isLoading || isPending || !eligible || hasActiveDraft;

  const disabledReason =
    isLoading
      ? "Checking eligibility..."
      : hasActiveDraft
      ? "An active draft RTW plan already exists for this case."
      : !eligible
      ? eligibility?.reason || "This case is not yet eligible for auto-drafting."
      : null;

  const button = (
    <Button
      onClick={() => draftMutation.mutate()}
      disabled={disabled}
      variant="default"
      size="sm"
      className="gap-2"
      data-testid="auto-draft-rtw-button"
    >
      <Sparkles className="h-4 w-4" />
      {isPending ? "Drafting..." : "Draft RTW Plan"}
    </Button>
  );

  if (!disabledReason) {
    return button;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Wrapper span so tooltip works even when button is disabled */}
          <span className="inline-flex">{button}</span>
        </TooltipTrigger>
        <TooltipContent>{disabledReason}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default AutoDraftButton;
