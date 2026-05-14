import { Link, useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState, Suspense, lazy } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, RefreshCw, Sparkles, CheckCircle2, Circle, AlertCircle, Clock, ShieldCheck, ShieldAlert, ShieldX, TrendingUp, TrendingDown, Minus, Flag, CalendarClock } from "lucide-react";
import type { WorkerCase, PaginatedCasesResponse, CaseActionDB } from "@shared/schema";
import { cn } from "@/lib/utils";
import { TimelineCard } from "@/components/TimelineCard";
import { CaseContactsPanel } from "@/components/CaseContactsPanel";
import { AutoDraftButton } from "@/components/AutoDraftButton";
import { AutoDraftRTWPlanBanner } from "@/components/AutoDraftRTWPlanBanner";

// Heavy components - lazy load to reduce initial bundle size
const DynamicRecoveryTimeline = lazy(() => import("@/components/DynamicRecoveryTimeline").then(m => ({ default: m.DynamicRecoveryTimeline })));

// Date formatting helper
const formatCertDate = (dateStr: string | undefined): string => {
  if (!dateStr) return "Unknown";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
};

// Chart loading component for better UX
const ChartLoader = () => (
  <div className="animate-pulse space-y-4 p-6 bg-gradient-to-br from-purple-50 to-blue-50 rounded-lg border border-purple-200/50">
    <div className="h-8 bg-gradient-to-r from-purple-200 to-blue-200 rounded w-1/3 mb-6"></div>
    <div className="space-y-3">
      <div className="h-64 bg-gradient-to-r from-purple-100 to-blue-100 rounded"></div>
      <div className="flex space-x-4">
        <div className="h-24 w-24 bg-gradient-to-r from-purple-100 to-blue-100 rounded-full"></div>
        <div className="h-24 w-24 bg-gradient-to-r from-blue-100 to-teal-100 rounded-full"></div>
        <div className="h-24 w-24 bg-gradient-to-r from-teal-100 to-emerald-100 rounded-full"></div>
      </div>
    </div>
  </div>
);

// Action type for API response
interface CaseAction {
  id: string;
  caseId: string;
  type: string;
  title: string | null;
  description: string | null;
  notes: string | null;
  status: 'pending' | 'completed' | 'failed';
  priority: number | null;                                         // Legacy integer — do not use for display
  priorityLevel: 'low' | 'medium' | 'high' | 'critical' | null;  // Use this
  dueDate: string | null;
  completedAt: string | null;
  completedBy: string | null;
  assignedTo?: string | null;
  assignedToName?: string | null;
  createdAt: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const MS_PER_DAY  = 24 * 60 * 60 * 1000;

function calcWeeksOffWork(dateOfInjury: string | undefined): number {
  if (!dateOfInjury) return 0;
  const injury = new Date(dateOfInjury);
  if (isNaN(injury.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - injury.getTime()) / MS_PER_WEEK));
}

function calcDaysFromInjury(dateOfInjury: string | undefined): number {
  if (!dateOfInjury) return 0;
  const injury = new Date(dateOfInjury);
  if (isNaN(injury.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - injury.getTime()) / MS_PER_DAY));
}

/** Returns the next Victorian compliance checkpoint (13/26/52 wk) and days until it. */
function nextCheckpoint(daysOff: number): { label: string; daysUntil: number } | null {
  const checkpoints = [
    { days: 91,  label: "13-week review" },
    { days: 182, label: "26-week review" },
    { days: 364, label: "52-week review" },
  ];
  for (const cp of checkpoints) {
    if (daysOff < cp.days) {
      return { label: cp.label, daysUntil: cp.days - daysOff };
    }
  }
  return null;
}

function certExpiryStatus(cert: WorkerCase["latestCertificate"]): {
  expired: boolean;
  daysAgo: number;
  label: string;
} | null {
  if (!cert?.endDate) return null;
  const end = new Date(cert.endDate);
  if (isNaN(end.getTime())) return null;
  const diff = Math.floor((end.getTime() - Date.now()) / MS_PER_DAY);
  if (diff < 0) {
    return { expired: true, daysAgo: Math.abs(diff), label: `Expired ${Math.abs(diff)} day${Math.abs(diff) !== 1 ? "s" : ""} ago` };
  }
  return { expired: false, daysAgo: 0, label: `Valid for ${diff} more day${diff !== 1 ? "s" : ""}` };
}

function formatRelativeDue(dueDate: string | null): { text: string; overdue: boolean } {
  if (!dueDate) return { text: "No due date", overdue: false };
  const due = new Date(dueDate);
  const diffDays = Math.floor((due.getTime() - Date.now()) / MS_PER_DAY);
  if (diffDays < 0) return { text: `${Math.abs(diffDays)} day${Math.abs(diffDays) !== 1 ? "s" : ""} overdue`, overdue: true };
  if (diffDays === 0) return { text: "Due today", overdue: false };
  if (diffDays === 1) return { text: "Due tomorrow", overdue: false };
  return { text: `Due in ${diffDays} days`, overdue: false };
}

function riskLevelToPlain(riskLevel: string | undefined, weeksOff?: number): string {
  const level = (riskLevel || "").toLowerCase();
  // Duration override: 36+ weeks without RTW = high risk regardless of stored level
  const longRunning = (weeksOff ?? 0) >= 36;
  if (level === "high" || level === "very high" || longRunning) {
    return "High probability of long-term incapacity — immediate RTW intervention required.";
  }
  if (level === "medium") {
    return "Moderate risk of extended time off — monitor closely and keep RTW plan current.";
  }
  if (level === "low") {
    return "Low risk — standard monitoring and cert renewals expected.";
  }
  return "Risk level not yet assessed.";
}

/** Derive a next action from case state when the actions API is empty. */
function deriveNextAction(
  workerCase: WorkerCase,
  weeksOff: number,
  certStatus: ReturnType<typeof certExpiryStatus>
): { title: string; owner: string; dueText: string; overdue: boolean } | null {
  if (workerCase.rtwPlanStatus === "pending_employer_review") {
    return {
      title: "Review and approve Return to Work plan",
      owner: "You (employer sign-off required)",
      dueText: "Action required",
      overdue: true,
    };
  }
  if (certStatus?.expired) {
    return {
      title: "Chase medical certificate renewal",
      owner: "Coordinator",
      dueText: "Overdue",
      overdue: true,
    };
  }
  if (!workerCase.hasCertificate && weeksOff > 0) {
    return {
      title: "Obtain medical certificate from treating GP",
      owner: "Coordinator",
      dueText: "As soon as possible",
      overdue: false,
    };
  }
  if (!workerCase.rtwPlanStatus && weeksOff >= 2 && workerCase.workStatus !== "At work") {
    return {
      title: "Create Return to Work plan",
      owner: "Coordinator",
      dueText: "Within 3 days",
      overdue: false,
    };
  }
  if (workerCase.dueDate) {
    const rel = formatRelativeDue(workerCase.dueDate);
    return {
      title: workerCase.nextStep || "Review case progress",
      owner: "Coordinator",
      dueText: rel.text,
      overdue: rel.overdue,
    };
  }
  return null;
}

// ─── flags engine ─────────────────────────────────────────────────────────────

interface CaseFlag {
  label: string;
  severity: "red" | "amber" | "green";
}

