# /work plan — IMAP poller (Phase 3 of email-drafter) — COUNCIL-REVISED

## Goal (one-line, verifiable)
A `node-cron`-driven poller that connects to `support@gpnet.au` and `jacinta.bailey@gpnet.au` IMAP, fetches new messages by UID, forwards each via `processInboundEmail()` so the existing v0 drafter (commit `6b8a2c5`) generates auto-reply drafts. Single-tenant. Env-gated. Loop-safe.

## Council findings folded in (4 reviewers — architect, critic, security, code-reviewer)
- **isRunning re-entrancy guard** (critic, code-reviewer)
- **Bounce / auto-reply / self-loop filter** in pure parser (3-way convergence)
- **Split cursor policy**: parse-fail → advance; dispatch-fail → hold (code-reviewer refinement)
- **UIDVALIDITY change = full fetch + Message-Id dedup** (architect; overrides initial skip)
- **`UIDNEXT - 1` for first-run cursor** (architect)
- **Block auto-cert-create when `source === "imap"`** (security HIGH)
- **Attachment caps**: 10MB per attachment, 25MB per email (critic, security)
- **Redact creds from error messages** before logging (security)
- **Pin `tls: true`, `rejectUnauthorized: true` in code** — not env-configurable (security)
- **Per-mailbox try/catch isolation** (code-reviewer NIT)

## Files (new + modified)
**New:**
- `server/services/imapPoller.ts` — class + pure cursor decision fn + pure message→internal fn + pure loop-filter fn
- `server/services/imapPoller.test.ts` — vitest unit tests
- `~/.claude/verify/imap-poller.sh` — deterministic structural verify

**Modified:**
- `shared/schema.ts` — add `imapMailboxState` table
- `server/services/inboundEmailService.ts` — extend `source` union to `"imap"`; **gate `shouldAutoCreateCertificate` on non-imap source**
- `server/storage.ts` — `getImapMailboxState` + `upsertImapMailboxState`
- `server/index.ts` — env-gated start/stop in lifecycle
- `package.json` — `imapflow`, `mailparser`, `@types/mailparser`
- `.env.example` — document the new env vars + auth-model caveat

## Approach

**Library**: `imapflow` (nodemailer-family IMAP) + `mailparser` (RFC822 → ParsedMail). Polling, not IDLE. Mirrors `complianceScheduler.ts` shape — `node-cron`, singleton, `start()`/`stop()`, `isRunning` overlap guard, `getStatus()`.

**State table** `imap_mailbox_state` keyed on mailbox:
```
mailbox (PK, varchar)
uid_validity (bigint)
last_seen_uid (bigint)
last_polled_at (timestamp, nullable)
last_error_at (timestamp, nullable)
last_error (text, nullable)
created_at, updated_at
```

**Per-mailbox poll algorithm**:
1. Connect (TLS pinned in code: `tls: true`, `rejectUnauthorized: true`)
2. `mailboxOpen("INBOX")` → read `uidValidity` + `uidNext`
3. **First run** (no row): seed cursor to `uidNext - 1`; return (no replay)
4. **UIDVALIDITY changed**: full fetch (`1:*`) → rely on existing `getCaseEmailByMessageId` dedup in `processInboundEmail`. NOT a silent skip.
5. **Normal**: `fetch({ uid: \`${lastSeenUid+1}:*\` }, { source: true, envelope: true, uid: true })`
6. For each message:
   a. Try `simpleParser(raw)` → if **parse fails**: log error, advance cursor past this UID (poison-message tolerance)
   b. Run `shouldRejectAsLoop(parsed, mailboxAddress)` — reject if `Auto-Submitted: auto-replied|auto-generated`, `Precedence: bulk|list|junk`, `from` is `mailer-daemon|noreply|no-reply|postmaster`, OR `from` is one of the AI-drafted mailboxes themselves. Reject → advance cursor.
   c. Enforce attachment caps: drop any attachment > 10MB; skip entire message if total > 25MB (advance cursor).
   d. `imapMessageToInternal(parsed, mailboxAddress)` → `processInboundEmail(payload)`
   e. If `processInboundEmail` **throws**: log error, **do NOT advance cursor** (retry next tick; `getCaseEmailByMessageId` dedupes on success replay)
   f. On success: advance cursor.
7. Disconnect; write `last_polled_at` (and `last_error*` if any).

**isRunning guard**: identical to `complianceScheduler.ts:126-137`. If a tick is mid-flight when cron fires, log + early-return.

**Per-mailbox failure isolation**: each mailbox `pollMailbox()` call is wrapped in try/catch in the tick body. One mailbox auth failure does not block the other.

**Loop-detection (`shouldRejectAsLoop`)** — pure function. Inputs: parsed headers + mailbox address. Returns reject + reason. No I/O. Easy to unit-test exhaustively.

