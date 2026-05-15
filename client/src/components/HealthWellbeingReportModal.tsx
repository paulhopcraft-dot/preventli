/**
 * HealthWellbeingReportModal
 *
 * Full GPNet Prevention Check Report rendered inline. Styling follows the
 * teal palette from the master prompt (see .planning/prompts/prevention-
 * check-report-master.md). Print / Save-as-PDF supported via window.print().
 *
 * Demo-grade: rendered client-side from a TS constant. The eventual backend
 * pipeline (assessment-submitted → LLM with master prompt → .docx via the
 * docx npm package) is captured in the master-prompt artifact for a follow-up
 * workstream.
 */

import React from "react";
import { Printer } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { HealthWellbeingReport } from "@shared/medicoLegalReports";
import {
  WELLBEING_DOMAIN_LABELS,
  WELLBEING_RISK_LABELS,
} from "@shared/medicoLegalReports";

interface Props {
  report: HealthWellbeingReport;
  workerName: string;
  companyName: string;
  jobTitle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

// Teal palette per master prompt
const NAVY = "#0D4D4D";
const BLUE = "#1A7A7A";
const LBLUE = "#D0EEEE";
const LGRAY = "#F5F5F5";
const AMBER = "#BF8F00";
const AMBER_BG = "#FFF8E7";
const GREEN_BG = "#E2EFDA";

export function HealthWellbeingReportModal({
  report,
  workerName,
  companyName,
  jobTitle,
  open,
  onOpenChange,
}: Props): React.JSX.Element {
  const handlePrint = (): void => {
    window.print();
  };

  const riskColor =
    report.overallRisk === "low"
      ? "#375623"
      : report.overallRisk === "moderate"
      ? "#BF8F00"
      : "#C00000";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto print:max-w-none print:max-h-none print:overflow-visible print:shadow-none p-0">
        <DialogHeader className="print:hidden p-6 pb-2">
          <div className="flex items-center justify-between">
            <DialogTitle>GPNet Prevention Check Report</DialogTitle>
            <div className="flex items-center gap-2 mr-6">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrint}
                data-testid="health-wellbeing-modal-print"
              >
                <Printer className="h-4 w-4 mr-1.5" />
                Print / Save as PDF
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="px-6 pb-6 print:px-0 print:pb-0 font-sans text-[15px] leading-relaxed bg-white text-slate-900 print:text-black">
          {/* 1. Title header */}
          <div
            style={{ backgroundColor: NAVY }}
            className="text-center py-6 px-4 mb-4 print:py-4"
          >
            <h1 className="text-white font-bold text-2xl tracking-wide print:text-3xl">
              GPNet&nbsp;&nbsp;Prevention Check Report
            </h1>
            <p className="italic text-base mt-1" style={{ color: "#A8DADA" }}>
              {companyName}
            </p>
          </div>

