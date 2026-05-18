/**
 * Per-case claim cost estimate formula — funding-bundle Phase 2.
 *
 * IMPORTANT: this surfaces ESTIMATED CLAIM COST for implication purposes only.
 * It is NOT a premium prediction. WorkSafe Victoria determines premiums.
 * See docs/adr/0001-claim-cost-framing.md for the full framing rationale.
 *
 * The disclaimer string below MUST appear on every UI / API surface that
 * displays the dollar number. Verify script greps for it.
 */

export const DISCLAIMER =
  "Estimated claim cost — for implication only. Actual premium impact is determined by WorkSafe Victoria.";

export const FORMULA_VERSION = "v1-2026-05-18";
export const COLD_START_THRESHOLD = 3; // <3 historical cases → industry baseline fallback

export const INDUSTRY_BASELINE = {
  // Placeholder pending citation update — see ADR-0001.
  // Source: WorkSafe Victoria annual report (claim averages by industry).
  // Coefficients sized for disability-services / community sector (Wallara baseline).
  // TODO(paul): swap to specific page reference + year when WSV report ingested.
  baselineDollars: 50_000,          // average claim cost when org has no history
  perDayOffWorkDollars: 400,        // per day_off_work additional cost
  source: "WorkSafe Victoria annual report (placeholder — citation pending)",
} as const;

export const SEVERITY_MULTIPLIERS = {
  riskLevel: {
    "very high": 1.6,
    "high": 1.3,
    "medium": 1.0,
    "low": 0.8,
    "very low": 0.6,
  } as Record<string, number>,
  lifecycleStage: {
    "intake": 1.0,
    "assessment": 1.1,
    "active_treatment": 1.2,
    "rtw_transition": 0.8,
    "maintenance": 0.6,
    // closed states reduce to 0 — claim is settled
    "closed_resolved": 0,
    "closed_terminated": 0,
    "closed_no_action": 0,
  } as Record<string, number>,
  openComplianceUplift: 0.10, // +10% if has open compliance issues
} as const;

export interface CostEstimateInput {
  // From the worker case row
  daysOffWork: number;
  riskLevel: string | null;
  lifecycleStage: string | null;
  hasOpenCompliance: boolean;
}

export interface OrgHistoryStats {
  caseCount: number;
  avgCaseCostDollars: number | null; // null when no history
}

export interface CostEstimateResult {
  estimatedCostDollars: number;
  baselineDollars: number;
  components: {
    base: number;
    daysOffComponent: number;
    riskMultiplier: number;
    lifecycleMultiplier: number;
    complianceUplift: number;
  };
  formulaVersion: string;
  baselineSource: "client_history" | "industry_baseline";
  disclaimer: string;
}

/**
 * Compute the estimated claim cost for a case.
 *
 * Algorithm:
 *   base = orgHistory.avgCaseCostDollars (if caseCount >= COLD_START_THRESHOLD)
 *          else INDUSTRY_BASELINE.baselineDollars
 *   daysOffComponent = daysOffWork * INDUSTRY_BASELINE.perDayOffWorkDollars
 *   risk_mult = SEVERITY_MULTIPLIERS.riskLevel[riskLevel] || 1.0
 *   lifecycle_mult = SEVERITY_MULTIPLIERS.lifecycleStage[lifecycleStage] || 1.0
 *   compliance_uplift = hasOpenCompliance ? SEVERITY_MULTIPLIERS.openComplianceUplift : 0
 *   estimated = (base + daysOffComponent) * risk_mult * lifecycle_mult * (1 + compliance_uplift)
 *   baseline (for "vs baseline" comparison) = base + daysOffComponent (without multipliers)
 */
export function calculateCostEstimate(
  input: CostEstimateInput,
  orgHistory: OrgHistoryStats,
): CostEstimateResult {
  // Determine base from org history or industry fallback
  const baselineSource: "client_history" | "industry_baseline" =
    orgHistory.caseCount >= COLD_START_THRESHOLD && orgHistory.avgCaseCostDollars !== null
      ? "client_history"
      : "industry_baseline";

  const base: number =
    baselineSource === "client_history"
      ? (orgHistory.avgCaseCostDollars as number)
      : INDUSTRY_BASELINE.baselineDollars;

  const daysOffComponent: number =
    input.daysOffWork * INDUSTRY_BASELINE.perDayOffWorkDollars;

  const riskMultiplier: number =
    input.riskLevel !== null
      ? (SEVERITY_MULTIPLIERS.riskLevel[input.riskLevel] ?? 1.0)
      : 1.0;

  const lifecycleMultiplier: number =
    input.lifecycleStage !== null
      ? (SEVERITY_MULTIPLIERS.lifecycleStage[input.lifecycleStage] ?? 1.0)
      : 1.0;

  const complianceUplift: number = input.hasOpenCompliance
    ? SEVERITY_MULTIPLIERS.openComplianceUplift
    : 0;

  // baselineDollars in result = pre-multiplier subtotal (for "vs baseline" comparison)
  const baselineDollars: number = base + daysOffComponent;

  const estimatedCostDollars: number =
    baselineDollars * riskMultiplier * lifecycleMultiplier * (1 + complianceUplift);

  return {
    estimatedCostDollars: Math.round(estimatedCostDollars * 100) / 100,
    baselineDollars,
    components: {
      base,
      daysOffComponent,
      riskMultiplier,
      lifecycleMultiplier,
      complianceUplift,
    },
    formulaVersion: FORMULA_VERSION,
    baselineSource,
    disclaimer: DISCLAIMER,
  };
}
