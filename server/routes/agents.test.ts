import { describe, it, expect, vi } from "vitest";

// Avoid pulling DATABASE_URL through transitive imports of agents.ts deps.
vi.mock("../db", () => ({ db: {} }));
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../middleware/auth", () => ({
  authorize: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../agents/agent-runner", () => ({ runSpecialistAgent: vi.fn() }));

import { deriveFirstName } from "./agents";

describe("deriveFirstName — Alex greeting", () => {
  it("prefers explicit preferredName when present", () => {
    expect(deriveFirstName("wallara@wallara.com.au", "Ellen")).toBe("Ellen");
  });

  it("trims preferredName whitespace", () => {
    expect(deriveFirstName("x@y.com", "  Ellen  ")).toBe("Ellen");
  });

  it("falls back to email local-part first token when preferredName is null", () => {
    expect(deriveFirstName("paul.hopcraft@example.com", null)).toBe("Paul");
  });

  it("falls back to email when preferredName is empty string", () => {
    expect(deriveFirstName("paul.hopcraft@example.com", "")).toBe("Paul");
  });

  it("falls back to email when preferredName is whitespace-only", () => {
    expect(deriveFirstName("paul.hopcraft@example.com", "   ")).toBe("Paul");
  });

  it("handles dash and underscore separators in email", () => {
    expect(deriveFirstName("ellen-burns@example.com", null)).toBe("Ellen");
    expect(deriveFirstName("ellen_burns@example.com", null)).toBe("Ellen");
    expect(deriveFirstName("ellen+work@example.com", null)).toBe("Ellen");
  });

  it("title-cases mixed-case email prefixes", () => {
    expect(deriveFirstName("ELLEN@example.com", null)).toBe("Ellen");
    expect(deriveFirstName("eLLeN@example.com", null)).toBe("Ellen");
  });

  it("returns 'there' when no preferredName and no usable email prefix", () => {
    expect(deriveFirstName("@example.com", null)).toBe("there");
  });

  it("accepts undefined preferredName", () => {
    expect(deriveFirstName("ellen.burns@example.com", undefined)).toBe("Ellen");
  });
});
