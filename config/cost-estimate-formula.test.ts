import { describe, it, expect } from "vitest";
import {
  calculateCostEstimate,
  DISCLAIMER,
  FORMULA_VERSION,
  COLD_START_THRESHOLD,
  INDUSTRY_BASELINE,
  SEVERITY_MULTIPLIERS,
  type CostEstimateInput,
  type OrgHistoryStats,
} from "./cost-estimate-formula";

// Helpers
function makeInput(overrides: Partial<CostEstimateInput> = {}): CostEstimateInput {
  return {
    daysOffWork: 0,
    riskLevel: "medium",
    lifecycleStage: "intake",
    hasOpenCompliance: false,
    ...overrides,
  };
}

function makeOrg(overrides: Partial<OrgHistoryStats> = {}): OrgHistoryStats {
  return {
    caseCount: 0,
    avgCaseCostDollars: null,
    ...overrides,
  };
}

describe("calculateCostEstimate", () => {
  // 1. Cold-start fallback
  it("caseCount=0 → baselineSource=industry_baseline, base=50_000", () => {
    const result = calculateCostEstimate(makeInput(), makeOrg({ caseCount: 0 }));
    expect(result.baselineSource).toBe("industry_baseline");
    expect(result.components.base).toBe(50_000);
  });

  // 2. Client history
  it("caseCount=5, avg=80_000 → baselineSource=client_history, base=80_000", () => {
    const result = calculateCostEstimate(
      makeInput(),
      makeOrg({ caseCount: 5, avgCaseCostDollars: 80_000 }),
    );
    expect(result.baselineSource).toBe("client_history");
    expect(result.components.base).toBe(80_000);
  });

  // 3. Days-off component adds 30 * 400 = 12_000
  it("daysOffWork=30 adds 30 * 400 = 12_000 to the daysOffComponent", () => {
    const result = calculateCostEstimate(
      makeInput({ daysOffWork: 30 }),
      makeOrg({ caseCount: 0 }),
    );
    expect(result.components.daysOffComponent).toBe(12_000);
    // baselineDollars = base(50k) + daysOff(12k) = 62_000
    expect(result.baselineDollars).toBe(62_000);
  });

  // 4. Risk multiplier "very high" → 1.6× the base+daysOff
  it("riskLevel=very high applies 1.6 multiplier to base+daysOff", () => {
    const base = 50_000;
    const daysOff = 0;
    const result = calculateCostEstimate(
      makeInput({ riskLevel: "very high", daysOffWork: daysOff, lifecycleStage: "intake", hasOpenCompliance: false }),
      makeOrg({ caseCount: 0 }),
    );
    // intake = 1.0, no compliance, no daysOff → estimatedCost = base * 1.6
    expect(result.estimatedCostDollars).toBeCloseTo(base * 1.6, 2);
    expect(result.components.riskMultiplier).toBe(1.6);
  });

  // 5. Lifecycle rtw_transition applies 0.8 reduction
  it("lifecycleStage=rtw_transition applies 0.8 lifecycle multiplier", () => {
    const result = calculateCostEstimate(
      makeInput({ lifecycleStage: "rtw_transition", riskLevel: "medium", hasOpenCompliance: false }),
      makeOrg({ caseCount: 0 }),
    );
    expect(result.components.lifecycleMultiplier).toBe(0.8);
    // medium risk = 1.0, no compliance → estimatedCost = 50_000 * 1.0 * 0.8
    expect(result.estimatedCostDollars).toBeCloseTo(40_000, 2);
  });

  // 6. Closed lifecycle returns 0 cost
  it("lifecycleStage=closed_resolved → estimatedCostDollars=0", () => {
    const result = calculateCostEstimate(
      makeInput({ lifecycleStage: "closed_resolved", daysOffWork: 30 }),
      makeOrg({ caseCount: 5, avgCaseCostDollars: 100_000 }),
    );
    expect(result.estimatedCostDollars).toBe(0);
    expect(result.components.lifecycleMultiplier).toBe(0);
  });

  it("lifecycleStage=closed_terminated → estimatedCostDollars=0", () => {
    const result = calculateCostEstimate(
      makeInput({ lifecycleStage: "closed_terminated" }),
      makeOrg({ caseCount: 0 }),
    );
    expect(result.estimatedCostDollars).toBe(0);
  });

  // 7. Open compliance uplift adds 10%
  it("hasOpenCompliance=true adds 10% uplift to the final cost", () => {
    const withoutCompliance = calculateCostEstimate(
      makeInput({ hasOpenCompliance: false }),
      makeOrg({ caseCount: 0 }),
    );
    const withCompliance = calculateCostEstimate(
      makeInput({ hasOpenCompliance: true }),
      makeOrg({ caseCount: 0 }),
    );
    expect(withCompliance.estimatedCostDollars).toBeCloseTo(
      withoutCompliance.estimatedCostDollars * 1.1,
      2,
    );
    expect(withCompliance.components.complianceUplift).toBe(0.1);
    expect(withoutCompliance.components.complianceUplift).toBe(0);
  });

  // 8. Disclaimer string is exported as a constant
  it("DISCLAIMER is exported as a non-empty string", () => {
    expect(typeof DISCLAIMER).toBe("string");
    expect(DISCLAIMER.length).toBeGreaterThan(0);
    expect(DISCLAIMER).toContain("WorkSafe Victoria");
  });

  // 9. FORMULA_VERSION is non-empty
  it("FORMULA_VERSION is a non-empty string", () => {
    expect(typeof FORMULA_VERSION).toBe("string");
    expect(FORMULA_VERSION.length).toBeGreaterThan(0);
  });

  // 10. All SEVERITY_MULTIPLIERS.riskLevel values are 0 < x < 2
  it("all riskLevel multipliers are strictly between 0 and 2", () => {
    for (const [key, value] of Object.entries(SEVERITY_MULTIPLIERS.riskLevel)) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(2);
    }
  });

  // Additional: disclaimer is included in result
  it("result.disclaimer matches the exported DISCLAIMER constant", () => {
    const result = calculateCostEstimate(makeInput(), makeOrg());
    expect(result.disclaimer).toBe(DISCLAIMER);
  });

  // Additional: cold-start threshold constant matches spec
  it("COLD_START_THRESHOLD is 3", () => {
    expect(COLD_START_THRESHOLD).toBe(3);
  });

  // Additional: caseCount exactly at threshold uses client history
  it("caseCount=3 (at threshold) uses client_history", () => {
    const result = calculateCostEstimate(
      makeInput(),
      makeOrg({ caseCount: 3, avgCaseCostDollars: 60_000 }),
    );
    expect(result.baselineSource).toBe("client_history");
    expect(result.components.base).toBe(60_000);
  });

  // Additional: caseCount=2 (below threshold) uses industry_baseline
  it("caseCount=2 (below threshold) uses industry_baseline", () => {
    const result = calculateCostEstimate(
      makeInput(),
      makeOrg({ caseCount: 2, avgCaseCostDollars: 60_000 }),
    );
    expect(result.baselineSource).toBe("industry_baseline");
    expect(result.components.base).toBe(INDUSTRY_BASELINE.baselineDollars);
  });
});