          {/* 2. Worker details table */}
          <table className="w-full text-sm mb-4 border-collapse">
            <tbody>
              {[
                ["Worker Name", workerName],
                ["Job Title", jobTitle],
                ["Company", companyName],
                ["Review Date", formatLongDate(report.assessmentDate)],
                ["Assessment Type", report.assessmentType],
                ["Assessor", `${report.assessorName}, ${report.assessorCredentials}`],
              ].map(([label, value]) => (
                <tr key={label} className="border-b border-slate-200 dark:border-slate-700 print:border-gray-400">
                  <td
                    style={{ backgroundColor: LBLUE, color: NAVY }}
                    className="font-bold py-2 px-3 w-1/3 print:text-black"
                  >
                    {label}
                  </td>
                  <td style={{ backgroundColor: LGRAY }} className="py-2 px-3 text-slate-900 print:text-black">
                    {value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 3. Disclaimer */}
          <div
            style={{ backgroundColor: AMBER_BG, borderLeft: `4px solid ${AMBER}` }}
            className="p-3 mb-4 text-sm"
          >
            <p className="italic text-slate-700 print:text-black">
              <span style={{ color: AMBER }} className="font-bold not-italic">
                Disclaimer&nbsp;&nbsp;
              </span>
              This report has been prepared by GPNet for preventive occupational health purposes
              only, consistent with the employer's duty of care under the Occupational Health and
              Safety Act 2004 (Vic). It is based on the worker's self-reported responses and any
              clinical documentation provided at the time of assessment. It does not constitute a
              medical diagnosis, clinical opinion, or WorkCover determination. Information in this
              report is health information under the Privacy Act 1988 (Cth) and must be handled in
              accordance with the Australian Privacy Principles. Recommendations are general
              guidance only and should be validated against actual role requirements and confirmed
              with the worker's treating practitioner before implementation. This report is
              confidential to the employer and GPNet and must not be disclosed to third parties
              without the worker's consent.
            </p>
          </div>

          {/* 4. Legislative compliance note */}
          <div
            style={{ backgroundColor: LBLUE, borderLeft: `4px solid ${BLUE}` }}
            className="p-3 mb-4 text-sm"
          >
            <p className="text-slate-700 print:text-black">
              <span style={{ color: BLUE }} className="font-bold">
                Legislative framework&nbsp;&nbsp;
              </span>
              Occupational Health and Safety Act 2004 (Vic) — employer duty of care (s.21) and
              worker duty of care (s.25); WorkSafe Victoria prevention and early intervention
              guidelines; Privacy Act 1988 (Cth) — Australian Privacy Principles (APP 3, 6, 11);
              Fair Work Act 2009 (Cth) — general protections (s.340); Equal Opportunity Act 2010
              (Vic). This is a prevention check report. It is not a WorkCover claim, injury
              management plan, or basis for adverse action.
            </p>
          </div>

          {/* 5. Fit classification */}
          <h2 style={{ color: NAVY }} className="font-bold text-lg uppercase tracking-wide border-b mb-2 print:text-black">
            Fit Classification
          </h2>
          <ul className="text-sm mb-1 space-y-1">
            <li>☐ &nbsp;Fit without restriction — {jobTitle}, {companyName}</li>
            <li className="font-semibold">☑ &nbsp;Fit with preventative recommendations — {jobTitle}, {companyName}</li>
            <li>☐ &nbsp;Not fit</li>
          </ul>
          <p className="italic text-xs text-slate-600 mb-4 print:text-gray-700">
            Classification based on self-reported assessment responses dated{" "}
            {formatLongDate(report.assessmentDate)}. No occupational restrictions identified. GP
            confirmation is recommended before any work-arrangement change.
          </p>

          {/* 6. Summary of findings */}
          <h2 style={{ color: NAVY }} className="font-bold text-lg uppercase tracking-wide border-b mb-2 print:text-black">
            Summary of Findings
          </h2>
          <p className="text-sm mb-3">{report.purpose}</p>
          <p className="text-sm mb-3">{report.summary}</p>
          <p className="text-sm mb-4 italic text-slate-600 print:text-gray-700">
            As limited clinical documentation was available at the time of this assessment, all
            findings should be treated as self-reported and reviewed with the worker's treating
            practitioner before any work arrangement decisions are made.
          </p>

          {/* 7. Findings by domain (substituting for pain-level chart since this is non-injury) */}
          <h2 style={{ color: NAVY }} className="font-bold text-lg uppercase tracking-wide border-b mb-2 print:text-black">
            Findings by Domain
          </h2>
          <table className="w-full text-sm mb-4 border-collapse">
            <thead>
              <tr style={{ backgroundColor: NAVY, color: "white" }}>
                <th className="text-left py-2 px-3">Domain</th>
                <th className="text-left py-2 px-3">Reported finding</th>
                <th className="text-left py-2 px-3 w-32">Risk level</th>
              </tr>
            </thead>
            <tbody>
              {report.findings.map((f, i) => (
                <tr key={i} style={{ backgroundColor: i % 2 === 0 ? "white" : LGRAY }}>
                  <td className="py-2 px-3 font-semibold">{WELLBEING_DOMAIN_LABELS[f.domain]}</td>
                  <td className="py-2 px-3">{f.finding}</td>
                  <td className="py-2 px-3 uppercase text-xs font-semibold">
                    <span
                      style={{
                        color:
                          f.riskLevel === "elevated"
                            ? "#C00000"
                            : f.riskLevel === "moderate"
                            ? "#BF8F00"
                            : "#375623",
                      }}
                    >
                      {f.riskLevel}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 8. Physical restrictions */}
          <h2 style={{ color: NAVY }} className="font-bold text-lg uppercase tracking-wide border-b mb-2 print:text-black">
            Physical Restrictions
          </h2>
          <p className="text-sm italic text-slate-600 mb-3 print:text-gray-700">
            No occupational restrictions identified at time of assessment. Recommendations are
            preventive in nature.
          </p>

          {/* 9. Recommendations */}
          <h2 style={{ color: NAVY }} className="font-bold text-lg uppercase tracking-wide border-b mb-2 print:text-black">
            Recommendations
          </h2>
          <p className="text-sm italic text-slate-600 mb-3 print:text-gray-700">
            Provided for preventive purposes under the employer's duty of care (OHS Act 2004 Vic,
            s.21). Based on the worker's self-reported assessment and any documentation provided.
            Implement in consultation with the worker and, where applicable, the treating GP.
          </p>

          <h3 style={{ color: BLUE }} className="font-bold text-base mb-2 print:text-black">
            For the Employer
          </h3>
          <div className="space-y-2 mb-4">
            {report.recommendations.slice(0, 3).map((rec) => (
              <div
                key={rec.id}
                style={{ backgroundColor: GREEN_BG, borderLeft: `4px solid #375623` }}
                className="p-3 text-sm"
              >
                <span className="font-bold" style={{ color: "#375623" }}>
                  Action&nbsp;&nbsp;
                </span>
                <span className="font-semibold">{rec.title}.</span>{" "}
                {rec.description}
                {rec.dueDate && (
                  <span className="text-xs text-slate-600 ml-1 print:text-gray-700">
                    (target: {formatLongDate(rec.dueDate)})
                  </span>
                )}
              </div>
            ))}
          </div>

          <h3 style={{ color: BLUE }} className="font-bold text-base mb-2 print:text-black">
            For the Worker
          </h3>
          <div className="space-y-2 mb-4">
            {report.recommendations.slice(3).map((rec) => (
              <div
                key={rec.id}
                style={{ backgroundColor: "#FFF2CC", borderLeft: `4px solid ${AMBER}` }}
                className="p-3 text-sm"
              >
                <span className="font-bold" style={{ color: AMBER }}>
                  Monitor&nbsp;&nbsp;
                </span>
                <span className="font-semibold">{rec.title}.</span>{" "}
                {rec.description}
                {rec.dueDate && (
                  <span className="text-xs text-slate-600 ml-1 print:text-gray-700">
                    (target: {formatLongDate(rec.dueDate)})
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* 10. Detail sections — abbreviated for demo */}
          <h2 style={{ color: NAVY }} className="font-bold text-lg uppercase tracking-wide border-b mb-2 print:text-black">
            Health Outlook
          </h2>
          <p className="text-sm mb-1">
            <span className="font-bold">Risk level:</span>{" "}
            <span style={{ color: riskColor }} className="uppercase font-semibold">
              {WELLBEING_RISK_LABELS[report.overallRisk]}
            </span>
            .
          </p>
          <p className="text-sm mb-1">{report.overallRiskNotes}</p>
          <p className="text-sm mb-4 italic">
            Follow-up Prevention Check recommended in 3 months.
          </p>

          {/* 12. Closing note */}
          <div className="border-t-2 pt-3 mt-6 text-center text-xs italic text-slate-600 print:text-gray-700">
            This report is based on {workerName}'s self-reported responses
            ({formatLongDate(report.assessmentDate)}) and any clinical documentation provided at
            the time of assessment. It does not replace clinical medical evaluation, diagnosis, or
            a WorkCover determination. It is confidential health information under the Privacy Act
            1988 (Cth) and must be handled in accordance with the Australian Privacy Principles. It
            must not be used as grounds for adverse action under the Fair Work Act 2009 (Cth).
            Prepared by GPNet.
          </div>

          {/* 11. Footer (print-only) */}
          <div className="hidden print:block text-center text-[10px] italic text-gray-600 mt-4 pt-2 border-t">
            Confidential — prepared for occupational health purposes only. Based on self-reported
            information. Does not replace clinical medical advice or constitute a WorkCover
            determination. Prepared by GPNet | www.gpnet.au
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default HealthWellbeingReportModal;
