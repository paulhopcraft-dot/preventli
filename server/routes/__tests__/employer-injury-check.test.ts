/**
 * Employer injury-check route tests.
 *
 * Covers the split that landed with employer-onboarding-ux-polish:
 *   POST /api/employer/cases/:id/injury-check/draft  — generate, no send
 *   POST /api/employer/cases/:id/injury-check/send   — Zod-validated, sends via emailService
 *
 * Strategy mirrors workers-timeline.test.ts: mock auth, storage, db, and the
 * emailService.sendEmail call, then drive the handlers through supertest.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.setConfig({ testTimeout: 30000 });
import express from "express";
import request from "supertest";
import type { NextFunction, Request, Response } from "express";

const ORG_A = "org-A";

let sendEmailMock: ReturnType<typeof vi.fn>;
let updateSetMock: ReturnType<typeof vi.fn>;
let updateWhereMock: ReturnType<typeof vi.fn>;
let selectedRow:
  | {
      id: string;
      workerName: string;
      company: string;
      summary: string;
      workStatus: string;
      workerEmail: string | null;
      injuryCheckSentAt: Date | null;
    }
  | undefined = undefined;

vi.mock("../../middleware/auth", () => ({
  authorize: () => (req: Request, _res: Response, next: NextFunction) => {
    (req as any).user = {
      id: "user-1",
      email: "jane@arcelectrical.com.au",
      role: "employer",
      organizationId: ORG_A,
    };
    next();
  },
}));

vi.mock("../../storage", () => ({
  storage: {
    // Not used by the injury-check routes directly — they query db.select().
    // Stubbed to satisfy the import.
    getOrganization: vi.fn(),
    getCases: vi.fn(),
    createCase: vi.fn(),
    getGPNet2CaseById: vi.fn(),
  },
}));

vi.mock("../../db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectedRow ? [selectedRow] : []),
        }),
      }),
    }),
    update: () => ({
      set: (...args: unknown[]) => {
        updateSetMock(...args);
        return {
          where: (...whereArgs: unknown[]) => {
            updateWhereMock(...whereArgs);
            return Promise.resolve();
          },
        };
      },
    }),
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([]) }),
    }),
  },
}));

vi.mock("../../services/emailService", () => ({
  sendEmail: (...args: unknown[]) => sendEmailMock(...args),
}));

vi.mock("../../lib/claude-cli", () => ({
  callClaude: vi.fn().mockResolvedValue("Hi Sarah,\n\nHope you're recovering well. Let me know if you need anything.\n\nRegards"),
}));

vi.mock("../../services/hybridSummary", () => ({
  HybridSummaryService: class {
    getCachedOrGenerateSummary() { return Promise.resolve(""); }
  },
}));

async function makeApp() {
  const { employerDashboardRouter } = await import("../employer-dashboard");
  const app = express();
  app.use(express.json());
  app.use("/api/employer", employerDashboardRouter);
  return app;
}

describe("POST /api/employer/cases/:id/injury-check/draft", () => {
  beforeEach(() => {
    sendEmailMock = vi.fn();
    updateSetMock = vi.fn();
    updateWhereMock = vi.fn();
    selectedRow = {
      id: "case-1",
      workerName: "Sarah Mitchell",
      company: "Arc Electrical",
      summary: "Ankle sprain",
      workStatus: "At work",
      workerEmail: "sarah@example.com",
      injuryCheckSentAt: null,
    };
  });

  it("returns to/subject/body with to populated from persisted workerEmail", async () => {
    const app = await makeApp();
    const res = await request(app).post("/api/employer/cases/case-1/injury-check/draft");

    expect(res.status).toBe(200);
    expect(res.body.to).toBe("sarah@example.com");
    expect(res.body.subject).toBe("Injury check-in — Sarah Mitchell");
    expect(typeof res.body.body).toBe("string");
    expect(res.body.body.length).toBeGreaterThan(0);
  });

  it("returns empty to when workerEmail is null (modal can prompt)", async () => {
    selectedRow!.workerEmail = null;
    const app = await makeApp();
    const res = await request(app).post("/api/employer/cases/case-1/injury-check/draft");

    expect(res.status).toBe(200);
    expect(res.body.to).toBe("");
  });

  it("404s when the case doesn't exist (or wrong tenant)", async () => {
    selectedRow = undefined;
    const app = await makeApp();
    const res = await request(app).post("/api/employer/cases/nope/injury-check/draft");

    expect(res.status).toBe(404);
  });
});

describe("POST /api/employer/cases/:id/injury-check/send", () => {
  beforeEach(() => {
    sendEmailMock = vi.fn().mockResolvedValue({ success: true, messageId: "test-msg-id" });
    updateSetMock = vi.fn();
    updateWhereMock = vi.fn();
    selectedRow = {
      id: "case-1",
      workerName: "Sarah Mitchell",
      company: "Arc Electrical",
      summary: "Ankle sprain",
      workStatus: "At work",
      workerEmail: "sarah@example.com",
      injuryCheckSentAt: null,
    };
  });

  it("calls emailService.sendEmail with the validated payload and stamps injuryCheckSentAt", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/api/employer/cases/case-1/injury-check/send")
      .send({
        to: "sarah.edited@example.com",
        subject: "Injury check-in — Sarah Mitchell",
        body: "Hi Sarah,\n\nEdited body content.\n\nRegards",
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sentTo).toBe("sarah.edited@example.com");
    expect(res.body.sentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(sendEmailMock).toHaveBeenCalledWith({
      to: "sarah.edited@example.com",
      subject: "Injury check-in — Sarah Mitchell",
      body: "Hi Sarah,\n\nEdited body content.\n\nRegards",
    });
    // The injuryCheckSentAt update was issued
    expect(updateSetMock).toHaveBeenCalledTimes(1);
    expect(updateWhereMock).toHaveBeenCalledTimes(1);
  });

  it("400s on invalid email address in to field (Zod rejection)", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/api/employer/cases/case-1/injury-check/send")
      .send({
        to: "not-an-email",
        subject: "Injury check-in — Sarah Mitchell",
        body: "Hi",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("400s on empty body (Zod rejection)", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/api/employer/cases/case-1/injury-check/send")
      .send({
        to: "sarah@example.com",
        subject: "Injury check-in — Sarah Mitchell",
        body: "",
      });

    expect(res.status).toBe(400);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("502s when emailService returns a failure (Resend down, etc.)", async () => {
    sendEmailMock = vi.fn().mockResolvedValue({ success: false, error: "Resend timeout" });
    const app = await makeApp();
    const res = await request(app)
      .post("/api/employer/cases/case-1/injury-check/send")
      .send({
        to: "sarah@example.com",
        subject: "Injury check-in — Sarah Mitchell",
        body: "Hi Sarah",
      });

    expect(res.status).toBe(502);
    expect(updateSetMock).not.toHaveBeenCalled();
  });
});
