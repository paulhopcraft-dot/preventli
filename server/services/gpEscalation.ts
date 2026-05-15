/**
 * GP Escalation Detection
 *
 * Detects when a worker's GP has not produced an updated medical certificate
 * within an acceptable window after the latest cert expired. Flagged cases
 * surface to the case manager as a signal to consider an IME or chase the GP.
 *
 * Detection layer only — no side effects, no IME trigger.
 */

export interface GpEscalationInput {
  /** Latest medical certificate for the case, or null if none on file. */
  latestCert: { endDate: Date | string | null } | null;
  /** Evaluation reference point (usually "now"). */
  today: Date;
  /** Days past latest cert endDate before flagging the case. */
  thresholdDays: number;
}

export type GpEscalationResult =
  | { escalated: false; reason: "no_certificate" | "cert_current" | "no_end_date"; daysOverdue: 0 }
  | { escalated: true; reason: "cert_expired_no_followup"; daysOverdue: number };

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Pure function. Given the latest certificate, today, and the org's threshold,
 * decide whether the case should be flagged for GP escalation.
 */
export function detectGpEscalation(input: GpEscalationInput): GpEscalationResult {
  const { latestCert, today, thresholdDays } = input;

  if (!latestCert) {
    return { escalated: false, reason: "no_certificate", daysOverdue: 0 };
  }

  if (!latestCert.endDate) {
    return { escalated: false, reason: "no_end_date", daysOverdue: 0 };
  }

  const endDate = latestCert.endDate instanceof Date ? latestCert.endDate : new Date(latestCert.endDate);
  if (Number.isNaN(endDate.getTime())) {
    return { escalated: false, reason: "no_end_date", daysOverdue: 0 };
  }

  const daysSinceExpiry = Math.floor((today.getTime() - endDate.getTime()) / MS_PER_DAY);

  if (daysSinceExpiry < thresholdDays) {
    return { escalated: false, reason: "cert_current", daysOverdue: 0 };
  }

  return {
    escalated: true,
    reason: "cert_expired_no_followup",
    daysOverdue: daysSinceExpiry,
  };
}
