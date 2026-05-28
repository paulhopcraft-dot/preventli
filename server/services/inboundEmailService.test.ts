import { describe, it, expect, vi } from "vitest";

// Stub heavy transitive imports — the real storage module loads server/db.ts
// which throws at import-time without DATABASE_URL. Same pattern used by
// rtwAutoDrafter.test.ts. We only test the pure helpers below.
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../lib/logger", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("./emailMatcher", () => ({
  matchEmailToCase: vi.fn(),
  detectsCertificateContent: vi.fn(),
  // Default to "no bracket found" so existing fuzzy-regex tests still hit
  // the fallback path. Tests that want bracket behaviour mock this directly.
  parseBracketedWorkerName: vi.fn(() => null),
}));
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
  describe("with a PDF cert attachment (hasCertAttachment=true)", () => {
    it("allows cert auto-create for thread match regardless of confidence", () => {
      expect(shouldAutoCreateCertificate("thread", null, true)).toBe(true);
      expect(shouldAutoCreateCertificate("thread", 0.1, true)).toBe(true);
    });

    it("allows cert auto-create for sender_email match regardless of confidence", () => {
      expect(shouldAutoCreateCertificate("sender_email", null, true)).toBe(true);
      expect(shouldAutoCreateCertificate("sender_email", 0.2, true)).toBe(true);
    });

    it("allows cert auto-create for claim_number match regardless of confidence", () => {
      expect(shouldAutoCreateCertificate("claim_number", null, true)).toBe(true);
      expect(shouldAutoCreateCertificate("claim_number", 0.3, true)).toBe(true);
    });

    it("allows cert auto-create for subject_bracket match (new high-trust method)", () => {
      expect(shouldAutoCreateCertificate("subject_bracket", null, true)).toBe(true);
      expect(shouldAutoCreateCertificate("subject_bracket", 0.95, true)).toBe(true);
    });

    it("blocks cert auto-create for low-confidence LLM match", () => {
      expect(shouldAutoCreateCertificate("llm", 0.6, true)).toBe(false);
      expect(shouldAutoCreateCertificate("llm", 0.89, true)).toBe(false);
      expect(shouldAutoCreateCertificate("llm", null, true)).toBe(false);
    });

    it("allows cert auto-create for high-confidence LLM match at the floor", () => {
      expect(shouldAutoCreateCertificate("llm", LLM_CERT_CONFIDENCE_FLOOR, true)).toBe(true);
      expect(shouldAutoCreateCertificate("llm", 0.95, true)).toBe(true);
      expect(shouldAutoCreateCertificate("llm", 1.0, true)).toBe(true);
    });

    it("blocks cert auto-create for worker_name fuzzy match (not in trusted set)", () => {
      expect(shouldAutoCreateCertificate("worker_name", 0.99, true)).toBe(false);
    });

    it("blocks cert auto-create for unknown / none / new_case methods", () => {
      expect(shouldAutoCreateCertificate("none", null, true)).toBe(false);
      expect(shouldAutoCreateCertificate("new_case", null, true)).toBe(false);
      expect(shouldAutoCreateCertificate("unknown", 1.0, true)).toBe(false);
    });
  });

  describe("without a PDF cert attachment (hasCertAttachment=false) — phantom-cert guard", () => {
    it("blocks cert auto-create even for thread match (no PDF = no cert)", () => {
      expect(shouldAutoCreateCertificate("thread", 1.0, false)).toBe(false);
    });

    it("blocks cert auto-create even for sender_email match (no PDF = no cert)", () => {
      // This is the "Alan forwards 'Dr Lee will send cert tomorrow'" case.
      expect(shouldAutoCreateCertificate("sender_email", 0.9, false)).toBe(false);
    });

    it("blocks cert auto-create even for claim_number match (no PDF = no cert)", () => {
      expect(shouldAutoCreateCertificate("claim_number", 1.0, false)).toBe(false);
    });

    it("blocks cert auto-create even for subject_bracket match (no PDF = no cert)", () => {
      expect(shouldAutoCreateCertificate("subject_bracket", 1.0, false)).toBe(false);
    });

    it("blocks cert auto-create for high-confidence LLM match without PDF", () => {
      expect(shouldAutoCreateCertificate("llm", 1.0, false)).toBe(false);
    });

    it("blocks cert auto-create when source is 'imap' — even on high-trust match with PDF", () => {
      // Anyone on the open internet can email support@gpnet.au with a PDF
      // named medical-certificate.pdf. Until a sender-allowlist exists, no
      // clinical write is allowed from IMAP-sourced mail.
      expect(shouldAutoCreateCertificate("thread", null, true, "imap")).toBe(false);
      expect(shouldAutoCreateCertificate("sender_email", 1.0, true, "imap")).toBe(false);
      expect(shouldAutoCreateCertificate("claim_number", 1.0, true, "imap")).toBe(false);
      expect(shouldAutoCreateCertificate("subject_bracket", 1.0, true, "imap")).toBe(false);
      expect(shouldAutoCreateCertificate("llm", 1.0, true, "imap")).toBe(false);
    });

    it("preserves existing behaviour for non-imap sources", () => {
      expect(shouldAutoCreateCertificate("thread", null, true, "postmark")).toBe(true);
      expect(shouldAutoCreateCertificate("thread", null, true, "sendgrid")).toBe(true);
      expect(shouldAutoCreateCertificate("thread", null, true, undefined)).toBe(true);
    });
  });
});
