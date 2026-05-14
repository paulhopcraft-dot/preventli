/**
 * HealthWellbeingPanel
 *
 * Inline panel on the employer case-detail page for preventative Health &
 * Wellbeing cases (e.g. Naomi Wright). Surfaces the GPNet Prevention Check
 * Report summary, the overall risk, and the top recommendations with CTAs.
 *
 * The "Download Prevention Report" button opens a styled modal of the full
 * GPNet Prevention Check Report (HTML), with a Print / Save-as-PDF action.
 * The real backend pipeline (assessment-submitted → LLM → docx) is captured
 * for a follow-up workstream in .planning/prompts/.
 */

import { useState } from "react";
import {
  HeartPulse,
  FileText,
  ChevronRight,
  ClipboardList,
  CalendarClock,
  Activity,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  getHealthWellbeingReport,
  WELLBEING_DOMAIN_LABELS,
  WELLBEING_RISK_LABELS,
  type WellbeingRecommendation,
} from "@shared/medicoLegalReports";
import { HealthWellbeingReportModal } from "./HealthWellbeingReportModal";

interface Props {
  caseId: string;
}

function formatLongDate(value: string): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function priorityClasses(priority: WellbeingRecommendation["priority"]): string {
  switch (priority) {
    case "high":
      return "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-100";
    case "medium":
      return "border-teal-300 bg-teal-50 text-teal-900 dark:border-teal-800 dark:bg-teal-950/30 dark:text-teal-100";
    case "low":
    default:
      return "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200";
  }
}

function riskBadgeClasses(risk: string): string {
  switch (risk) {
    case "low":
      return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "moderate":
      return "bg-amber-100 text-amber-800 border-amber-200";
    case "elevated":
      return "bg-orange-100 text-orange-800 border-orange-200";
    case "high":
      return "bg-red-100 text-red-800 border-red-200";
    default:
      return "bg-slate-100 text-slate-800 border-slate-200";
  }
}

export function HealthWellbeingPanel({ caseId }: Props): React.JSX.Element | null {
  const report = getHealthWellbeingReport(caseId);
  const [modalOpen, setModalOpen] = useState(false);
  const { toast } = useToast();

  if (!report) return null;

  const handleRecommendation = (rec: WellbeingRecommendation): void => {
    // Demo wiring — toasts only. Real workflow handlers deferred.
    switch (rec.ctaAction) {
      case "open_workstation_review":
        toast({
          title: "Workstation review opened (demo)",
          description: "Virtual ergonomic assessment dispatched to worker; calendar invite pending.",
        });
        break;
      case "log_referral":
        toast({
          title: "Referral logged (demo)",
          description: `${rec.title} — referral recorded under wellbeing budget.`,
        });
        break;
      case "schedule_training":
        toast({
          title: "Coaching scheduled (demo)",
          description: "EAP recovery coach contacted — worker to confirm session times.",
        });
        break;
      case "add_diary":
        toast({
          title: "Diary item added (demo)",
          description: rec.dueDate ? `Reminder set for ${formatLongDate(rec.dueDate)}.` : "Reminder added.",
        });
        break;
      case "book_followup":
        toast({
          title: "Follow-up booked (demo)",
          description: "Voluntary follow-up assessment offered to worker.",
        });
        break;
      default:
        toast({ title: rec.ctaLabel, description: "Action queued (demo)." });
    }
  };

  const riskLabel = WELLBEING_RISK_LABELS[report.overallRisk];

  return (
    <>
      <Card
        data-testid="health-wellbeing-panel"
        className="border-l-4 border-l-teal-500 bg-gradient-to-br from-teal-50/60 to-white dark:from-teal-950/30 dark:to-slate-900"
      >
        <CardContent className="p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="shrink-0 rounded-full bg-teal-100 dark:bg-teal-900/40 p-2.5">
                <HeartPulse className="h-5 w-5 text-teal-700 dark:text-teal-300" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-base text-teal-950 dark:text-teal-100">
                    GPNet Prevention Check — report ready
                  </span>
                  <Badge variant="outline" className={`text-xs ${riskBadgeClasses(report.overallRisk)}`}>
                    {riskLabel} risk
                  </Badge>
                </div>
                <p className="text-xs text-teal-900/80 dark:text-teal-200/80 mt-0.5">
                  {report.assessorName}, {report.assessorCredentials} — {report.assessorSpecialty}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Assessed {formatLongDate(report.assessmentDate)} · {report.assessmentType}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setModalOpen(true)}
              data-testid="health-wellbeing-view-report-button"
              className="shrink-0"
            >
              <FileText className="h-4 w-4 mr-2" />
              View Prevention Report
            </Button>
          </div>

          {/* Two-column body */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: summary + findings */}
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Summary
                </p>
                <p className="text-sm text-foreground">{report.summary}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5" />
                  Findings by domain
                </p>
                <ul className="space-y-1.5">
                  {report.findings.map((f, i) => (
                    <li key={i} className="text-sm">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground">
                          {WELLBEING_DOMAIN_LABELS[f.domain]}
                        </span>
                        <Badge
                          variant="outline"
                          className={`text-[10px] uppercase ${
                            f.riskLevel === "elevated"
                              ? "bg-orange-50 text-orange-800 border-orange-200"
                              : f.riskLevel === "moderate"
                              ? "bg-amber-50 text-amber-800 border-amber-200"
                              : "bg-emerald-50 text-emerald-800 border-emerald-200"
                          }`}
                        >
                          {f.riskLevel}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{f.finding}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Overall risk
                </p>
                <p className="text-sm text-foreground">{report.overallRiskNotes}</p>
              </div>
            </div>

            {/* Right: recommendations */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <ClipboardList className="h-3.5 w-3.5" />
                Recommended next steps
              </p>
              <ol className="space-y-2">
                {report.recommendations.map((rec, i) => (
                  <li
                    key={rec.id}
                    className={`rounded-md border px-3 py-2 ${priorityClasses(rec.priority)}`}
                    data-testid={`health-wellbeing-recommendation-${rec.id}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-sm leading-tight">
                          {i + 1}. {rec.title}
                        </p>
                        <p className="text-xs mt-0.5 opacity-90">{rec.description}</p>
                        {rec.dueDate && (
                          <p className="text-[11px] mt-1 flex items-center gap-1 opacity-80">
                            <CalendarClock className="h-3 w-3" />
                            By {formatLongDate(rec.dueDate)}
                          </p>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRecommendation(rec)}
                        data-testid={`health-wellbeing-cta-${rec.id}`}
                        className="shrink-0 h-7 px-2 text-xs"
                      >
                        {rec.ctaLabel}
                        <ChevronRight className="h-3 w-3 ml-1" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>

          {/* Footer note */}
          <p className="mt-4 pt-3 border-t border-teal-200/60 dark:border-teal-900/60 text-[11px] text-muted-foreground">
            Prevention Check guidance only — based on the worker's self-reported responses and any
            clinical documents provided. Confidential health information under the Privacy Act 1988
            (Cth). Recommendations must be implemented in consultation with the worker.
          </p>
        </CardContent>
      </Card>

      <HealthWellbeingReportModal
        report={report}
        workerName="Naomi Wright"
        companyName="Wallara"
        jobTitle="Support Coordinator"
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </>
  );
}

export default HealthWellbeingPanel;
