# Check Types Audit — 2026-05-15

## Result: All 6 check types are present in both schema and UI. No code changes required.

---

## Audit Table

| # | Check Type | Schema / Enum | UI Surface (ChecksPage tab) | Dashboard Card | Status |
|---|-----------|---------------|----------------------------|---------------|--------|
| 1 | Pre-employment | `TelehealthServiceType: "pre_employment"` + `preEmploymentAssessments` table | `pre-employment` tab — live data from `/api/assessments` | "Pending Pre-Employment Assessments" (EmployerDashboardPage) | PRESENT |
| 2 | Prevention check | `LifecycleDashboard.prevention` stage; mapped via `telehealthBookings.serviceType` (no dedicated enum value, modelled as a lifecycle stage) | `prevention` tab — static placeholder stats | No dedicated dashboard card | PRESENT (placeholder UI) |
| 3 | Injury check | `worker_cases` table (injury cases have `claimNumber` populated); `TelehealthServiceType: "injury"` | `injury` tab — links to `/cases` | Active cases drive the main RTW dashboard | PRESENT |
| 4 | Wellness check | `LifecycleDashboard.wellbeing` stage; `TelehealthServiceType: "wellbeing"` | `wellness` tab — static placeholder stats | No dedicated dashboard card | PRESENT (placeholder UI) |
| 5 | Mental health check | `TelehealthServiceType: "mental_health"` | `mental-health` tab — static placeholder stats | No dedicated dashboard card | PRESENT (placeholder UI) |
| 6 | Exit health check | `TelehealthServiceType: "exit"` | `exit` tab — live data from `/api/bookings` filtered to `serviceType="exit"` | "Exit Interviews & Pre-Employment" (EmployerDashboardPage) | PRESENT |

---

## The 6th Check Type

The 6th type is **Exit health check** (`serviceType: "exit"`). It is the final health assessment
conducted when an employee leaves, covering exit documentation, liability closure, and health record
archival. It maps directly to the `TelehealthServiceType` schema value `"exit"` and is surfaced both
in the Checks page exit tab and the dashboard "Exit Interviews & Pre-Employment" card.

---

## Schema Sources

- **`shared/schema.ts:2580`** — `TelehealthServiceType = "pre_employment" | "injury" | "mental_health" | "exit" | "wellbeing"`
- **`shared/schema.ts:2267`** — `PreEmploymentAssessmentType` (sub-types for pre-employment: baseline_health, functional_capacity, medical_screening, fitness_for_duty, psychological_assessment, substance_screening)
- **`shared/schema.ts:2284`** — `preEmploymentAssessments` table
- **`shared/schema.ts:2584`** — `telehealthBookings` table

## UI Sources

- **`client/src/pages/ChecksPage.tsx`** — 6-tab layout (`pre-employment`, `prevention`, `injury`, `wellness`, `mental-health`, `exit`). Pre-employment and exit tabs use live API data; prevention, injury (links out), wellness, and mental-health tabs show placeholder stats.
- **`client/src/pages/EmployerDashboardPage.tsx:441`** — "Exit Interviews & Pre-Employment" card (live bookings filtered to `exit` + `pre_employment`)
- **`client/src/pages/EmployerDashboardPage.tsx:502`** — "Pending Pre-Employment Assessments" card (live assessments with `status=in_progress`)
- **`client/src/pages/LifecycleDashboard.tsx`** — lifecycle view with prevention, wellbeing, injury, exit stages

## Notes

- Prevention, wellness, and mental health tabs use hardcoded placeholder statistics (not live API data).
  This is known/acceptable for the demo build; no API endpoints yet exist for these check types.
- The `TelehealthServiceType` uses `"wellbeing"` (not `"wellness"`) in the schema but the UI tab says
  "Wellness" — they refer to the same concept. No mismatch in practice.
- Injury checks are not tracked as a separate telehealth booking type; instead they drive `worker_cases`
  records. The Checks page Injury tab links to the existing RTW/cases workflow.
