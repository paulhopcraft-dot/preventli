import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Suspense, lazy } from "react";
import { PageLayout } from "@/components/PageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TimelineCard } from "@/components/TimelineCard";
import { PageSpinner } from "@/components/typography";
import {
  RefreshCw,
  SearchX,
  ArrowLeft,
  ShieldCheck,
  TrendingUp,
  Brain,
  Info,
  ClipboardList,
  Ban,
  FileText,
  Shield,
  AlertTriangle,
  Gavel,
  Flag,
  Accessibility,
  BadgeCheck,
  ShieldPlus,
  AlertCircle,
  CalendarDays,
  Users as UsersIcon,
  Paperclip,
} from "lucide-react";
import type { WorkerCase, PaginatedCasesResponse, CaseLifecycleStage } from "@shared/schema";
import { LIFECYCLE_STAGE_LABELS } from "@shared/schema";
import { cn } from "@/lib/utils";
import { CaseContactsPanel } from "@/components/CaseContactsPanel";
import { FinancialSummaryPanel } from "@/components/FinancialSummaryPanel";
import { LifecycleStepper } from "@/components/LifecycleStepper";
import { CurrentCapacityCard } from "@/components/CurrentCapacityCard";
import { ComponentErrorBoundary } from "@/components/ErrorBoundary";
import { ContextualHelpSystem } from "@/components/unified-case-management/ContextualHelpSystem";
import { SmartRTWPlanning } from "@/components/unified-case-management/SmartRTWPlanning";
import { CaseActionPanel } from "@/components/CaseActionPanel";
import { MilestoneClock } from "@/components/MilestoneClock";
import ContactSuppressionBadge from "@/components/ContactSuppressionBadge";
import ClaimCostCard from "@/components/ClaimCostCard";
import EngagementScoreBadge from "@/components/EngagementScoreBadge";
import EscalateToInsurerButton from "@/components/EscalateToInsurerButton";
import AuditTrailLink from "@/components/AuditTrailLink";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Lazy load the modern recovery timeline component
const DynamicRecoveryTimeline = lazy(() => import("@/components/DynamicRecoveryTimeline").then(m => ({ default: m.DynamicRecoveryTimeline })));

