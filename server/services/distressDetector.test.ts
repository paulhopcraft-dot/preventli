import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock LLM client so no real API calls are made.
vi.mock("../lib/llm-client", () => ({
  callClaude: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { detectDistress } from "./distressDetector";
import { callClaude } from "../lib/llm-client";

const mockCallClaude = callClaude as unknown as ReturnType<typeof vi.fn>;

const WORKER_ID = "worker-test-001";

describe("detectDistress — pre-filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when no keywords match (no LLM call)", async () => {
    const result = await detectDistress({
      subject: "Weekly update on my shoulder progress",
      bodyText: "Hi, just wanted to let you know I had my physio appointment.",
      workerId: WORKER_ID,
    });

    expect(result).toBeNull();
    expect(mockCallClaude).not.toHaveBeenCalled();
  });

  it("detects 'stop contacting me' in subject and calls LLM", async () => {
    mockCallClaude.mockResolvedValue(
      `{"isDistress":true,"confidence":0.92,"rationale":"Worker explicitly requests cessation of contact"}`,
    );

    const result = await detectDistress({
      subject: "Please stop contacting me",
      bodyText: "I have asked multiple times. This is harassment.",
      workerId: WORKER_ID,
    });

    expect(result).not.toBeNull();
    expect(result!.preFilterMatches).toContain("stop contacting me");
    expect(result!.isDistress).toBe(true);
    expect(result!.confidence).toBeCloseTo(0.92, 2);
    expect(mockCallClaude).toHaveBeenCalledOnce();
  });

  it("detects 'harassment' keyword (case-insensitive) in body", async () => {
    mockCallClaude.mockResolvedValue(
      `{"isDistress":true,"confidence":0.85,"rationale":"Worker alleges harassment by contact frequency"}`,
    );

    const result = await detectDistress({
      subject: "Complaint",
      bodyText: "This level of contact is HARASSMENT and I want it to stop.",
      workerId: WORKER_ID,
    });

    expect(result).not.toBeNull();
    expect(result!.preFilterMatches).toContain("harassment");
    expect(result!.isDistress).toBe(true);
  });

  it("detects 'psychological' keyword and passes pre-filter matches to LLM prompt", async () => {
    mockCallClaude.mockResolvedValue(
      `{"isDistress":true,"confidence":0.88,"rationale":"Worker reports psychological injury from contact pressure"}`,
    );

    const result = await detectDistress({
      subject: "Medical update",
      bodyText: "My doctor says I have a psychological condition linked to the claim.",
      workerId: WORKER_ID,
    });

    expect(result).not.toBeNull();
    expect(result!.preFilterMatches).toContain("psychological");
    expect(result!.llm.prompt).toContain("psychological");
    expect(result!.llm.model).toBeTruthy();
    expect(result!.llm.response).toBeTruthy();
  });

  it("returns isDistress=false when LLM determines keyword was false positive", async () => {
    mockCallClaude.mockResolvedValue(
      `{"isDistress":false,"confidence":0.15,"rationale":"Keyword 'psychological' used in unrelated clinical context"}`,
    );

    const result = await detectDistress({
      subject: "Psychological assessment booked",
      bodyText: "Just confirming your psychological assessment is booked for Monday.",
      workerId: WORKER_ID,
    });

    expect(result).not.toBeNull();
    expect(result!.isDistress).toBe(false);
    expect(result!.confidence).toBeCloseTo(0.15, 2);
    expect(result!.preFilterMatches).toContain("psychological");
  });

  it("returns low-confidence non-distress result when LLM call fails", async () => {
    mockCallClaude.mockRejectedValue(new Error("API timeout"));

    const result = await detectDistress({
      subject: "stop emailing me",
      bodyText: "I have had enough.",
      workerId: WORKER_ID,
    });

    expect(result).not.toBeNull();
    expect(result!.isDistress).toBe(false);
    expect(result!.confidence).toBe(0);
    expect(result!.preFilterMatches).toContain("stop emailing");
    // LLM fields still populated for audit even on failure
    expect(result!.llm.model).toBeTruthy();
    expect(result!.llm.prompt).toBeTruthy();
    expect(result!.llm.response).toBe("");
  });

  it("strips markdown fences from LLM response", async () => {
    mockCallClaude.mockResolvedValue(
      "```json\n" +
        `{"isDistress":true,"confidence":0.91,"rationale":"Clear distress signal"}` +
        "\n```",
    );

    const result = await detectDistress({
      subject: "leave me alone",
      bodyText: "Please.",
      workerId: WORKER_ID,
    });

    expect(result).not.toBeNull();
    expect(result!.isDistress).toBe(true);
    expect(result!.confidence).toBeCloseTo(0.91, 2);
  });

  it("returns low-confidence result when LLM response is unparseable", async () => {
    mockCallClaude.mockResolvedValue("I think this is distressing. High confidence.");

    const result = await detectDistress({
      subject: "i am unwell and stressed",
      bodyText: "This process is making me worse.",
      workerId: WORKER_ID,
    });

    expect(result).not.toBeNull();
    expect(result!.isDistress).toBe(false);
    expect(result!.confidence).toBe(0);
  });

  it("captures multiple keyword matches in preFilterMatches", async () => {
    mockCallClaude.mockResolvedValue(
      `{"isDistress":true,"confidence":0.95,"rationale":"Multiple explicit distress indicators"}`,
    );

    const result = await detectDistress({
      subject: "harassment complaint",
      bodyText: "This is harassment. I have a psychological condition. Stop emailing me.",
      workerId: WORKER_ID,
    });

    expect(result).not.toBeNull();
    expect(result!.preFilterMatches.length).toBeGreaterThan(1);
    expect(result!.preFilterMatches).toContain("harassment");
    expect(result!.preFilterMatches).toContain("psychological");
    expect(result!.preFilterMatches).toContain("stop emailing");
  });
});