function buildCaseFlags(
  workerCase: WorkerCase,
  weeksOff: number,
  certStatus: ReturnType<typeof certExpiryStatus>,
  effectiveRiskLevel?: string
): CaseFlag[] {
  const flags: CaseFlag[] = [];

  if (certStatus?.expired) {
    flags.push({ label: certStatus.label, severity: "red" });
  } else if (!workerCase.hasCertificate && weeksOff > 0) {
    flags.push({ label: "No medical certificate on file", severity: "red" });
  }

  if (workerCase.rtwPlanStatus === "pending_employer_review") {
    flags.push({ label: "Action required: RTW plan awaiting your approval", severity: "red" });
  } else if (!workerCase.rtwPlanStatus && weeksOff >= 2 && workerCase.workStatus !== "At work") {
    flags.push({ label: "No RTW plan — worker off work 2+ weeks", severity: "amber" });
  }

  const compliance = (workerCase.complianceIndicator || "").toLowerCase();
  if (compliance === "low" || compliance === "very low") {
    flags.push({ label: "Compliance: Critical — case file incomplete", severity: "red" });
  }
  // Medium compliance is not flagged — specific issues (no cert, no RTW plan) are already surfaced above

  const riskForFlags = effectiveRiskLevel || workerCase.riskLevel;
  if (riskForFlags === "High") {
    flags.push({ label: `Risk level: High`, severity: "red" });
  }

  if (flags.length === 0) {
    flags.push({ label: "No active flags", severity: "green" });
  }

  return flags;
}

// ─── Command Centre Component ──────────────────────────────────────────────────

interface CommandCentreProps {
  workerCase: WorkerCase;
  caseActions: CaseAction[];
  effectiveRiskLevel: string;
  onApproveRtw?: () => void;
  onRequestChangesRtw?: (feedback: string) => void;
  rtwApprovePending?: boolean;
}

