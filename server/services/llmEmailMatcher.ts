/**
 * LLM-based email-to-case matcher.
 *
 * Fallback when the heuristic matcher (emailMatcher.ts) fails to find a
 * case by thread / claim-number / sender-email / worker-name regex.
 *
 * Tenant-safe by design: caller MUST supply an organizationId hint. We never
 * search across orgs, so an inbound email destined for tenant A cannot be
 * mis-routed to tenant B's case via name collision.
 */

import { storage } from "../storage";
import { callClaude } from "../lib/llm-client";
import { createLogger } from "../lib/logger";
import type { MatchResult } from "./emailMatcher";

const log = createLogger("LLMEmailMatcher");

const MIN_CONFIDENCE = 0.6;
const MAX_BODY_CHARS = 1200;
const MAX_CASES_IN_PROMPT = 40;

interface CandidateCase {
  id: string;
  workerName: string;
  workStatus: string | null;
  injurySummary: string | null;
}

export async function llmMatchEmailToCase(
  email: {
    fromEmail: string;
    fromName?: string | null;
    subject: string;
    bodyText?: string | null;
  },
  organizationId: string,
): Promise<MatchResult | null> {
  // Pull the org's active worker cases. Keep the list small so the prompt
  // stays cheap (and Anthropic prompt-cache friendly per org).
  let allCases;
  try {
    allCases = await storage.getCases(organizationId);
  } catch (err) {
    log.error("Failed to load cases for LLM match", { organizationId }, err as Error);
    return null;
  }
  if (!allCases || allCases.length === 0) return null;

  const candidates: CandidateCase[] = allCases
    .slice(0, MAX_CASES_IN_PROMPT)
    .map((c: any) => ({
      id: c.id,
      workerName: c.workerName || "Unknown",
      workStatus: c.workStatus || null,
      injurySummary: c.summary || c.injuryDescription || null,
    }));

  const body = (email.bodyText || "").slice(0, MAX_BODY_CHARS).replace(/\s+/g, " ").trim();

  const prompt = buildPrompt(email, candidates, body);

  let raw: string;
  try {
    raw = await callClaude(prompt, 20_000);
  } catch (err) {
    log.warn("LLM call failed during email matching", { err: (err as Error)?.message });
    return null;
  }

  const parsed = parseLLMResponse(raw);
  if (!parsed) {
    log.warn("LLM response unparseable", { raw: raw.slice(0, 200) });
    return null;
  }

  if (parsed.caseId === "none" || !parsed.caseId) {
    log.info("LLM declined match", { confidence: parsed.confidence });
    return null;
  }

  // Validate the returned caseId actually belongs to a candidate (don't trust
  // the LLM to invent IDs).
  const validated = candidates.find((c) => c.id === parsed.caseId);
  if (!validated) {
    log.warn("LLM returned caseId not in candidates", { llmCaseId: parsed.caseId });
    return null;
  }

  if (parsed.confidence < MIN_CONFIDENCE) {
    log.info("LLM match below confidence threshold", {
      caseId: parsed.caseId,
      confidence: parsed.confidence,
      threshold: MIN_CONFIDENCE,
    });
    return null;
  }

  log.info("LLM matched email to case", {
    caseId: parsed.caseId,
    confidence: parsed.confidence,
    workerName: validated.workerName,
  });

  return {
    caseId: validated.id,
    organizationId,
    method: "llm" as MatchResult["method"],
    confidence: parsed.confidence,
  };
}

function buildPrompt(
  email: { fromEmail: string; fromName?: string | null; subject: string },
  candidates: CandidateCase[],
  body: string,
): string {
  const candidateLines = candidates
    .map(
      (c, i) =>
        `${i + 1}. id=${c.id} | worker=${c.workerName} | status=${c.workStatus ?? "?"} | injury=${c.injurySummary?.slice(0, 80) ?? "?"}`,
    )
    .join("\n");

  return `You are matching an inbound email to one of the active worker cases listed below.

EMAIL:
From: ${email.fromName ?? "Unknown"} <${email.fromEmail}>
Subject: ${email.subject}
Body: ${body || "(empty)"}

CANDIDATE CASES:
${candidateLines}

TASK:
Identify the single most likely case this email refers to, or return "none" if no candidate is a clear match.

Match signals to consider:
- Worker name appearing anywhere in subject or body (including possessives, misspellings, first-name-only)
- Injury type or treatment mentioned that aligns with a candidate's injury summary
- Implicit references ("the new claim", "the back injury case") only if context disambiguates

Respond ONLY with a single line of valid JSON. No prose, no markdown, no explanation outside the JSON. Schema:
{"caseId":"<id-or-none>","confidence":<0.0-1.0>,"reasoning":"<one short sentence>"}

If no candidate clearly matches, return: {"caseId":"none","confidence":0.0,"reasoning":"no clear match"}`;
}

function parseLLMResponse(
  raw: string,
): { caseId: string; confidence: number; reasoning: string } | null {
  // The LLM sometimes wraps in markdown code fences or adds preamble. Pull the
  // first JSON object out.
  const jsonMatch = raw.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) return null;

  try {
    const obj = JSON.parse(jsonMatch[0]);
    if (typeof obj.caseId !== "string") return null;
    const confidence =
      typeof obj.confidence === "number"
        ? Math.max(0, Math.min(1, obj.confidence))
        : 0;
    const reasoning = typeof obj.reasoning === "string" ? obj.reasoning : "";
    return { caseId: obj.caseId, confidence, reasoning };
  } catch {
    return null;
  }
}
