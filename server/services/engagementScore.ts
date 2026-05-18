/**
 * Worker engagement score calculator — cooperation metric (funding-bundle Phase 3).
 *
 * PURE FUNCTION — no DB calls, no LLM calls, no side effects.
 *
 * Produces a 0-100 score from a list of engagement events, broken down into
 * four weighted components for transparency. The score drives insurer-escalation
 * thresholds in later slices.
 */

export interface EngagementEvent {
  type: string; // "cert.received" | "cert.late" | "appointment.attended" | "appointment.noshow" | "message.responded" | "message.no-response" | "contact.suppressed"
  occurredAt: Date | string;
  weight?: number; // optional override; if omitted use default per type
}

export interface EngagementComponents {
  certificateCompliance: number; // 0-100; based on cert.received vs cert.late ratio in last 90 days
  appointmentAttendance: number; // 0-100; attended vs no-show ratio
  responseRate: number; // 0-100; responded vs no-response ratio
  recencyBonus: number; // 0-100; activity in last 14 days
}

export interface EngagementScoreResult {
  score: number; // 0-100 weighted
  components: EngagementComponents;
  weights: Record<keyof EngagementComponents, number>; // for transparency
  eventCount: number; // total events used
  formulaVersion: string; // e.g. "v1"
}

export const ENGAGEMENT_WEIGHTS: Record<keyof EngagementComponents, number> = {
  certificateCompliance: 0.40,
  appointmentAttendance: 0.30,
  responseRate: 0.20,
  recencyBonus: 0.10,
} as const;

const FORMULA_VERSION = "v1";

// Number of days for cert/appointment/response lookback window
const LOOKBACK_DAYS = 90;
// Days thresholds for recency bonus
const RECENCY_ACTIVE_DAYS = 14;
const RECENCY_RECENT_DAYS = 30;
// Dampening applied per contact.suppressed event (points subtracted from final score)
const SUPPRESSION_DAMPENING = 10;

/**
 * Calculate a worker's engagement score from their event history.
 *
 * Edge cases:
 * - Empty events → all components 50 (neutral), score 50, eventCount 0
 * - Missing data for a component → defaults to 50 (neutral)
 * - contact.suppressed events → -10 dampening per event on final score (floor 0)
 */
export function calculateEngagementScore(events: EngagementEvent[]): EngagementScoreResult {
  if (events.length === 0) {
    return {
      score: 50,
      components: {
        certificateCompliance: 50,
        appointmentAttendance: 50,
        responseRate: 50,
        recencyBonus: 50,
      },
      weights: ENGAGEMENT_WEIGHTS,
      eventCount: 0,
      formulaVersion: FORMULA_VERSION,
    };
  }

  const now = new Date();

  // ── Certificate compliance ──────────────────────────────────────────────────
  // Only events within last 90 days
  const certEvents = events.filter((e) => {
    if (e.type !== "cert.received" && e.type !== "cert.late") return false;
    return daysSince(e.occurredAt, now) <= LOOKBACK_DAYS;
  });
  const certReceived = certEvents.filter((e) => e.type === "cert.received").length;
  const certLate = certEvents.filter((e) => e.type === "cert.late").length;
  const certificateCompliance = computeRatioScore(certReceived, certLate);

  // ── Appointment attendance ─────────────────────────────────────────────────
  const apptEvents = events.filter((e) => {
    if (e.type !== "appointment.attended" && e.type !== "appointment.noshow") return false;
    return daysSince(e.occurredAt, now) <= LOOKBACK_DAYS;
  });
  const attended = apptEvents.filter((e) => e.type === "appointment.attended").length;
  const noshow = apptEvents.filter((e) => e.type === "appointment.noshow").length;
  const appointmentAttendance = computeRatioScore(attended, noshow);

  // ── Response rate ──────────────────────────────────────────────────────────
  const msgEvents = events.filter((e) => {
    if (e.type !== "message.responded" && e.type !== "message.no-response") return false;
    return daysSince(e.occurredAt, now) <= LOOKBACK_DAYS;
  });
  const responded = msgEvents.filter((e) => e.type === "message.responded").length;
  const noResponse = msgEvents.filter((e) => e.type === "message.no-response").length;
  const responseRate = computeRatioScore(responded, noResponse);

  // ── Recency bonus ──────────────────────────────────────────────────────────
  // Looks at all non-suppressed events
  const relevantEvents = events.filter((e) => e.type !== "contact.suppressed");
  const mostRecentDays =
    relevantEvents.length > 0
      ? Math.min(...relevantEvents.map((e) => daysSince(e.occurredAt, now)))
      : Infinity;

  let recencyBonus: number;
  if (mostRecentDays <= RECENCY_ACTIVE_DAYS) {
    recencyBonus = 100;
  } else if (mostRecentDays <= RECENCY_RECENT_DAYS) {
    recencyBonus = 50;
  } else {
    recencyBonus = 0;
  }

  // ── Weighted composite ─────────────────────────────────────────────────────
  const components: EngagementComponents = {
    certificateCompliance,
    appointmentAttendance,
    responseRate,
    recencyBonus,
  };

  let rawScore =
    certificateCompliance * ENGAGEMENT_WEIGHTS.certificateCompliance +
    appointmentAttendance * ENGAGEMENT_WEIGHTS.appointmentAttendance +
    responseRate * ENGAGEMENT_WEIGHTS.responseRate +
    recencyBonus * ENGAGEMENT_WEIGHTS.recencyBonus;

  // ── Contact suppression dampening ─────────────────────────────────────────
  const suppressionCount = events.filter((e) => e.type === "contact.suppressed").length;
  rawScore -= suppressionCount * SUPPRESSION_DAMPENING;

  // Clamp to [0, 100]
  const score = Math.max(0, Math.min(100, Math.round(rawScore * 100) / 100));

  return {
    score,
    components,
    weights: ENGAGEMENT_WEIGHTS,
    eventCount: events.length,
    formulaVersion: FORMULA_VERSION,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute a 0-100 score from positive and negative counts.
 * If both are 0 (no data), returns 50 (neutral default).
 * Score = (positive / total) * 100, rounded to 2 decimal places.
 */
function computeRatioScore(positive: number, negative: number): number {
  const total = positive + negative;
  if (total === 0) return 50;
  return Math.round((positive / total) * 10000) / 100;
}

/**
 * Days elapsed since a given date/string, relative to `now`.
 * Returns Infinity for invalid dates.
 */
function daysSince(date: Date | string, now: Date): number {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return Infinity;
  return (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24);
}
