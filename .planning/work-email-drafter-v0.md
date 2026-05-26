# Email Drafter v0 — Plan

## Goal
Every matched inbound email to `support@gpnet.au` or `jacinta.bailey@gpnet.au` produces a Claude-drafted reply persisted to `email_drafts` (status=pending) + a Telegram ping. `lisah@preventli.ai` is excluded (manual). No UI; Paul copy-pastes to send.

## Existing infra (reuse, do not rebuild)
- `server/routes/postmark-inbound.ts` — webhook receiver, basic-auth, payload parsing (DONE, wired at `/api/webhooks/postmark/inbound`)
- `server/services/inboundEmailService.ts::processInboundEmail()` — ingest + match chain + discussion note + cert detection (DONE)
- `server/services/emailMatcher.ts` — thread / subject_bracket / sender_email match chain (DONE — exactly what spec calls for)
- `server/services/emailDraftService.ts` — existing case-manager-triggered draft generation (precedent only, not reused — different code path)
- `server/services/alertService.ts::sendTelegram` — pattern reference for Telegram POST
- `server/lib/claude-cli.ts::callClaude` — LLM call helper

## Gap (build this)
1. Auto-reply draft step at end of `processInboundEmail` (only when matched + GPNet mailbox)
2. Mailbox-specific signature (Jacqui vs Jacinta escalation)
3. Persistence to `email_drafts` with new `mailbox` + `in_reply_to` columns + `pending` status
4. Telegram ping via separate `DRAFT_TELEGRAM_WEBHOOK` (do not pollute ops alert channel)

## Files to touch
| File | Change |
|------|--------|
| `shared/schema.ts` | Add `mailbox` + `inReplyTo` columns to `emailDrafts`; extend `EmailDraftStatus` to include `"pending"` |
| `server/services/inboundMailbox.ts` | NEW — pure: `resolveInboundMailbox(toEmail)` returns `{mailbox, signature, displayName} | null` |
| `server/services/inboundReplyDrafter.ts` | NEW — `draftReplyForInbound(...)` builds prompt + calls Claude + persists + pings Telegram |
| `server/services/inboundReplyDrafter.test.ts` | NEW — unit tests for prompt builder + mailbox resolver |
| `server/services/inboundEmailService.ts` | Wire post-match: if matched + isNewCase=false + mailbox resolves → fire-and-forget draftReplyForInbound |
| `server/lib/draftTelegram.ts` | NEW — small helper, POST text to `DRAFT_TELEGRAM_WEBHOOK`, fail-soft |
| `.env.example` | Document `DRAFT_TELEGRAM_WEBHOOK` |
| `~/.claude/verify/email-drafter-v0.sh` | Verify script |

## Approach
- **Schema first** — add columns nullable, extend status union, `npm run db:push`
- **Pure modules first** — mailbox resolver + prompt builder are pure → easy to test
- **Gate at the matcher boundary** — draft only when:
  - `caseId` is set
  - `isNewCase === false` (Paul's spec: unmatched = drop, no draft, even if pipeline auto-creates)
  - `resolveInboundMailbox(toEmail) !== null` (lisah@ excluded, anything outside the 2 GPNet inboxes excluded)
- **Fire-and-forget at call site** — `.catch(() => log.error(...))` so a draft failure never breaks the webhook 200 OK

## Mailbox config (single source of truth)
```ts
{
  "support@gpnet.au": { mailbox: "support@gpnet.au", displayName: "Jacqui Nichol", signature: "..." },
  "jacinta.bailey@gpnet.au": { mailbox: "jacinta.bailey@gpnet.au", displayName: "Jacinta Bailey", signature: "..." },
}
```
Matching is exact lowercase. `Headers["Delivered-To"]` is not consulted in v0 — Postmark `To` is enough for single-tenant.

## Verify criterion (what the shell script checks)
1. `shared/schema.ts` contains `mailbox: text("mailbox")` and `inReplyTo: text("in_reply_to")` inside `emailDrafts` table
2. `shared/schema.ts` `EmailDraftStatus` union includes `"pending"`
3. `server/services/inboundMailbox.ts` exists and exports `resolveInboundMailbox`
4. `server/services/inboundReplyDrafter.ts` exists and exports `draftReplyForInbound`
5. `server/services/inboundEmailService.ts` calls `draftReplyForInbound` (grep wiring)
6. `server/lib/draftTelegram.ts` exists and exports `pingDraftTelegram`
7. `server/services/inboundReplyDrafter.test.ts` exists and `npm test -- inboundReplyDrafter` passes
8. `.env.example` mentions `DRAFT_TELEGRAM_WEBHOOK`
9. TypeScript build passes for changed files (`npx tsc --noEmit` scoped error count = 0 for changed files)

## Test plan
- New: `inboundReplyDrafter.test.ts` covers
  - `resolveInboundMailbox` for the 3 known cases + 2 unknown
  - `buildDraftPrompt` includes mailbox signature + inbound body excerpt
  - skip-conditions: caseId null → no draft; lisah@ → no draft
- Existing: smoke `npm test` to ensure no regression in webhook/matcher tests
- Smoke test by Paul: requires Postmark forwarding rules (Paul's blocker, manual)

## Estimate
- Schema + db:push: 20 min
- Mailbox + signatures + prompt builder: 30 min
- Drafter service + persistence + Telegram: 40 min
- Wiring + skip-conditions in processInboundEmail: 15 min
- Tests: 25 min
- Verify script + dry-run: 15 min
- TypeScript fixes / iteration: 30 min buffer
**Total: ~2:35 active. Well under 5h budget.**

## Schedule risks
1. Drizzle migration edge — `db:push` may flag drift if main has unrelated schema changes; local db is single-tenant dev so impact is bounded
2. Claude prompt drift — signature inclusion is fiddly; one extra iteration likely

## ADR? No
Single mailbox map, easily reversible (delete file), no architectural commitment.

## Out of scope (Paul's explicit list)
Trusted-sender registry, provisioning gate, on_preventli flag, parent_tenant_id, admin triage UI, Postmark adapter abstraction beyond v0, org_inbound_aliases.
