# rtw-plan-multi-party-distribution

## Purpose

When a draft RTW plan is created, distribute it to all relevant parties at once — worker, worker's manager, treating doctor, physio (if involved), and (if a WorkCover claim) the insurance company case manager. Each party gets a contextually-different ask (manager: "is the role okay?"; doctor: "would you like to vary constraints?"; worker: "what do you think?"; insurer: courtesy notification). Plan does not finalise until all parties respond. Each recipient's email is editable before send, same modal pattern as `employer-onboarding-ux-polish` (already shipped). Pre-conditions: party contact emails must be captured up front at case creation so they're available when the plan is drafted.

## Architecture posture (decided upstream, 2026-05-26)

**Hybrid:** workflow hard-coded, content LLM-assisted, decisions deterministic. NOT an agent. Per `~/.claude/rules/architectural-principles.md` — WorkCover-claim → insurer-CC is a compliance/deed requirement and must be auditable and reproducible. LLMs do NOT decide who gets the email; templates decide what each party sees; LLM generates the plan body only.

| Concern | Implementation |
|---|---|
| Recipient set (workCover? physio? doctor?) | Hard-coded if/else over case data |
| Per-party context (greeting / ask) | Hard-coded template strings (marketing copy must be consistent) |
| State machine (`draft → awaiting_responses → all_responded → finalised`) | DB column + service code |
| Compliance check (WorkCover + no insurer CM → block) | Hard-coded gate |
| Plan body draft | LLM (existing `rtwEmailService.generateRTWPlanEmail`) |
| Per-party body lens (clinical detail to doctor, plain language to worker) | LLM with party-type input — OPTIONAL, defer if time pressure |
| Response sentiment classification (auto-route "accepted" vs "wants changes") | OPTIONAL — defer; v1 just captures the text |
| Edit-before-send screen | Human-in-the-loop, modal pattern from `EmployerCaseSuccessPage` |

## Requirements

### 1. Capture party contacts up front at case creation
- Employer new-case form (`EmployerNewCasePage.tsx`) gains fields: **worker email** (already present), **manager email**, **manager name**, **treating doctor email**, **doctor practice name**, **physio email** (optional), **physio practice name** (optional)
- The form has a "**Is this a WorkCover claim?**" toggle (yes/no). When YES:
  - Show + require: **claim number** (free-text, persisted to `worker_cases.claimNumber`), **insurer name**, **insurance case-manager email**, **insurance case-manager name**
  - Server-side validate: claim number not empty, insurer CM email is a valid email format
- When NO: `worker_cases.claimNumber` stays NULL, no insurer contact row created. Standard preventative-case flow.
- Submitting the form writes these as `case_contacts` rows (roles: `employer_primary` for manager, `treating_gp` for doctor, `physiotherapist`, `insurer` for the CM). Schema already supports this — no migration needed.
- Validate emails server-side (Zod, same shape as the injury-check `/send` schema)

### 2. Recipient list resolution (deterministic)
- Given a plan, the server computes the recipient list by reading `case_contacts` for the plan's case:
  - Always: worker (case has worker email), manager (`employer_primary`), treating doctor (`treating_gp`)
  - If `case_contacts` has a `physiotherapist` row: include physio
  - If `worker_cases.claimNumber` is populated AND `case_contacts` has an `insurer` row: include insurer case manager
- If a required contact is missing (worker email, manager email, doctor email): the send button shows a blocking error pointing to the case-contacts page
- If WorkCover claim AND insurer row missing: the send button shows a blocking error specific to "insurer case manager required for WorkCover claims"

### 3. Per-party email content (deterministic templates + LLM body)
Each recipient gets:
- **Greeting/intro paragraph** (hard-coded template, varies by role):
  - Worker: "Hi `<workerName>`, here's the proposed RTW plan we've put together with `<companyName>`. We'd like to hear your thoughts before we finalise it."
  - Manager: "Hi `<managerName>`, here's the proposed RTW plan for `<workerName>`. Please confirm the role and duties are workable for your team."
  - Doctor: "Dear `Dr <doctorLastName>`, please review the proposed RTW plan for `<workerName>`. Would you like to add to or vary any of the constraints?"
  - Physio: same template as doctor (different salutation)
  - Insurer (WorkCover only): "Dear `<csmName>`, courtesy notification of the proposed RTW plan for `<workerName>`, claim `<claimNumber>`. Please respond if you have any concerns or questions."
