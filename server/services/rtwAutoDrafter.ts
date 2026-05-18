/**
 * RTW Auto-Drafter
 *
 * Orchestrator that composes existing RTW services to generate a draft plan
 * when the medical-constraints gate passes. Pure glue — no business logic.
 *
 * Spec: .planning/work-rtw-auto-draft.md (chunk 2)
 * Reused services: planGenerator, functionalAbilityCalculator, modificationSuggester,
 * scheduleCalculator, auditLogger.
 *
 * Skip semantics: every fail-mode returns `{ skipped: true, reason }` rather than
 * throwing. The caller (manual button / nightly sweep) decides whether to surface
 * the reason to a consultant or just log it. Audit is emitted in both success and
 * skip paths.
 */

import type { IStorage } from "../storage";
import type { CertificateCapacity } from "@shared/schema";
import {
  calculateDutySuitability,
  type SuitabilityResult,
} from "./functionalAbilityCalculator";
import {
  recommendPlanType,
  filterDutiesForPlan,
  type DutySuitabilityInput,
  type PlanType,
} from "./planGenerator";
import { generateModificationSuggestions } from "./modificationSuggester";
import {
  generateDefaultSchedule,
  generatePartialHoursSchedule,
  generateNormalHoursSchedule,
  type ScheduleConfig,
  type WeekSchedule,
} from "./scheduleCalculator";
import { logAuditEvent, AuditEventTypes } from "./auditLogger";
import { logger } from "../lib/logger";
import { isOutreachAllowed } from "../lib/contactGuard";

export type AutoDraftSkipReason =
  | "no_medical_constraints_gate"
  | "existing_active_draft"
  | "no_pre_injury_role"
  | "worker_unfit"
  | "confidence_below_threshold"
  | "all_duties_not_suitable"
  | "worker_contact_suppressed";

// Statuses that mean an in-flight draft exists — block new auto-draft.
const IN_FLIGHT_STATUSES = new Set(["draft", "pending_employer_review"]);

export type AutoDraftTriggerSource = "manual" | "nightly_sweep";

export interface AutoDraftSuccess {
  skipped: false;
  planId: string;
  versionId: string;
  planType: PlanType;
  confidence: number;
}

export interface AutoDraftSkipped {
  skipped: true;
  reason: AutoDraftSkipReason;
}

export type AutoDraftResult = AutoDraftSuccess | AutoDraftSkipped;

const CONFIDENCE_THRESHOLD = 0.5;

export interface DraftRTWPlanForCaseDeps {
  storage: IStorage;
}

/**
 * Generate a draft RTW plan for a case if the medical-constraints gate passes
 * and the fail-mode checks all clear. Idempotent: no-op if an active draft exists.
 *
 * @param caseId - Worker case id
 * @param organizationId - Tenant org id (enforced on every storage call)
 * @param triggerSource - 'manual' (button) or 'nightly_sweep' (cron)
 * @param userId - createdBy attribution (real user for manual; system user for sweep)
 * @param deps - storage injected for testability
 */
