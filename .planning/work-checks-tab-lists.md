# /work — Health Check tab lists + type filtering

**Slug:** checks-tab-lists
**Friction:** non-trivial
**Council:** architect + critic + code-reviewer — all SHIP-WITH-FIXES (fixes folded below)

## Goal
Give the Prevention / Injury / Wellness / Mental Health / Exit tabs of the Health
Checks page real, type-filtered, DB-backed assessment lists like Pre-Employment has,
and fix `/api/assessments` so each tab shows only its own check category.

## Root cause
`GET /api/assessments` returns ALL of the org's assessments, no category filter.
ChecksPage's Pre-Employment tab renders that full list; the other 5 tabs render
hard-coded mock objects (ChecksPage.tsx L162-166) and never call the API. New
assessments store the check category in `preEmploymentAssessments.assessmentType`
(`prevention`/`injury`/`wellness`/`mental_health`/`exit`; `pre_employment` →
`baseline_health`). Legacy pre-employment rows use the 6 clinical enum values.

## Approach (surgical) — council fixes folded in

### 1. shared/check-categories.ts (NEW) — single source of truth
- `CHECK_CATEGORIES` (6, snake_case `as const`), `CheckCategory` type, `CHECK_LABELS`.
- `assessmentTypesForCategory(category)`: `pre_employment` → 6 clinical values;
  other 5 → `[category]`.
- **[council] REPLACES the duplicate constants** at `server/routes/assessments.ts`
  L15-25 — those become imports. `NewAssessmentPage.tsx` `CHECK_META` keeps its
  UI-copy but its category type/list derives from this file. No 4th definition.

### 2. server/routes/assessments.ts — `GET /` category filter
- Read `req.query.category`. **[council] Zod-validate** `z.enum(CHECK_CATEGORIES)`:
  absent → return all (backward compat); present+valid → filter; present+invalid →
  `400 {error}`. No silent unfiltered fallback on a bad value.
- Filter the org's assessments in-handler by `assessmentTypesForCategory(category)`
  before response mapping. In-memory (storage already fetches all org rows; zero
  extra DB cost at current scale). No storage-signature change, no migration.

### 3. shared/schema.ts — honest type
- Expand the assessment-type union to include the 5 category names.
  **[council] rename** `PreEmploymentAssessmentType` → `AssessmentType` (keep a
  `PreEmploymentAssessmentType` alias if other importers exist — check at code time).
  `assessment_type` is `text()` — type-only change, no migration.

### 4. client/src/pages/NewAssessmentPage.tsx — cache invalidation [council CRITICAL]
- After create-success AND send-success, `queryClient.invalidateQueries({ queryKey:
  ["assessments"] })`. Pre-existing latent bug: `staleTime: Infinity` (queryClient.ts
  L264) + no invalidation means a freshly created check is invisible on return to
  /checks. Load-bearing for the goal — fixed here, not deferred.

### 5. client/src/pages/ChecksPage.tsx — real lists for all 6 tabs
- Define a client-side `CategoryConfig` (per category: card title/description,
  stat-card defs, empty-state copy, `New Assessment` link, `showAttentionPanel`).
- Extract `AssessmentList` component: props `{ category }`. Does
  `useQuery(["assessments", category], fetch("/api/assessments?category="+category))`.
  Renders search box + list rows + status badges. **[council] passes the snake_case
  API category** — NOT the tab value.
- **[council] kebab/snake fix**: tab `value`s become snake_case (`pre_employment`,
  `mental_health`) so `activeTab` == API category. (Or a `tabToCategory` map — tab
  rename is cleaner.)
- **[council] drop `.slice(0,5)`** — every tab shows the FULL list, newest first.
  Drop the PE-only `completed+cleared` exclusion from the shared list (show all).
- **[council] PE-only stays PE-only**: the amber "Attention Required" panel
  (L248-279, needs `/api/workers`) renders only when `config.showAttentionPanel`.
- **[council] parameterize the report-modal title** (L671 hardcodes "Pre-Employment
  Health Report") by category via `CHECK_LABELS`.
- Delete mock objects L162-166; stat cards show real derived counts
  (Total / Sent / Completed / In-progress) computed from the fetched list. Fake
  un-derivable metrics (overdue/critical/flagged) are removed — honest zeros beat
  fake numbers (that was the user's complaint).

## Files
- `shared/check-categories.ts` — new
- `shared/schema.ts` — type union expand + rename
- `server/routes/assessments.ts` — `GET /` category filter + import shared constants
- `client/src/pages/NewAssessmentPage.tsx` — invalidate `["assessments"]` on create/send
- `client/src/pages/ChecksPage.tsx` — extract `AssessmentList`, `CategoryConfig`, wire 6 tabs, kill mock data

## Decision — no ADR (fails 3-criteria gate: reversible)
Mapping layer, NOT a new `checkCategory` DB column. New records already store the
category in `assessmentType`; a column+backfill is a prod migration with rollback
risk for zero functional gain. Fully reversible.

## Verify criterion (deterministic shell script)
- `assessmentTypesForCategory` exported from `shared/check-categories.ts`
- `server/routes/assessments.ts` handles + Zod-validates `category`; imports shared constants (no local `CHECK_CATEGORIES` literal)
- `ChecksPage.tsx` no longer contains mock literals `total: 45` / `total: 67` / `total: 23`; references `AssessmentList`
- `NewAssessmentPage.tsx` calls `invalidateQueries` with an `assessments` key
- tab `value`s are snake_case (no `value="mental-health"`)
- scoped `tsc` on changed dirs = 0 NEW errors

## Test plan
- `npm run build` — TS check passes
- `npm test` — full suite green
- **NEW unit test**: `assessmentTypesForCategory` (pure fn) — all 6 categories
- **NEW route integration test** (council): seed assessments of 2+ types, assert
  `GET /api/assessments?category=prevention` returns only prevention, `?category=
  pre_employment` returns only clinical types, invalid category → 400
- Browser verify (YELLOW — needs deploy): ABC → Checks → Prevention shows Marcus
  Webb; Pre-Employment no longer shows him

## Estimate
- Backend (shared file, route filter+Zod, schema type, consolidate constants): ~1.25h
- Frontend (NewAssessmentPage invalidation; ChecksPage extract+CategoryConfig+wire 6 tabs+modal title): ~2.5h
- Tests (unit + route integration) + verify script: ~1h
- Manual/browser verification: ~0.25h (post-deploy)
- Verify-script iterations: 1-2
- Schedule risks: (1) ChecksPage is ~660 lines — the `AssessmentList` extraction +
  `CategoryConfig` is the bulk and the riskiest; (2) the `AssessmentType` rename may
  ripple to importers — alias mitigates.
