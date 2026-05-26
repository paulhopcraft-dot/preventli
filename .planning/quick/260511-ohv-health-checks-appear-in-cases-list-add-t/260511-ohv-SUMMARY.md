---
plan: 260511-ohv
phase: quick
subsystem: cases
tags: [schema, health-checks, worker-cases, cases-list, type-discrimination]
requires: []
provides:
  - worker_cases.type column with default 'injury' and full 6-value enum
  - worker_cases.assessment_id column (soft nullable reference to pre_employment_assessments)
  - Auto-creation of worker_cases row on POST /api/public/check/:token submission
  - POST /api/cases/:id/convert-to-injury endpoint
  - CasesPage type badge + View Report / Convert to Case action buttons
affects:
  - Any future health-check form submission endpoints (Exit/Prevention/Wellness/MentalHealth need similar hooks)
  - CasesPage query consumers (PaginatedCasesResponse.cases now always includes type + assessmentId)
tech-stack:
  added: []
  patterns:
    - Non-blocking async side-effect pattern (createCaseFromAssessment fire-and-forget with catch)
    - Soft varchar reference instead of FK to avoid Drizzle forward-reference ordering issue
key-files:
  created:
    - migrations/0009_striped_tigra.sql
    - server/scripts/migrate-case-type.ts
  modified:
    - shared/schema.ts
    - server/storage.ts
    - server/routes/public.ts
    - server/routes.ts
    - client/src/pages/CasesPage.tsx
decisions:
  - id: soft-assessment-id-ref
    choice: "varchar assessment_id without FK constraint"
    alternatives: "arrow FK () => preEmploymentAssessments.id"
    rationale: "preEmploymentAssessments is declared later in schema.ts (line 2268). Drizzle emits TypeScript type errors on forward FK references in some configurations. The soft link is equally queryable and avoids file restructuring."
  - id: pre-employment-defaults
    choice: "workStatus=Pending, riskLevel=Low, company=departmentName ?? Pre-employment, dateOfInjury=completedDate ?? sentAt ?? now()"
    rationale: "Worker has not yet started employment; Pending signals health-check stage. Low risk is conservative default pending actual report. dateOfInjury reuses the nearest available timestamp as required by NOT NULL constraint."
  - id: audit-event-type
    choice: "AuditEventTypes.CASE_UPDATE"
    rationale: "Existing type used by close-case endpoint. No CASE_CONVERT_TYPE type exists; creating new types was out of scope per plan constraint."
  - id: mapper-fix
    choice: "Added type + assessmentId to both getCases and getCasesPaginated mappers"
    rationale: "Advisor flagged that list endpoints would silently return undefined type if mappers weren't updated. This was an unplanned but necessary addition (Rule 2 - Missing Critical)."
metrics:
  duration: "~45 minutes"
  completed: "2026-05-11"
---

# Quick Task 260511-ohv: Health Checks Appear in Cases List

**One-liner:** Type-discriminated worker_cases surfacing pre-employment health checks in the cases list with View Report and Convert to Case actions.

## What Was Delivered

1. **Schema**: `worker_cases.type` (NOT NULL DEFAULT 'injury', WorkerCaseType union) and `worker_cases.assessment_id` (nullable varchar) columns added. Migration generated and applied. 150 existing rows backfilled to 'injury'.

2. **Storage layer**: `createCase` extended with optional `type`/`assessmentId` params. New `createCaseFromAssessment(assessment)` convenience method. New `updateWorkerCaseType(caseId, orgId, newType)` method. Both getCases and getCasesPaginated mappers updated to surface `type` and `assessmentId` in every WorkerCase object.

3. **Public endpoint**: `POST /api/public/check/:token` now fires `createCaseFromAssessment` after saving responses (non-blocking — failure cannot break the worker's submit flow).

4. **Convert endpoint**: `POST /api/cases/:id/convert-to-injury` registered before the close-case route, protected by `authorize()` + `requireCaseOwnership()`, audited via `AuditEventTypes.CASE_UPDATE`.

5. **CasesPage**: Type column added between Worker Name and Company. Coloured badges for all 6 types. Health-check rows show View Report button (links to `/assessments/:assessmentId`) and Convert to Case button (fires convert mutation with CSRF token). Action cell uses `stopPropagation` to prevent row-click navigation. Empty-state colSpan updated from 7 to 8.

## Deviations from Plan

### Planned deviations

**[Rule 2 - Missing Critical] Updated getCases and getCasesPaginated mappers to surface type + assessmentId**

- **Found during:** Pre-task analysis (advisor review)
- **Issue:** Both mappers explicitly constructed WorkerCase objects and would have emitted `type: undefined` for every row, silently defeating the badge logic
- **Fix:** Added `type: ((dbCase as any).type as WorkerCaseType) ?? "injury"` and `assessmentId: (dbCase as any).assessmentId ?? null` to both mapper objects in getCases (line ~800) and getCasesPaginated (line ~977)
- **Files modified:** server/storage.ts

### Schema decision

**assessmentId stored as soft varchar (no FK)**

The plan anticipated this: "If the build complains about ordering, move the `assessmentId` reference to use a string column without the foreign-key constraint." The Drizzle schema processes types at compile time and the arrow form `() => preEmploymentAssessments.id` for tables declared ~1400 lines later caused TypeScript inference issues. Soft reference chosen without restructuring the file.

## Success Criteria Verification

- [x] `worker_cases.type` column exists with default `'injury'`; all pre-existing rows backfilled (150 rows confirmed)
- [x] `worker_cases.assessment_id` column exists, nullable
- [x] `WorkerCase` TS interface exposes `type` (required) and `assessmentId` (optional)
- [x] `POST /api/public/check/:token` creates a `worker_cases` row with `type='pre_employment'` and `assessmentId` set, non-blocking on failure
- [x] `POST /api/cases/:id/convert-to-injury` (auth + ownership protected) flips the row's `type` to `'injury'` and returns 200 with the updated case
- [x] `CasesPage.tsx` shows a Type column with a coloured badge for every row
- [x] Health-check rows show View Report + Convert to Case buttons; injury rows do not
- [x] Clicking either button does not propagate the row's onClick (stopPropagation on action cell)
- [x] Build green (3 separate passes), tests green (343/344 passing, 1 skipped — pre-existing)

## Commits

| Hash | Description |
|------|-------------|
| f989ae6 | feat(260511-ohv): add type and assessmentId columns to workerCases schema |
| 1fc3684 | feat(260511-ohv): auto-create case on health-check submit + convert-to-injury endpoint |
| b2ad5ef | feat(260511-ohv): surface type badge and health-check actions in CasesPage |

## Next Steps (Out of Scope — Follow-up Quick Plan)

The plan explicitly deferred wiring auto-case-creation for Exit / Prevention / Wellness / MentalHealth form submission endpoints. Those form submission paths need to be identified and given the same `createCaseFromAssessment` hook. A SCOPE NOTE comment has been left in `server/routes/public.ts` and `server/storage.ts:createCaseFromAssessment` documenting this.