export default function CaseSummaryPage() {
  const { id } = useParams<{ id: string }>();

  const { data: paginatedData, isLoading } = useQuery<PaginatedCasesResponse>({
    queryKey: ["/api/cases?limit=200"],
  });
  const cases = paginatedData?.cases ?? [];

  const workerCase = cases.find((c) => c.id === id);

  // Fetch dynamic timeline estimate
  const { data: timelineEstimate } = useQuery<{ estimatedCompletionDate?: string }>({
    queryKey: [`/api/cases/${id}/timeline-estimate`],
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <PageLayout title="Case Summary" subtitle="Loading...">
        <PageSpinner label="Loading case summary..." />
      </PageLayout>
    );
  }

  if (!workerCase) {
    return (
      <PageLayout title="Case Not Found">
        <Card>
          <CardContent className="py-8 text-center">
            <SearchX className="w-10 h-10 text-muted-foreground mb-4 mx-auto" />
            <p className="text-muted-foreground mb-4">
              The requested case could not be found.
            </p>
            <Link to="/cases">
              <Button>Back to Cases</Button>
            </Link>
          </CardContent>
        </Card>
      </PageLayout>
    );
  }

  const riskBadgeVariant = (level: string): "critical" | "warning" | "success" => {
    switch (level) {
      case "High":
        return "critical";
      case "Medium":
        return "warning";
      default:
        return "success";
    }
  };

  // Use dynamic timeline estimate if available, fallback to 12-week default
  const expectedRecoveryDate = timelineEstimate?.estimatedCompletionDate
    ? new Date(timelineEstimate.estimatedCompletionDate)
    : (() => {
        const fallback = new Date(workerCase.dateOfInjury);
        fallback.setDate(fallback.getDate() + 12 * 7);
        return fallback;
      })();

  return (
    <PageLayout
      title={workerCase.workerName}
      subtitle={`${workerCase.company} - Case ${workerCase.id}`}
    >
      <div className="space-y-6">
        {/* Back Button */}
        <div>
          <Link to="/cases">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1 inline" />
              Back to Cases
            </Button>
          </Link>
        </div>

        {/* Phase 11.1 — Related claims banner */}
        {workerCase.relatedCaseIds && workerCase.relatedCaseIds.length > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            <span className="font-semibold">
              This worker has {workerCase.relatedCaseIds.length} related claim{workerCase.relatedCaseIds.length !== 1 ? "s" : ""}:
            </span>
            {workerCase.relatedCaseIds.map((relId) => (
              <Link key={relId} to={`/cases/${relId}`} className="underline hover:text-amber-900">
                {relId.slice(0, 8)}…
              </Link>
            ))}
          </div>
        )}

        {/* Phase 11.2 — Dispute status banner */}
        {workerCase.disputeStatus && workerCase.disputeStatus !== "none" && workerCase.disputeStatus !== "resolved" && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
            <span className="font-bold">DISPUTED:</span>
            <span>{workerCase.disputeStatus.replace(/_/g, " ")}</span>
          </div>
        )}

        {/* Lifecycle Stage Stepper */}
        {workerCase.lifecycleStage && (
          <Card className="p-4">
            <LifecycleStepper
              currentStage={workerCase.lifecycleStage as CaseLifecycleStage}
              changedAt={workerCase.lifecycleStageChangedAt}
              changedBy={workerCase.lifecycleStageChangedBy}
              reason={workerCase.lifecycleStageReason}
            />
          </Card>
        )}

        {/* Status Bar */}
        <div className="border border-border rounded-lg p-4 bg-muted/50 flex items-center gap-4 flex-wrap">
          <Badge variant={workerCase.workStatus === "At work" ? "success" : "warning"}>
            {workerCase.workStatus}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              workerCase.complianceIndicator === "Very High" ||
              workerCase.complianceIndicator === "High"
                ? "border-emerald-300 text-emerald-700"
                : workerCase.complianceIndicator === "Medium"
                ? "border-amber-300 text-amber-700"
                : "border-red-300 text-red-700"
            )}
          >
            Compliance: {workerCase.complianceIndicator}
          </Badge>
          {workerCase.workerId && (
            <ContactSuppressionBadge workerId={workerCase.workerId} />
          )}
          {workerCase.workerId && (
            <EngagementScoreBadge workerId={workerCase.workerId} />
          )}
          {workerCase.caseManagerName && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium text-primary">
                {workerCase.caseManagerName.charAt(0).toUpperCase()}
              </div>
              <span>{workerCase.caseManagerName}</span>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
            <div className="text-sm text-muted-foreground">
              Next Step Due: <span className="font-medium">{new Date(workerCase.dueDate).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</span>
            </div>
            <AuditTrailLink caseId={workerCase.id} />
          </div>
        </div>

        {/* Main content area + persistent sidebar */}
        <div className="flex gap-6 items-start">
        {/* 7-Tab Case Detail View */}
        <div className="flex-1 min-w-0">
        <Tabs defaultValue="summary" className="space-y-4">
          <TabsList className="grid grid-cols-8 h-12">
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="injury">Injury</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="rtw">RTW Plan</TabsTrigger>
            <TabsTrigger value="financial">Financial</TabsTrigger>
            <TabsTrigger value="risk">Risk</TabsTrigger>
            <TabsTrigger value="contacts">Contacts</TabsTrigger>
            <TabsTrigger value="recovery">Recovery</TabsTrigger>
          </TabsList>

          <TabsContent value="summary" className="mt-4">
            <div className="space-y-6">
              {/* Compliance Milestone Clock — Off Work cases only */}
              {workerCase.workStatus === "Off work" && workerCase.caseStatus !== "closed" && (
                <MilestoneClock workerCase={workerCase} />
              )}

              {/* Three summary cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <CurrentCapacityCard workerCase={workerCase} />

                {/* Compliance summary card */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                      <ShieldCheck className="w-5 h-5 text-primary" />
                      Compliance
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-2">
                    <Badge variant="outline" className={cn(
                      "text-sm",
                      workerCase.complianceIndicator === "Very High" || workerCase.complianceIndicator === "High"
                        ? "border-green-300 text-green-700 bg-green-50"
                        : workerCase.complianceIndicator === "Medium"
                        ? "border-amber-300 text-amber-700 bg-amber-50"
                        : "border-red-300 text-red-700 bg-red-50"
                    )}>
                      {workerCase.complianceIndicator}
                    </Badge>
                    {workerCase.compliance?.reason && (
                      <p className="text-xs text-muted-foreground">{workerCase.compliance.reason}</p>
                    )}
                    {workerCase.dueDate && <p className="text-xs text-muted-foreground">Due: {new Date(workerCase.dueDate).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</p>}
                  </CardContent>
                </Card>

                {/* Recovery summary card */}
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                      <TrendingUp className="w-5 h-5 text-primary" />
                      Recovery
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-2">
                    <Badge variant={
                      workerCase.clinicalEvidence?.isImprovingOnExpectedTimeline === true
                        ? "success"
                        : workerCase.clinicalEvidence?.isImprovingOnExpectedTimeline === false
                        ? "warning"
                        : "info"
                    }>
                      {workerCase.clinicalEvidence?.isImprovingOnExpectedTimeline === true ? "On Track"
                        : workerCase.clinicalEvidence?.isImprovingOnExpectedTimeline === false ? "Needs Review"
                        : "Monitoring"}
                    </Badge>
                    {workerCase.clinicalEvidence?.flags && workerCase.clinicalEvidence.flags.length > 0 && (
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        {workerCase.clinicalEvidence.flags.slice(0, 2).map(f => f.message).join("; ")}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Claim cost estimate */}
              <ClaimCostCard caseId={workerCase.id} />

              {/* Escalate to insurer */}
              {workerCase.workerId && (
                <EscalateToInsurerButton
                  caseId={workerCase.id}
                  workerId={workerCase.workerId}
                  workerName={workerCase.workerName}
                />
              )}

              {/* AI Summary */}
              {workerCase.aiSummary && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <Brain className="w-5 h-5 text-primary" />
                        AI Case Summary
                      </CardTitle>
                      <Button variant="outline" size="sm">
                        <RefreshCw className="h-4 w-4 mr-2" />
                        Refresh
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:text-foreground prose-p:text-muted-foreground prose-strong:text-foreground prose-li:text-muted-foreground">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          table: ({children}) => (
                            <div className="overflow-x-auto my-4">
                              <table className="min-w-full border-collapse border border-border text-sm">
                                {children}
                              </table>
                            </div>
                          ),
                          th: ({children}) => (
                            <th className="border border-border bg-muted px-3 py-2 text-left font-medium text-foreground">
                              {children}
                            </th>
                          ),
                          td: ({children}) => (
                            <td className="border border-border px-3 py-2 text-muted-foreground">
                              {children}
                            </td>
                          ),
                        }}
                      >
                        {workerCase.aiSummary}
                      </ReactMarkdown>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Case Overview */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Info className="w-5 h-5 text-primary" />
                    Case Overview
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="text-xs text-muted-foreground">Work Status</label>
                      <p className="text-sm font-medium">{workerCase.workStatus}</p>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Date of Injury</label>
                      <p className="text-sm font-medium">{new Date(workerCase.dateOfInjury).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</p>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Owner</label>
                      <p className="text-sm font-medium">{workerCase.owner}</p>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Due Date</label>
                      <p className="text-sm font-medium">{workerCase.dueDate ? new Date(workerCase.dueDate).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }) : "—"}</p>
                    </div>
                  </div>
                  {workerCase.summary && (
                    <div>
                      <label className="text-sm font-medium text-muted-foreground">Case Summary</label>
                      <p className="text-sm mt-1">{workerCase.summary}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="injury" className="mt-4">
            <div className="space-y-4">
            {/* Phase 11.3 — Mental health privacy notice */}
            {(workerCase.aiSummary?.toLowerCase().match(/stress|anxiety|depression|psychological|mental health|burnout|ptsd/)) && (
              <div className="flex items-start gap-3 rounded-lg border border-info/30 bg-info/10 p-3 text-sm text-info-foreground dark:text-info">
                <span className="font-semibold flex-shrink-0">Mental Health Claim:</span>
                <span>
                  This case involves a psychological/mental health injury. Diagnosis details have
                  restricted access. Psychosocial workplace risk factors must be addressed in RTW planning.
                  Longer recovery timelines apply — see Recovery tab.
                </span>
              </div>
            )}
            <Card>
              <CardHeader>
                <CardTitle>Injury Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Date of Injury</label>
                    <p className="text-sm mt-1">{new Date(workerCase.dateOfInjury).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Company</label>
                    <p className="text-sm mt-1">{workerCase.company}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Employment Status</label>
                    <p className="text-sm mt-1">{workerCase.employmentStatus || "Not recorded"}</p>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground">Lifecycle Stage</label>
                    <p className="text-sm mt-1">{workerCase.lifecycleStage ? LIFECYCLE_STAGE_LABELS[workerCase.lifecycleStage] : "Not set"}</p>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Current Status</label>
                  <p className="text-sm mt-1">{workerCase.currentStatus}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Next Step Required</label>
                  <p className="text-sm mt-1 font-medium text-primary">{workerCase.nextStep}</p>
                </div>
              </CardContent>
            </Card>

            {/* Medical Constraints */}
            {workerCase.medicalConstraints && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ClipboardList className="w-5 h-5 text-primary" />
                    Medical Constraints
                    {workerCase.medicalConstraints.lastUpdatedAt && (
                      <span className="text-xs font-normal text-muted-foreground ml-auto">
                        Updated {new Date(workerCase.medicalConstraints.lastUpdatedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                        {workerCase.medicalConstraints.lastUpdatedBy ? ` by ${workerCase.medicalConstraints.lastUpdatedBy}` : ""}
                      </span>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Restrictions */}
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Restrictions</p>
                    <ul className="space-y-1 text-sm">
                      {workerCase.medicalConstraints.noLiftingOverKg !== undefined && (
                        <li className="flex items-center gap-2 text-amber-700">
                          <Ban className="w-4 h-4" />
                          No lifting over {workerCase.medicalConstraints.noLiftingOverKg} kg
                        </li>
                      )}
                      {workerCase.medicalConstraints.noBending && (
                        <li className="flex items-center gap-2 text-amber-700">
                          <Ban className="w-4 h-4" />
                          No bending
                        </li>
                      )}
                      {workerCase.medicalConstraints.noTwisting && (
                        <li className="flex items-center gap-2 text-amber-700">
                          <Ban className="w-4 h-4" />
                          No twisting
                        </li>
                      )}
                      {workerCase.medicalConstraints.noProlongedStanding && (
                        <li className="flex items-center gap-2 text-amber-700">
                          <Ban className="w-4 h-4" />
                          No prolonged standing
                        </li>
                      )}
                      {workerCase.medicalConstraints.noProlongedSitting && (
                        <li className="flex items-center gap-2 text-amber-700">
                          <Ban className="w-4 h-4" />
                          No prolonged sitting
                        </li>
                      )}
                      {workerCase.medicalConstraints.noDriving && (
                        <li className="flex items-center gap-2 text-amber-700">
                          <Ban className="w-4 h-4" />
                          No driving
                        </li>
                      )}
                      {workerCase.medicalConstraints.noClimbing && (
                        <li className="flex items-center gap-2 text-amber-700">
                          <Ban className="w-4 h-4" />
                          No climbing
                        </li>
                      )}
                      {workerCase.medicalConstraints.otherConstraints && (
                        <li className="flex items-center gap-2 text-amber-700">
                          <Ban className="w-4 h-4" />
                          {workerCase.medicalConstraints.otherConstraints}
                        </li>
                      )}
                    </ul>
                  </div>
                  {/* Capacity */}
                  {(workerCase.medicalConstraints.suitableForLightDuties ||
                    workerCase.medicalConstraints.suitableForSeatedWork ||
                    workerCase.medicalConstraints.suitableForModifiedHours) && (
                    <div className="space-y-1">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Suitable For</p>
                      <div className="flex flex-wrap gap-2">
                        {workerCase.medicalConstraints.suitableForLightDuties && (
                          <Badge variant="secondary" className="text-xs">Light duties</Badge>
                        )}
                        {workerCase.medicalConstraints.suitableForSeatedWork && (
                          <Badge variant="secondary" className="text-xs">Seated work</Badge>
                        )}
                        {workerCase.medicalConstraints.suitableForModifiedHours && (
                          <Badge variant="secondary" className="text-xs">Modified hours</Badge>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Certificate summary */}
            {workerCase.latestCertificate && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-primary" />
                    Current Medical Certificate
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <label className="text-xs text-muted-foreground">Certificate Period</label>
                      <p className="font-medium">
                        {new Date(workerCase.latestCertificate.startDate).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                        {" — "}
                        {new Date(workerCase.latestCertificate.endDate).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
                      </p>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Capacity</label>
                      <p className="font-medium">{workerCase.latestCertificate.capacity}</p>
                    </div>
                    {(workerCase.latestCertificate as any).practitionerName && (
                      <div className="col-span-2">
                        <label className="text-xs text-muted-foreground">Issuing Practitioner</label>
                        <p className="font-medium">{(workerCase.latestCertificate as any).practitionerName}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
            </div>
          </TabsContent>

          <TabsContent value="timeline" className="mt-4">
            <TimelineCard caseId={workerCase.id} />
          </TabsContent>

          <TabsContent value="rtw" className="mt-4">
            <ComponentErrorBoundary label="RTW Planning">
              <SmartRTWPlanning workerCase={workerCase} />
            </ComponentErrorBoundary>
          </TabsContent>

          <TabsContent value="financial" className="mt-4">
            <FinancialSummaryPanel caseId={workerCase.id} workerName={workerCase.workerName} />
          </TabsContent>

          <TabsContent value="risk" className="mt-4">
            <div className="space-y-4">
              {/* Overall Risk */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-primary" />
                    Overall Risk Level
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center gap-3">
                    <Badge variant={riskBadgeVariant(workerCase.riskLevel)} className="text-sm px-3 py-1">
                      {workerCase.riskLevel}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {workerCase.riskLevel === "High"
                        ? "Immediate case manager attention required. Multiple risk indicators active."
                        : workerCase.riskLevel === "Medium"
                        ? "Elevated risk indicators present. Monitor closely and plan interventions."
                        : "Low risk profile. Routine follow-up schedule applies."}
                    </span>
                  </div>

                  {/* Risk Flags */}
                  {(workerCase as any).riskFlags && (workerCase as any).riskFlags.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Active Risk Flags</p>
                      <div className="flex flex-wrap gap-2">
                        {(workerCase as any).riskFlags.map((flag: string) => (
                          <Badge key={flag} variant="outline" className="text-xs border-amber-300 text-amber-700 bg-amber-50">
                            <AlertTriangle className="w-3 h-3 mr-1 inline" />
                            {flag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Dispute alert */}
                  {workerCase.disputeStatus && workerCase.disputeStatus !== "none" && workerCase.disputeStatus !== "resolved" && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                      <Gavel className="w-4 h-4 mt-0.5" />
                      <span><strong>Dispute active:</strong> {workerCase.disputeStatus.replace(/_/g, " ")}. Legal risk elevated — consult insurer before major case decisions.</span>
                    </div>
                  )}

                  {/* Termination audit flag */}
                  {workerCase.terminationAuditFlag && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                      <Flag className="w-4 h-4 mt-0.5" />
                      <span><strong>Termination audit flag:</strong> {workerCase.terminationAuditFlag.replace(/_/g, " ")}. Employment action requires legal review.</span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Functional Capacity Risk */}
              {workerCase.functionalCapacity && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Accessibility className="w-5 h-5 text-primary" />
                      Functional Capacity
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      {workerCase.functionalCapacity.maxWorkHoursPerDay !== undefined && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Max hours/day</span>
                          <span className="font-medium">{workerCase.functionalCapacity.maxWorkHoursPerDay}h</span>
                        </div>
                      )}
                      {workerCase.functionalCapacity.maxWorkDaysPerWeek !== undefined && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Max days/week</span>
                          <span className="font-medium">{workerCase.functionalCapacity.maxWorkDaysPerWeek}d</span>
                        </div>
                      )}
                      {workerCase.functionalCapacity.canLiftKg !== undefined && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Lifting limit</span>
                          <span className="font-medium">{workerCase.functionalCapacity.canLiftKg} kg</span>
                        </div>
                      )}
                      {workerCase.functionalCapacity.canStandMinutes !== undefined && (
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground">Standing (max)</span>
                          <span className="font-medium">{workerCase.functionalCapacity.canStandMinutes} min</span>
                        </div>
                      )}
                    </div>
                    {workerCase.functionalCapacity.otherCapacityNotes && (
                      <p className="mt-3 text-sm text-muted-foreground">{workerCase.functionalCapacity.otherCapacityNotes}</p>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Compliance */}
              {workerCase.compliance && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BadgeCheck className="w-5 h-5 text-primary" />
                      Compliance Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge variant={riskBadgeVariant(
                        workerCase.compliance.indicator === "Very High" || workerCase.compliance.indicator === "High"
                          ? "Low"
                          : workerCase.compliance.indicator === "Low" || workerCase.compliance.indicator === "Very Low"
                            ? "High"
                            : "Medium"
                      )}>
                        {workerCase.compliance.indicator}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{workerCase.compliance.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      Source: {workerCase.compliance.source} | Last checked:{" "}
                      {new Date(workerCase.compliance.lastChecked).toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Mitigation strategies */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ShieldPlus className="w-5 h-5 text-primary" />
                    Mitigation Strategies
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    {workerCase.riskLevel === "High" && (
                      <li className="flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-500 mt-0.5" />
                        Escalate to senior case manager for review within 48 hours
                      </li>
                    )}
                    <li className="flex items-start gap-2">
                      <CalendarDays className="w-4 h-4 text-blue-500 mt-0.5" />
                      Schedule next clinical review and ensure RTW plan is current
                    </li>
                    <li className="flex items-start gap-2">
                      <UsersIcon className="w-4 h-4 text-emerald-500 mt-0.5" />
                      Coordinate with employer on suitable duties availability
                    </li>
                    {workerCase.disputeStatus && workerCase.disputeStatus !== "none" && workerCase.disputeStatus !== "resolved" && (
                      <li className="flex items-start gap-2">
                        <Gavel className="w-4 h-4 text-amber-500 mt-0.5" />
                        Engage insurer legal team — conciliation strategy is in progress
                      </li>
                    )}
                    <li className="flex items-start gap-2">
                      <FileText className="w-4 h-4 text-purple-500 mt-0.5" />
                      Ensure all compliance deadlines are documented in the case timeline
                    </li>
                  </ul>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="contacts" className="mt-4">
            <div className="space-y-4">
              {/* Case Contacts Panel with clickable phone/email */}
              <CaseContactsPanel
                caseId={workerCase.id}
                workerName={workerCase.workerName}
                company={workerCase.company}
              />

              {/* Attachments */}
              {workerCase.attachments && workerCase.attachments.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Paperclip className="w-5 h-5 text-primary" />
                      Attachments
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      {workerCase.attachments.map((attachment: any) => (
                        <a
                          key={attachment.id}
                          href={attachment.url}
                          className="flex items-center gap-2 text-sm text-primary hover:underline"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <FileText className="w-4 h-4" />
                          {attachment.name}
                        </a>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </TabsContent>

          <TabsContent value="recovery" className="mt-4">
            <ComponentErrorBoundary label="Recovery Timeline">
              <Suspense fallback={
                <div className="animate-pulse space-y-4 p-6 bg-gradient-to-br from-purple-50 to-blue-50 rounded-lg border border-purple-200/50">
                  <div className="h-8 bg-gradient-to-r from-purple-200 to-blue-200 rounded w-1/3 mb-6"></div>
                  <div className="h-64 bg-gradient-to-r from-purple-100 to-blue-100 rounded"></div>
                </div>
              }>
                <DynamicRecoveryTimeline caseId={id!} />
              </Suspense>
            </ComponentErrorBoundary>
          </TabsContent>
        </Tabs>
        </div>{/* end flex-1 tab container */}

        {/* Persistent right sidebar */}
        <CaseActionPanel
          caseId={workerCase.id}
          organizationId={workerCase.organizationId}
          nextStep={workerCase.nextStep}
        />
        </div>{/* end flex row */}
      </div>
      <ContextualHelpSystem mode="floating" showTips={true} userRole="case_manager" />
    </PageLayout>
  );
}
