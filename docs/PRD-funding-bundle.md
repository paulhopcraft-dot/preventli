# PRD — Funding Bundle (Tier 1 WorkSafe-Aligned Features)

**Status:** Locked 2026-05-18 via `/work` Large-orchestrator inline planning.
**Slug:** `funding-bundle`
**Tracker label:** `funding-bundle`

---

## Problem Statement

Preventli has signed Wallara as design partner and is going for funding. The funding pitch needs to land specifically with **WorkSafe Victoria** as a partner-of-record (their endorsement is the highest-value signal funders look for in this sector). Today, Preventli has:

- Real RTW automation (auto-draft, recovery timeline, certificate detection)
- An AI case manager (Alex) embedded everywhere
- Compliance indicators tied to WIRC Act rules

What's missing for the pitch:
1. **Mental-injury liability protection.** WorkSafe's fastest-growing claim category. No worker-distress signal handling in the product today — a worker harassment claim from a Preventli-managed case would be an existential pitch killer.
2. **Per-case $ impact.** Funders + WorkSafe both ask "how much does this save?" Today the answer is "trust us, claims get shorter." Need a defensible dollar number.
3. **Auditable worker-cooperation evidence.** WorkSafe disputes hinge on "who failed to engage and when." Today engagement is implicit. Need an explicit score + insurer-push trigger with full audit trail.

These three features convert Preventli from "we automate RTW" to "we measurably protect both worker and employer, and we have the evidence to prove it" — the WorkSafe sweet spot.

## Solution

Build three loosely-coupled features that each:
- Produce a clinician-facing UI artifact (badge, card, panel) demoable in 30 seconds
- Write an audit_events row for every decision (queryable trail)
- Log model + prompt + response for any LLM-driven decision (defensible)

Phase 0 lands the shared `audit_events` infra + seed-data updates so the three features have a common evidence-trail foundation.

## User Stories

### Phase 1 — Contact Cadence Guardrails

- **US-1.1** As a clinician, I can mark a worker as "in distress" from the case detail page so that all automated outreach to that worker pauses immediately.
- **US-1.2** As Alex (the AI), when I detect a distress signal in inbound communication (keywords like "stop contacting me", "harassment", "stress claim"), I auto-flag the worker as in distress and emit a high-priority action for clinician review.
- **US-1.3** As a clinician, I can see exactly why outreach is paused for any worker, with the rationale, who/what flagged them, and when.
- **US-1.4** As a WorkSafe auditor, I can query audit_events for a worker and see every contact-suppression decision with the rationale that produced it.
- **US-1.5** As a clinician, I can manually unpause outreach with a required rationale that gets logged.

### Phase 2 — Per-Case Premium Impact Calculator

- **US-2.1** As a clinician, I can see "$X impact on this case" on the case detail page, broken down by component (days off work, severity multiplier, etc).
- **US-2.2** As Alex, I can reference the dollar number in case briefings ("Marcus's case has saved $47k vs scheme baseline by closing 21 days early").
- **US-2.3** As a CFO/HR lead, I can see a portfolio-level "$ saved across all cases" on a new summary dashboard card.
- **US-2.4** As a WorkSafe auditor, I can see the formula source (citation comment in code) and the input variables for any case's calculated impact.
- **US-2.5** The calculator is offline-first — formula coefficients live in a config file, not hardcoded, so they can be tuned without code edits.

### Phase 3 — Engagement Scoring + Insurer Escalation

- **US-3.1** As a clinician, I see an "engagement score" (0-100) per worker on the case detail page, with the score components visible (response rate, cert compliance, appointment attendance).
- **US-3.2** As Alex, I update the engagement score automatically as new events fire (cert received, appointment attended, message responded to).
- **US-3.3** As a clinician, when a worker drops below the configured threshold, I see a one-click "Escalate to insurer" button with a pre-drafted message.
- **US-3.4** As a WorkSafe auditor, I can see the full engagement timeline + every score change with the trigger event.
- **US-3.5** The insurer-escalation endpoint is a stub adapter — logs the push to audit_events and returns success. Real adapter wires in v2.