- **Plan body** (LLM-generated, ONE canonical version per plan, NOT per-party in v1) — reuse existing `generateRTWPlanEmail` output
- **Response ask** (hard-coded, varies by role): single sentence at the end matching the role's contextual question
- **Reply-to** points to the case's primary case manager so responses thread back

### 4. Edit-before-send screen (extend the injury-check modal pattern)
- New page or modal at `/rtw-plans/:planId/distribute` (decide during planning whether full-page is better than modal — there are 4-5 recipients, so probably full-page with tabs/accordions)
- Per-recipient editable fields: `to`, `subject`, `body` (all pre-populated from template + LLM)
- Per-recipient toggle: "include in send" (allows skipping a recipient if e.g. physio email turns out to be wrong)
- Single "Send to all" button at the bottom validates Zod schema for each enabled recipient, then sends in parallel via existing `emailService.sendEmail`
- All-or-nothing transactional semantic: if any send fails, the others still go; UI shows per-recipient send status and lets you retry the failures

### 5. Plan state machine
New DB column on `rtw_plans`: `distributionStatus` (text, default `'not_distributed'`). Values:
- `not_distributed` — plan created but distribution not started
- `awaiting_responses` — emails sent, waiting for at least one response from each non-courtesy party
- `all_responded` — all gated parties (worker, manager, doctor, physio if present) have responded
- `finalised` — practitioner manually marks complete after reviewing responses

