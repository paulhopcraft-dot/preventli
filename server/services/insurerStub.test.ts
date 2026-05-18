import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock auditLog so no real DB calls are made.
vi.mock("../lib/auditLog", () => ({
  auditLog: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { pushEscalation, ESCALATION_THRESHOLD } from "./insurerStub";
import { auditLog } from "../lib/auditLog";

const mockAuditLog = auditLog as unknown as ReturnType<typeof vi.fn>;

const BASE_PAYLOAD = {
  caseId: "case-001",
  workerName: "Sarah Test",
  triggeredByUserId: "user-clinician-001",
  scoreAtTrigger: 32,
  thresholdAtTrigger: 40,
  messageBody: "Worker has missed 3 appointments and has not responded to outreach.",
};

describe("insurerStub", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ESCALATION_THRESHOLD equals 40", () => {
    expect(ESCALATION_THRESHOLD).toBe(40);
  });

  it("pushEscalation returns { ok: true, escalationId, stubResponse } shape", async () => {
    mockAuditLog.mockResolvedValue(undefined);

    const result = await pushEscalation(BASE_PAYLOAD);

    expect(result.ok).toBe(true);
    expect(typeof result.escalationId).toBe("string");
    expect(result.escalationId.length).toBeGreaterThan(0);
    expect(result.stubResponse).toEqual({
      acknowledged: true,
      ticket: result.escalationId,
    });
  });

  it("escalationId is unique across multiple calls", async () => {
    mockAuditLog.mockResolvedValue(undefined);

    const [r1, r2, r3] = await Promise.all([
      pushEscalation(BASE_PAYLOAD),
      pushEscalation(BASE_PAYLOAD),
      pushEscalation(BASE_PAYLOAD),
    ]);

    const ids = [r1.escalationId, r2.escalationId, r3.escalationId];
    const unique = new Set(ids);
    expect(unique.size).toBe(3);
  });

  it("stubResponse.ticket matches escalationId", async () => {
    mockAuditLog.mockResolvedValue(undefined);

    const result = await pushEscalation(BASE_PAYLOAD);

    expect(result.stubResponse.ticket).toBe(result.escalationId);
  });

  it("audit log failure does NOT cause pushEscalation to throw", async () => {
    mockAuditLog.mockRejectedValue(new Error("DB connection failed"));

    await expect(pushEscalation(BASE_PAYLOAD)).resolves.toMatchObject({
      ok: true,
    });
  });

  it("returns within 100ms (no real network call)", async () => {
    mockAuditLog.mockResolvedValue(undefined);

    const start = Date.now();
    await pushEscalation(BASE_PAYLOAD);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
  });
});