## Implementation Decisions

- **Schema additions** (all via boot-time additive migration in server/index.ts):
  - `audit_events` table (Phase 0) — id, case_id, worker_id, event_type, actor (user_id or "alex"), payload jsonb, model + prompt + response (nullable, for LLM decisions), created_at
  - `contact_suppressions` table (Phase 1) — id, worker_id, reason, source ("clinician" or "alex"), llm_model + llm_prompt + llm_response (nullable), unpaused_at (nullable), created_at
  - `case_premium_impacts` materialized rows (Phase 2) — case_id (FK), saved_dollars, baseline_dollars, components jsonb, formula_version, calculated_at
  - `worker_engagement_scores` (Phase 3) — id, worker_id, score (numeric), components jsonb, triggered_by (event_type), created_at
  - `insurer_escalations` (Phase 3) — id, case_id, triggered_by_user_id, score_at_trigger, message_body, stub_response jsonb, created_at

- **API surfaces** (all admin/clinician-only, audit-logged):
  - `POST /api/workers/:id/contact-suppression` + `DELETE /api/contact-suppressions/:id`
  - `GET /api/cases/:id/premium-impact` (computed on read with cache)
  - `GET /api/cases/portfolio-summary` (org-scoped aggregate)
  - `GET /api/workers/:id/engagement-score`
  - `POST /api/cases/:id/escalate-to-insurer`
  - `GET /api/audit-events?caseId=&workerId=` (filtered, paginated)

- **UI components** (added to existing pages — no new top-level routes):
  - `<ContactSuppressionBadge>` on case detail header (pause/unpause)
  - `<PremiumImpactCard>` on case detail right column
  - `<EngagementScoreBadge>` on worker profile + case detail
  - `<EscalateToInsurerButton>` next to compliance indicator (gated on threshold)
  - `<PortfolioImpactCard>` on the CFO dashboard

- **Audit trail invariant** — every state-mutating route handler in this bundle MUST call `await auditLog(...)` before responding. Reviewer agent + verify scripts grep for this pattern.

- **LLM decision invariant** — any Alex-initiated suppression/escalation MUST persist model + prompt + response. Without these three fields, the decision is not auditable and fails verify.

## Testing Decisions

- **Vitest unit tests** for the formula functions (premium calculator, engagement score) — known input then known output.
- **Vitest integration tests** for the route handlers that audit_events gets written on every mutation (mock storage, assert `auditLog` was called).
- **Playwright E2E** for the three demo paths (mark distressed, see premium card, escalate to insurer). One spec per phase.
- **Manual verification** in the browser at each phase milestone (4 total pauses) — non-negotiable per WorkSafe defensibility ("did the UI actually render the audit trail?").

## Out of Scope

- Doctor contact + IME procurement automation (Tier 2, deferred — needs provider creds)
- Diagnostic gap detection (Tier 2, deferred — depends on engagement baseline)
- 24/7 relentless follow-up agent loop (Tier 2, deferred — demo risk)
- Real insurer API integration (stub adapter only — real wires post-funding)
- Worker-facing UI for engagement score (clinician-only this round)
- Multi-language UI

## Further Notes

- **HITL gates** in the autonomous loop:
  - Slice 2.1: Paul provides the premium formula + source citation. Without this, Phase 2 stalls.
  - Slice 3.2: Paul provides the insurer-escalation threshold + endpoint stub format.
- **WorkSafe defensibility** is the primary quality bar. Every feature must be explicable to a WorkSafe inspector in plain English ("here's the rule, here's why we made this decision, here's the trail"). LLM-blackbox decisions without prompt logging would fail this bar.
- **Offline-first** is non-negotiable for the insurer-push and external comms. Stub adapters log to audit_events and return success; real integrations wire later.
- **Demo continuity**: Wallara seed cases (Sarah, Marcus, Priya, David, Naomi) MUST keep their existing IDs so the demo script doesn't break.
