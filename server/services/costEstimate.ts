/**
 * Claim cost estimate recompute service — funding-bundle Phase 2.
 *
 * Pulls a case row + org history, runs the formula, upserts the result.
 * Best-effort — logs but never throws, so callers (lifecycle route) are not blocked.
 */

import { storage } from "../storage";
import { calculateCostEstimate } from "../../config/cost-estimate-formula";
import { createLogger } from "../lib/logger";

const log = createLogger("CostEstimate");

/**
 * Recompute the claim cost estimate for a single case and persist the result.
 * Best-effort: any error is logged but not re-thrown.
 */
export async function recomputeFor(caseId: string): Promise<void> {
  try {
    const workerCase = await storage.getGPNet2CaseByIdAdmin(caseId);
    if (!workerCase) {
      log.warn("recomputeFor: case not found", { caseId });
      return;
    }

    // Compute days off work from dateOfInjury to now
    const injuryDate = new Date(workerCase.dateOfInjury);
    const daysOffWork = isNaN(injuryDate.getTime())
      ? 0
      : Math.max(0, Math.floor((Date.now() - injuryDate.getTime()) / 86_400_000));

    // Derive hasOpenCompliance from the complianceIndicator field.
    // "Very High" or "High" compliance indicator = open compliance issue.
    const complianceIndicator = workerCase.complianceIndicator ?? "";
    const hasOpenCompliance =
      complianceIndicator === "Very High" || complianceIndicator === "High";

    const orgHistory = await storage.getOrgCaseCostStats(workerCase.organizationId);

    const result = calculateCostEstimate(
      {
        daysOffWork,
        riskLevel: workerCase.riskLevel ?? null,
        lifecycleStage: workerCase.lifecycleStage ?? null,
        hasOpenCompliance,
      },
      orgHistory,
    );

    await storage.upsertCaseCostEstimate({
      caseId,
      estimatedCostDollars: result.estimatedCostDollars.toString(),
      baselineDollars: result.baselineDollars.toString(),
      components: result.components as unknown as Record<string, number>,
      formulaVersion: result.formulaVersion,
      baselineSource: result.baselineSource,
    } as any);
  } catch (err) {
    log.error("recomputeFor failed", { caseId }, err);
  }
}
