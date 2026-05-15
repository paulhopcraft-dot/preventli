/**
 * Unit tests for rtwAutoDrafter orchestrator.
 *
 * Covers the spec from .planning/work-rtw-auto-draft.md:
 *   - Happy path → success + RTW_AUTO_DRAFT_CREATED audit
 *   - Four fail modes from the decision matrix:
 *     (a) confidence < 0.5, (b) all duties not_suitable,
 *     (c) no pre-injury role, (d) worker unfit on latest cert
 *   - Idempotency: existing active draft → skip
 *   - Gate: no medical constraints → skip
 *   - Role-pick chain: case override beats worker baseline
 *
 * Strategy: mock the entire IStorage surface used by the orchestrator and the
 * auditLogger module. The composed services (planGenerator, calculator,
 * suggester, scheduleCalculator) are NOT mocked — they run for real because
 * they are pure functions and their behaviour is part of what we're asserting
 * against (e.g. confidence threshold).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IStorage } from "../storage";
import type {
  FunctionalRestrictions,
  FunctionalRestrictionsExtracted,
  MedicalCertificateDB,
  RTWDutyDB,
  RTWDutyDemandsDB,
  WorkerDB,
} from "@shared/schema";

// Stub the entire auditLogger module — pulling in the real one transitively
// loads server/db.ts which throws at import-time without DATABASE_URL. The
// mocked AuditEventTypes mirrors the real values from auditLogger.ts; keep
// these strings in sync if the real constants are renamed.
vi.mock("./auditLogger", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
  AuditEventTypes: {
    RTW_AUTO_DRAFT_CREATED: "rtw_plan.auto_draft.created",
    RTW_AUTO_DRAFT_SKIPPED: "rtw_plan.auto_draft.skipped",
  } as const,
}));

import {
  draftRTWPlanForCase,
  type AutoDraftSkipped,
  type AutoDraftSuccess,
} from "./rtwAutoDrafter";
import { logAuditEvent, AuditEventTypes } from "./auditLogger";

// ────────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────────

const ORG = "org-1";
const CASE_ID = "case-1";
const USER = "user-1";
const ROLE_ID = "role-1";
const WORKER_ID = "worker-1";

function makeGoodRestrictions(): FunctionalRestrictionsExtracted {
  // All 15 capability fields assessed → confidence = 1.0
  return {
    sitting: "can",
    standingWalking: "can",
    bending: "can",
    squatting: "can",
    kneelingClimbing: "can",
    twisting: "can",
    reachingOverhead: "can",
    reachingForward: "can",
    neckMovement: "can",
    lifting: "can",
    liftingMaxKg: 25,
    carrying: "can",
    carryingMaxKg: 25,
    pushing: "can",
    pulling: "can",
    repetitiveMovements: "can",
    useOfInjuredLimb: "can",
  };
}

function makeLowConfidenceRestrictions(): FunctionalRestrictions {
  // Only 2 of 15 capability fields assessed → confidence ≈ 0.13
  return {
    sitting: "can",
    standingWalking: "can",
    bending: "not_assessed",
    squatting: "not_assessed",
    kneelingClimbing: "not_assessed",
    twisting: "not_assessed",
    reachingOverhead: "not_assessed",
    reachingForward: "not_assessed",
    neckMovement: "not_assessed",
    lifting: "not_assessed",
    liftingMaxKg: undefined,
    carrying: "not_assessed",
    carryingMaxKg: undefined,
    pushing: "not_assessed",
    pulling: "not_assessed",
    repetitiveMovements: "not_assessed",
    useOfInjuredLimb: "not_assessed",
  };
}

function makeRestrictedRestrictions(): FunctionalRestrictions {
  // Fully assessed but worker cannot do anything → every duty not_suitable
  return {
    sitting: "cannot",
    standingWalking: "cannot",
    bending: "cannot",
    squatting: "cannot",
    kneelingClimbing: "cannot",
    twisting: "cannot",
    reachingOverhead: "cannot",
    reachingForward: "cannot",
    neckMovement: "cannot",
    lifting: "cannot",
    liftingMaxKg: 0,
    carrying: "cannot",
    carryingMaxKg: 0,
    pushing: "cannot",
    pulling: "cannot",
    repetitiveMovements: "cannot",
    useOfInjuredLimb: "cannot",
  };
}

function makeDemands(overrides: Partial<RTWDutyDemandsDB> = {}): RTWDutyDemandsDB {
  return {
    id: "demands-1",
    dutyId: "duty-1",
    bending: "frequently",
    squatting: "occasionally",
    kneeling: "never",
    twisting: "occasionally",
    reachingOverhead: "occasionally",
    reachingForward: "frequently",
    lifting: "frequently",
    liftingMaxKg: 10,
    carrying: "occasionally",
    carryingMaxKg: 10,
    standing: "frequently",
    sitting: "occasionally",
    walking: "frequently",
    repetitiveMovements: "occasionally",
    concentration: "frequently",
    stressTolerance: "occasionally",
    workPace: "frequently",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeDuty(
  id: string,
  overrides: Partial<RTWDutyDB> = {},
): RTWDutyDB & { demands: RTWDutyDemandsDB | null } {
  return {
    id,
    roleId: ROLE_ID,
    organizationId: ORG,
    name: `Duty ${id}`,
    description: null,
    isModifiable: true,
    riskFlags: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    demands: makeDemands({ dutyId: id }),
    ...overrides,
  };
}

function makeCert(overrides: Partial<MedicalCertificateDB> = {}): MedicalCertificateDB {
  return {
    id: "cert-1",
    caseId: CASE_ID,
    workerId: WORKER_ID,
    issueDate: new Date(),
    startDate: new Date(),
    endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    capacity: "partial",
    workCapacityPercentage: 50,
    notes: null,
    source: "manual",
    documentUrl: null,
    functionalRestrictionsJson: makeGoodRestrictions() as FunctionalRestrictions,
    isCurrentCertificate: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as unknown as MedicalCertificateDB;
}

function makeStorage(overrides: Partial<IStorage> = {}): IStorage {
  const restrictions = makeGoodRestrictions() as FunctionalRestrictions;
  const base: Partial<IStorage> = {
    caseHasMedicalConstraintsGate: vi.fn().mockResolvedValue(true),
    getActiveDraftPlan: vi.fn().mockResolvedValue(null),
    getLatestRTWPlanByCase: vi.fn().mockResolvedValue(null),
    getCaseRoleContext: vi
      .fn()
      .mockResolvedValue({ workerId: WORKER_ID, preInjuryRoleOverrideId: null }),
    getWorkerById: vi.fn().mockResolvedValue({ roleId: ROLE_ID } as unknown as WorkerDB),
    getLatestCertificate: vi.fn().mockResolvedValue(makeCert()),
    getCurrentRestrictions: vi.fn().mockResolvedValue({
      restrictions,
      maxWorkHoursPerDay: null,
      maxWorkDaysPerWeek: null,
      source: "single_certificate",
      certificateCount: 1,
    }),
    getRoleDutiesWithDemands: vi
      .fn()
      .mockResolvedValue([makeDuty("d1"), makeDuty("d2")]),
    createRTWPlan: vi
      .fn()
      .mockResolvedValue({ planId: "plan-1", versionId: "version-1" }),
  };
  return { ...base, ...overrides } as IStorage;
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe("rtwAutoDrafter", () => {
  beforeEach(() => {
    vi.mocked(logAuditEvent).mockClear();
  });

  describe("happy path", () => {
    it("creates a draft plan and emits RTW_AUTO_DRAFT_CREATED audit", async () => {
      const storage = makeStorage();
      const result = await draftRTWPlanForCase(CASE_ID, ORG, "manual", USER, { storage });

      expect(result.skipped).toBe(false);
      const success = result as AutoDraftSuccess;
      expect(success.planId).toBe("plan-1");
      expect(success.versionId).toBe("version-1");
      expect(success.confidence).toBeGreaterThanOrEqual(0.5);
      expect(storage.createRTWPlan).toHaveBeenCalledTimes(1);

      const createArg = vi.mocked(storage.createRTWPlan).mock.calls[0][0];
      expect(createArg.autoGenerated).toBe(true);
      expect(createArg.autoGenerationConfidence).toBe(success.confidence);
      expect(createArg.roleId).toBe(ROLE_ID);
      expect(createArg.organizationId).toBe(ORG);
      expect(createArg.caseId).toBe(CASE_ID);
      expect(createArg.createdBy).toBe(USER);

      const audit = vi.mocked(logAuditEvent).mock.calls[0][0];
      expect(audit.eventType).toBe(AuditEventTypes.RTW_AUTO_DRAFT_CREATED);
      expect(audit.resourceId).toBe("plan-1");
      expect(audit.metadata).toMatchObject({
        caseId: CASE_ID,
        versionId: "version-1",
        planType: success.planType,
        triggerSource: "manual",
      });
    });
  });

  describe("fail modes (each emits RTW_AUTO_DRAFT_SKIPPED with reason)", () => {
    it("skips with no_medical_constraints_gate when gate fails", async () => {
      const storage = makeStorage({
        caseHasMedicalConstraintsGate: vi.fn().mockResolvedValue(false),
      });
      const result = (await draftRTWPlanForCase(CASE_ID, ORG, "manual", USER, {
        storage,
      })) as AutoDraftSkipped;

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("no_medical_constraints_gate");
      expect(storage.createRTWPlan).not.toHaveBeenCalled();

      const audit = vi.mocked(logAuditEvent).mock.calls[0][0];
      expect(audit.eventType).toBe(AuditEventTypes.RTW_AUTO_DRAFT_SKIPPED);
      expect(audit.metadata).toMatchObject({
        reason: "no_medical_constraints_gate",
        triggerSource: "manual",
      });
    });

    it("skips with existing_active_draft when an active draft exists (idempotency)", async () => {
      const storage = makeStorage({
        getLatestRTWPlanByCase: vi
          .fn()
          .mockResolvedValue({ plan: { id: "existing-plan", status: "draft", version: 1 } }),
      });
      const result = (await draftRTWPlanForCase(CASE_ID, ORG, "nightly_sweep", USER, {
        storage,
      })) as AutoDraftSkipped;

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("existing_active_draft");
      expect(storage.createRTWPlan).not.toHaveBeenCalled();

      const audit = vi.mocked(logAuditEvent).mock.calls[0][0];
      expect(audit.metadata).toMatchObject({
        reason: "existing_active_draft",
        existingPlanId: "existing-plan",
      });
    });

    it("skips with no_pre_injury_role when case has no override and worker has no roleId", async () => {
      const storage = makeStorage({
        getCaseRoleContext: vi
          .fn()
          .mockResolvedValue({ workerId: WORKER_ID, preInjuryRoleOverrideId: null }),
        getWorkerById: vi.fn().mockResolvedValue({ roleId: null } as unknown as WorkerDB),
      });
      const result = (await draftRTWPlanForCase(CASE_ID, ORG, "manual", USER, {
        storage,
      })) as AutoDraftSkipped;

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("no_pre_injury_role");
    });

    it("skips with no_pre_injury_role when case has no workerId and no override", async () => {
      const storage = makeStorage({
        getCaseRoleContext: vi
          .fn()
          .mockResolvedValue({ workerId: null, preInjuryRoleOverrideId: null }),
      });
      const result = (await draftRTWPlanForCase(CASE_ID, ORG, "manual", USER, {
        storage,
      })) as AutoDraftSkipped;

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("no_pre_injury_role");
      // getWorkerById should NOT have been called when workerId is null
      expect(storage.getWorkerById).not.toHaveBeenCalled();
    });

    it("skips with worker_unfit when latest certificate capacity is 'unfit'", async () => {
      const storage = makeStorage({
        getLatestCertificate: vi
          .fn()
          .mockResolvedValue(makeCert({ capacity: "unfit", id: "cert-unfit" })),
      });
      const result = (await draftRTWPlanForCase(CASE_ID, ORG, "manual", USER, {
        storage,
      })) as AutoDraftSkipped;

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("worker_unfit");

      const audit = vi.mocked(logAuditEvent).mock.calls[0][0];
      expect(audit.metadata).toMatchObject({
        reason: "worker_unfit",
        latestCertificateId: "cert-unfit",
      });
    });

    it("skips with confidence_below_threshold when restrictions are mostly unassessed", async () => {
      const storage = makeStorage({
        getCurrentRestrictions: vi.fn().mockResolvedValue({
          restrictions: makeLowConfidenceRestrictions(),
          maxWorkHoursPerDay: null,
          maxWorkDaysPerWeek: null,
          source: "single_certificate",
          certificateCount: 1,
        }),
      });
      const result = (await draftRTWPlanForCase(CASE_ID, ORG, "manual", USER, {
        storage,
      })) as AutoDraftSkipped;

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("confidence_below_threshold");

      const audit = vi.mocked(logAuditEvent).mock.calls[0][0];
      expect(audit.metadata).toMatchObject({ reason: "confidence_below_threshold" });
      expect((audit.metadata as { confidence: number }).confidence).toBeLessThan(0.5);
    });

    it("skips with all_duties_not_suitable when every duty fails suitability", async () => {
      const storage = makeStorage({
        getCurrentRestrictions: vi.fn().mockResolvedValue({
          restrictions: makeRestrictedRestrictions(),
          maxWorkHoursPerDay: null,
          maxWorkDaysPerWeek: null,
          source: "single_certificate",
          certificateCount: 1,
        }),
        getRoleDutiesWithDemands: vi
          .fn()
          .mockResolvedValue([
            makeDuty("d1", { isModifiable: false }),
            makeDuty("d2", { isModifiable: false }),
          ]),
      });
      const result = (await draftRTWPlanForCase(CASE_ID, ORG, "manual", USER, {
        storage,
      })) as AutoDraftSkipped;

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("all_duties_not_suitable");
    });
  });

  describe("role-pick fallback chain", () => {
    it("prefers case.preInjuryRoleOverrideId over worker.roleId", async () => {
      const overrideRoleId = "role-override-1";
      const storage = makeStorage({
        getCaseRoleContext: vi.fn().mockResolvedValue({
          workerId: WORKER_ID,
          preInjuryRoleOverrideId: overrideRoleId,
        }),
        // Worker has a different baseline role — should be ignored
        getWorkerById: vi
          .fn()
          .mockResolvedValue({ roleId: "role-worker-baseline" } as unknown as WorkerDB),
      });

      await draftRTWPlanForCase(CASE_ID, ORG, "manual", USER, { storage });

      expect(storage.getRoleDutiesWithDemands).toHaveBeenCalledWith(overrideRoleId, ORG);
      // getWorkerById should not be called when override is present
      expect(storage.getWorkerById).not.toHaveBeenCalled();
    });

    it("falls back to worker.roleId when case has no override", async () => {
      const storage = makeStorage();
      await draftRTWPlanForCase(CASE_ID, ORG, "manual", USER, { storage });
      expect(storage.getRoleDutiesWithDemands).toHaveBeenCalledWith(ROLE_ID, ORG);
      expect(storage.getWorkerById).toHaveBeenCalledWith(WORKER_ID);
    });
  });
});
