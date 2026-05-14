/**
 * MedicoLegalReportModal
 *
 * Full IME (Independent Medical Examination) report rendered inline in a
 * modal — styled to read like a real medical document. The "Print / Save as
 * PDF" button uses the browser's print dialog so consultants can attach the
 * resulting PDF to email or the case file without the demo needing a real
 * PDF pipeline.
 */

import React from "react";
import { Printer, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { MedicoLegalReport } from "@shared/medicoLegalReports";
import {
  CAPACITY_VERDICT_LABELS,
  RECOMMENDATION_PRIORITY_LABELS,
} from "@shared/medicoLegalReports";

interface Props {
  report: MedicoLegalReport;
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

export function MedicoLegalReportModal({ report, open, onOpenChange }: Props): React.JSX.Element {
  const handlePrint = (): void => {
    window.print();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto print:max-w-none print:max-h-none print:overflow-visible print:shadow-none">
        <DialogHeader className="print:hidden">
          <div className="flex items-center justify-between">
            <DialogTitle>Independent Medical Examination Report</DialogTitle>
            <div className="flex items-center gap-2 mr-6">
              <Button
                variant="outline"
                size="sm"
                onClick={handlePrint}
                data-testid="medico-legal-modal-print"
              >
                <Printer className="h-4 w-4 mr-1.5" />
                Print / Save as PDF
              </Button>
            </div>
          </div>
        </DialogHeader>

        <article className="prose prose-sm max-w-none print:prose dark:prose-invert print:text-black">
          {/* Document header */}
          <div className="border-b-2 border-indigo-700 pb-3 mb-4 print:border-black">
            <h1 className="text-xl font-bold tracking-tight text-indigo-950 dark:text-indigo-100 print:text-black mb-1">
              INDEPENDENT MEDICAL EXAMINATION
            </h1>
            <p className="text-xs text-muted-foreground print:text-gray-700">
              Confidential clinical report — prepared for case management and insurer review only.
            </p>
          </div>

          {/* Worker + examiner block */}
          <table className="w-full text-sm mb-4 border-collapse">
            <tbody>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <td className="py-1.5 pr-3 font-semibold w-1/3">Claim number</td>
                <td className="py-1.5">{report.claimNumber}</td>
              </tr>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <td className="py-1.5 pr-3 font-semibold">Date of injury</td>
                <td className="py-1.5">{formatLongDate(report.injuryDate)}</td>
              </tr>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <td className="py-1.5 pr-3 font-semibold">Examined by</td>
                <td className="py-1.5">
                  {report.examinerName}, {report.examinerCredentials}
                  <br />
                  <span className="text-xs text-muted-foreground">
                    {report.examinerSpecialty} — {report.examinerAddress}
                  </span>
                </td>
              </tr>
              <tr>
                <td className="py-1.5 pr-3 font-semibold">Date of examination</td>
                <td className="py-1.5">{formatLongDate(report.examinationDate)}</td>
              </tr>
            </tbody>
          </table>

          <section className="mb-4">
            <h2 className="text-base font-bold uppercase tracking-wide text-indigo-900 dark:text-indigo-200 print:text-black mb-1.5">
              Clinical history
            </h2>
            <p className="text-sm">{report.clinicalHistory}</p>
          </section>

          <section className="mb-4">
            <h2 className="text-base font-bold uppercase tracking-wide text-indigo-900 dark:text-indigo-200 print:text-black mb-1.5">
              Current status
            </h2>
            <p className="text-sm">{report.currentStatus}</p>
          </section>

          <section className="mb-4">
            <h2 className="text-base font-bold uppercase tracking-wide text-indigo-900 dark:text-indigo-200 print:text-black mb-1.5">
              Examination findings
            </h2>
            <p className="text-sm">{report.examinationFindings}</p>
          </section>

          <section className="mb-4">
            <h2 className="text-base font-bold uppercase tracking-wide text-indigo-900 dark:text-indigo-200 print:text-black mb-1.5">
              Diagnosis
            </h2>
            <ol className="list-decimal pl-5 text-sm space-y-0.5">
              {report.diagnoses.map((dx, i) => (
                <li key={i}>{dx}</li>
              ))}
            </ol>
          </section>

          <section className="mb-4">
            <h2 className="text-base font-bold uppercase tracking-wide text-indigo-900 dark:text-indigo-200 print:text-black mb-1.5">
              Prognosis
            </h2>
            <p className="text-sm">{report.prognosis}</p>
            {report.wholePersonImpairmentEstimate && (
              <p className="text-sm mt-1.5">
                <span className="font-semibold">Whole-Person Impairment estimate:</span>{" "}
                {report.wholePersonImpairmentEstimate}
              </p>
            )}
          </section>

          <section className="mb-4">
            <h2 className="text-base font-bold uppercase tracking-wide text-indigo-900 dark:text-indigo-200 print:text-black mb-1.5">
              Capacity for work
            </h2>
            <p className="text-sm mb-2">
              <span className="font-semibold">Verdict:</span>{" "}
              {CAPACITY_VERDICT_LABELS[report.capacityVerdict]}
            </p>
            <p className="text-sm mb-2">{report.capacityNotes}</p>
            <p className="text-sm font-semibold mb-1">Restrictions:</p>
            <ul className="list-disc pl-5 text-sm space-y-0.5">
              {report.capacityRestrictions.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </section>

          <section className="mb-4">
            <h2 className="text-base font-bold uppercase tracking-wide text-indigo-900 dark:text-indigo-200 print:text-black mb-1.5">
              Recommendations
            </h2>
            <ol className="list-decimal pl-5 text-sm space-y-2">
              {report.recommendations.map((rec) => (
                <li key={rec.id}>
                  <span className="font-semibold">{rec.title}</span>
                  <span className="text-xs text-muted-foreground ml-2">
                    ({RECOMMENDATION_PRIORITY_LABELS[rec.priority]}
                    {rec.dueDate ? ` · by ${formatLongDate(rec.dueDate)}` : ""})
                  </span>
                  <p className="text-sm mt-0.5">{rec.description}</p>
                </li>
              ))}
            </ol>
          </section>

          {/* Signature line */}
          <div className="mt-8 pt-4 border-t border-slate-300 dark:border-slate-700 text-sm">
            <p className="font-semibold">Signed</p>
            <p className="mt-3">{report.examinerName}, {report.examinerCredentials}</p>
            <p className="text-xs text-muted-foreground">{report.examinerSpecialty}</p>
            <p className="text-xs text-muted-foreground mt-3">
              This report is provided for occupational health and case management purposes. It does
              not constitute a WorkCover determination. Recommendations should be implemented in
              consultation with the worker's treating practitioner and insurer agent.
            </p>
          </div>
        </article>
      </DialogContent>
    </Dialog>
  );
}

export default MedicoLegalReportModal;
