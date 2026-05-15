/**
 * CurrentRTWPlanCard
 *
 * Displays the worker's current/active RTW plan (anything beyond draft status).
 * - Queries GET /api/rtw-plans?caseId=X to get the latest plan
 * - If the latest plan status is in an "active" set, fetches /details for duty names
 * - Renders nothing if no active plan exists
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { ClipboardList, ChevronRight, Calendar, Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RTW_PLAN_STATUS_LABELS } from "@shared/schema";
import { fetchWithCsrf } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface Props {
  caseId: string;
}

const ACTIVE_STATUSES = new Set([
  "in_progress",
  "working_well",
  "failing",
  "on_hold",
  "planned_not_started",
  "pending_employer_review",
  "approved",
  "completed",
]);

interface LatestPlanResponse {
  success: boolean;
  data: {
    plan: {
      id: string;
      status: string;
      startDate?: string | null;
      targetEndDate?: string | null;
    };
  } | null;
}

interface PlanDetailDuty {
  dutyId: string;
  dutyName: string;
  suitability: string;
  isIncluded: boolean;
}

interface PlanDetailsResponse {
  success: boolean;
  data: {
    plan: {
      id: string;
      status: string;
      startDate?: string | null;
    };
    duties: PlanDetailDuty[];
  } | null;
}

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function statusBadgeClasses(status: string): string {
  switch (status) {
    case "in_progress":
    case "working_well":
      return "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800";
    case "failing":
      return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800";
    case "on_hold":
      return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800";
    case "completed":
      return "bg-slate-100 text-slate-800 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700";
    case "pending_employer_review":
    case "planned_not_started":
    default:
      return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800";
  }
}

const SUPERSEDABLE_STATUSES = new Set(["approved", "completed"]);

export function CurrentRTWPlanCard({ caseId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: latest } = useQuery<LatestPlanResponse>({
    queryKey: [`/api/rtw-plans?caseId=${caseId}`],
    enabled: !!caseId,
    retry: false,
  });

  const draftNewVersionMutation = useMutation({
    mutationFn: async () => {
      const response = await fetchWithCsrf(`/api/cases/${caseId}/auto-draft-rtw-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      return response.json();
    },
    onSuccess: () => {
      toast({
        title: "New draft RTW plan ready",
        description: "Review the updated plan before approving.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: [`/api/rtw-plans?caseId=${caseId}`] });
      queryClient.invalidateQueries({ queryKey: ["rtw-plans", caseId] });
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/auto-draft-eligibility`] });
    },
    onError: (error: Error) => {
      toast({
        title: "Draft failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const plan = latest?.data?.plan;
  const isActive = !!plan && ACTIVE_STATUSES.has(plan.status);

  const { data: details } = useQuery<PlanDetailsResponse>({
    queryKey: [`/api/rtw-plans/${plan?.id}/details`],
    enabled: !!plan?.id && isActive,
    retry: false,
  });

  if (!plan || !isActive) return null;

  const statusLabel = RTW_PLAN_STATUS_LABELS[plan.status] || plan.status;
  const startLabel = formatDate(plan.startDate);
  const endLabel = formatDate(plan.targetEndDate);
  const canDraftNewVersion = SUPERSEDABLE_STATUSES.has(plan.status);

  const allDuties = details?.data?.duties ?? [];
  const suitable = allDuties.filter((d) => d.isIncluded);
  const restricted = allDuties.filter((d) => !d.isIncluded);

  return (
    <Card
      data-testid="current-rtw-plan-card"
      className="border-l-4 border-l-emerald-500"
    >
      <CardContent className="pt-4 pb-3 px-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="shrink-0 rounded-full bg-emerald-100 dark:bg-emerald-900/40 p-2">
              <ClipboardList className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm">Current RTW Plan</span>
                <Badge variant="outline" className={statusBadgeClasses(plan.status)}>
                  {statusLabel}
                </Badge>
              </div>
              {(startLabel || endLabel) && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                  <Calendar className="h-3 w-3" />
                  <span>
                    {startLabel ?? "—"}
                    {endLabel ? ` → ${endLabel}` : ""}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            <Link
              to={`/rtw/plans/${plan.id}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-100"
              data-testid="current-rtw-plan-view-link"
            >
              View full plan
              <ChevronRight className="h-3 w-3" />
            </Link>
            {canDraftNewVersion && (
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-xs gap-1"
                onClick={() => draftNewVersionMutation.mutate()}
                disabled={draftNewVersionMutation.isPending}
                data-testid="current-rtw-plan-draft-new-version"
              >
                <Sparkles className="h-3 w-3" />
                {draftNewVersionMutation.isPending ? "Drafting..." : "Draft new version"}
              </Button>
            )}
          </div>
        </div>

        {(suitable.length > 0 || restricted.length > 0) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div>
              <p className="font-semibold text-emerald-700 dark:text-emerald-300 mb-1">
                Suitable duties ({suitable.length})
              </p>
              {suitable.length > 0 ? (
                <ul className="space-y-0.5 text-muted-foreground">
                  {suitable.slice(0, 5).map((d) => (
                    <li key={d.dutyId} className="truncate">• {d.dutyName}</li>
                  ))}
                  {suitable.length > 5 && (
                    <li className="text-[10px] italic">+ {suitable.length - 5} more</li>
                  )}
                </ul>
              ) : (
                <p className="text-muted-foreground italic">None listed</p>
              )}
            </div>
            <div>
              <p className="font-semibold text-red-700 dark:text-red-300 mb-1">
                Restricted duties ({restricted.length})
              </p>
              {restricted.length > 0 ? (
                <ul className="space-y-0.5 text-muted-foreground">
                  {restricted.slice(0, 5).map((d) => (
                    <li key={d.dutyId} className="truncate">• {d.dutyName}</li>
                  ))}
                  {restricted.length > 5 && (
                    <li className="text-[10px] italic">+ {restricted.length - 5} more</li>
                  )}
                </ul>
              ) : (
                <p className="text-muted-foreground italic">None listed</p>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default CurrentRTWPlanCard;
