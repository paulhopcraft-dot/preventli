# Project State: RTW Planner Engine

## Project Reference

See: .planning/PROJECT.md (updated 2026-01-25)

**Core value:** Automatically generate legally-defensible RTW plans from structured medical constraints and job duty data
**Current focus:** Phase 7 - Email Generation (in progress)

## Current Position

Phase: 7 of 11 (Email Generation)
Plan: 1 of 3 complete
Status: In progress
Last activity: 2026-05-11 - Completed quick task 260511-ohv: Health checks appear in Cases list

Progress: [#########.] 82%

## Current Status

| Artifact | Status |
|----------|--------|
| PROJECT.md | Created |
| config.json | Created |
| REQUIREMENTS.md | Created (90 requirements) |
| ROADMAP.md | Created (10 phases) |

## Phase Progress

| Phase | Name | Status | Plans |
|-------|------|--------|-------|
| 1 | Database Schema | COMPLETE | 1/1 |
| 2 | Admin: Roles & Duties | COMPLETE | 5/5 |
| 3 | Medical Integration | COMPLETE | 3/3 |
| 4 | Functional Ability Matrix | COMPLETE | 3/3 |
| 5 | Plan Generator | COMPLETE | 4/4 |
| 6 | Plan Output | COMPLETE | 4/4 |
| 7 | Email Generation | In progress | 2/3 |
| 8 | Approval Workflow | Pending | 0/0 |
| 9 | Audit Trail | Pending | 0/0 |
| 10 | RTW Planner UI | Pending | 0/0 |
| 11 | System-Wide Testing | COMPLETE | 7/7 |

## Accumulated Decisions

| Decision | Rationale | Phase |
|----------|-----------|-------|
| DemandFrequency as varchar | Flexibility for future frequency levels without migration | 1 |
| Cascade deletes for RTW tables | Data integrity when parent records deleted | 1 |
| RTW plan versions as separate table | Full version history with dataJson snapshots | 1 |
| Weight limits as separate columns | Precise tracking of liftingMaxKg, carryingMaxKg | 1 |
| Always create demands record for duties | Ensure consistent data structure | 2 |
| Upsert pattern for demands on update | Handles missing demands gracefully | 2 |
| Soft delete preserves demands | Audit trail for deleted duties | 2 |
| Transaction wrapping for multi-table ops | Atomicity for duty+demands operations | 2 |
| Playwright extended fixtures for auth | Reusable login across all E2E tests | 11 |
| TEST_GREP env var for wave filtering | Enables smoke/critical/regression/performance test execution | 11 |
| Graceful tab handling in tests | Tab tests use catch pattern to handle missing tabs without failing | 11 |
| 5 second performance target | All major endpoints and pages should respond within 5 seconds | 11 |
| Performance logging for baseline | Tests log actual times to establish baseline before enforcing | 11 |
| Direct pg Pool for integrity tests | Raw SQL cleaner for referential checks, avoids ORM in test layer | 11 |
| Conditional skip for DATABASE_URL | Tests skip gracefully when no database, not fail | 11 |
| Recovery chart tests log missing data | Test data may lack certificates; log rather than fail | 11 |
| FunctionalRestrictionsExtracted extends base | Allows time limits and extraction metadata alongside capabilities | 3 |
| Fire-and-forget extraction in pipeline | Extraction errors should not block certificate creation | 3 |
| Edge case handling without LLM | Fit/unfit have deterministic mappings; saves API costs | 3 |
| Category-based restriction grouping | Groups related demands for easier UI scanning | 3 |
| Color coding (green/yellow/red/gray) | Consistent with app-wide status colors | 3 |
| Inline weight limits | Shows max kg next to lifting/carrying for immediate context | 3 |
| CAPABILITY_PRIORITY constant mapping | Clear precedence: cannot > with_modifications > can > not_assessed | 3 |
| Weight limits use minimum in combination | Lower weight limit = more restrictive = safer for worker | 3 |
| Rest requirements use maximum in combination | More rest = more restrictive = safer for worker | 3 |
| Return source indicator in API response | UI can show if restrictions from single cert or combined sources | 3 |
| Cognitive demands default to not_assessed | FunctionalRestrictions doesn't include cognitive fields | 4 |
| Weight limit tolerance 5kg for modifications | Small weight differences can use mechanical aids | 4 |
| Max 3 not_suitable demands for modification | More than 3 mismatches too many to accommodate | 4 |
| SuitabilityLevel type only 3 values | FAM-02: Never undefined/null/invalid states | 4 |
| API returns dutyId not planDutyId | Phase 4 operates on templates for preview, plan instances come in Phase 5 | 4 |
| TRUE matrix with sticky first column | Duties as rows, 15 demand columns, horizontal scroll with sticky duty name | 4 |
| Abbreviated column headers | Short labels (Sit, Stand, Lift) with full name in tooltip for space efficiency | 4 |
| 80% suitable threshold for duty restrictions | Industry standard for "duties OK" determination | 5 |
| 4-4-6-8 hour graduated progression | WorkSafe Victoria guidance: days increase before hours for safer progression | 5 |
| Max 12 weeks schedule duration | Reasonable recovery ceiling - longer plans should be broken into phases | 5 |
| Max 2 hour/day or 2 day/week increase per week | Safe progression warning prevents aggressive ramp-up | 5 |
| Modification notes capped at 3 | Keeps plan documentation readable, full details in suitability assessment | 5 |
| sessionStorage for draft persistence | Clears on tab close, prevents stale drafts, perfect for in-progress form data | 5 |
| 4-step wizard flow | Plan Type -> Schedule -> Duties -> Preview for logical progression | 5 |
| Server-side suitability re-validation | Prevents frontend manipulation, recalculates before saving | 5 |
| Transaction wrapping for RTW plan creation | Atomicity across plan + version + schedule + duties tables | 5 |
| Audit logging for plan creation | Uses case.create event type until RTW-specific types added | 5 |
| Use caseContextSnapshot.planId for plan email lookup | email_drafts lacks resource columns, use existing JSONB column | 6 |
| Fallback email template when AI unavailable | Graceful degradation for missing ANTHROPIC_API_KEY | 6 |
| Block email regeneration for approved plans | OUT-08 requires emails locked after plan approval | 6 |
| Print CSS @import at top of index.css | CSS spec requires @import before other rules | 6 |
| Separate section components for plan display | Composable building blocks for PlanDetailView | 6 |
| PlanPrintView uses children pattern | Flexible content wrapping for print functionality | 6 |
| Single PlanDetailView rendering | Email section has print:hidden, no need for duplicate | 6 |
| Handlebars for template rendering | Lightweight, bundled TypeScript types, no @types needed | 7 |
| Template -> AI -> Fallback chain | Graceful degradation ensures email generation always succeeds | 7 |

## Blockers/Concerns

None currently.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 001 | Fix smoke test failures (logout, auth guard, special chars, timeouts, 500 errors) | 2026-01-28 | 913dae8 | [001-fix-smoke-test-failures](./quick/001-fix-smoke-test-failures/) |
| 260511-ohv | Health checks appear in Cases list: add type column to worker_cases, create case row on check completion, show View Report + Convert to Case buttons in cases list UI | 2026-05-11 | 10c34a8 | [260511-ohv-health-checks-appear-in-cases-list-add-t](./quick/260511-ohv-health-checks-appear-in-cases-list-add-t/) |

## Next Action

**Continue Phase 7:** Email Generation

Next steps:
1. Execute 07-03-PLAN.md (Phase 7 verification checkpoint — human verify EMAIL-01 to EMAIL-10)
2. Continue to Phase 8 (Approval Workflow)

Completed phases: 1, 2, 3, 4, 5, 6, 11
In progress: Phase 7 (Email Generation) - 2/3 plans complete

## Roadmap Evolution

- Phase 11 added: System-Wide Testing (2026-01-28)

## Session Notes

- 2026-01-25: Project initialized
- RTW Planner is currently a stub showing zeros
- Medical certificates already exist with structured data
- Job duties database needs to be built from scratch
- Physical demands matrix: Bending, Squatting, Kneeling, Twisting, Reaching, etc.
- Frequency levels: Never / Occasionally / Frequently / Constantly
- User has sample RTW plans in Google Drive (clients directory)
- Medical constraints come from latest medical certificate
- 2026-01-25: Phase 1 PLAN.md created - defines 8 new tables for RTW system
- 2026-01-26: Phase 1 EXECUTED - 8 RTW tables created, all migrations successful
- 2026-01-26: Phase 2 Wave 1 (02-01, 02-02) EXECUTED - Roles and Duties APIs complete
- 2026-01-26: Phase 2 Plan 03 EXECUTED - Roles UI pages (RolesList, RoleForm) complete
- 2026-01-28: Phase 11 Plan 01 EXECUTED - Test infrastructure (auth fixture, test data, wave-based scripts)
- 2026-01-28: Phase 11 Plan 02 EXECUTED - Smoke tests (health, auth, navigation with @smoke tags)
- 2026-01-28: Phase 11 Plan 03 EXECUTED - Critical path E2E tests (dashboard, case list, 7 case detail tabs)
- 2026-01-28: Phase 11 Plan 05 EXECUTED - Performance tests (API response times, page load times)
- 2026-01-28: Phase 11 Plan 06 EXECUTED - Database integrity tests, error handling E2E tests, recovery chart tests
- 2026-01-28: Phase 11 Plan 07 AUTO TASKS COMPLETE - Test report generator, npm scripts (checkpoint pending)
- 2026-01-28: Phase 2 Plan 04 previously EXECUTED - Duties UI pages (DutiesList, DutyForm, DemandMatrix)
- 2026-01-28: Phase 2 Plan 05 VERIFIED - Code inspection confirms all ADMIN-01 to ADMIN-12 requirements implemented
- 2026-01-28: Phase 3 Plan 01 EXECUTED - Schema update + restriction extractor service
- 2026-01-28: Phase 3 Plan 03 EXECUTED - CurrentRestrictionsPanel UI component + restrictionUtils helpers
- 2026-01-28: Phase 3 Plan 02 EXECUTED - Restriction mapper + current restrictions API endpoint
- 2026-01-28: Phase 4 Plan 01 EXECUTED - Core suitability calculator + modification suggester + 43 unit tests
- 2026-01-28: Phase 4 Plan 02 EXECUTED - Matrix API endpoint + suitabilityUtils display helpers
- 2026-01-28: Phase 4 Plan 03 EXECUTED - TRUE matrix UI component (duties as rows, demands as columns)
- 2026-01-28: Phase 5 Plan 01 EXECUTED - Plan generator + schedule calculator services + 53 unit tests
- 2026-01-28: Phase 5 Plan 03 EXECUTED - Plan Generator UI wizard + draft persistence + step components
- 2026-01-28: Phase 5 Plan 02 EXECUTED - RTW Plans API (recommend + create + get endpoints) + storage methods
- 2026-01-28: Phase 5 Plan 04 VERIFIED - 7/7 must-haves passed, all GEN-01 to GEN-10 implemented
- 2026-01-29: Phase 6 Plan 01 EXECUTED - Backend API (details, email endpoints) + rtwEmailService
- 2026-01-29: Phase 6 Plan 02 EXECUTED - Print CSS + 4 section components (Header, Constraints, Schedule, Duties)
- 2026-01-29: Phase 6 Plan 03 EXECUTED - PlanDetailView, ManagerEmailSection, PlanPrintView, PlanPage route
- 2026-01-29: Phase 6 Plan 04 VERIFIED - 9/9 must-haves passed, all OUT-01 to OUT-10 implemented
- 2026-01-29: Phase 6 COMPLETE - Plan Output with print/PDF/email features
- 2026-01-29: Phase 7 Plan 01 EXECUTED - Organization email templates with Handlebars
- 2026-03-06: Phase 7 Plan 02 EXECUTED - Send Email button + SMTP endpoint (EMAIL-10) — commit b05f100

## Session Continuity

Last session: 2026-03-06
Stopped at: Completed 07-02-PLAN.md — needs human verification (07-03)
Resume file: .planning/phases/07-email-generation/07-02-SUMMARY.md

---
*Last updated: 2026-03-06*
