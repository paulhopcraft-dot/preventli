/**
 * GET /api/assessments — category filter tests.
 *
 * Strategy: mount the assessments router on a tiny express app, mock
 * `storage` and `authorize` so each test can drive the handler with fixture
 * assessment rows and assert on the JSON response.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// First-time module init (vitest cold start) takes longer than the default 5s
// on Windows. Bump the per-test timeout for the whole file.
vi.setConfig({ testTimeout: 30000 });
import express from "express";
import request from "supertest";
import type { NextFunction, Request, Response } from "express";

const ORG_A = "org-A";

// Tunable per-test: storage.getPreEmploymentAssessments return value.
let assessmentRows: unknown[] = [];
let getPreEmploymentAssessmentsMock: ReturnType<typeof vi.fn>;

vi.mock("../middleware/auth", () => ({
  authorize: () => (req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = {
      id: "user-1",
      email: "test@example.com",
      role: "employer",
      organizationId: ORG_A,
    };
    next();
  },
}));

vi.mock("../storage", () => ({
  storage: {
    getPreEmploymentAssessments: (...args: unknown[]) =>
      getPreEmploymentAssessmentsMock(...args),
  },
}));

// Lazy-import the router AFTER mocks are registered.
async function makeApp() {
  const { default: router } = await import("./assessments");
  const app = express();
  app.use(express.json());
  app.use("/api/assessments", router);
  return app;
}

function makeAssessment(overrides: Record<string, unknown> = {}): any {
  return {
    id: "asmt-1",
    workerId: "worker-1",
    candidateName: "Daryl Thompson",
    positionTitle: "Warehouse Operative",
    assessmentType: "baseline_health",
    status: "created",
    clearanceLevel: null,
    sentAt: null,
    createdAt: new Date("2025-01-01T10:00:00Z"),
    reportJson: null,
    accessToken: "secret-token",
    ...overrides,
  };
}

beforeEach(() => {
  assessmentRows = [];
  getPreEmploymentAssessmentsMock = vi.fn(() => Promise.resolve(assessmentRows));
});

describe("GET /api/assessments?category=", () => {
  it("returns all assessments when no category is given", async () => {
    const app = await makeApp();
    assessmentRows = [
      makeAssessment({ id: "a-pe", assessmentType: "baseline_health" }),
      makeAssessment({ id: "a-prev", assessmentType: "prevention" }),
      makeAssessment({ id: "a-exit", assessmentType: "exit" }),
    ];

    const res = await request(app).get("/api/assessments");
    expect(res.status).toBe(200);
    expect(res.body.assessments).toHaveLength(3);
  });

  it("?category=prevention returns only prevention assessments", async () => {
    const app = await makeApp();
    assessmentRows = [
      makeAssessment({ id: "a-pe", assessmentType: "baseline_health" }),
      makeAssessment({ id: "a-prev1", assessmentType: "prevention" }),
      makeAssessment({ id: "a-prev2", assessmentType: "prevention" }),
      makeAssessment({ id: "a-exit", assessmentType: "exit" }),
    ];

    const res = await request(app).get("/api/assessments?category=prevention");
    expect(res.status).toBe(200);
    expect(res.body.assessments).toHaveLength(2);
    expect(res.body.assessments.map((a: any) => a.id).sort()).toEqual([
      "a-prev1",
      "a-prev2",
    ]);
  });

  it("?category=pre_employment returns only the clinical assessment types", async () => {
    const app = await makeApp();
    assessmentRows = [
      makeAssessment({ id: "a-baseline", assessmentType: "baseline_health" }),
      makeAssessment({ id: "a-fcap", assessmentType: "functional_capacity" }),
      makeAssessment({ id: "a-screen", assessmentType: "medical_screening" }),
      makeAssessment({ id: "a-prev", assessmentType: "prevention" }),
      makeAssessment({ id: "a-wellness", assessmentType: "wellness" }),
    ];

    const res = await request(app).get("/api/assessments?category=pre_employment");
    expect(res.status).toBe(200);
    expect(res.body.assessments.map((a: any) => a.id).sort()).toEqual([
      "a-baseline",
      "a-fcap",
      "a-screen",
    ]);
  });

  it("?category=<invalid> responds 400", async () => {
    const app = await makeApp();
    assessmentRows = [makeAssessment()];

    const res = await request(app).get("/api/assessments?category=not-a-category");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid category/);
  });

  it("does not leak the accessToken field in the response", async () => {
    const app = await makeApp();
    assessmentRows = [makeAssessment({ id: "a-1", accessToken: "secret-token" })];

    const res = await request(app).get("/api/assessments");
    expect(res.status).toBe(200);
    expect(res.body.assessments[0]).not.toHaveProperty("accessToken");
  });
});