function CommandCentre({ workerCase, caseActions, effectiveRiskLevel, onApproveRtw, onRequestChangesRtw, rtwApprovePending }: CommandCentreProps) {
  const [showChangesInput, setShowChangesInput] = useState(false);
  const [changesFeedback, setChangesFeedback] = useState("");
  const weeksOff   = calcWeeksOffWork(workerCase.dateOfInjury);
  const daysOff    = calcDaysFromInjury(workerCase.dateOfInjury);
  const checkpoint = nextCheckpoint(daysOff);
  const certStatus = certExpiryStatus(workerCase.latestCertificate);
  const flags      = buildCaseFlags(workerCase, weeksOff, certStatus, effectiveRiskLevel);

  // Fetch injury-specific recovery estimate (injury type + risk modifier = accurate weeks)
  const { data: recoveryChartData } = useQuery<{ estimatedWeeks?: number; adjustedEstimateWeeks?: number }>({
    queryKey: [`/api/cases/${workerCase.id}/recovery-chart`],
  });

  // Fetch RTW plan summary for employer approval preview
  const { data: rtwPlanData } = useQuery<{ success: boolean; data: { plan: { planType: string; startDate: string | null }; schedule: { weekNumber: number; hoursPerDay: number; daysPerWeek: number }[]; duties: { dutyName: string; suitability: string }[] } }>({
    queryKey: [`/api/rtw-plans?caseId=${workerCase.id}`],
    enabled: workerCase.rtwPlanStatus === "pending_employer_review",
  });

  // Compliance card
  const complianceRaw = (workerCase.complianceIndicator || "").toLowerCase();
  const complianceLevel: "compliant" | "at-risk" | "non-compliant" =
    complianceRaw === "very high" || complianceRaw === "high" ? "compliant" :
    complianceRaw === "medium" ? "at-risk" : "non-compliant";

  const complianceIssue =
    certStatus?.expired ? `Medical cert expired ${certStatus.daysAgo} day${certStatus.daysAgo !== 1 ? "s" : ""} ago` :
    !workerCase.hasCertificate && weeksOff > 0 ? "No medical certificate on file" :
    complianceLevel === "at-risk" ? "Compliance indicator flagged" :
    complianceLevel === "non-compliant" ? "One or more obligations not met" :
    "All obligations met";

  // Recovery card — use injury-specific estimate from API; fall back to risk-level heuristic
  const riskBasedWeeks =
    effectiveRiskLevel === "Low" ? 6 :
    effectiveRiskLevel === "Medium" ? 12 :
    effectiveRiskLevel === "High" ? 26 : 8;
  const expectedWeeks = recoveryChartData?.adjustedEstimateWeeks
    ?? recoveryChartData?.estimatedWeeks
    ?? riskBasedWeeks;

  const recoveryStatus: "on-track" | "delayed" =
    weeksOff <= expectedWeeks ? "on-track" : "delayed";

  // Next action card
  const pendingActions = caseActions.filter(a => a.status !== "completed");
  const topAction = pendingActions.length > 0
    ? pendingActions.sort((a, b) => {
        const pOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        return (pOrder[a.priorityLevel ?? "medium"] ?? 9) - (pOrder[b.priorityLevel ?? "medium"] ?? 9);
      })[0]
    : null;

  const derivedAction = !topAction ? deriveNextAction(workerCase, weeksOff, certStatus) : null;

  const actionTypeLabel = (type: string): string => {
    switch (type) {
      case 'review_case': return 'Review Case';
      case 'chase_certificate': return 'Obtain Medical Certificate';
      case 'follow_up': return 'Follow Up Required';
      case 'contact_worker': return 'Contact Worker';
      case 'update_rtw_plan': return 'Update RTW Plan';
      default: return type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    }
  };

  const nextActionTitle  = (topAction ? (topAction.title || actionTypeLabel(topAction.type)) : null) ?? derivedAction?.title ?? "No immediate actions";
  const nextActionOwner  = topAction?.assignedToName ?? topAction?.assignedTo ?? derivedAction?.owner ?? "Coordinator";
  const nextActionDue    = topAction ? formatRelativeDue(topAction.dueDate) : (derivedAction ? { text: derivedAction.dueText, overdue: derivedAction.overdue } : { text: "", overdue: false });

  // Action feed
  const recentCompleted  = caseActions.filter(a => a.status === "completed").slice(0, 3);
  const pendingFeed      = caseActions.filter(a => a.status !== "completed");

  return (
    <div className="p-4 space-y-4 max-w-5xl mx-auto">

      {/* ── 1. Case Status Banner ─────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">
              {workerCase.workerId ? (
                <Link
                  to={`/workers/${workerCase.workerId}`}
                  className="hover:underline focus:underline focus:outline-none"
                >
                  {workerCase.workerName}
                </Link>
              ) : (
                workerCase.workerName
              )}
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {workerCase.company}
              {workerCase.dateOfInjury ? ` · Injured ${workerCase.dateOfInjury}` : ""}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Weeks since injury — only show "off work" label when worker is actually off work */}
            {weeksOff > 0 && (
              <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200 font-medium">
                {workerCase.workStatus === "At work"
                  ? `Week ${weeksOff} post-injury`
                  : `Week ${weeksOff} off work`}
              </Badge>
            )}

            {/* Work status */}
            <Badge className={cn(
              "font-medium",
              workerCase.workStatus === "At work"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100"
                : "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100"
            )}>
              {workerCase.workStatus}
            </Badge>

            {/* Risk level — uses XGBoost-elevated effectiveRiskLevel if available */}
            <Badge variant="outline" className={cn(
              "font-medium border",
              effectiveRiskLevel === "High"
                ? "border-red-300 text-red-700 bg-red-50 dark:bg-red-950/30 dark:text-red-300"
                : effectiveRiskLevel === "Medium"
                ? "border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300"
                : "border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300"
            )}>
              {effectiveRiskLevel || "Unknown"} risk
            </Badge>

            {/* Compliance checkpoint countdown */}
            {checkpoint && checkpoint.daysUntil <= 21 && (
              <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100 flex items-center gap-1 font-medium">
                <CalendarClock className="h-3 w-3" />
                {checkpoint.label} in {checkpoint.daysUntil} day{checkpoint.daysUntil !== 1 ? "s" : ""}
              </Badge>
            )}
            {checkpoint && checkpoint.daysUntil > 21 && checkpoint.daysUntil <= 42 && (
              <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100 flex items-center gap-1 font-medium">
                <CalendarClock className="h-3 w-3" />
                {checkpoint.label} in {checkpoint.daysUntil} days
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* ── 1b. Employer Brief ────────────────────────────────────────────── */}
      {(() => {
        const isOff = workerCase.workStatus !== "At work";
        const injuryDesc = workerCase.summary
          ? workerCase.summary.split(/[.;]/)[0].trim().toLowerCase()
          : "an injury";
        const injuryDate = formatCertDate(workerCase.dateOfInjury);
        const riskLabel = (effectiveRiskLevel || workerCase.riskLevel || "unknown").toLowerCase();
        const overdue = isOff && expectedWeeks > 0 && weeksOff > expectedWeeks;
        const overdueBy = overdue ? weeksOff - expectedWeeks : 0;

        let statusLine: string;
        if (!isOff) {
          statusLine = `${workerCase.workerName} has returned to work and is currently active. The case remains open for monitoring.`;
        } else if (overdue) {
          statusLine = `${workerCase.workerName} has been off work for ${weeksOff} weeks — ${overdueBy} week${overdueBy !== 1 ? "s" : ""} beyond the expected ${expectedWeeks}-week recovery window. The claim is classified as ${riskLabel} risk.`;
        } else {
          statusLine = `${workerCase.workerName} has been off work for ${weeksOff} week${weeksOff !== 1 ? "s" : ""}. Recovery is within the expected window for a ${riskLabel}-risk claim.`;
        }

        const barrierParts: string[] = [];
        if (!workerCase.hasCertificate && isOff) barrierParts.push("no medical certificate on file");
        if (!workerCase.rtwPlanStatus && weeksOff >= 2 && isOff) barrierParts.push("no RTW plan in place");
        if (workerCase.rtwPlanStatus === "pending_employer_review") barrierParts.push("RTW plan awaiting your approval");
        if ((complianceLevel === "non-compliant")) barrierParts.push("compliance obligations not met");

        const activePlan = workerCase.rtwPlanStatus === "in_progress" || workerCase.rtwPlanStatus === "working_well";

        return (
          <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm space-y-1">
            <p className="text-foreground leading-relaxed">{statusLine}</p>
            {activePlan && (
              <p className="text-emerald-700 dark:text-emerald-400 leading-relaxed">
                ✓ Return to work plan is active — your coordinator is managing implementation. Contact them if you have questions.
              </p>
            )}
            {barrierParts.length > 0 && (
              <p className="text-amber-700 dark:text-amber-400 leading-relaxed">
                Current barriers: {barrierParts.join("; ")}.
              </p>
            )}
          </div>
        );
      })()}

      {/* ── 2. Four Status Cards ──────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">

        {/* Card 1 — Compliance */}
        <Card className={cn(
          "border-t-4",
          complianceLevel === "compliant"     ? "border-t-emerald-500" :
          complianceLevel === "at-risk"       ? "border-t-amber-500" :
                                               "border-t-red-500"
        )}>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-start justify-between mb-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Compliance</span>
              {complianceLevel === "compliant"   ? <ShieldCheck className="h-5 w-5 text-emerald-500 shrink-0" /> :
               complianceLevel === "at-risk"     ? <ShieldAlert className="h-5 w-5 text-amber-500 shrink-0" /> :
                                                   <ShieldX className="h-5 w-5 text-red-500 shrink-0" />}
            </div>
            <p className={cn(
              "text-base font-bold",
              complianceLevel === "compliant"   ? "text-emerald-700 dark:text-emerald-400" :
              complianceLevel === "at-risk"     ? "text-amber-700 dark:text-amber-400" :
                                                  "text-red-700 dark:text-red-400"
            )}>
              {complianceLevel === "compliant" ? "Compliant" :
               complianceLevel === "at-risk"   ? "At Risk" : "Non-Compliant"}
            </p>
            <p className="text-xs text-muted-foreground mt-1 leading-snug">{complianceIssue}</p>
          </CardContent>
        </Card>

        {/* Card 2 — Recovery */}
        <Card className={cn(
          "border-t-4",
          recoveryStatus === "on-track" ? "border-t-emerald-500" : "border-t-amber-500"
        )}>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-start justify-between mb-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recovery</span>
              {recoveryStatus === "on-track"
                ? <TrendingUp className="h-5 w-5 text-emerald-500 shrink-0" />
                : <TrendingDown className="h-5 w-5 text-amber-500 shrink-0" />}
            </div>
            {recoveryStatus === "on-track" ? (
              <>
                <p className="text-base font-bold text-emerald-700 dark:text-emerald-400">On Track</p>
                <p className="text-xs text-muted-foreground mt-1 leading-snug">
                  Week {weeksOff} of ~{expectedWeeks} expected — progressing as expected
                </p>
              </>
            ) : (
              <>
                <p className="text-base font-bold text-amber-700 dark:text-amber-400">Delayed</p>
                <p className="text-xs text-muted-foreground mt-1 leading-snug">
                  {weeksOff - expectedWeeks} week{weeksOff - expectedWeeks !== 1 ? "s" : ""} beyond expected recovery — escalation recommended
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Card 3 — Next Action */}
        <Card className={cn(
          "border-t-4",
          nextActionDue.overdue ? "border-t-red-500" :
          (topAction || derivedAction) ? "border-t-blue-500" : "border-t-slate-300"
        )}>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-start justify-between mb-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Next Action</span>
              <Clock className={cn("h-5 w-5 shrink-0", nextActionDue.overdue ? "text-red-500" : "text-blue-500")} />
            </div>
            <p className="text-sm font-bold leading-snug">{nextActionTitle}</p>
            {(topAction || derivedAction) && (
              <div className="mt-1.5 space-y-0.5">
                <p className="text-xs text-muted-foreground">Owner: {nextActionOwner}</p>
                <p className={cn("text-xs font-medium", nextActionDue.overdue ? "text-red-600" : "text-muted-foreground")}>
                  {nextActionDue.text}
                </p>
              </div>
            )}
            {workerCase?.rtwPlanStatus === "pending_employer_review" && onApproveRtw && (
              <div className="mt-3 space-y-2">
                {rtwPlanData?.data && (() => {
                  const { plan, schedule, duties } = rtwPlanData.data;
                  const planTypeLabel = plan.planType === "graduated_return" ? "Graduated return" : plan.planType === "partial_hours" ? "Partial hours" : "Normal hours";
                  const firstWeek = schedule[0];
                  const lastWeek = schedule[schedule.length - 1];
                  const includedDuties = duties.filter(d => d.suitability !== "not_suitable");
                  const startStr = plan.startDate ? new Date(plan.startDate).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "TBC";
                  return (
                    <div className="rounded-md border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-xs space-y-1">
                      <p className="font-semibold text-amber-900 dark:text-amber-200">Plan summary — please review before approving</p>
                      <p className="text-amber-800 dark:text-amber-300"><span className="font-medium">Type:</span> {planTypeLabel} · <span className="font-medium">Start:</span> {startStr} · <span className="font-medium">Duration:</span> {schedule.length} week{schedule.length !== 1 ? "s" : ""}</p>
                      {firstWeek && (
                        <p className="text-amber-800 dark:text-amber-300">
                          <span className="font-medium">Schedule:</span> Week 1 — {firstWeek.hoursPerDay}h/day, {firstWeek.daysPerWeek} day{firstWeek.daysPerWeek !== 1 ? "s" : ""}/wk
                          {lastWeek && lastWeek.weekNumber > 1 && ` → Week ${lastWeek.weekNumber} — ${lastWeek.hoursPerDay}h/day, ${lastWeek.daysPerWeek} day${lastWeek.daysPerWeek !== 1 ? "s" : ""}/wk`}
                        </p>
                      )}
                      {includedDuties.length > 0 && (
                        <p className="text-amber-800 dark:text-amber-300"><span className="font-medium">Duties:</span> {includedDuties.slice(0, 3).map(d => d.dutyName).join(", ")}{includedDuties.length > 3 ? ` +${includedDuties.length - 3} more` : ""}</p>
                      )}
                    </div>
                  );
                })()}
                {!showChangesInput ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="bg-emerald-500 hover:bg-emerald-600 text-white"
                      disabled={rtwApprovePending}
                      onClick={onApproveRtw}
                    >
                      {rtwApprovePending ? "Approving…" : "Approve plan"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={rtwApprovePending}
                      onClick={() => setShowChangesInput(true)}
                    >
                      Request changes
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">What needs to change?</p>
                    <textarea
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                      rows={3}
                      placeholder="e.g. The schedule is too aggressive — start at 2 days/week, not 4"
                      value={changesFeedback}
                      onChange={e => setChangesFeedback(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={!changesFeedback.trim()}
                        onClick={() => {
                          onRequestChangesRtw?.(changesFeedback.trim());
                          setShowChangesInput(false);
                          setChangesFeedback("");
                        }}
                      >
                        Send feedback
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => { setShowChangesInput(false); setChangesFeedback(""); }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {(workerCase?.rtwPlanStatus === "in_progress" || workerCase?.rtwPlanStatus === "working_well") && (
              <div className="mt-2 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
                ✓ Plan approved — coordinator is managing implementation
              </div>
            )}
          </CardContent>
        </Card>

        {/* Card 4 — Case Health / Flags */}
        <Card className={cn(
          "border-t-4",
          flags.some(f => f.severity === "red")    ? "border-t-red-500" :
          flags.some(f => f.severity === "amber")  ? "border-t-amber-500" :
                                                     "border-t-emerald-500"
        )}>
          <CardContent className="pt-4 pb-3 px-4">
            <div className="flex items-start justify-between mb-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Case Health</span>
              <Flag className={cn(
                "h-5 w-5 shrink-0",
                flags.some(f => f.severity === "red")   ? "text-red-500" :
                flags.some(f => f.severity === "amber") ? "text-amber-500" :
                                                          "text-emerald-500"
              )} />
            </div>
            <p className={cn(
              "text-base font-bold",
              flags.some(f => f.severity === "red")   ? "text-red-700 dark:text-red-400" :
              flags.some(f => f.severity === "amber") ? "text-amber-700 dark:text-amber-400" :
                                                        "text-emerald-700 dark:text-emerald-400"
            )}>
              {flags.filter(f => f.severity !== "green").length} flag{flags.filter(f => f.severity !== "green").length !== 1 ? "s" : ""}
            </p>
            <ul className="mt-1 space-y-0.5">
              {flags.slice(0, 3).map((f, i) => (
                <li key={i} className={cn(
                  "text-xs leading-snug",
                  f.severity === "red"   ? "text-red-600 dark:text-red-400" :
                  f.severity === "amber" ? "text-amber-600 dark:text-amber-400" :
                                          "text-emerald-600 dark:text-emerald-400"
                )}>
                  {f.label}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* Risk plain English row */}
      <div className="rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        <span className="font-medium text-foreground">Risk outlook: </span>
        {riskLevelToPlain(effectiveRiskLevel, weeksOff)}
      </div>

      {/* ── 3. Action Feed ───────────────────────────────────────────────── */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide px-1">Action Feed</h3>

        {recentCompleted.length === 0 && pendingFeed.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground text-sm">
              <Minus className="h-6 w-6 mx-auto mb-2 opacity-40" />
              No actions recorded yet. Actions are created when compliance checks run.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-1.5">
            {/* Pending / overdue actions */}
            {pendingFeed.map(action => {
              const due = formatRelativeDue(action.dueDate);
              const isPriorityCriticalOrHigh = action.priorityLevel === "critical" || action.priorityLevel === "high";
              const owner = action.assignedToName || action.assignedTo;
              return (
                <div
                  key={action.id}
                  className={cn(
                    "flex items-start gap-3 rounded-lg border px-4 py-3",
                    due.overdue               ? "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800" :
                    isPriorityCriticalOrHigh  ? "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800" :
                                               "bg-card border-border"
                  )}
                >
                  <div className="mt-0.5 shrink-0">
                    <Circle className={cn(
                      "h-4 w-4",
                      due.overdue ? "text-red-400" : "text-muted-foreground/40"
                    )} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{action.title || actionTypeLabel(action.type)}</p>
                    {(action.description || action.notes) && <p className="text-xs text-muted-foreground mt-0.5">{action.description ?? action.notes}</p>}
                    {owner && <p className="text-xs text-muted-foreground/70 mt-0.5">Assigned to: {owner}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className={cn("text-xs font-medium", due.overdue ? "text-red-600" : "text-muted-foreground")}>
                      {due.text}
                    </p>
                  </div>
                </div>
              );
            })}

            {/* Completed actions */}
            {recentCompleted.length > 0 && (
              <>
                {pendingFeed.length > 0 && <div className="border-t my-2" />}
                <p className="text-xs text-muted-foreground px-1 pb-0.5">Recently completed</p>
                {recentCompleted.map(action => (
                  <div
                    key={action.id}
                    className="flex items-start gap-3 rounded-lg border border-border px-4 py-3 opacity-60"
                  >
                    <div className="mt-0.5 shrink-0">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm line-through">{action.title || actionTypeLabel(action.type)}</p>
                      {action.completedBy && <p className="text-xs text-muted-foreground/70 mt-0.5">Completed by: {action.completedBy}</p>}
                    </div>
                    {action.completedAt && (
                      <p className="text-xs text-muted-foreground shrink-0">
                        {new Date(action.completedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function EmployerCaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") || "summary";
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const approveRtwMutation = useMutation({
    mutationFn: () =>
      apiRequest("PUT", `/api/cases/${id}/rtw-plan`, {
        rtwPlanStatus: "in_progress",
        reason: "Approved by employer",
      }),
    onSuccess: async () => {
      toast({ title: "RTW plan approved", description: "The Return to Work plan is now active." });
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["/api/cases"] }),
        queryClient.refetchQueries({ queryKey: ["/api/employer/dashboard"] }),
      ]);
      navigate("/employer");
    },
    onError: () => {
      toast({ title: "Failed to approve plan", variant: "destructive" });
    },
  });

  // Fetch case data - use same approach as CaseSummaryPage
  const { data: paginatedData, isLoading, error } = useQuery<PaginatedCasesResponse>({
    queryKey: ["/api/cases"],
  });
  const cases = paginatedData?.cases ?? [];
  const workerCase = cases.find((c) => c.id === id);

  // Fetch case actions
  const { data: actionsData } = useQuery<{ success: boolean; data: CaseAction[] }>({
    queryKey: [`/api/actions/case/${id}`],
    enabled: !!id,
  });

  const caseActions = actionsData?.data ?? [];

  // Parse injury details from AI summary markdown tables
  const parseInjuryFromSummary = (summary: string | null | undefined) => {
    if (!summary) return {};

    const result: Record<string, string> = {};

    // Find the Injury Details section
    const injurySection = summary.match(/## Injury Details[\s\S]*?(?=\n---|\n##|$)/i);
    if (!injurySection) return {};

    // Parse table rows: | Field | Value |
    const tableRows = injurySection[0].match(/\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/g);
    if (!tableRows) return {};

    for (const row of tableRows) {
      const match = row.match(/\|\s*([^|]+)\s*\|\s*([^|]+)\s*\|/);
      if (match) {
        const field = match[1].trim().toLowerCase();
        const value = match[2].trim();
        // Skip header rows and insufficient data
        if (field !== 'field' && field !== '-------' && value !== 'Value' &&
            value.toLowerCase() !== 'insufficient data' && value !== '-------') {
          result[field] = value;
        }
      }
    }

    return result;
  };

  const injuryFromSummary = parseInjuryFromSummary(aiSummary || workerCase?.aiSummary);

  // Derive risk level from XGBoost score embedded in AI summary (overrides stored riskLevel when present)
  const parseXGBoostRiskLevel = (summary: string | null | undefined): "High" | "Medium" | "Low" | null => {
    if (!summary) return null;
    const match = summary.match(/XGBoost\s+(?:risk(?:\s+index)?|probability|stability score|resilience score)\s+([\d.]+)/i);
    if (!match) return null;
    const score = parseFloat(match[1]);
    if (isNaN(score)) return null;
    if (score >= 0.61) return "High";
    if (score >= 0.31) return "Medium";
    return "Low";
  };

  const effectiveRiskLevel = parseXGBoostRiskLevel(aiSummary || workerCase?.aiSummary) ?? workerCase?.riskLevel;

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-lg">Loading case details...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-lg text-red-600">Error loading case details. Please try again.</div>
      </div>
    );
  }

  if (!workerCase) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-lg">Case not found.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b bg-card sticky top-0 z-10">
        <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="shrink-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-lg font-bold truncate">
                {workerCase.workerId ? (
                  <Link
                    to={`/workers/${workerCase.workerId}`}
                    className="hover:underline focus:underline focus:outline-none"
                  >
                    {workerCase.workerName}
                  </Link>
                ) : (
                  workerCase.workerName
                )}
              </h1>
              <p className="text-xs text-muted-foreground truncate">
                {workerCase.company} • Injured {formatCertDate(workerCase.dateOfInjury)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={cn(
              "text-xs",
              workerCase.workStatus === "At work"
                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-100"
                : "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100"
            )}>
              {workerCase.workStatus}
            </Badge>
            <Badge variant="outline" className={cn(
              "text-xs border",
              (effectiveRiskLevel || workerCase.riskLevel || "").toLowerCase() === "high"
                ? "border-red-300 text-red-700"
                : (effectiveRiskLevel || workerCase.riskLevel || "").toLowerCase() === "medium"
                ? "border-yellow-300 text-yellow-700"
                : "border-emerald-300 text-emerald-700"
            )}>
              {effectiveRiskLevel || workerCase.riskLevel || "Unknown"}
            </Badge>
            <AutoDraftButton caseId={workerCase.id} />
          </div>
        </div>
      </div>

      {/* Auto-draft RTW plan banner (only renders when an auto-generated draft exists) */}
      <div className="px-4 pt-4">
        <AutoDraftRTWPlanBanner caseId={workerCase.id} />
      </div>

      {/* Tabs at the top */}
      <Tabs defaultValue={initialTab} className="flex-1 flex flex-col">
        {/* Ultra-Modern Tabs with Glassmorphism */}
        <div className="relative border-b bg-gradient-to-r from-slate-50 via-white to-slate-50 dark:from-slate-900 dark:via-slate-800 dark:to-slate-900 px-4 py-3 overflow-x-auto backdrop-blur-xl">
          <div className="absolute inset-0 bg-gradient-to-r from-purple-500/5 via-blue-500/5 to-teal-500/5 pointer-events-none"></div>
          <TabsList className="relative inline-flex h-12 w-max gap-2 bg-white/40 dark:bg-slate-800/60 backdrop-blur-md p-1 rounded-xl border border-white/20 dark:border-slate-700 shadow-2xl">
            <TabsTrigger
              value="summary"
              className="relative px-4 py-2 text-sm font-medium rounded-lg transition-all duration-300
                         data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-500 data-[state=active]:to-blue-500
                         data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-purple-500/25
                         hover:bg-white/60 dark:hover:bg-slate-700/60 hover:shadow-md text-slate-700 dark:text-slate-200"
            >
              Summary
            </TabsTrigger>
            <TabsTrigger
              value="injury"
              className="relative px-4 py-2 text-sm font-medium rounded-lg transition-all duration-300
                         data-[state=active]:bg-gradient-to-r data-[state=active]:from-emerald-500 data-[state=active]:to-teal-500
                         data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-emerald-500/25
                         hover:bg-white/60 dark:hover:bg-slate-700/60 hover:shadow-md text-slate-700 dark:text-slate-200"
            >
              Injury & Diagnosis
            </TabsTrigger>
            <TabsTrigger
              value="treatment"
              className="relative px-4 py-2 text-sm font-medium rounded-lg transition-all duration-300
                         data-[state=active]:bg-gradient-to-r data-[state=active]:from-pink-500 data-[state=active]:to-rose-500
                         data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-pink-500/25
                         hover:bg-white/60 dark:hover:bg-slate-700/60 hover:shadow-md text-slate-700 dark:text-slate-200"
            >
              Treatment & Recovery
            </TabsTrigger>
            <TabsTrigger
              value="timeline"
              className="relative px-4 py-2 text-sm font-medium rounded-lg transition-all duration-300
                         data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-500 data-[state=active]:to-purple-500
                         data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-indigo-500/25
                         hover:bg-white/60 dark:hover:bg-slate-700/60 hover:shadow-md text-slate-700 dark:text-slate-200"
            >
              Timeline
            </TabsTrigger>
            <TabsTrigger
              value="financial"
              className="relative px-4 py-2 text-sm font-medium rounded-lg transition-all duration-300
                         data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber-500 data-[state=active]:to-orange-500
                         data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-amber-500/25
                         hover:bg-white/60 dark:hover:bg-slate-700/60 hover:shadow-md text-slate-700 dark:text-slate-200"
            >
              Financial
            </TabsTrigger>
            <TabsTrigger
              value="risk"
              className="relative px-4 py-2 text-sm font-medium rounded-lg transition-all duration-300
                         data-[state=active]:bg-gradient-to-r data-[state=active]:from-red-500 data-[state=active]:to-pink-500
                         data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-red-500/25
                         hover:bg-white/60 dark:hover:bg-slate-700/60 hover:shadow-md text-slate-700 dark:text-slate-200"
            >
              Risk
            </TabsTrigger>
            <TabsTrigger
              value="contacts"
              className="relative px-4 py-2 text-sm font-medium rounded-lg transition-all duration-300
                         data-[state=active]:bg-gradient-to-r data-[state=active]:from-slate-500 data-[state=active]:to-gray-500
                         data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-slate-500/25
                         hover:bg-white/60 dark:hover:bg-slate-700/60 hover:shadow-md text-slate-700 dark:text-slate-200"
            >
              Contacts
            </TabsTrigger>
          </TabsList>
        </div>

        {/* Tab Content */}
        <TabsContent value="summary" className="flex-1 overflow-y-auto">
          <CommandCentre
            workerCase={workerCase}
            caseActions={caseActions}
            effectiveRiskLevel={effectiveRiskLevel ?? workerCase.riskLevel ?? "Unknown"}
            onApproveRtw={() => approveRtwMutation.mutate()}
            onRequestChangesRtw={async (feedback: string) => {
              const reason = feedback || "Employer requested changes to the RTW plan";
              await apiRequest("PUT", `/api/cases/${id}/rtw-plan`, {
                rtwPlanStatus: "planned_not_started",
                reason,
              });
              // Create a coordinator action with Sarah's feedback so it surfaces in their queue
              await apiRequest("POST", `/api/actions/case/${id}`, {
                type: "review_case",
                notes: `Employer requested RTW plan changes: "${reason}"`,
                priority: 1,
              }).catch(() => {}); // best-effort
              toast({ title: "Changes requested", description: "Your feedback has been sent to the coordinator." });
              await Promise.all([
                queryClient.refetchQueries({ queryKey: ["/api/cases"] }),
                queryClient.refetchQueries({ queryKey: ["/api/employer/dashboard"] }),
              ]);
              navigate("/employer");
            }}
            rtwApprovePending={approveRtwMutation.isPending}
          />
        </TabsContent>

        <TabsContent value="injury" className="flex-1 p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Injury Details Section */}
            <Card>
              <CardHeader>
                <CardTitle>Injury Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <div className="flex border-b pb-2">
                    <div className="w-40 text-sm font-medium">Injury</div>
                    <div className="text-sm flex-1">
                      {workerCase.clinical_status_json?.treatmentPlan?.injuryType ||
                       injuryFromSummary['injury'] ||
                       (workerCase.summary ? workerCase.summary.split(/[.;]/)[0].trim() : "Not specified")}
                    </div>
                  </div>
                  <div className="flex border-b pb-2">
                    <div className="w-40 text-sm font-medium">Date of Onset</div>
                    <div className="text-sm flex-1">
                      {injuryFromSummary['date of onset'] || formatCertDate(workerCase.dateOfInjury) || "Not recorded"}
                    </div>
                  </div>
                  {((workerCase.medicalConstraints as Record<string, string> | undefined)?.mechanism || injuryFromSummary['mechanism']) && (
                    <div className="flex border-b pb-2">
                      <div className="w-40 text-sm font-medium">Mechanism</div>
                      <div className="text-sm flex-1">
                        {(workerCase.medicalConstraints as Record<string, string> | undefined)?.mechanism || injuryFromSummary['mechanism']}
                      </div>
                    </div>
                  )}
                  {((workerCase.medicalConstraints as Record<string, string> | undefined)?.treatingGp || injuryFromSummary['treating gp']) && (
                    <div className="flex border-b pb-2">
                      <div className="w-40 text-sm font-medium">Treating GP</div>
                      <div className="text-sm flex-1">
                        {(workerCase.medicalConstraints as Record<string, string> | undefined)?.treatingGp || injuryFromSummary['treating gp']}
                      </div>
                    </div>
                  )}
                  {((workerCase.medicalConstraints as Record<string, string> | undefined)?.physiotherapist || injuryFromSummary['physiotherapist']) && (
                    <div className="flex border-b pb-2">
                      <div className="w-40 text-sm font-medium">Physiotherapist</div>
                      <div className="text-sm flex-1">
                        {(workerCase.medicalConstraints as Record<string, string> | undefined)?.physiotherapist || injuryFromSummary['physiotherapist']}
                      </div>
                    </div>
                  )}
                  {(injuryFromSummary['orp'] || injuryFromSummary['specialists']) && (
                    <div className="flex border-b pb-2">
                      <div className="w-40 text-sm font-medium">ORP/Specialist</div>
                      <div className="text-sm flex-1">
                        {injuryFromSummary['orp'] || injuryFromSummary['specialists']}
                      </div>
                    </div>
                  )}
                  {(injuryFromSummary['case manager'] || (workerCase.owner && workerCase.owner !== "Unassigned")) && (
                    <div className="flex border-b pb-2">
                      <div className="w-40 text-sm font-medium">Case Manager</div>
                      <div className="text-sm flex-1">
                        {injuryFromSummary['case manager'] || workerCase.owner}
                      </div>
                    </div>
                  )}
                  <div className="flex pb-2">
                    <div className="w-40 text-sm font-medium">Work Status</div>
                    <div className="text-sm flex-1">{workerCase.workStatus}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Diagnosis Section */}
            <Card>
              <CardHeader>
                <CardTitle>Diagnosis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Medical Diagnosis */}
                  <div>
                    <h4 className="text-sm font-semibold text-primary mb-2">Medical Diagnosis</h4>
                    <p className="text-sm">
                      {workerCase.clinical_status_json?.treatmentPlan?.diagnosisSummary ||
                       workerCase.clinical_status_json?.treatmentPlan?.injuryType ||
                       workerCase.summary ||
                       "Diagnosis details not yet recorded"}
                    </p>
                  </div>

                  {/* Scans & Imaging - Only show actual attachments */}
                  <div>
                    <h4 className="text-sm font-semibold text-primary mb-2">Scans & Imaging</h4>
                    {(() => {
                      const imagingAttachments = workerCase.attachments?.filter(att =>
                        ['x-ray', 'xray', 'mri', 'ct', 'ultrasound', 'scan', 'imaging'].some(term =>
                          att.name.toLowerCase().includes(term) || att.type.toLowerCase().includes(term)
                        )
                      ) || [];

                      if (imagingAttachments.length > 0) {
                        return (
                          <div className="space-y-2">
                            {imagingAttachments.map(att => (
                              <div key={att.id} className="flex items-center justify-between p-2 bg-muted rounded text-sm">
                                <span>{att.name}</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => window.open(att.url, '_blank')}
                                >
                                  View
                                </Button>
                              </div>
                            ))}
                          </div>
                        );
                      }

                      // Psychological/stress injuries don't require imaging
                      const summaryLower = (workerCase.summary || workerCase.aiSummary || "").toLowerCase();
                      const isPsychological = ['psychological', 'mental', 'stress', 'anxiety', 'depression', 'ptsd', 'psychiatric'].some(t => summaryLower.includes(t));
                      if (isPsychological) {
                        return (
                          <p className="text-sm text-muted-foreground">Not applicable for psychological injuries. Medical/psychiatric assessments are managed by the case manager.</p>
                        );
                      }
                      return (
                        <div className="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded text-sm">
                          <p className="text-amber-800 dark:text-amber-200">No imaging results on file</p>
                          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
                            Consider requesting X-ray, MRI, or ultrasound if clinically indicated
                          </p>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Test Results - Only show actual attachments */}
                  <div>
                    <h4 className="text-sm font-semibold text-primary mb-2">Test Results</h4>
                    {(() => {
                      const testAttachments = workerCase.attachments?.filter(att =>
                        ['blood', 'pathology', 'lab', 'test', 'nerve', 'conduction', 'emg', 'ecg'].some(term =>
                          att.name.toLowerCase().includes(term) || att.type.toLowerCase().includes(term)
                        )
                      ) || [];

                      if (testAttachments.length > 0) {
                        return (
                          <div className="space-y-2">
                            {testAttachments.map(att => (
                              <div key={att.id} className="flex items-center justify-between p-2 bg-muted rounded text-sm">
                                <span>{att.name}</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => window.open(att.url, '_blank')}
                                >
                                  View
                                </Button>
                              </div>
                            ))}
                          </div>
                        );
                      }
                      return (
                        <div className="p-3 bg-muted rounded text-sm text-muted-foreground">
                          No test results on file
                        </div>
                      );
                    })()}
                  </div>

                  {/* Medical Certificates */}
                  <div>
                    <h4 className="text-sm font-semibold text-primary mb-2">Medical Certificates</h4>
                    {(() => {
                      const certAttachments = workerCase.attachments?.filter(att =>
                        ['certificate', 'cert', 'medical cert', 'worksafe'].some(term =>
                          att.name.toLowerCase().includes(term) || att.type.toLowerCase().includes(term)
                        )
                      ) || [];

                      if (certAttachments.length > 0 || workerCase.latestCertificate) {
                        return (
                          <div className="space-y-2">
                            {workerCase.latestCertificate && (
                              <div
                                className={cn(
                                  "flex items-center justify-between p-2 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded text-sm",
                                  workerCase.latestCertificate.documentUrl && "cursor-pointer hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
                                )}
                                onClick={() => {
                                  if (workerCase.latestCertificate?.documentUrl) {
                                    window.open(workerCase.latestCertificate.documentUrl, '_blank');
                                  }
                                }}
                              >
                                <div>
                                  <span className="font-medium">Current Certificate</span>
                                  <p className="text-xs text-muted-foreground">
                                    Valid: {formatCertDate(workerCase.latestCertificate.startDate)} to {formatCertDate(workerCase.latestCertificate.endDate)}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-800 dark:text-emerald-100">Active</Badge>
                                  {workerCase.latestCertificate.documentUrl && (
                                    <Button variant="ghost" size="sm" className="h-6 text-xs px-2">View</Button>
                                  )}
                                </div>
                              </div>
                            )}
                            {certAttachments.map(att => (
                              <div key={att.id} className="flex items-center justify-between p-2 bg-muted rounded text-sm">
                                <span>{att.name}</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => window.open(att.url, '_blank')}
                                >
                                  View
                                </Button>
                              </div>
                            ))}
                          </div>
                        );
                      }
                      return (
                        <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded text-sm">
                          <p className="text-red-800 dark:text-red-200 font-medium">No medical certificate on file</p>
                          <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                            Action required: Request current medical certificate
                          </p>
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="timeline" className="flex-1 p-6">
          <TimelineCard caseId={id!} />
        </TabsContent>


        <TabsContent value="financial" className="flex-1 p-6">
          {(() => {
            // Australian workers comp average: ~$1,350/week income replacement
            const AVG_WEEKLY_COMP = 1350;
            const weeksOff = calcWeeksOffWork(workerCase.dateOfInjury);
            const isOffWork = workerCase.workStatus !== "At work";
            const costToDate = isOffWork ? weeksOff * AVG_WEEKLY_COMP : 0;
            // Estimated remaining based on risk level heuristic
            const riskBasedTotalWeeks =
              (effectiveRiskLevel || workerCase.riskLevel || "").toLowerCase() === "high" ? 26 :
              (effectiveRiskLevel || workerCase.riskLevel || "").toLowerCase() === "medium" ? 12 : 6;
            const isLongDuration = isOffWork && weeksOff > riskBasedTotalWeeks;
            // Long-duration: use 13-week rolling estimate (ongoing); normal: remaining to estimate
            const remainingWeeks = isOffWork
              ? (isLongDuration ? 13 : Math.max(0, riskBasedTotalWeeks - weeksOff))
              : 0;
            const projectedFutureCost = remainingWeeks * AVG_WEEKLY_COMP;
            const totalEstimate = costToDate + projectedFutureCost;
            const fmt = (n: number) => `$${n.toLocaleString()}`;
            return (
              <div className="space-y-4">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Claim Cost Estimate</CardTitle>
                    <p className="text-xs text-muted-foreground">Based on Australian average workers compensation ($1,350/week). Actual amounts depend on PIAWE calculation and insurer.</p>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-3 gap-4 mb-4">
                      <div className="rounded-lg border bg-muted/30 p-4 text-center">
                        <div className="text-2xl font-bold text-foreground">{fmt(costToDate)}</div>
                        <div className="text-xs text-muted-foreground mt-1">Est. paid to date</div>
                        <div className="text-xs text-muted-foreground">{weeksOff} weeks</div>
                      </div>
                      <div className="rounded-lg border bg-amber-50 p-4 text-center">
                        <div className="text-2xl font-bold text-amber-700">{fmt(projectedFutureCost)}</div>
                        <div className="text-xs text-muted-foreground mt-1">Projected future cost</div>
                        <div className="text-xs text-muted-foreground">{isLongDuration ? "Ongoing — ~13 wks rolling est." : `${remainingWeeks} weeks remaining (est.)`}</div>
                      </div>
                      <div className="rounded-lg border bg-blue-50 p-4 text-center">
                        <div className="text-2xl font-bold text-blue-700">{fmt(totalEstimate)}</div>
                        <div className="text-xs text-muted-foreground mt-1">Total claim estimate</div>
                        <div className="text-xs text-muted-foreground">{isLongDuration ? `${weeksOff}+ weeks (ongoing)` : `${riskBasedTotalWeeks} weeks total (est.)`}</div>
                      </div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex border-b pb-2">
                        <div className="w-56 font-medium text-muted-foreground">Worker status</div>
                        <div>{workerCase.workStatus}</div>
                      </div>
                      <div className="flex border-b pb-2">
                        <div className="w-56 font-medium text-muted-foreground">Weeks since injury</div>
                        <div>{weeksOff} weeks</div>
                      </div>
                      <div className="flex border-b pb-2">
                        <div className="w-56 font-medium text-muted-foreground">Estimated weekly rate</div>
                        <div>$1,350/week (Australian avg)</div>
                      </div>
                      <div className="flex">
                        <div className="w-56 font-medium text-muted-foreground">Risk level</div>
                        <div>{effectiveRiskLevel || workerCase.riskLevel || "Unknown"}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                {weeksOff > 26 && (
                  <Card className="border-red-200 bg-red-50">
                    <CardContent className="pt-4">
                      <div className="flex gap-2 text-sm text-red-800">
                        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium">Long-duration claim</p>
                          <p className="text-xs text-red-600 mt-1">This case has exceeded 26 weeks. Review with your insurer about claim classification and consider escalating RTW planning.</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            );
          })()}
        </TabsContent>

        <TabsContent value="risk" className="flex-1 p-6">
          {(() => {
            const weeksOff = calcWeeksOffWork(workerCase.dateOfInjury);
            const isOffWork = workerCase.workStatus !== "At work";
            const compliance = (workerCase.complianceIndicator || "").toLowerCase();
            const riskLevel = (effectiveRiskLevel || workerCase.riskLevel || "").toLowerCase();

            type RiskFactor = { label: string; likelihood: "high" | "medium" | "low"; impact: "high" | "medium" | "low"; mitigation: string };
            const factors: RiskFactor[] = [];

            // 1. Duration risk
            if (weeksOff >= 26 && isOffWork) {
              factors.push({ label: "Long-duration absence", likelihood: "high", impact: "high", mitigation: "Escalate to senior case manager. Schedule IME. Review insurer claim classification." });
            } else if (weeksOff >= 13 && isOffWork) {
              factors.push({ label: "Extended absence", likelihood: "medium", impact: "high", mitigation: "Confirm RTW plan is active. Review barriers to return." });
            } else if (weeksOff >= 4 && isOffWork) {
              factors.push({ label: "Absence exceeding 4 weeks", likelihood: "medium", impact: "medium", mitigation: "Confirm graduated RTW plan is in place with treating GP." });
            }

            // 2. Certificate / compliance risk
            if (!workerCase.hasCertificate && isOffWork) {
              factors.push({ label: "No medical certificate on file", likelihood: "high", impact: "high", mitigation: "Request certificate immediately. Claim may be at risk without valid certification." });
            } else if (compliance === "low" || compliance === "very low") {
              factors.push({ label: "Low compliance — case file incomplete", likelihood: "high", impact: "medium", mitigation: "Review missing documentation with case coordinator. Complete claim requirements." });
            } else if (compliance === "medium") {
              factors.push({ label: "Partial compliance", likelihood: "medium", impact: "low", mitigation: "Follow up on outstanding items with case coordinator." });
            }

            // 3. RTW plan risk
            if (!workerCase.rtwPlanStatus && weeksOff >= 2 && isOffWork) {
              factors.push({ label: "No return-to-work plan", likelihood: "high", impact: "high", mitigation: "Initiate RTW planning with treating doctor and insurer. Delayed RTW plans increase long-term risk." });
            }

            // 4. Overall risk level
            if (riskLevel === "high" || riskLevel === "very high") {
              factors.push({ label: "High clinical risk classification", likelihood: "high", impact: "high", mitigation: "Monitor weekly. Ensure specialist involvement. Consider vocational assessment." });
            } else if (riskLevel === "medium") {
              factors.push({ label: "Moderate clinical risk", likelihood: "medium", impact: "medium", mitigation: "Bi-weekly check-ins with worker. Confirm treatment is progressing." });
            }

            // 5. Claim complexity (ticket count as proxy)
            if ((workerCase.ticketCount || 1) >= 5) {
              factors.push({ label: "High claim complexity", likelihood: "medium", impact: "medium", mitigation: "Multiple updates suggest complex case. Ensure all parties (insurer, GP, employer) are aligned." });
            }

            const likelihoodColor = (l: string) =>
              l === "high" ? "bg-red-100 text-red-800" : l === "medium" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800";
            const impactColor = (i: string) =>
              i === "high" ? "bg-red-100 text-red-800" : i === "medium" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800";

            const highCount = factors.filter(f => f.likelihood === "high").length;
            const overallBg = highCount >= 2 ? "border-red-200 bg-red-50" : highCount === 1 ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50";
            const overallText = highCount >= 2 ? "text-red-800" : highCount === 1 ? "text-amber-800" : "text-green-800";
            const overallLabel = highCount >= 2 ? "High Risk — Immediate Action Required" : highCount === 1 ? "Moderate Risk — Monitor Closely" : "Low Risk — Routine Management";

            return (
              <div className="space-y-4">
                <Card className={cn("border", overallBg)}>
                  <CardContent className="pt-4 pb-3">
                    <div className="flex items-center gap-2">
                      {highCount >= 2 ? <ShieldX className={cn("w-5 h-5", overallText)} /> : highCount === 1 ? <ShieldAlert className={cn("w-5 h-5", overallText)} /> : <ShieldCheck className={cn("w-5 h-5", overallText)} />}
                      <span className={cn("font-semibold text-sm", overallText)}>{overallLabel}</span>
                    </div>
                    <p className={cn("text-xs mt-1 ml-7", overallText.replace("800", "600"))}>{factors.length} risk factor{factors.length !== 1 ? "s" : ""} identified across duration, compliance, and clinical dimensions.</p>
                  </CardContent>
                </Card>

                {factors.length > 0 ? (
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Risk Factors</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                      <div className="divide-y">
                        {factors.map((f, idx) => (
                          <div key={idx} className="grid grid-cols-[2fr_1fr_1fr_3fr] gap-3 p-3 text-sm items-start">
                            <div className="font-medium">{f.label}</div>
                            <div><span className={cn("px-2 py-0.5 rounded text-xs capitalize", likelihoodColor(f.likelihood))}>{f.likelihood}</span></div>
                            <div><span className={cn("px-2 py-0.5 rounded text-xs capitalize", impactColor(f.impact))}>{f.impact}</span></div>
                            <div className="text-muted-foreground text-xs">{f.mitigation}</div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="border-green-200 bg-green-50">
                    <CardContent className="pt-4">
                      <div className="flex gap-2 text-sm text-green-800">
                        <ShieldCheck className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium">No significant risk factors identified</p>
                          <p className="text-xs text-green-600 mt-1">This case appears to be progressing within expected parameters. Continue routine management.</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            );
          })()}
        </TabsContent>

        <TabsContent value="contacts" className="flex-1 p-6">
          <CaseContactsPanel
            caseId={id!}
            workerName={workerCase.workerName}
            company={workerCase.company}
            readOnly
          />
        </TabsContent>

        <TabsContent value="treatment" className="flex-1 p-6">
          <div className="treatment-tab-container space-y-6">
            {/* Hero Section - Full-Width Recovery Dashboard */}
            <div className="recovery-hero-section">
              {id && (
                <Suspense fallback={<ChartLoader />}>
                  <DynamicRecoveryTimeline caseId={id} readOnly />
                </Suspense>
              )}
            </div>

            {/* Supporting Information - Treatment Plan & Diagnosis Grid */}
            <div className="treatment-supporting-info grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Treatment Plan Section — clinical plans are not accessible to employer accounts */}
              <div className="treatment-left-column">
                <GlassPanel className="h-full" variant="gradient">
                  <div className="p-6 flex flex-col items-center justify-center text-center min-h-[200px]">
                    <span className="material-symbols-outlined text-4xl text-white/40 mb-3">lock</span>
                    <h3 className="text-sm font-semibold text-white/80 mb-1">Treatment Plan</h3>
                    <p className="text-xs text-white/50">Clinical treatment details are managed by the case manager and are not available in the employer view.</p>
                  </div>
                </GlassPanel>
              </div>

              {/* Diagnosis Section */}
              <div className="treatment-right-column">
                <GlassPanel className="diagnosis-glass-card h-full" variant="gradient">
                  <div className="p-6">
                    <div className="border-b border-white/20 pb-4 mb-6">
                      <h3 className="flex items-center gap-2 text-base font-semibold text-white">
                        <span className="material-symbols-outlined text-white/90">diagnosis</span>
                        Medical Diagnosis
                      </h3>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-sm font-semibold text-white/90 mb-2">Primary Diagnosis</h4>
                        <p className="text-sm text-white/80">{workerCase.summary || "Diagnosis details pending"}</p>
                        <p className="text-sm text-white/60">Injury Date: {formatCertDate(workerCase.dateOfInjury)}</p>
                      </div>
                      <div>
                        <h4 className="text-sm font-semibold text-white/90 mb-2">Work Status</h4>
                        <p className="text-sm text-white/80">{workerCase.workStatus}</p>
                      </div>
                      {workerCase.rtwPlanStatus && (
                        <div>
                          <h4 className="text-sm font-semibold text-white/90 mb-2">RTW Plan</h4>
                          <p className={cn(
                            "text-sm font-medium",
                            workerCase.rtwPlanStatus === "pending_employer_review" ? "text-yellow-300" :
                            workerCase.rtwPlanStatus === "in_progress" || workerCase.rtwPlanStatus === "working_well" ? "text-emerald-300" :
                            workerCase.rtwPlanStatus === "failing" ? "text-red-300" :
                            "text-white/80"
                          )}>
                            {workerCase.rtwPlanStatus === "pending_employer_review" ? "Awaiting your approval" :
                             workerCase.rtwPlanStatus === "in_progress" ? "In progress" :
                             workerCase.rtwPlanStatus === "working_well" ? "On track" :
                             workerCase.rtwPlanStatus === "failing" ? "Failing — intervention needed" :
                             workerCase.rtwPlanStatus === "planned_not_started" ? "Planned, not started" :
                             workerCase.rtwPlanStatus === "on_hold" ? "On hold" :
                             workerCase.rtwPlanStatus === "completed" ? "Completed" :
                             workerCase.rtwPlanStatus}
                          </p>
                          {workerCase.rtwPlanStatus === "pending_employer_review" && (
                            <div className="flex gap-2 mt-3">
                              <Button
                                size="sm"
                                className="bg-emerald-500 hover:bg-emerald-600 text-white"
                                disabled={approveRtwMutation.isPending}
                                onClick={() => approveRtwMutation.mutate()}
                              >
                                {approveRtwMutation.isPending ? "Approving…" : "Approve plan"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="border-white/30 text-white/80 hover:bg-white/10"
                                disabled={approveRtwMutation.isPending}
                                onClick={async () => {
                                  const feedback = window.prompt("What changes are needed? (Your feedback goes to the coordinator)");
                                  if (feedback === null) return; // cancelled
                                  const reason = feedback.trim() || "Employer requested changes to the RTW plan";
                                  await apiRequest("PUT", `/api/cases/${id}/rtw-plan`, {
                                    rtwPlanStatus: "planned_not_started",
                                    reason,
                                  });
                                  await apiRequest("POST", `/api/actions/case/${id}`, {
                                    type: "review_case",
                                    notes: `Employer requested RTW plan changes: "${reason}"`,
                                    priority: 1,
                                  }).catch(() => {});
                                  toast({ title: "Changes requested", description: "Your feedback has been sent to the coordinator." });
                                  await Promise.all([
                                    queryClient.refetchQueries({ queryKey: ["/api/cases"] }),
                                    queryClient.refetchQueries({ queryKey: ["/api/employer/dashboard"] }),
                                  ]);
                                  navigate("/employer");
                                }}
                              >
                                Request changes
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                      <div>
                        <h4 className="text-sm font-semibold text-white/90 mb-2">Risk Level</h4>
                        <Badge className={cn(
                          effectiveRiskLevel === "High" ? "bg-gradient-to-r from-red-500 to-pink-500 text-white shadow-lg shadow-red-500/25" :
                          effectiveRiskLevel === "Medium" ? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/25" :
                          "bg-gradient-to-r from-emerald-500 to-green-500 text-white shadow-lg shadow-emerald-500/25"
                        )}>
                          {effectiveRiskLevel}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </GlassPanel>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}