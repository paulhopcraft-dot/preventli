import { describe, it, expect, vi } from "vitest";

// emailMatcher.ts transitively imports storage which needs DATABASE_URL at
// import time. Mock storage + logger so the pure parser is testable in
// isolation, matching the pattern used by inboundEmailService.test.ts.
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { parseBracketedWorkerName } from "./emailMatcher";

describe("parseBracketedWorkerName", () => {
  describe("happy path — bracket at start of subject", () => {
    it("extracts the name from a plain subject", () => {
      expect(parseBracketedWorkerName("[Marcus Wallara] Updated medical cert"))
        .toBe("Marcus Wallara");
    });

    it("extracts the name when subject is just the bracket", () => {
      expect(parseBracketedWorkerName("[Marcus Wallara]")).toBe("Marcus Wallara");
    });

    it("normalises internal whitespace inside the bracket", () => {
      expect(parseBracketedWorkerName("[  Marcus   Wallara  ] cert"))
        .toBe("Marcus Wallara");
    });

    it("preserves apostrophes in names", () => {
      expect(parseBracketedWorkerName("[Sarah O'Connor] cert update"))
        .toBe("Sarah O'Connor");
    });

    it("preserves hyphens in names", () => {
      expect(parseBracketedWorkerName("[Anne-Marie Lee] cert"))
        .toBe("Anne-Marie Lee");
    });

    it("accepts three-part names", () => {
      expect(parseBracketedWorkerName("[Maria del Carmen] cert"))
        .toBe("Maria del Carmen");
    });
  });

  describe("forwarding / reply prefixes — strip once before matching", () => {
    it("handles Re: prefix", () => {
      expect(parseBracketedWorkerName("Re: [Sarah Chen] insurer ack"))
        .toBe("Sarah Chen");
    });

    it("handles Fwd: prefix", () => {
      expect(parseBracketedWorkerName("Fwd: [Naomi Wright] phone summary"))
        .toBe("Naomi Wright");
    });

    it("handles FW: prefix", () => {
      expect(parseBracketedWorkerName("FW: [John Smith] reply"))
        .toBe("John Smith");
    });

    it("handles lowercase fwd:", () => {
      expect(parseBracketedWorkerName("fwd: [Marcus Wallara] cert"))
        .toBe("Marcus Wallara");
    });
  });

  describe("rejections — should return null", () => {
    it("rejects a subject without any bracket", () => {
      expect(parseBracketedWorkerName("Updated medical certificate for Marcus"))
        .toBeNull();
    });

    it("rejects an empty string", () => {
      expect(parseBracketedWorkerName("")).toBeNull();
    });

    it("rejects a single-token bracket (not a person name)", () => {
      expect(parseBracketedWorkerName("[FYI] some note")).toBeNull();
    });

    it("rejects a single first-name bracket", () => {
      expect(parseBracketedWorkerName("[Marcus] cert update")).toBeNull();
    });

    it("rejects an empty bracket", () => {
      expect(parseBracketedWorkerName("[] cert")).toBeNull();
    });

    it("rejects a bracket with only whitespace", () => {
      expect(parseBracketedWorkerName("[   ] cert")).toBeNull();
    });

    it("rejects a bracket NOT at the start of the subject", () => {
      // Strict by design — avoids picking up inline `[note]` markers
      expect(parseBracketedWorkerName("Update on case [Marcus Wallara]"))
        .toBeNull();
    });

    it("rejects digits-only inside the bracket", () => {
      expect(parseBracketedWorkerName("[12345] cert")).toBeNull();
    });
  });

  describe("ambiguity — first bracket wins", () => {
    it("returns only the first bracket when subject has multiple", () => {
      expect(parseBracketedWorkerName("[Marcus Wallara] [Note] cert"))
        .toBe("Marcus Wallara");
    });
  });
});
