# Auto-draft roles + case contacts seed fix — progress

Branch: `demo/wallara-seed`
Target: unblock `POST /api/cases/:id/auto-draft-rtw-plan` on the Wallara demo
(currently returns `{"skipped":true,"reason":"no_pre_injury_role"}`).

## Root cause
- `rtwAutoDrafter.resolveRoleId` reads `workerCases.preInjuryRoleOverrideId` →
  falls back to `workers.roleId`. Both were NULL on Wallara seed data.
- Wallara seed never inserted `rtwRoles` or `rtwDuties`/`rtwDutyDemands`, so
  even if a role was set the duty-suitability calculator would have no input.

## Fix (single commit)
1. Imported `rtwRoles`, `rtwDuties`, `rtwDutyDemands`, `caseContacts` into
   `server/seed-wallara.ts`.
2. Inserted 3 roles (DSW / Maintenance / Coordinator), 16 duties (5–6 per
   role with mixed physical-demand profiles), and matching duty demands rows.
3. Set `workers.roleId` for Sarah / Marcus / Priya and
   `workerCases.preInjuryRoleOverrideId` for the three cases — belt and braces
   so the orchestrator resolves a role via either lookup path.
4. Inserted 12 `caseContacts` rows (treating GP + specialist where indicated +
   physiotherapist for Marcus + case_manager + employer_primary) across
   multiple AU clinics with VIC phone format.
5. Extended FK-safe cleanup at top of `seedWallara()` to clear new tables:
   `caseContacts` (with existing case ids), `rtwDuties` (cascades to
   `rtwDutyDemands`), `rtwRoles`. Order ensures workers clear before roles
   (workers.roleId → rtw_roles.id has no cascade).

## TS check
`npx tsc --noEmit -p .` → no errors in `server/seed-wallara.ts`.

## Seed run + push
See terminal output recorded in commit message + final report.
