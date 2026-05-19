# Session 122 — Bug Triage (2026-05-09)

In-repo record of bug triage performed on 2026-05-09 by Paul + Claude. Source-of-truth for what was found, decided, spawned, and what's still open. Companion to local session journal at `~/.claude/wsl-imported/sessions/session-4-preventli-web.md`.

## Items found

| # | Bug / change | Status | Spawn worktree / branch | Commit | Tracking |
|---|---|---|---|---|---|
| 1 | Partner cases worker-name click opens worker timeline instead of case detail (`client/src/pages/PartnerWorkspace.tsx:586-601`) | Code complete | `claude/vibrant-leakey-dd0be3` | `e38840f` | Separate PR |
| 2 | Closed cases appearing in partner cases list — `GET /api/partner/cases` selects but doesn't filter `caseStatus` (`server/routes/partner.ts:589-619`) | Code complete | `claude/pensive-mclean-4214e0` | `3593c73` | Separate PR |
| 3 | `POST /api/assessments` returns 500 when a job-description file is attached. Multer is wired correctly; failure is in `saveJdFile` → storage service / S3 path (`server/services/fileUpload.ts:84`, `server/services/storageService.ts`) | Spawned, no work done — needs respawn or autonomous run to pick up | `claude/thirsty-mendeleev-b908b1` (empty) | none | TODO |
| 4 | Replace 3-column employer dashboard (Critical / Urgent / Routine actions) with flat case list — red/amber/blank left bar by `riskLevel`, partner-workspace style (`client/src/pages/EmployerDashboardPage.tsx:239-407`) | Captured, design confirmed (riskLevel-based, replace entirely, partner-style columns) | not spawned | n/a | TODO |
| 5 | `/check/:token` routes to short `PublicQuestionnaire` (185 lines, single page) instead of multi-page `PreEmploymentForm` (1655 lines, 8 steps). Plus genuine field gaps vs. Jotform reference: full 10-item Kessler K10, ~30 medical Yes/No questions, e-signature pad, declaration checkbox, Section 41 WIRC Act (Vic) disclosure (`client/src/App.tsx:150-155` + `client/src/pages/PublicQuestionnaire.tsx`) | Captured — recommended `/gsd:plan-phase` (DB schema additions + e-sig lib + multi-page state) | not spawned | n/a | TODO |
| 6 | Email branding + form pre-population: hardcoded "— Preventli Health Team" sign-off (`server/routes/assessments.ts:153`); subject doesn't mention org; email body should explicitly tell candidate which company; Company Name on form should be pre-filled from assessment record | Captured | not spawned | n/a | TODO |
| 7 | Domain move to `https://app.preventli.ai`. Update hardcoded fallback `"https://gpnet3.onrender.com"` at `server/routes/assessments.ts:134` and Render env `APP_URL` | Captured | not spawned | n/a | TODO |

## Key context decisions

- **Worker history must remain reachable.** Closed cases are filtered from active lists (#2) but the worker timeline / profile page (`/workers/:workerId`) is the canonical history view. Do not delete `openWorkerProfile`, the `/workers/:workerId` route, or the worker profile page itself. The respawned #1 prompt explicitly enforces this — first attempt had a deletion clause that was caught and removed before damage.
- **Form architecture for `/check/:token`** — recommended approach is option B: `PublicQuestionnaire` becomes a token-loading dispatcher that renders `PreEmploymentForm` (or other per-type forms) based on the assessment's `assessmentType`. Avoids duplicating the 1655-line form and sets up cleanly for the other check types (Exit, Wellness, Mental Health, Prevention, Injury) that already have stub form files.
- **Email branding partner flow.** When a partner (e.g. WorkBetter) sends on behalf of a client (e.g. Alpine Health), `assessment.organizationId` is already the client org's id (partner JWT-swap puts it there per session 120 work). Lookup `organizations.name` and substitute into the subject + sign-off + body.

## Cowork E2E test

A self-contained Cowork prompt covering 6 scenarios + 4 edge cases is at `.claude/cowork/pre-employment-e2e.md`. It checks all 5 fixes (1–5) plus the email-branding requirement and the new `app.preventli.ai` domain. Cowork files structured GitHub issues with label `e2e-pre-employment` for every failure, plus a markdown report on a branch via PR.

## Pattern observations (orchestration meta-notes)

1. **Spawn agents may stop right before the publish step.** Two of three spawned tasks made commits but didn't open PRs. Going forward, the orchestrating session should always check `git status` of each spawned worktree before declaring "shipped" — and either prompt the agent to finish or push + PR on its behalf.
2. **Empty worktree = silent failure.** A spawned session that ends with no commits and no notes (like #3) is the worst failure mode because it looks like the chip was clicked but nothing happened. Future spawn prompts should include a "if blocked, leave a STATE.md describing why" instruction.
3. **Cloud vs. local lane.** All three chips ended up local even when cloud was recommended for code-only work. Either the cloud lane wasn't picked, or the chip UI defaults to local. Worth checking the chip behaviour for whether the lane was actually used.