Insurer response is NOT gating (it's a courtesy CC). Worker/manager/doctor/physio responses ARE gating.

Each `case_contacts` row gets two new columns (or a sibling `rtw_plan_distributions` table) to track per-recipient state:
- `lastDistributedAt` (timestamp, nullable)
- `respondedAt` (timestamp, nullable)
- `responseText` (text, nullable — what they said, captured via inbound email or a magic-link form)

### 6. Response capture (v1: manual paste; v2: inbound email parse)
- **v1 (in scope):** the case-detail page shows a "Distribution responses" panel listing each recipient with status (`Sent · awaiting reply` / `Replied YYYY-MM-DD`); practitioner pastes the response text manually and clicks "mark responded"
- **v2 (out of scope):** parse inbound email replies via existing `postmark-inbound.ts` infrastructure to auto-mark `respondedAt`

### 7. Finalisation gate
- Plan can ONLY transition to `approved` / `finalised` if `distributionStatus === 'all_responded'` (or if the practitioner explicitly bypasses with a written reason captured in audit log)
- The existing "approve plan" button is disabled with a tooltip listing outstanding parties until they respond

## Out of scope

- **v2 inbound email response parsing** — handle via separate spec once the manual flow stabilises
- **LLM-per-party body adaptation** — defer; one canonical body is fine for v1
- **Sentiment classification on responses** — defer; practitioner reads and acts on the text
- **Insurer claim-number validation** — log the value; don't validate against external WorkCover/insurer APIs
- **Reminder timers** ("X days no response → nudge") — defer to a separate spec
- **Plan editing post-distribution** — if the plan changes after distribution, that's a v2 problem (re-distribute? lock plan during distribution? out of scope)

## Code pointers

- [shared/schema.ts:1881](shared/schema.ts) — `case_contacts` already has the right shape; only `rtw_plans` needs a `distributionStatus` column + the per-recipient tracking
- [shared/schema.ts:857](shared/schema.ts) — `worker_cases.claimNumber` distinguishes WorkCover (populated) from preventative (null)
- [server/routes/rtwPlans.ts:594-651](server/routes/rtwPlans.ts) — existing single-recipient `GET /email` + `POST /email/regenerate` + `POST /email/send`; the new multi-recipient endpoints sit alongside (`/distribute/preview`, `/distribute/send`, `/responses/:contactId/mark`)
- [server/services/rtwEmailService.ts](server/services/rtwEmailService.ts) — existing email-body generator; reuse, don't replace
- [server/services/emailService.ts](server/services/emailService.ts) — Resend-backed `sendEmail`; called per-recipient in a `Promise.allSettled` loop
- [server/routes/employer-dashboard.ts:631-756](server/routes/employer-dashboard.ts) — the *pattern* to follow: `/draft` + `/send` split with Zod, server-side template strings, deterministic decisions. Mirror this shape for the new RTW endpoints.
- [client/src/pages/EmployerCaseSuccessPage.tsx](client/src/pages/EmployerCaseSuccessPage.tsx) — the 4-state modal pattern (`idle → generating → ready → sending`) is reusable directly; lift it into a shared component if the new distribute screen also needs it (or accept the duplication for v1 simplicity)
- [client/src/pages/EmployerNewCasePage.tsx](client/src/pages/EmployerNewCasePage.tsx) — the form gaining new contact fields (req 1)
- [server/routes/postmark-inbound.ts](server/routes/postmark-inbound.ts) — exists; out-of-scope for v1 but listed here so the v2 author knows where to wire response capture

## Verification

Deterministic source-grep gate (cross-runtime shell):
1. `EmployerNewCasePage.tsx` has fields for manager email, doctor email, physio email, and conditional insurer CM email (WorkCover only)
2. `rtwPlans.ts` has `POST /:planId/distribute/preview` and `POST /:planId/distribute/send` and `POST /responses/:contactId/mark`
3. New routes Zod-validate each recipient's `{to, subject, body}` (same shape as `injuryCheckSendSchema`)
4. `rtw_plans` table gains `distribution_status` column; `case_contacts` gains `last_distributed_at`, `responded_at`, `response_text` (or sibling distributions table)
5. Hard-coded template strings present in the code: one per role (worker / manager / doctor / physio / insurer)
6. `distributionStatus` transition logic is unit-testable: given a case + plan + WorkCover flag + contact set, the recipient list is deterministic
7. Approve-plan endpoint refuses 400 when `distributionStatus !== 'all_responded'` unless `bypassReason` is set
8. Scoped tsc passes on every touched file

Live walk (Jane on `app.preventli.ai`):
1. Create a new WorkCover-claim case → form REQUIRES insurer CM email; submitting without it shows a validation error
2. Generate an RTW plan → navigate to "Distribute" → screen shows 5 recipients (worker, manager, doctor, physio, insurer)
3. Edit the doctor's body, untick physio (turns out wrong email), click "Send to all" → modal shows per-recipient send status; doctor + worker + manager + insurer go; physio is skipped
4. Refresh → page shows `Sent · awaiting reply` for the 4 recipients
5. Paste a doctor's response → click "mark responded" → status updates → "Approve plan" button still disabled because worker + manager haven't responded yet
6. Mark all responded → "Approve plan" enables → plan finalises

## Closure

WorkCover-claim case can be created with all 5 party contacts captured up front, RTW plan drafted, distributed to all 5 with per-party greeting + ask, responses captured manually, plan only finalisable after gated parties respond. Demo-recordable end-to-end.

## Estimate (rough; refine during /work plan step)

| Component | Hours |
|---|---|
| Schema migration + storage methods (new columns, recipient resolver, distribution tracker) | 1.5 |
| Backend routes (preview, send-to-all, mark-response, approve gate) + Zod + tests | 3.0 |
| Frontend form: new contact fields on new-case form + Zod-mirror | 1.5 |
| Frontend: distribute screen with per-recipient editable cards + send-all flow | 3.0 |
| Frontend: case-detail responses panel + mark-responded UX | 1.5 |
| Integration tests for recipient-resolution logic (WorkCover vs not, physio yes/no) | 1.0 |
| Manual live walk + screenshot | 1.0 |
| **Total** | **12.5 h ≈ 1.5–2 days** |

Schedule risks:
- Distribute-as-modal vs distribute-as-full-page is a UX decision that affects 3.0h of frontend work — pin it during grill-me
- v1-manual-response-capture vs threading inbound emails — call it out during grill-me so Paul can decide whether v2 is "next session" or "never"
