/**
 * MedicoLegalReportPanel
 *
 * Inline panel on the employer case-detail page that surfaces an IME
 * (Independent Medical Examination) report and the system-recommended next
 * steps. Renders nothing unless the case has a synthetic IME entry registered
 * in `shared/medicoLegalReports.ts`.
 *
 * Demo wiring: the "next step" CTAs fire a toast confirming the action would
 * have been queued. Real action wiring (auto-draft, diary, referral log) is
 * deferred to a separate workstream.
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FileText,
  Stethoscope,
  AlertTriangle,
  ChevronRight,
  ClipboardList,
  CalendarClock,
  Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  getMedicoLegalReport,
  CAPACITY_VERDICT_LABELS,
  RECOMMENDATION_PRIORITY_LABELS,
  type ImeRecommendation,
} from "@shared/medicoLegalReports";
import { MedicoLegalReportModal } from "./MedicoLegalReportModal";

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

function priorityClasses(priority: ImeRecommendation["priority"]): string {
  switch (priority) {
    case "high":
      return "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200";
    case "medium":
      return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200";
    case "low":
    default:
      return "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200";
  }
}

export function MedicoLegalReportPanel({ caseId }: Props): React.JSX.Element | null {
  const report = getMedicoLegalReport(caseId);
  const [modalOpen, setModalOpen] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  if (!report) return null;

  const handleRecommendation = (rec: ImeRecommendation): void => {
    // Demo wiring — toast confirmation only. Backend wiring deferred.
    switch (rec.ctaAction) {
      case "open_rtw_draft":
        // Send Ellen toward the auto-draft surface for this case. The auto-draft
        // gate may still skip if data isn't aligned — that's the existing flow.
        toast({
          title: "Opening RTW auto-draft",
          description: "Drafting graduated modified-duties plan from current restrictions.",
        });
        // Navigation handled by the AutoDraftButton's own flow on the same page;
        // here we just scroll to it.
        document
          .querySelector('[data-testid="auto-draft-rtw-button"]')
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
        break;
      case "book_case_conference":
        toast({
          title: "Case conference scheduled (demo)",
          description: `Invites queued for GP, IME and insurer. Target: ${rec.dueDate ? formatLongDate(rec.dueDate) : "within 2 weeks"}.`,
        });
        break;
      case "log_referral":
        toast({
          title: "Referral logged (demo)",
          description: `${rec.title} — referral recorded against case file.`,
        });
        break;
      case "add_diary":
        toast({
          title: "Diary item added (demo)",
          description: rec.dueDate ? `Reminder set for ${formatLongDate(rec.dueDate)}.` : "Reminder added.",
        });
        break;
      case "open_vocational_reassessment":
        toast({
          title: "Vocational reassessment workflow (demo)",
          description: "Engaging vocational provider — questionnaire dispatched to worker.",
        });
        break;
      default:
        navigate(`/cases/${caseId}`);
    }
  };

  const capacityLabel = CAPACITY_VERDICT_LABELS[report.capacityVerdict];
  const capacityColor =
    report.capacityVerdict === "fit_full_duties"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : report.capacityVerdict === "fit_modified_duties"
      ? "bg-blue-100 text-blue-800 border-blue-200"
      : "bg-red-100 text-red-800 border-red-200";

  return (
    <>
      <Card
        data-testid="medico-legal-report-panel"
        className="border-l-4 border-l-indigo-500 bg-gradient-to-br from-indigo-50/60 to-white dark:from-indigo-950/30 dark:to-slate-900"
      >
        <CardContent className="p-5">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-start gap-3 min-w-0">
              <div className="shrink-0 rounded-full bg-indigo-100 dark:bg-indigo-900/40 p-2.5">
                <Stethoscope className="h-5 w-5 text-indigo-700 dark:text-indigo-300" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-base text-indigo-950 dark:text-indigo-100">
                    Independent Medical Examination — report received
                  </span>
                  <Badge variant="outline" className="text-xs bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/40 dark:text-indigo-200">
                    <Sparkles className="h-3 w-3 mr-1" /> Ready for review
                  </Badge>
                </div>
                <p className="text-xs text-indigo-900/80 dark:text-indigo-200/80 mt-0.5">
                  {report.examinerName}, {report.examinerCredentials} — {report.examinerSpecialty}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Examined {formatLongDate(report.examinationDate)} · Claim {report.claimNumber}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setModalOpen(true)}
              data-testid="medico-legal-view-report-button"
              className="shrink-0"
            >
              <FileText className="h-4 w-4 mr-2" />
              View full report
            </Button>
          </div>

          {/* Two-column body */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Left: report summary */}
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Capacity verdict
                </p>
                <Badge variant="outline" className={`text-xs ${capacityColor}`}>
                  {capacityLabel}
                </Badge>
                <p className="text-xs text-muted-foreground mt-1.5">{report.capacityNotes}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Key diagnoses
                </p>
                <ul className="text-sm space-y-0.5">
                  {report.diagnoses.map((dx, i) => (
                    <li key={i} className="text-foreground">
                      <span className="text-indigo-600 dark:text-indigo-300 mr-1.5">•</span>
                      {dx}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">
                  Prognosis
                </p>
                <p className="text-sm text-foreground">{report.prognosis}</p>
                {report.wholePersonImpairmentEstimate && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Whole-Person Impairment (provisional): {report.wholePersonImpairmentEstimate}
                  </p>
                )}
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
                    data-testid={`medico-legal-recommendation-${rec.id}`}
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
                        data-testid={`medico-legal-cta-${rec.id}`}
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

          {/* Footer compliance note */}
          <p className="mt-4 pt-3 border-t border-indigo-200/60 dark:border-indigo-900/60 text-[11px] text-muted-foreground flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600" />
            <span>
              IME recommendations are guidance only. Implementation requires consultation with the
              treating GP and insurer agent. Demo CTAs do not currently dispatch external actions.
            </span>
          </p>
        </CardContent>
      </Card>

      <MedicoLegalReportModal
        report={report}
        open={modalOpen}
        onOpenChange={setModalOpen}
      />
    </>
  );
}

export default MedicoLegalReportPanel;
