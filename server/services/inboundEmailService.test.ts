import { describe, it, expect, vi } from "vitest";

// Stub heavy transitive imports — the real storage module loads server/db.ts
// which throws at import-time without DATABASE_URL. Same pattern used by
// rtwAutoDrafter.test.ts. We only test the pure helpers below.
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../lib/logger", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("./emailMatcher", () => ({ matchEmailToCase: vi.fn(), detectsCertificateContent: vi.fn() }));
vi.mock("./llmEmailMatcher", () => ({ llmMatchEmailToCase: vi.fn() }));

import {
  extractCaseInfoFromEmail,
  shouldAutoCreateCertificate,
  LLM_CERT_CONFIDENCE_FLOOR,
} from "./inboundEmailService";

describe("extractCaseInfoFromEmail — tenant safety", () => {
  it("does NOT hardcode org-alpha; returns the orgId the caller provided", () => {
    const info = extractCaseInfoFromEmail(
      "Injury Report - Sarah Chen",
      undefined,
      "gp@clinic.example",
      "Dr Smith",
      "org-wallara",
    );
    expect(info.organizationId).toBe("org-wallara");
    expect(info.organizationId).not.toBe("org-alpha");
  });

  it("returns organizationId: null when caller has no tenant for the email", () => {
    const info = extractCaseInfoFromEmail(
      "Injury Report - Sarah Chen",
      undefined,
      "gp@clinic.example",
      "Dr Smith",
      null,
    );
    expect(info.organizationId).toBeNull();
    // workerName still extracted — the gate is on the caller side
    expect(info.workerName).toBe("Sarah Chen");
  });

  it("still extracts worker name + risk level correctly regardless of orgId", () => {
    const info = extractCaseInfoFromEmail(
      "URGENT: Marcus Tanaka — ambulance call out",
      undefined,
      "hr@employer.example",
      "HR Manager",
      "org-test",
    );
    expect(info.workerName).toBe("Marcus Tanaka");
    expect(info.riskLevel).toBe("High");
    expect(info.workStatus).toBe("Off work");
  });
});

describe("shouldAutoCreateCertificate — clinical-write gate", () => {
  it("allows cert auto-create for thread match regardless of confidence", () => {
    expect(shouldAutoCreateCertificate("thread", null)).toBe(true);
    expect(shouldAutoCreateCertificate("thread", 0.1)).toBe(true);
  });

  it("allows cert auto-create for sender_email match regardless of confidence", () => {
    expect(shouldAutoCreateCertificate("sender_email", null)).toBe(true);
    expect(shouldAutoCreateCertificate("sender_email", 0.2)).toBe(true);
  });

  it("allows cert auto-create for claim_number match regardless of confidence", () => {
    expect(shouldAutoCreateCertificate("claim_number", null)).toBe(true);
    expect(shouldAutoCreateCertificate("claim_number", 0.3)).toBe(true);
  });

  it("blocks cert auto-create for low-confidence LLM match", () => {
    expect(shouldAutoCreateCertificate("llm", 0.6)).toBe(false);
    expect(shouldAutoCreateCertificate("llm", 0.89)).toBe(false);
    expect(shouldAutoCreateCertificate("llm", null)).toBe(false);
  });

  it("allows cert auto-create for high-confidence LLM match at the floor", () => {
    expect(shouldAutoCreateCertificate("llm", LLM_CERT_CONFIDENCE_FLOOR)).toBe(true);
    expect(shouldAutoCreateCertificate("llm", 0.95)).toBe(true);
    expect(shouldAutoCreateCertificate("llm", 1.0)).toBe(true);
  });

  it("blocks cert auto-create for worker_name fuzzy match (not in trusted set)", () => {
    expect(shouldAutoCreateCertificate("worker_name", 0.99)).toBe(false);
  });

  it("blocks cert auto-create for unknown / none / new_case methods", () => {
    expect(shouldAutoCreateCertificate("none", null)).toBe(false);
    expect(shouldAutoCreateCertificate("new_case", null)).toBe(false);
    expect(shouldAutoCreateCertificate("unknown", 1.0)).toBe(false);
  });
});
