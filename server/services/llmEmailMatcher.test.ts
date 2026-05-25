import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../storage", () => ({
  storage: {
    getCases: vi.fn(),
  },
}));

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

import { llmMatchEmailToCase } from "./llmEmailMatcher";
import { storage } from "../storage";
import { callClaude } from "../lib/llm-client";

const mockStorage = storage as any;
const mockCallClaude = callClaude as unknown as ReturnType<typeof vi.fn>;

const ORG_ID = "org-wallara";

const SAMPLE_CASES = [
  { id: "case-wallara-marcus", workerName: "Marcus Tanaka", workStatus: "At work", summary: "Rotator cuff strain, week 12 post-injury" },
  { id: "case-wallara-sarah", workerName: "Sarah Chen", workStatus: "Off work", summary: "L4/L5 disc, week 4 off work" },
  { id: "case-wallara-david", workerName: "David Nguyen", workStatus: "Off work", summary: "L4-L5 disc, 26 weeks off, IME just received" },
];

describe("llmMatchEmailToCase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getCases.mockResolvedValue(SAMPLE_CASES);
  });

  it("returns a match when LLM identifies a candidate above the confidence threshold", async () => {
    mockCallClaude.mockResolvedValue(
      `{"caseId":"case-wallara-marcus","confidence":0.92,"reasoning":"Subject mentions Marcus directly"}`,
    );

    const result = await llmMatchEmailToCase(
      {
        fromEmail: "physio@example.com",
        fromName: "Dr. Jones",
        subject: "Marcus update — shoulder progress",
        bodyText: "Hi, just checking in on Marcus's recovery.",
      },
      ORG_ID,
    );

    expect(result).not.toBeNull();
    expect(result!.caseId).toBe("case-wallara-marcus");
    expect(result!.organizationId).toBe(ORG_ID);
    expect(result!.method).toBe("llm");
    expect(result!.confidence).toBeCloseTo(0.92, 2);
  });

  it("returns null when LLM declines to match (caseId 'none')", async () => {
    mockCallClaude.mockResolvedValue(
      `{"caseId":"none","confidence":0.0,"reasoning":"no clear match"}`,
    );

    const result = await llmMatchEmailToCase(
      { fromEmail: "x@example.com", subject: "general inquiry", bodyText: "" },
      ORG_ID,
    );

    expect(result).toBeNull();
  });

  it("returns null when LLM confidence is below the threshold", async () => {
    mockCallClaude.mockResolvedValue(
      `{"caseId":"case-wallara-sarah","confidence":0.4,"reasoning":"weak signal"}`,
    );

    const result = await llmMatchEmailToCase(
      { fromEmail: "x@example.com", subject: "ambiguous", bodyText: "" },
      ORG_ID,
    );

    expect(result).toBeNull();
  });

  it("returns null when LLM returns a caseId not in the candidate list (hallucination guard)", async () => {
    mockCallClaude.mockResolvedValue(
      `{"caseId":"case-invented-by-llm","confidence":0.95,"reasoning":"hallucinated id"}`,
    );

    const result = await llmMatchEmailToCase(
      { fromEmail: "x@example.com", subject: "hi", bodyText: "" },
      ORG_ID,
    );

    expect(result).toBeNull();
  });

  it("returns null when LLM response is unparseable JSON", async () => {
    mockCallClaude.mockResolvedValue("I think it's Marcus. Confidence: high.");

    const result = await llmMatchEmailToCase(
      { fromEmail: "x@example.com", subject: "hi", bodyText: "" },
      ORG_ID,
    );

    expect(result).toBeNull();
  });

  it("returns null when org has no cases", async () => {
    mockStorage.getCases.mockResolvedValue([]);

    const result = await llmMatchEmailToCase(
      { fromEmail: "x@example.com", subject: "hi", bodyText: "" },
      ORG_ID,
    );

    expect(result).toBeNull();
    expect(mockCallClaude).not.toHaveBeenCalled();
  });

  it("returns null when LLM call throws", async () => {
    mockCallClaude.mockRejectedValue(new Error("API down"));

    const result = await llmMatchEmailToCase(
      { fromEmail: "x@example.com", subject: "Marcus", bodyText: "" },
      ORG_ID,
    );

    expect(result).toBeNull();
  });

  it("strips markdown code fences from the LLM response", async () => {
    mockCallClaude.mockResolvedValue(
      "```json\n" +
        `{"caseId":"case-wallara-david","confidence":0.88,"reasoning":"David IME mention"}` +
        "\n```",
    );

    const result = await llmMatchEmailToCase(
      { fromEmail: "x@example.com", subject: "David IME follow-up", bodyText: "" },
      ORG_ID,
    );

    expect(result).not.toBeNull();
    expect(result!.caseId).toBe("case-wallara-david");
  });
});
