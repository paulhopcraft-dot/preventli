# RTW auto-draft follow-up progress

## Plan
- Task A: New `CurrentRTWPlanCard` component, wired below banner. Queries `/api/rtw-plans?caseId=X` which returns the LATEST plan (single, not list). If the latest is a non-draft active status, render the card; otherwise return null.
- Task B: Add tooltip to the existing Compliance card in `EmployerCaseDetailPage.tsx` showing `workerCase.compliance.reason / source / lastChecked` when level is at-risk or non-compliant.
- ONE commit at the end.

## Key findings
- `GET /api/rtw-plans?caseId=X` returns `{success, data: RTWPlanWithDetails}` where data = `{plan, version, schedule, duties}`. `duties` are `RTWPlanDutyDB[]` (no joined duty names).
- For duty names we use the `/details` endpoint per planId. Plan has `dataJson` in version with structured data — but cleanest is to query `/details` for the active plan.
- Compliance card is around line 446 in `EmployerCaseDetailPage.tsx`. Compliance reason is on `workerCase.compliance.reason` (CaseCompliance type).
- Tooltip component exists at `client/src/components/ui/tooltip.tsx`.
- The banner already uses key `[/api/rtw-plans?caseId=X]` so I'll reuse it.

## Steps
1. [x] Explore endpoints + types
2. [x] Create CurrentRTWPlanCard.tsx
3. [x] Wire into EmployerCaseDetailPage.tsx (below banner)
4. [x] Add tooltip to Compliance card
5. [x] Run `npx tsc --noEmit` — only pre-existing error in `server/routes/rtw.test.ts:10` (RTWPlanStatus exhaustive map); no new errors introduced
6. [x] Commit
