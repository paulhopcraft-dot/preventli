# RTW Auto-Draft Backend — Progress

- Explored: rtwAutoDrafter signature `draftRTWPlanForCase(caseId, organizationId, triggerSource, userId, { storage })`
- Explored: storage already has `caseHasMedicalConstraintsGate`, `getActiveDraftPlan`, `getLatestCertificate`, `getCaseRoleContext`, `getCurrentRestrictions`, `getRoleDutiesWithDemands`, `createRTWPlan` — no schema/storage mod needed
- Explored: routes registration pattern is `app.use("/api/<prefix>", authorize(), router)` inside `server/routes.ts`; per-case ownership via `requireCaseOwnership()` middleware which supports `:caseId` param
- Plan: write `server/routes/rtwAutoDraft.ts` with two endpoints under `/api/cases` prefix, register in routes.ts
- Wrote `server/routes/rtwAutoDraft.ts` (POST auto-draft-rtw-plan, GET auto-draft-eligibility) — uses `authorize()` + `requireCaseOwnership()` per-route, narrows AutoDraftResult discriminated union via `result.skipped === true`, maps skip reasons to 4xx (409 for existing_active_draft, 400 for others)
- Registered router in `server/routes.ts` on `/api/cases` mount
- Storage methods already existed from a prior commit on this branch lineage (`caseHasMedicalConstraintsGate`, `getActiveDraftPlan`) — no storage mod needed
- TS check: only pre-existing error in `rtw.test.ts` (unrelated `pending_employer_review` map gap, last touched 2c373c6); no new errors from this change
