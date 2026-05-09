/**
 * Worker Health Timeline endpoint tests (WHT-04).
 *
 * Strategy: mount the workers router on a tiny express app, mock `storage`,
 * `db`, and `authorize` so each test can drive the handler with fixture data
 * and assert on the JSON response.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// First-time module init (vitest cold start) takes longer than the default 5s
// on Windows. Bump the per-test timeout for the whole file.
vi.setConfig({ testTimeout: 30000 });
import express from "express";
import request from "supertest";
import type { NextFunction, Request, Response } from "express";

// Tunable per-test: which org the simulated authenticated user belongs to.
let currentUserOrgId = "org-A";

// Tunable per-test: storage mock returns. We re-assign these in beforeEach.
type WorkerProfileMockReturn = {
  worker: { id: string; name: string; organizationId: string };
  assessments: unknown[];
  bookings: unknown[];
} | null;

let getWorkerProfileMock: ReturnType<typeof vi.fn>;
let getWorkerCasesByWorkerMock: ReturnType<typeof vi.fn>;
let getCertificatesForWorkerTimelineMock: ReturnType<typeof vi.fn>;
// db.select().from(preEmploymentAssessments).where(...) — drive via this list:
let assessmentRows: unknown[] = [];

vi.mock("../../middleware/auth", () => ({
  authorize: () => (req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = {
      id: "user-1",
      email: "test@example.com",
      role: "employer",
      organizationId: currentUserOrgId,
    };
    next();
  },
}));

vi.mock("../../storage", () => ({
  storage: {
    getWorkerProfile: (...args: unknown[]) => getWorkerProfileMock(...args),
    getWorkerCasesByWorker: (...args: unknown[]) =>
      getWorkerCasesByWorkerMock(...args),
    getCertificatesForWorkerTimeline: (...args: unknown[]) =>
      getCertificatesForWorkerTimelineMock(...args),
    upsertWorkerByEmail: vi.fn(),
    listWorkers: vi.fn(),
  },
}));

vi.mock("../../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        // Return the in-test assessmentRows when .where() is awaited.
        where: () => Promise.resolve(assessmentRows),
      }),
    }),
  },
}));

// Lazy-import the router AFTER mocks are registered.
async function makeApp() {
  const { default: router } = await import("../workers");
  const app = express();
  app.use(express.json());
  app.use("/api/workers", router);
  return app;
}

const ORG_A = "org-A";
const ORG_B = "org-B";
const WORKER_ID = "worker-1";

function makeAssessment(overrides: Record<string, unknown> = {}): any {
  return {
    id: "asmt-1",
    workerId: WORKER_ID,
    candidateName: "Daryl Thompson",
    positionTitle: "Warehouse Operative",
    assessmentType: "pre_employment",
    status: "completed",
    completedDate: new Date("2025-01-15T10:00:00Z"),
    sentAt: new Date("2025-01-10T10:00:00Z"),
    createdAt: new Date("2025-01-01T10:00:00Z"),
    clearanceLevel: "cleared_unconditional",
    ...overrides,
  };
}

function makeCase(overrides: Record<string, unknown> = {}): any {
  return {
    id: "case-1",
    workerId: WORKER_ID,
    workerName: "Daryl Thompson",
    organizationId: ORG_A,
    summary: "Lower-back strain after lifting a heavy box",
    currentStatus: "Active",
    workStatus: "Modified duties",
    riskLevel: "High",
    caseStatus: "open",
    dateOfInjury: new Date("2024-06-12T00:00:00Z"),
    createdAt: new Date("2024-06-13T00:00:00Z"),
    ...overrides,
  };
}

function makeCert(overrides: Record<string, unknown> = {}): any {
  return {
    id: "cert-1",
    caseId: "case-1",
    workerId: WORKER_ID,
    organizationId: ORG_A,
    issueDate: new Date("2024-08-01T00:00:00Z"),
    startDate: new Date("2024-08-01T00:00:00Z"),
    endDate: new Date("2099-12-31T00:00:00Z"),
    capacity: "Modified duties",
    ...overrides,
  };
}

beforeEach(() => {
  currentUserOrgId = ORG_A;
  assessmentRows = [];
  getWorkerProfileMock = vi.fn();
  getWorkerCasesByWorkerMock = vi.fn();
  getCertificatesForWorkerTimelineMock = vi.fn();
});

describe("GET /api/workers/:id/health-timeline", () => {
  it("(a) merges 2 assessments + 1 case + 3 certificates into 6 events", async () => {
    const app = await makeApp();
    getWorkerProfileMock.mockResolvedValue({
      worker: { id: WORKER_ID, name: "Daryl Thompson", organizationId: ORG_A },
      assessments: [],
      bookings: [],
    } as WorkerProfileMockReturn);
    assessmentRows = [
      makeAssessment({ id: "asmt-A", completedDate: new Date("2025-01-15T00:00:00Z") }),
      makeAssessment({ id: "asmt-B", completedDate: new Date("2024-12-20T00:00:00Z") }),
    ];
    getWorkerCasesByWorkerMock.mockResolvedValue([makeCase({ id: "case-A" })]);
    getCertificatesForWorkerTimelineMock.mockResolvedValue([
      makeCert({ id: "cert-A", issueDate: new Date("2024-08-01T00:00:00Z") }),
      makeCert({ id: "cert-B", issueDate: new Date("2024-09-01T00:00:00Z") }),
      makeCert({ id: "cert-C", issueDate: new Date("2024-10-01T00:00:00Z") }),
    ]);

    const res = await request(app).get(`/api/workers/${WORKER_ID}/health-timeline`);
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(6);

    const types = res.body.events.map((e: any) => e.type).sort();
    expect(types).toEqual(["assessment", "assessment", "case", "certificate", "certificate", "certificate"]);
  });

  it("(b) sorts events by date descending", async () => {
    const app = await makeApp();
    getWorkerProfileMock.mockResolvedValue({
      worker: { id: WORKER_ID, name: "Daryl Thompson", organizationId: ORG_A },
      assessments: [],
      bookings: [],
    });
    assessmentRows = [
      makeAssessment({ id: "asmt-old", completedDate: new Date("2023-01-01T00:00:00Z") }),
      makeAssessment({ id: "asmt-new", completedDate: new Date("2025-06-01T00:00:00Z") }),
    ];
    getWorkerCasesByWorkerMock.mockResolvedValue([
      makeCase({ id: "case-mid", dateOfInjury: new Date("2024-06-01T00:00:00Z") }),
    ]);
    getCertificatesForWorkerTimelineMock.mockResolvedValue([
      makeCert({ id: "cert-new", issueDate: new Date("2024-09-01T00:00:00Z") }),
      makeCert({ id: "cert-old", issueDate: new Date("2024-02-01T00:00:00Z") }),
    ]);

    const res = await request(app).get(`/api/workers/${WORKER_ID}/health-timeline`);
    expect(res.status).toBe(200);
    const events = res.body.events as { date: string }[];
    for (let i = 0; i < events.length - 1; i++) {
      expect(new Date(events[i].date).getTime()).toBeGreaterThanOrEqual(
        new Date(events[i + 1].date).getTime(),
      );
    }
  });

  it("(c) every event has required WorkerHealthTimelineEvent fields and a valid deepLink", async () => {
    const app = await makeApp();
    getWorkerProfileMock.mockResolvedValue({
      worker: { id: WORKER_ID, name: "Daryl Thompson", organizationId: ORG_A },
      assessments: [],
      bookings: [],
    });
    assessmentRows = [makeAssessment({ id: "asmt-X" })];
    getWorkerCasesByWorkerMock.mockResolvedValue([makeCase({ id: "case-X" })]);
    getCertificatesForWorkerTimelineMock.mockResolvedValue([
      makeCert({ id: "cert-X", caseId: "case-X" }),
    ]);

    const res = await request(app).get(`/api/workers/${WORKER_ID}/health-timeline`);
    expect(res.status).toBe(200);

    // deepLink format per PLAN.md section 4.1 table:
    //   /assessments/{id}, /employer/case/{id}, /employer/case/{caseId}?tab=treatment
    const deepLinkRe = /^\/(assessments|employer\/case)\/[^/?]+(\?tab=treatment)?$/;

    for (const ev of res.body.events) {
      expect(typeof ev.id).toBe("string");
      expect(ev.id.length).toBeGreaterThan(0);
      expect(["assessment", "case", "certificate"]).toContain(ev.type);
      // ISO 8601 round-trip
      expect(typeof ev.date).toBe("string");
      expect(Number.isNaN(new Date(ev.date).getTime())).toBe(false);
      expect(typeof ev.title).toBe("string");
      expect(ev.title.length).toBeGreaterThan(0);
      expect(typeof ev.deepLink).toBe("string");
      expect(ev.deepLink).toMatch(deepLinkRe);
      expect(typeof ev.sourceId).toBe("string");
      expect(ev.sourceId.length).toBeGreaterThan(0);
    }

    // Type-specific deeplink shape
    const byType = Object.fromEntries(
      res.body.events.map((e: any) => [e.type, e]),
    );
    expect(byType.assessment.deepLink).toBe("/assessments/asmt-X");
    expect(byType.case.deepLink).toBe("/employer/case/case-X");
    expect(byType.certificate.deepLink).toBe("/employer/case/case-X?tab=treatment");
  });

  it("(d) returns 200 with { events: [] } for a worker with no events", async () => {
    const app = await makeApp();
    getWorkerProfileMock.mockResolvedValue({
      worker: { id: WORKER_ID, name: "Daryl Thompson", organizationId: ORG_A },
      assessments: [],
      bookings: [],
    });
    assessmentRows = [];
    getWorkerCasesByWorkerMock.mockResolvedValue([]);
    getCertificatesForWorkerTimelineMock.mockResolvedValue([]);

    const res = await request(app).get(`/api/workers/${WORKER_ID}/health-timeline`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ events: [] });
  });

  it("(e) calls storage methods with the caller's orgId so cross-org events are excluded", async () => {
    const app = await makeApp();
    currentUserOrgId = ORG_A;
    getWorkerProfileMock.mockResolvedValue({
      worker: { id: WORKER_ID, name: "Daryl Thompson", organizationId: ORG_A },
      assessments: [],
      bookings: [],
    });
    assessmentRows = [];
    getWorkerCasesByWorkerMock.mockResolvedValue([]);
    getCertificatesForWorkerTimelineMock.mockResolvedValue([]);

    await request(app).get(`/api/workers/${WORKER_ID}/health-timeline`);

    expect(getWorkerCasesByWorkerMock).toHaveBeenCalledWith(
      WORKER_ID,
      "Daryl Thompson",
      ORG_A,
    );
    expect(getCertificatesForWorkerTimelineMock).toHaveBeenCalledWith(
      WORKER_ID,
      "Daryl Thompson",
      ORG_A,
    );
  });

  it("(f1) GET /api/workers/:id returns 404 for cross-org access (not 200, not 403)", async () => {
    const app = await makeApp();
    currentUserOrgId = ORG_A;
    // Worker exists but belongs to org B
    getWorkerProfileMock.mockResolvedValue({
      worker: { id: WORKER_ID, name: "Daryl Thompson", organizationId: ORG_B },
      assessments: [],
      bookings: [],
    });

    const res = await request(app).get(`/api/workers/${WORKER_ID}`);
    expect(res.status).toBe(404);
  });

  it("(f2) GET /api/workers/:id/health-timeline returns 404 for cross-org access (not 200, not 403)", async () => {
    const app = await makeApp();
    currentUserOrgId = ORG_A;
    getWorkerProfileMock.mockResolvedValue({
      worker: { id: WORKER_ID, name: "Daryl Thompson", organizationId: ORG_B },
      assessments: [],
      bookings: [],
    });

    const res = await request(app).get(`/api/workers/${WORKER_ID}/health-timeline`);
    expect(res.status).toBe(404);
    // Storage methods that fetch events should NOT have been called once the
    // org-isolation guard rejected.
    expect(getWorkerCasesByWorkerMock).not.toHaveBeenCalled();
    expect(getCertificatesForWorkerTimelineMock).not.toHaveBeenCalled();
  });

  it("(f3) both endpoints return 404 for an unknown worker", async () => {
    const app = await makeApp();
    getWorkerProfileMock.mockResolvedValue(null);

    const r1 = await request(app).get(`/api/workers/does-not-exist`);
    expect(r1.status).toBe(404);

    const r2 = await request(app).get(`/api/workers/does-not-exist/health-timeline`);
    expect(r2.status).toBe(404);
  });

  it("(g) defensive name-match fallback: case with workerId=null but matching name+org appears in events", async () => {
    // The actual fallback join lives inside storage.getWorkerCasesByWorker
    // (covered in the storage method's where-clause; see WHT-03). At the route
    // layer, our contract is: whatever storage returns, the endpoint maps it
    // into a `case` event. So this test verifies the endpoint correctly
    // surfaces a workerId-null case row that storage chose to include via the
    // name-match fallback.
    const app = await makeApp();
    getWorkerProfileMock.mockResolvedValue({
      worker: { id: WORKER_ID, name: "Daryl Thompson", organizationId: ORG_A },
      assessments: [],
      bookings: [],
    });
    assessmentRows = [];
    // Simulate the storage layer's name-match fallback returning a row whose
    // workerId is null but whose workerName matches.
    getWorkerCasesByWorkerMock.mockResolvedValue([
      makeCase({ id: "case-fallback", workerId: null }),
    ]);
    getCertificatesForWorkerTimelineMock.mockResolvedValue([]);

    const res = await request(app).get(`/api/workers/${WORKER_ID}/health-timeline`);
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0]).toMatchObject({
      type: "case",
      sourceId: "case-fallback",
      deepLink: "/employer/case/case-fallback",
    });
  });
});