**Pure-function seam (the testable spine)**:
1. `imapMessageToInternal(parsed: ParsedMail, toEmail: string): InboundEmailPayload`
2. `decideNextCursor(prev: State | null, uidValidity: number, uidNext: number): { cursor: number; mode: "first-run" | "uidvalidity-changed" | "normal" }` — `mode` drives branching in the caller (full-fetch on uidvalidity-changed; normal range fetch otherwise)
3. `shouldRejectAsLoop(parsed: ParsedMail, ownMailbox: string): { reject: boolean; reason?: string }`

**Source extension**: add `"imap"` to the union in `inboundEmailService.ts` ONLY. The pre-existing `"postmark"`-vs-shared-enum drift (flagged by code-reviewer BLOCKER-2) is out of scope — separate cleanup task.

**Auto-cert-create gate**: in `shouldAutoCreateCertificate`, return false when `source === "imap"`. Rationale: anyone on the internet can email `support@gpnet.au` with a PDF named `medical-certificate.pdf`. Even with high-trust match (thread/sender_email), the SOURCE is untrusted until a sender-allowlist exists.

**Credential redaction**: wrap imapflow connection + fetch in try/catch; before logging the error, strip the password value (looked up from env) from `error.message` and `error.stack`.

**Config (env)**:
- `IMAP_POLLER_ENABLED=true`
- `IMAP_POLLER_CRON="*/2 * * * *"` (default every 2 min)
- `IMAP_HOST`, `IMAP_PORT=993` (port configurable for non-standard servers)
- `IMAP_SUPPORT_USER`, `IMAP_SUPPORT_PASS`
- `IMAP_JACINTA_USER`, `IMAP_JACINTA_PASS`
- Missing per-mailbox creds → skip that mailbox with warning (don't crash poller)
- **TLS is hard-coded `true` + `rejectUnauthorized: true` in code** (not env-configurable per security review)

## Verify criterion
`bash ~/.claude/verify/imap-poller.sh` returns 0. Checks:
- `imapflow` + `mailparser` in package.json
- `imap_mailbox_state` table in `shared/schema.ts`
- `imapPoller.ts` exports the class + three pure fns
- Pure fns have unit tests (grep test names)
- `server/index.ts` env-gates `IMAP_POLLER_ENABLED`
- `"imap"` added to source union in `inboundEmailService.ts`
- `shouldAutoCreateCertificate` rejects `source === "imap"`
- `.env.example` documents the new vars + basic-auth caveat
- Bounce-filter unit test exists
- Cursor-don't-advance-on-dispatch-fail unit test exists
- `npm test` passes (no new failures vs baseline)

## Test plan
**Unit (vitest):**
- `decideNextCursor` — first-run (returns `uidNext - 1`), uidvalidity-changed (mode flag), normal advance
- `imapMessageToInternal` — multi-To, In-Reply-To header, attachments mapped to base64, missing fields
- `shouldRejectAsLoop` — Auto-Submitted, Precedence: bulk, mailer-daemon sender, own-mailbox sender (self-loop), normal message passes
- **`pollMailbox` integration with mocked imapflow client**:
  - dispatch failure → cursor unchanged (the data-loss test code-reviewer asked for)
  - parse failure → cursor advances
  - loop-filter reject → cursor advances, no `processInboundEmail` call
  - Attachment > 10MB → dropped from payload
  - Attachment total > 25MB → message skipped, cursor advances

**Integration (real IMAP):** deferred per handoff scope.

## ADR — no
3-criteria gate: hard-to-reverse moderate, surprising no (mirrors `complianceScheduler`), real tradeoff yes-but-narrow. Two of three at best → skip.

## Deferred to future sessions (documented)
- `IMAP_REPLAY_FROM_UID` escape hatch (if Paul ever wants historical drain)
- Trusted-sender allowlist / sender-verification
- Cross-tenant heuristic matcher fix (pre-existing in `emailMatcher.ts` — global scope queries)
- `EmailSource` union consolidation across `shared/schema.ts:2531`, `inboundEmailService.ts:31`, `inbound-email.ts:36`
- OAuth2 for IMAP (if GPNet mailbox provider drops basic auth — M365 already has, Google Workspace narrowing)
- UIDVALIDITY-reset alerting (Telegram ping vs log-only)
- Dead-letter table for permanently-failed dispatches

## Bootstrap prerequisites (Paul, WSL)
1. `npm run db:push` — applies BOTH the prior `gpnet_only` column (commit 640dbb8) AND the new `imap_mailbox_state` table
2. One-time SQL: `UPDATE organizations SET gpnet_only = true WHERE id = '<paul-home-org-id>';`
3. Set env vars (`IMAP_HOST`, per-mailbox creds, `IMAP_POLLER_ENABLED=true`)
4. Confirm GPNet IMAP auth model is basic-auth-compatible (architect HIGH-3)
