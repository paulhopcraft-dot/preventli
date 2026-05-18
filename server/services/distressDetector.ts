/**
 * Distress signal detector for inbound worker emails.
 *
 * Mental-injury defensibility (funding-bundle 1.4).
 * Every detection that results in a contact suppression persists the full
 * LLM decision (model + prompt + response) for WorkSafe audit trails.
 *
 * Two-phase design:
 *  1. Fast deterministic keyword pre-filter (no LLM cost when irrelevant)
 *  2. LLM confirm step — only fires when at least one keyword matches
 */

import { callClaude } from "../lib/llm-client";
import { createLogger } from "../lib/logger";

const log = createLogger("DistressDetector");

// Model tag stored in LLM decision fields for audit traceability.
// Mirrors what llmEmailMatcher.ts uses — the actual model is resolved at
// runtime by llm-client depending on provider env-var, but we record the
// env-resolved name in the result.
const MODEL_TAG = process.env.LLM_MODEL ?? "anthropic/claude-sonnet-4-5";

const MAX_BODY_CHARS = 2000;

/**
 * Canonical keyword list.  Case-insensitive.  Extending this list is the
 * primary tuning lever — no code elsewhere needs changing.
 */
const DISTRESS_KEYWORDS: readonly string[] = [
  "stop contacting me",
  "harass",
  "harassment",
  "stress claim",
  "mental injury",
  "i am unwell",
  "psychological",
  "stop emailing",
  "leave me alone",
  "wellbeing concern",
];

export interface DistressDetectionResult {
  isDistress: boolean;
  confidence: number;        // 0–1, from LLM
  rationale: string;         // human-readable, from LLM
  preFilterMatches: string[]; // which keywords triggered
  llm: {
    model: string;
    prompt: string;
    response: string;
  };
}

/**
 * Detect worker-distress signals in an inbound email.
 *
 * Returns `null` when the pre-filter finds no keywords (no LLM call made).
 * Returns a `DistressDetectionResult` when at least one keyword matched,
 * even if the LLM subsequently decides `isDistress: false`.
 */
export async function detectDistress(input: {
  subject: string;
  bodyText: string;
  workerId: string;
}): Promise<DistressDetectionResult | null> {
  const haystack = `${input.subject} ${input.bodyText}`.toLowerCase();

  // ── Phase 1: fast deterministic pre-filter ──────────────────────────────
  const preFilterMatches = DISTRESS_KEYWORDS.filter((kw) =>
    haystack.includes(kw.toLowerCase()),
  );

  if (preFilterMatches.length === 0) {
    // No keywords matched — skip LLM to save cost.
    return null;
  }

  log.info("Distress pre-filter matched keywords", {
    workerId: input.workerId,
    keywords: preFilterMatches,
  });

  // ── Phase 2: LLM confirm ────────────────────────────────────────────────
  const truncatedBody = input.bodyText.slice(0, MAX_BODY_CHARS);
  const prompt = buildPrompt(input.subject, truncatedBody, preFilterMatches);

  let rawResponse: string;
  try {
    rawResponse = await callClaude(prompt, 30_000);
  } catch (err) {
    log.error("LLM call failed during distress detection (non-fatal)", { workerId: input.workerId }, err as Error);
    // On LLM failure, return a conservative low-confidence result so callers
    // can decide whether to act.  We do NOT suppress automatically.
    return {
      isDistress: false,
      confidence: 0,
      rationale: "LLM call failed — cannot confirm distress signal",
      preFilterMatches,
      llm: { model: MODEL_TAG, prompt, response: "" },
    };
  }

  const parsed = parseLLMResponse(rawResponse);
  if (!parsed) {
    log.warn("Distress LLM response unparseable", { workerId: input.workerId, raw: rawResponse.slice(0, 200) });
    return {
      isDistress: false,
      confidence: 0,
      rationale: "LLM response could not be parsed",
      preFilterMatches,
      llm: { model: MODEL_TAG, prompt, response: rawResponse },
    };
  }

  log.info("Distress detection complete", {
    workerId: input.workerId,
    isDistress: parsed.isDistress,
    confidence: parsed.confidence,
  });

  return {
    isDistress: parsed.isDistress,
    confidence: parsed.confidence,
    rationale: parsed.rationale,
    preFilterMatches,
    llm: { model: MODEL_TAG, prompt, response: rawResponse },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildPrompt(
  subject: string,
  bodyText: string,
  matchedKeywords: string[],
): string {
  return `You are a WorkSafe Victoria compliance assistant reviewing a worker's inbound email for genuine distress signals or a request to cease contact.

EMAIL SUBJECT: ${subject}
EMAIL BODY:
${bodyText || "(empty)"}

The following keywords were detected in this email (case-insensitive): ${matchedKeywords.join(", ")}

TASK:
Determine whether this email indicates the worker is genuinely distressed, experiencing a psychological/mental injury, or explicitly requesting that contact cease.

Consider:
- Explicit requests to stop contact or communication
- Expressions of mental health deterioration ("I am unwell", "psychological harm")
- Allegations of harassment or excessive contact pressure
- Context: does the surrounding text reinforce or contradict the matched keywords?

Respond ONLY with a single line of valid JSON. No prose, no markdown fences. Schema:
{"isDistress":true/false,"confidence":<0.0-1.0>,"rationale":"<one concise sentence>"}

If the context clearly contradicts distress (e.g. spam, unrelated use of a keyword), set isDistress to false and confidence accordingly.`;
}

function parseLLMResponse(
  raw: string,
): { isDistress: boolean; confidence: number; rationale: string } | null {
  // Strip markdown fences if present
  const jsonMatch = raw.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return null;

  try {
    const obj = JSON.parse(jsonMatch[0]);
    if (typeof obj.isDistress !== "boolean") return null;
    const confidence =
      typeof obj.confidence === "number"
        ? Math.max(0, Math.min(1, obj.confidence))
        : 0;
    const rationale = typeof obj.rationale === "string" ? obj.rationale : "";
    return { isDistress: obj.isDistress, confidence, rationale };
  } catch {
    return null;
  }
}
