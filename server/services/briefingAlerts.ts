/**
 * Morning briefing alert composer.
 *
 * Pure function. Given a list of WorkerCase projections (with the fields
 * already populated by storage.getCases / getCasesPaginated), derive the
 * actionable signals a case manager should see first thing in the morning:
 *
 *   - GP escalation  — cert expired beyond org threshold, no replacement
 *   - Low compliance — risk-like compliance indicator below threshold
 *
 * Severity ordering keeps the top items high. No LLM calls. Easy to extend
 * with new categories (cert-review queue, off-work duration, pending
 * pre-employment, etc) later — cert-review needs requiresReview exposed on
 * the public MedicalCertificate type first.
 */

import type { WorkerCase, ComplianceIndicator } from "@shared/schema";

export type AlertSeverity = "high" | "medium" | "low";

export type AlertCategory =
  | "gp_escalation"
  | "compliance"
  | "off_work";

export interface BriefingAlert {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  detail: string;
  caseId: string;
  workerName: string;
  /** Plain-English next step. Doesn't trigger anything — just suggests. */
  suggestedAction: string;
}

const GP_HIGH_THRESHOLD_DAYS = 14;
const LOW_COMPLIANCE: ComplianceIndicator[] = ["Low", "Very Low"];
const OFF_WORK_MEDIUM_DAYS = 90;
const OFF_WORK_HIGH_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function severityFromGpDays(daysOverdue: number): AlertSeverity {
  if (daysOverdue >= GP_HIGH_THRESHOLD_DAYS) return "high";
  return "medium";
}

function severityFromCompliance(ind: ComplianceIndicator | undefined): AlertSeverity {
  if (ind === "Very Low") return "high";
  if (ind === "Low") return "medium";
  return "low";
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { high: 3, medium: 2, low: 1 };

/**
 * Compose alerts from a list of cases. Returns top N alerts, ordered by
 * severity desc, then by days overdue desc (for GP escalations).
 *
 * `today` defaults to `new Date()`; pass an explicit Date in tests so the
 * off-work-duration math stays deterministic.
 */
export function composeBriefingAlerts(
  cases: WorkerCase[],
  limit = 5,
  today: Date = new Date(),
): BriefingAlert[] {
  const alerts: BriefingAlert[] = [];

  for (const c of cases) {
    // GP escalation — uses the gpEscalation projection added in 05c467f.
    if (c.gpEscalation?.escalated) {
      const days = c.gpEscalation.daysOverdue;
      alerts.push({
        id: `gp-${c.id}`,
        severity: severityFromGpDays(days),
        category: "gp_escalation",
        title: `${c.workerName}'s GP certificate is ${days} day${days === 1 ? "" : "s"} overdue`,
        detail: `Last certificate expired without a replacement. Worker case may be off-track.`,
        caseId: c.id,
        workerName: c.workerName,
        suggestedAction: days >= GP_HIGH_THRESHOLD_DAYS
          ? "Trigger an IME if the GP remains non-responsive."
          : "Chase the GP for an updated certificate.",
      });
    }

    // Low compliance — only when there's a stored reason, per the
    // [[feedback-compliance-reason-required]] rule.
    if (
      c.complianceIndicator &&
      LOW_COMPLIANCE.includes(c.complianceIndicator) &&
      c.compliance?.reason
    ) {
      alerts.push({
        id: `compliance-${c.id}`,
        severity: severityFromCompliance(c.complianceIndicator),
        category: "compliance",
        title: `${c.workerName} flagged as ${c.complianceIndicator.toLowerCase()} compliance`,
        detail: c.compliance.reason,
        caseId: c.id,
        workerName: c.workerName,
        suggestedAction: "Review case status and consider escalation steps.",
      });
    }

    // Off-work duration — long-tail cases drift if nobody reviews them.
    if (c.workStatus === "Off work" && c.dateOfInjury) {
      const injuryDate = new Date(c.dateOfInjury);
      if (!Number.isNaN(injuryDate.getTime())) {
        const daysOff = Math.floor((today.getTime() - injuryDate.getTime()) / MS_PER_DAY);
        if (daysOff >= OFF_WORK_MEDIUM_DAYS) {
          const severity: AlertSeverity = daysOff >= OFF_WORK_HIGH_DAYS ? "high" : "medium";
          alerts.push({
            id: `off-work-${c.id}`,
            severity,
            category: "off_work",
            title: `${c.workerName} has been off work for ${daysOff} days`,
            detail: c.currentStatus?.trim() || "Long-duration claim — drift risk if not actively managed.",
            caseId: c.id,
            workerName: c.workerName,
            suggestedAction: "Review treatment plan and consider next steps.",
          });
        }
      }
    }
  }

  // Severity desc, then GP days overdue desc for tie-breaking.
  alerts.sort((a, b) => {
    const sevDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sevDiff !== 0) return sevDiff;
    // Heuristic tie-break: prefer GP alerts (most time-sensitive)
    if (a.category === "gp_escalation" && b.category !== "gp_escalation") return -1;
    if (b.category === "gp_escalation" && a.category !== "gp_escalation") return 1;
    return 0;
  });

  return alerts.slice(0, limit);
}
