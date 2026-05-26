# 1. Alex compliance gate vs legacy ComplianceAgent — COEXIST

Date: 2026-05-26
Status: Accepted

## Context

The Alex Case Intelligence build (see `agent-specs/SHAPE.md`) introduces a compliance gate that must, before Alex emits a compliance-keyworded response, call a deterministic rules engine and force a citation (`ruleId`) onto the reply. The repo already contains two artefacts whose names imply they cover this surface:

- `server/services/intelligence/complianceAgent.ts` — an LLM analytics specialist extending `BaseHealthcareAgent`. Returns a `ComplianceAnalysis` (overall score, deadlines, violations, recommendations) shaped for executive/coordinator consumption. Registered into `server/services/intelligence/intelligenceCoordinator.ts` as one of six Healthcare Specialist Subagents and surfaced through `server/routes/intelligence/index.ts`.
- `server/services/complianceEngine.ts` — the deterministic rules engine. Evaluates a case against rules sourced from the WIRC Act 2013 and the WorkSafe Claims Manual, persists results in `case_compliance_checks`, and returns structured findings with `ruleCode`, `legislativeRef`, `consequence`, and `remedy`. Consumed by `server/services/rtwCompliance.ts` (`computeRTWCompliance`) and indirectly by `server/routes/chat.ts`.

SHAPE.md chunk 0 makes the ADR a hard gate on every downstream chunk. Three credible verdicts existed: REPLACE the legacy agent, WRAP it under Alex's gate, or COEXIST and call the rules engine directly from Alex.

This is a hard-to-reverse choice (re-pointing consumers, deleting code, and migrating any persisted analytics output is non-trivial), surprising without context (a future reader sees two "compliance" subsystems and reasonably asks why), and the result of a real trade-off (the three alternatives are all defensible). All three ADR criteria from `~/.claude/rules/adr-criteria.md` are met.

## Decision

**COEXIST.** Alex's compliance gate (chunk 3) calls `complianceEngine.evaluateCase` and `computeRTWCompliance` directly. The legacy `ComplianceAgent` is left in place, untouched, continuing to serve the existing `intelligenceCoordinator` → `/api/intelligence/*` analytics surface. No consumer is re-pointed, no code is deleted, no migration is performed as part of the Alex build.

The two artefacts are different *kinds* of thing solving different problems for different callers:

- `complianceEngine.ts` is the deterministic, auditable, rule-by-rule source of truth. Alex needs this — the gate must produce a citable `ruleId` and reject hallucinated regulations (per chunk 3's "rules engine returned zero matches" path).
- `complianceAgent.ts` is an LLM-shaped analytics rollup with prose recommendations. The intelligence coordinator and its consumers depend on that shape.

A future consolidation door is left explicitly open: if/when the intelligence coordinator pipeline is retired or rebuilt on top of the deterministic engine, `ComplianceAgent` becomes a candidate for removal at that point — not now.

## Alternatives considered

- **REPLACE** — delete `ComplianceAgent`, re-point `intelligenceCoordinator` and `/api/intelligence/*` at `complianceEngine.ts`. Rejected: out of scope for the Alex milestone, requires reshaping the engine's structured output into the `AgentResponse` contract the coordinator expects, and risks breaking the existing intelligence surface for no Alex-side benefit. Alex never calls `ComplianceAgent` — replacing it does not move Alex forward.
- **WRAP** — make Alex call `ComplianceAgent`, which internally delegates to `complianceEngine`. Rejected: injects an LLM-shaped analytics layer into a gate that must be deterministic. The gate's job is to produce a `ruleId` and refuse to respond without one; wrapping it in an LLM analytics agent re-introduces the hallucination surface the gate exists to close. Also forces a base-class refactor (`BaseHealthcareAgent` was not designed to be called synchronously inside a tool-execution gate) for no architectural payoff.
- **COEXIST** — selected. Two consumer chains, two artefacts, zero cross-dependency. Lowest blast radius, fastest unblock for chunks 1 → 9b, and preserves the consolidation option without paying for it now.

## Consequences

- **Unblocks** all subsequent SHAPE.md chunks. Chunk 3 (compliance gate + citation enforcement) can proceed against `complianceEngine.evaluateCase` and `computeRTWCompliance` without waiting on coordinator-pipeline work.
- **Makes easy** — Alex's deterministic gate is decoupled from the LLM analytics pipeline; either can evolve independently.
- **Makes hard** — anyone scanning the codebase for "compliance" sees two modules and must learn which is which. This ADR is the answer to that question.
- **Revisit when** — the `intelligenceCoordinator` pipeline is retired, rebuilt, or migrated onto the deterministic engine; OR the two artefacts begin drifting in a way that produces contradictory outputs to different consumers for the same case. Either trigger reopens REPLACE as the next ADR.
- **Not revisited when** — a new caller wants compliance data. The rule of thumb is: deterministic / citation-bearing / audit-trail callers use `complianceEngine.ts`; LLM analytics / coordinator-shaped callers use `ComplianceAgent`. New callers route by that rule, not by re-opening this ADR.
