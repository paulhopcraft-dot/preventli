# Build Plan — funding-bundle (Tier 1, locked)

Locked 2026-05-18 — `/work` Large-orchestrator inline plan.

## Scope
Build 3 WorkSafe-aligned features for the Preventli funding deck:
1. Contact cadence guardrails — distress detection + outreach pause + audit
2. Per-case premium impact calculator — case state → $ saved/lost vs scheme
3. Worker engagement scoring + insurer escalation — cooperation score + push

Each feature produces an auditable evidence trail. Demo audience: WorkSafe Vic + funders.

## Phases (~18 slices across 4 phases)
- Phase 0: shared audit-trail infra + seed updates  (~3 slices, ~2h)
- Phase 1: contact cadence guardrails               (~5 slices, ~4h)
- Phase 2: premium calculator                       (~5 slices, ~3h)
- Phase 3: engagement scoring + insurer escalation  (~5 slices, ~5h)

Total active: ~14h. Wall-clock: ~1.5 days. Pauses: 4 (between phases for verify).

## Constraints (MUST NOT)
- Modify shared/schema.ts billing/insurer columns without ADR
- Modify recoveryCurves.ts (existing RTW math)
- Replace existing compliance scoring — extend only
- Touch seed.ts / seed-workbetter.ts / seed-wallara.ts structure (add records only)
- Alter existing Alex prompts/personality without ADR
- New tables MUST have boot-time additive migration in server/index.ts (no preDeploy on free plan)
- State-mutating endpoints MUST emit audit_events row
- LLM-driven decisions MUST log model + prompt + response
- Contact-suppression decisions MUST log rationale (mental-injury defensibility)

## Done means
- Clinician sees "$ saved" on case detail
- Worker can be marked distressed → outreach pauses with audit trail
- Engagement score visible per worker + insurer-escalation trigger button
- audit_events queryable for full decision trail per case
- LLM decisions store model + prompt + response

## End condition
`~/.claude/verify/funding-bundle-all-slices.sh` returns 0 when:
- All 18 slices closed (label: funding-bundle)
- Each per-slice verify script returns 0
- Master script confirms 3 component mount points + 4 API endpoint signatures + audit_events writes

## Token estimate
- Main thread (Opus 1M):       ~80k total — SAFE
- Per subagent (Sonnet 200k):  ~80-100k avg — SAFE
- Watchdog: force opus for slices touching >5 files or >3 sibling reads

## HITL inputs from Paul
- 2.1 premium-impact formula (with source citation for defensibility)
- 3.2 insurer-escalation criteria (threshold + endpoint stub vs real)

## Offline-first
Insurer-push, contact-cadence external comms — stub adapters + log lines.
Real integrations post-funding when creds + signed agreements exist.

## Excluded (deferred to post-funding session)
- Doctor contact + IME procurement automation (needs provider creds)
- Diagnostic gap detection (depends on engagement scoring baseline)
- 24/7 relentless follow-up agent loop (risk to live demo)
