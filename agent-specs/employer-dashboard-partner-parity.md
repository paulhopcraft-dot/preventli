# employer-dashboard-partner-parity

## Purpose

Bring the employer-role dashboard at `/` (currently `EmployerDashboardPage.tsx`) to **structural and visual parity** with the partner-role workspace at `/partner/clients` (currently `PartnerWorkspace.tsx`). Today they are different products with different layouts, data shapes, and feature surface area. Make the employer dashboard feel like a first-class peer of the partner workspace so single-tenant customers (e.g. Arc Electrical) get the same depth of capability the multi-tenant partner UI delivers.

**Context — why this is its own spec, deferred from `employer-onboarding-ux-polish`:** scope analysis on 2026-05-25 determined this is a 1.5–2 day rebuild, not a polish task. `PartnerWorkspace.tsx` is 798 lines with 8 tabs, partner-only API endpoints, JWT-swap mechanism for cross-org nav, and middleware-gated queries. Replicating its surface for a single-org user means new endpoints, new component architecture, and explicit teardown of the partner-tier coupling.

## Requirements

1. **Tab parity** — employer dashboard exposes the same 8 sections the partner dashboard does: Cases / Risk / RTW / Checks / Check-ins / Financials / Predictions / Audit. (Or an explicit subset, decided in grill-me.)
2. **Single-org scope** — no client picker; all data scoped to the user's own org via existing `organizationId` resolution.
3. **No JWT swap mechanism** — employer is already scoped; the partner workspace's `POST /api/partner/active-org` swap is partner-tier-only and must NOT leak.
4. **Visual chrome consistent** — same header layout, same tab pills, same case-table styling. Designer should treat the partner workspace as the reference implementation.
5. **No data regressions** — the existing employer endpoints (`/api/employer/dashboard`, `/api/employer/cases`, etc.) keep working; new endpoints added per tab where missing.
6. **Route stays `/`** — `RoleBasedDashboard.tsx` continues to fork on `user.role`, but the employer branch renders the new dashboard component.
7. **All 5 prereqs from `employer-onboarding-ux-polish` are shipped first** — this spec assumes that work has landed.

## Out of scope

- Changes to the partner workspace itself (this is one-way conformance — employer → partner pattern).
- Cross-tenant features (multi-org filtering, "Sign in as" flows). Those are partner-tier-exclusive.
- Backend rewrites where existing employer endpoints are sufficient — only add new endpoints per tab that don't have a single-org equivalent.
- Mobile/responsive overhaul beyond what the partner workspace already does.

## Code pointers

- `client/src/pages/PartnerWorkspace.tsx` — reference implementation, 798 lines, 8 tabs
- `client/src/pages/EmployerDashboardPage.tsx` — current employer dashboard, 472 lines, single-org
- `client/src/components/RoleBasedDashboard.tsx` — `/` route forks here on `user.role`
- `server/routes/employer-dashboard.ts` — single-org backend; new tab endpoints likely added here
- `server/routes/partner.ts` (or partner router file) — DO NOT mix into; partner-tier auth must stay isolated
- `shared/schema.ts:1756` — `organizations` table; employer's `organizationId` is the scope key

## Verification

- Side-by-side screenshots of employer-role-as-Jane and partner-role-as-`(partner-test-user)` show the same tab structure, same case-table chrome, same priority-actions panel.
- Visiting `/` as Jane shows the 8 tabs with employer-scoped data.
- Visiting `/partner/clients` as a partner user is unchanged.
- TypeScript scoped check: `npx tsc --noEmit 2>&1 | grep -cE "^(client/src/pages/EmployerDashboardPage|server/routes/employer-dashboard|client/src/components/RoleBasedDashboard)\.ts: error TS"` equals `0`.
- Existing E2E tests for the employer dashboard pass.

## Estimated effort

1.5–2 working days. Run in its own session via `/work --from-spec agent-specs/employer-dashboard-partner-parity.md`. Will likely need its own grill-me (which tabs to copy first, what to defer, how to handle data shape gaps).

## Closure

Logged-in as Jane: `/` renders the partner-equivalent dashboard scoped to Arc Electrical with all 8 tabs functional or explicitly-deferred. Partner workspace untouched. Onboarding video #1 was unblocked by `employer-onboarding-ux-polish` and is unrelated to this spec.
