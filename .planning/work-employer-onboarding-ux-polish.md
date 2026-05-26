# /work plan — employer-onboarding-ux-polish

**Spec:** [agent-specs/employer-onboarding-ux-polish.md](../agent-specs/employer-onboarding-ux-polish.md)
**Friction:** non-trivial (multi-file, frontend + backend, bug-fix tracing, requirement-6 is ambiguous)
**Mode:** CONFIRM (default for non-trivial — awaiting green-light before code)

---

## ⚠️ Three spec assumptions vs. code reality — need green-light

### Gap 1 — "Send" doesn't actually send today

**Spec assumes:** clicking Send Injury Check fires the email today, and we're inserting a draft modal between the click and the send.

**Code reality:** `POST /api/employer/cases/:id/injury-check` ([server/routes/employer-dashboard.ts:579-657](server/routes/employer-dashboard.ts#L579)) only calls Claude to *generate* the email body, returns `emailContent`, and logs. **No email is sent.** The frontend ignores `emailContent` and shows a "sent" toast that is a lie.

`emailService.ts` exists (Resend-based, line 39 `FROM_FALLBACK="Preventli <onboarding@resend.dev>"`) and `RESEND_API_KEY` gating present, so the send infra is ready to wire in.

**Recommended resolution (proceed unless you say otherwise):**
- Refactor `POST /injury-check` → split into `POST /injury-check/draft` (returns `{to, subject, body}`) and modify `POST /injury-check` to accept `{to, subject, body}` payload and actually call `emailService.send()`.
- "to" comes from the case's `workerEmail` (need to confirm it's persisted — additional info section at line 535 has it, but the case row may not).

### Gap 2 — "Unknown Company" root cause

**Confirmed in code:** [server/routes/employer-dashboard.ts:472-481](server/routes/employer-dashboard.ts#L472) — case creation infers company name by reading the *first existing case* for the org. Jane has zero cases yet → fallback string `'Unknown Company'`.

**Fix:** look up `organizations.name` by `organizationId`. `storage.ts` has no `getOrganization` helper — add a thin one or read via `db` directly in the route. **Surgical, no schema changes** (org name is already at [shared/schema.ts:1758](shared/schema.ts#L1758)).

**Side note:** every existing Arc Electrical case after this fix will *still* show "Unknown Company" unless we backfill. Cheap one-shot script — call out as Open if not done.

### Gap 3 — "Dashboard parity" is broader than 1 sitting → **DEFERRED**

**Decision (2026-05-25):** Req 6 deferred to its own spec/session per Paul. Reqs 1-5 ship this session. Video #1's onboarding flow doesn't depend on dashboard parity (Jane lands at `/`, immediately clicks "+ New Case").

**Deferred work captured in:** [agent-specs/employer-dashboard-partner-parity.md](../agent-specs/employer-dashboard-partner-parity.md)

**Updated spec status:** [agent-specs/employer-onboarding-ux-polish.md](../agent-specs/employer-onboarding-ux-polish.md) req 6 marked DEFERRED with link to new spec.

---

## Goal

Make the 5 surgical UX fixes (reqs 1-5) demo-ready on `app.preventli.ai` as Jane. Req 6 deferred to separate spec per Gap 3.

## Files to touch

| File | Why |
|---|---|
| `shared/schema.ts` | Add `worker_email` column to `worker_cases` (council blocker — see "Council folds" below) |
| Drizzle migration file | Generated via `npm run drizzle:generate`, applied via `npm run db:push` |
| `client/src/pages/EmployerCaseSuccessPage.tsx` | All UI changes: modal, persistent confirm, draft-generating + sending loading states, button copy (reqs 1-4) |
| `client/src/components/ui/dialog.tsx` | (already exists — consume, don't modify) |
| `server/routes/employer-dashboard.ts` | (1) Split `/injury-check` into `/injury-check/draft` (generate) + `/injury-check/send` (send) with Zod payload validation, (2) persist `worker_email` in create-case handler, (3) fix Unknown Company via `organizations.name` lookup |
| `server/services/emailService.ts` | (consume `send()` — no modification) |
| `server/storage.ts` | Add `getOrganization(id)` helper |
| `server/routes/__tests__/employer-injury-check.test.ts` | NEW integration tests: draft returns `{to, subject, body}`; send calls emailService.send with correct args (mocked) |
| `scripts/backfill-org-company.ts` | Drizzle-based one-shot to fix existing "Unknown Company" rows |

**Not touched this session (deferred):** `EmployerDashboardPage.tsx` (req 6).

## Approach (surgical, one logical change per commit, conventional-commit prefixes)

1. **Commit A — `feat: add worker_email column + injuryCheckSent flag to worker_cases`**
   - Schema change: `workerEmail: text("worker_email")`, `injuryCheckSentAt: timestamp("injury_check_sent_at")` on `worker_cases`. Both nullable.
   - Run `npm run drizzle:generate` to produce migration file; `npm run db:push` to apply locally.

2. **Commit B — `fix: persist workerEmail on case creation, resolve company from organizations.name`**
   - Add `getOrganization(id)` in `server/storage.ts` following the existing `getCases` pattern.
   - In create-case handler at [server/routes/employer-dashboard.ts:493](server/routes/employer-dashboard.ts#L493): replace company-from-existing-cases inference with `(await storage.getOrganization(organizationId))?.name ?? 'Unknown Company'`. Pass `workerEmail: formData.workerEmail` into the createCase call.

3. **Commit C — `feat: split injury-check into draft + send, wire emailService`**
   - New route `POST /api/employer/cases/:id/injury-check/draft`: calls `callClaude` for body only; constructs subject server-side using template `"Injury check-in — ${workerCase.workerName}"`; returns `{to: workerCase.workerEmail, subject, body}`. If `workerEmail` is null, returns `{to: '', subject, body}` so the modal can prompt for it.
   - New route `POST /api/employer/cases/:id/injury-check/send` with Zod validation: `z.object({ to: z.string().email(), subject: z.string().min(1).max(200), body: z.string().min(1).max(5000) })`. Calls `emailService.send()`. On success: UPDATE `worker_cases.injuryCheckSentAt = NOW()`. Returns `{success, sentTo, sentAt}`.
   - Delete original `/injury-check` route (no external callers — frontend is the only consumer).
   - Integration tests: one for `/draft`, one for `/send` with mocked `emailService.send`.

4. **Commit D — `feat: edit-before-send modal + persistent confirm on injury check`**
   - In [EmployerCaseSuccessPage.tsx](client/src/pages/EmployerCaseSuccessPage.tsx): button click opens `<Dialog>`.
   - Three states inside modal: `idle` → `generating` (shows "Generating draft…" spinner while `POST /draft` runs, blocks Send) → `ready` (shows editable to/subject/body + Cancel/Send) → `sending` (shows "Sending…" + disabled Send).
   - On send success: modal closes, button area swaps to persistent success card showing `sentTo` and `sentAt`.
   - Page-load: if `caseData.injuryCheckSentAt` is set, render the success card on first paint (covers reload case).
   - Subtitle copy: "AI-drafted — you review before sending".

5. **Commit E — `chore: backfill org names for Unknown Company rows`**
   - `scripts/backfill-org-company.ts` using Drizzle:
     ```ts
     // pseudo: for each org, update worker_cases.company = org.name
     //   WHERE worker_cases.organizationId = org.id
     //     AND worker_cases.company = 'Unknown Company'
     //     AND org.name <> 'Unknown Company'  // safety: don't overwrite with same string
     ```
   - Run locally against dev db; log per-org row count. Document run-once-in-prod step in PR description.

## Verify criterion (`~/.claude/verify/employer-onboarding-ux-polish.sh`)

**Tier 1 — deterministic source/build checks (the gate):**
1. `EmployerCaseSuccessPage.tsx` contains `<Dialog` AND `/injury-check/draft` AND `/injury-check/send` AND `Generating draft` AND `Sending` AND `AI-drafted — you review before sending`
2. `employer-dashboard.ts` contains `/injury-check/draft` AND `/injury-check/send` AND `emailService` import AND `injuryCheckSendSchema` (Zod) AND `getOrganization(`
3. `shared/schema.ts` contains `worker_email` AND `injury_check_sent_at`
4. `storage.ts` contains `getOrganization(`
5. `scripts/backfill-org-company.ts` exists AND contains `db.update(workerCases)` (Drizzle, not raw SQL)
6. Backend integration test files exist and reference `injury-check/draft` and `injury-check/send`
7. `npx tsc --noEmit 2>&1 | grep -cE "^(client/src/pages/EmployerCaseSuccessPage|server/routes/employer-dashboard|server/storage|shared/schema|scripts/backfill-org-company)\.ts: error TS"` equals `0`
8. `npm test -- employer-injury-check` passes (the new integration tests)

**Tier 2 — hard pre-ship gates (verified in Step 5 / before declaring done):**
- `RESEND_API_KEY` present in prod env (curl `app.preventli.ai/healthz` or check Render dashboard). If absent, email silently logs — **do not mark feature complete**.
- Backfill script run output recorded in PR description.

**Tier 3 — manual live-app verification on `app.preventli.ai` as `jane@arcelectrical.com.au`** (the 6 numbered checks in [agent-specs/employer-onboarding-ux-polish.md](../agent-specs/employer-onboarding-ux-polish.md) "Verification" section, minus #6 which is deferred).

## Test plan

- Existing unit tests (`npm test`) must still pass after refactor.
- **NEW** backend integration tests (Commit C): `/injury-check/draft` returns `{to, subject, body}` with `to` populated from persisted `workerEmail`; `/injury-check/send` invokes mocked `emailService.send` with the validated payload and writes `injuryCheckSentAt`. Required per code-reviewer council finding (rubric Dim 6).
- No new UI unit tests (covered by manual live-app walk).

## Estimate

| Component | Hours |
|---|---|
| Schema change (Commit A) + migration | 0.25 h |
| Backend persist + Unknown Company (Commit B) | 0.5 h |
| Backend draft/send split + Zod + integration tests (Commit C) | 1.5 h |
| Frontend modal + 3 states + persistent confirm + copy (Commit D) | 1.5 h |
| Backfill script (Commit E) | 0.25 h |
| Manual verification on live app | 0.5 h |
| Verify-script iteration (expected 1-2 attempts) | 0.5 h |
| **Total** | **5.0 h** (was 3.0; council blocker added ~2h) |

**Schedule risks:**
1. **`workerEmail` persistence** — if it isn't on `worker_cases` row, "to" can't auto-populate and the modal needs a workaround. Adds 0.5 h.
2. **Resend env var not set in prod** — sends will fail silently into "logged not sent". Adds 0.25 h to confirm + document the env-var requirement before declaring done.

## ADR?

**No.** None of the three ADR criteria hit:
- Hard-to-reverse — no, all changes are revert-safe.
- Surprising — no, this is conventional draft-then-send UX.
- Real trade-off — no, the split is straightforwardly better than current "lie about sending."

## Council folds (2026-05-25, architect + critic + code-reviewer)

All three converged on a single **BLOCKER**: `workerEmail` is captured from the form (line 535) but only logged via `logger.info` — never persisted. The modal would open with an empty `to` field. **Folded:** schema change Commits A + B added.

**Other findings folded:**
- (architect) endpoint rename to `/injury-check/send` for clarity → done in Commit C.
- (code-reviewer) Zod payload validation on send → done in Commit C.
- (code-reviewer) backend-generated subject template (not AI) → done in Commit C.
- (code-reviewer) Drizzle for backfill, not raw SQL → done in Commit E.
- (code-reviewer) backend integration tests required per rubric Dim 6 → done in Commit C test file.
- (critic) Draft-generation has its own loading state ("Generating draft…") not just send → done in Commit D state machine.
- (critic) Resend env-var check promoted to hard pre-ship gate → Verify Tier 2.
- (critic) Backfill safety: skip when org.name == 'Unknown Company' → folded into Commit E pseudo.
- (critic) Persistent confirmation survives reload via server-side `injuryCheckSentAt` flag → Commit A schema + Commit D first-paint check.

**Acknowledged but not folded (listed as Open in Step 6):**
- (critic) JWT 15-min expiry on long-open modal — user can refresh; not a demo blocker.
- (critic) "Sending…" minimum-display-duration — placebo critique; one frame is acceptable for the demo, can tighten later.
- (critic) callClaude empty/garbage response → relies on existing prompt quality; no validator added.

---

## Status (2026-05-25)

- ✅ Gap 1, 2, 3 answered by Paul (wire send, backfill yes, req 6 deferred)
- ✅ Council fired (architect + critic + code-reviewer) — findings folded above
- ✅ Estimate revised 3.0h → 5.0h to absorb workerEmail schema change + tests + state machine
- ⏳ Awaiting final green-light to proceed to Step 3 (code)