export async function draftRTWPlanForCase(
  caseId: string,
  organizationId: string,
  triggerSource: AutoDraftTriggerSource,
  userId: string,
  deps: DraftRTWPlanForCaseDeps,
): Promise<AutoDraftResult> {
  const { storage } = deps;

  // ── Gate 1: medical constraints parsed on at least one current certificate
  const hasGate = await storage.caseHasMedicalConstraintsGate(caseId, organizationId);
  if (!hasGate) {
    return skip(caseId, organizationId, "no_medical_constraints_gate", triggerSource, userId);
  }

  // ── Gate 2: idempotency — never overwrite an in-flight draft.
  // An approved or completed plan may be superseded by a new draft (vN+1).
  const latestPlanResult = await storage.getLatestRTWPlanByCase(caseId, organizationId);
  const latestPlanStatus = latestPlanResult?.plan.status ?? null;
  if (latestPlanStatus !== null && IN_FLIGHT_STATUSES.has(latestPlanStatus)) {
    return skip(caseId, organizationId, "existing_active_draft", triggerSource, userId, {
      existingPlanId: latestPlanResult!.plan.id,
      existingPlanStatus: latestPlanStatus,
    });
  }
  // Compute next version number: if an existing plan is present, increment; else start at 1.
  const nextVersion = latestPlanResult !== null ? latestPlanResult.plan.version + 1 : 1;

  // ── Resolve pre-injury role: case override → worker baseline → null
  const caseCtx = await storage.getCaseRoleContext(caseId, organizationId);
  if (!caseCtx) {
    // Defensive: caseHasMedicalConstraintsGate already passed, so the case must exist
    // and belong to this org. If we get here, something raced. Treat as skip.
    return skip(caseId, organizationId, "no_pre_injury_role", triggerSource, userId, {
      raceCondition: "case_disappeared_after_gate_check",
    });
  }

  const roleId = await resolveRoleId(caseCtx, storage);
  if (!roleId) {
    return skip(caseId, organizationId, "no_pre_injury_role", triggerSource, userId);
  }

  // ── Gate: contact suppression — do not draft for a suppressed worker
  // isOutreachAllowed fails open (returns { allowed: true } on error) so a
  // guard outage never silently blocks plan creation.
  if (caseCtx.workerId) {
    const guard = await isOutreachAllowed(caseCtx.workerId);
    if (!guard.allowed) {
      return skip(caseId, organizationId, "worker_contact_suppressed", triggerSource, userId, {
        workerId: caseCtx.workerId,
        suppressionId: guard.suppressionId,
        suppressionReason: guard.reason,
      });
    }
  }

  // ── Gate 3: latest certificate worker capacity is not 'unfit'
  const latestCert = await storage.getLatestCertificate(caseId, organizationId);
  // latestCert is guaranteed non-null here because caseHasMedicalConstraintsGate
  // returned true (which requires at least one cert with parsed restrictions),
  // but check anyway — the gate fetches *current* certs, this fetches *latest by
  // endDate*. They almost always overlap but the type system can't prove it.
  if (latestCert && (latestCert.capacity as CertificateCapacity) === "unfit") {
    return skip(caseId, organizationId, "worker_unfit", triggerSource, userId, {
      latestCertificateId: latestCert.id,
    });
  }

  // ── Pull restrictions + role duties (parallel — both depend only on prior state)
  const [restrictionsResult, dutiesWithDemands] = await Promise.all([
    storage.getCurrentRestrictions(caseId, organizationId),
    storage.getRoleDutiesWithDemands(roleId, organizationId),
  ]);

  if (!restrictionsResult) {
    // Should not happen because gate passed, but defend anyway.
    return skip(caseId, organizationId, "no_medical_constraints_gate", triggerSource, userId, {
      raceCondition: "restrictions_disappeared_after_gate_check",
    });
  }

  // ── Compute suitability per duty using the calculator
  const dutyResults: Array<{
    duty: (typeof dutiesWithDemands)[number];
    result: SuitabilityResult;
  }> = dutiesWithDemands.map((duty) => ({
    duty,
    result: calculateDutySuitability(
      duty.demands,
      restrictionsResult.restrictions,
      duty.isModifiable,
    ),
  }));

  // ── Calculator confidence is the restriction-data-completeness fraction.
  // It's identical across all duties on a case (same restrictions feed each call).
  // Pick the first result's value, or 0 if no duties exist.
  const confidence = dutyResults.length > 0 ? dutyResults[0].result.confidence : 0;

  if (confidence < CONFIDENCE_THRESHOLD) {
    return skip(caseId, organizationId, "confidence_below_threshold", triggerSource, userId, {
      confidence,
      threshold: CONFIDENCE_THRESHOLD,
    });
  }

  // ── Fail mode: every duty came back not_suitable
  const notSuitableCount = dutyResults.filter(
    (d) => d.result.overallSuitability === "not_suitable",
  ).length;
  if (dutyResults.length > 0 && notSuitableCount === dutyResults.length) {
    return skip(caseId, organizationId, "all_duties_not_suitable", triggerSource, userId, {
      totalDuties: dutyResults.length,
    });
  }

  // ── Pick plan type + filter duties + generate modification suggestions
  const dutySuitabilityInputs: DutySuitabilityInput[] = dutyResults.map(({ duty, result }) => ({
    duty,
    suitability: result.overallSuitability,
    modificationSuggestions: generateModificationSuggestions({
      dutyName: duty.name,
      dutyDescription: duty.description ?? "",
      demandComparisons: result.demandComparisons,
      isModifiable: duty.isModifiable,
    }),
  }));

  const planTypeRec = recommendPlanType(restrictionsResult.restrictions, dutySuitabilityInputs);
  const filteredDuties = filterDutiesForPlan(dutySuitabilityInputs, true);

  // ── Schedule: pick generator matching the chosen plan type
  const startDate = new Date();
  const restrictionReviewDate = latestCert?.endDate ?? null;
  const scheduleConfig: ScheduleConfig = {
    startDate,
    restrictionReviewDate,
    maxHoursPerDay: restrictionsResult.maxWorkHoursPerDay,
    maxDaysPerWeek: restrictionsResult.maxWorkDaysPerWeek,
  };
  const schedule = generateScheduleForPlanType(planTypeRec.planType, scheduleConfig);

  // ── Persist via existing transactional createRTWPlan
  const { planId, versionId } = await storage.createRTWPlan({
    organizationId,
    caseId,
    roleId,
    planType: planTypeRec.planType,
    startDate,
    restrictionReviewDate,
    createdBy: userId,
    schedule: schedule.map((w) => ({
      weekNumber: w.weekNumber,
      hoursPerDay: w.hoursPerDay,
      daysPerWeek: w.daysPerWeek,
    })),
    duties: filteredDuties.map((d) => ({
      dutyId: d.dutyId,
      dutyName: d.dutyName,
      suitability: d.suitability,
      modificationNotes: d.modificationNotes,
      excludedReason: d.excludedReason,
      isIncluded: d.isIncluded,
    })),
    autoGenerated: true,
    autoGenerationConfidence: confidence,
    version: nextVersion,
    changeReason:
      nextVersion > 1
        ? `Auto-drafted v${nextVersion} based on latest medical certificate`
        : "Initial plan creation",
  });

  // ── Audit success
  await logAuditEvent({
    userId,
    organizationId,
    eventType: AuditEventTypes.RTW_AUTO_DRAFT_CREATED,
    resourceType: "rtw_plan",
    resourceId: planId,
    metadata: {
      caseId,
      versionId,
      planType: planTypeRec.planType,
      planTypeConfidence: planTypeRec.confidence,
      autoGenerationConfidence: confidence,
      roleId,
      includedDuties: filteredDuties.filter((d) => d.isIncluded).length,
      excludedDuties: filteredDuties.filter((d) => !d.isIncluded).length,
      scheduleWeeks: schedule.length,
      triggerSource,
    },
  });

  logger.db.info("Auto-drafted RTW plan", {
    planId,
    versionId,
    caseId,
    planType: planTypeRec.planType,
    confidence,
    triggerSource,
  });

  return {
    skipped: false,
    planId,
    versionId,
    planType: planTypeRec.planType,
    confidence,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

async function resolveRoleId(
  caseCtx: { workerId: string | null; preInjuryRoleOverrideId: string | null },
  storage: IStorage,
): Promise<string | null> {
  // Per-case override beats worker baseline
  if (caseCtx.preInjuryRoleOverrideId) {
    return caseCtx.preInjuryRoleOverrideId;
  }
  if (!caseCtx.workerId) {
    return null;
  }
  const worker = await storage.getWorkerById(caseCtx.workerId);
  return worker?.roleId ?? null;
}

function generateScheduleForPlanType(
  planType: PlanType,
  config: ScheduleConfig,
): WeekSchedule[] {
  switch (planType) {
    case "normal_hours":
      return generateNormalHoursSchedule(config);
    case "partial_hours":
      return generatePartialHoursSchedule(config);
    case "graduated_return":
      return generateDefaultSchedule(config);
  }
}

async function skip(
  caseId: string,
  organizationId: string,
  reason: AutoDraftSkipReason,
  triggerSource: AutoDraftTriggerSource,
  userId: string,
  extra?: Record<string, unknown>,
): Promise<AutoDraftSkipped> {
  await logAuditEvent({
    userId,
    organizationId,
    eventType: AuditEventTypes.RTW_AUTO_DRAFT_SKIPPED,
    resourceType: "worker_case",
    resourceId: caseId,
    metadata: { reason, triggerSource, ...extra },
  });
  logger.db.info("Auto-draft skipped", { caseId, reason, triggerSource, ...extra });
  return { skipped: true, reason };
}
