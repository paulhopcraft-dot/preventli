# 1. Storage-layer visibility filter for gpnet-only orgs

Date: 2026-05-27
Status: Accepted

## Context

Preventli is a multi-tenant claims/RTW app. Internally it serves two groups of administrators:

- **GPNet-side admins** (e.g. Paul) — own the system, see everything.
- **Preventli-side admins** (e.g. Lisa) — partner team, see Preventli orgs only.

The existing `UserRole` taxonomy (`admin | employer | clinician | insurer | partner`) does not encode this distinction. Cross-tenant visibility is currently a single boolean — `req.user.role === 'admin'` toggles `organizationId` from "your org" to `undefined`, and storage methods receiving `undefined` skip the org filter entirely.

We needed to add a one-way curtain: certain orgs (e.g. the GPNet internal org) must be invisible to Preventli-side admins, while GPNet-side admins keep full cross-tenant visibility. The flag is `organizations.gpnetOnly`; default `false`. Paul flips it manually per org.

The open question was **where** to enforce the curtain.

## Decision

Enforce at the **storage layer** via a single named helper (`gpnetOnlyExclusionPredicate` in `server/lib/orgVisibility.ts`) that returns a Drizzle SQL fragment.

The helper takes a `Viewer` (`{userId, role, organizationId, homeOrgId, homeOrgIsGpnetOnly}`) and returns `undefined` when no exclusion applies, or a `NOT EXISTS` correlated subquery against `organizations.gpnet_only = true` otherwise. Callers AND it into their `where` clause.

The `Viewer` is built once in `authorize()` middleware. For admin-role requests the middleware reads `users.organizationId` + `organizations.gpnetOnly` from the database to derive `homeOrgIsGpnetOnly`. For non-admin requests the lookup is skipped (no visibility decision turns on the flag).

The helper is named `shouldExcludeGpnetOnlyOrgs` / `gpnetOnlyExclusionPredicate` and lives only at the storage/middleware boundary — `client/` and most of `server/routes/` import nothing from this module. `server/routes/admin/organizations.ts` is the one route that imports it directly, because *that* route's table IS organizations — there is no storage method to push the filter into.

## Alternatives considered

- **Route-layer enforcement** — every route in `server/routes/*.ts` calls the predicate before returning data. Rejected because new tables/queries can easily bypass the curtain; the surface area is too large to keep correct over time.
- **JWT-baked `homeOrgIsGpnetOnly`** — avoids the per-request DB lookup. Rejected because flipping an org to gpnetOnly would not take effect until every active session expired; cache invalidation is a separate engineering problem we don't need to take on.
- **New `super_admin` role in UserRole** — task brief said "don't invent new roles; use what's there." The home-org-flag approach uses the existing admin role.

## Consequences

**What this makes easy:**
- Adding a new table that is org-scoped: the developer just AND's `gpnetOnlyExclusionPredicate(viewer, table.organizationId)` into their storage query. The visibility decision is centralised.
- Auditing: `grep -r shouldExcludeGpnetOnlyOrgs` shows every place visibility decisions are made.
- Privilege-escalation defence: the same helper exposes `isGpnetSideAdmin(viewer)` which gates writes to the `gpnetOnly` field in `server/routes/admin/organizations.ts`. Without that gate, any admin could PUT `{ gpnetOnly: true }` on their own home org and promote themselves to GPNet-side. Closed.

**What this makes hard:**
- Per-user temporary overrides (e.g. Paul wants to grant Lisa one-off GPNet visibility): there's no mechanism. Would require a `users.gpnet_visibility_override` column or similar. Out of scope for v0.
- Reasoning about a query's visibility without looking up the storage method: visibility is implicit at the call site. Mitigated by the leak-proof grep audit.

**v0 boundary (what is filtered, what is not):**
- ✅ `getCases`, `getCasesPaginated` — the dashboard list path and 6 other authed call-sites in `server/routes.ts` (smart-actions, workspace/stats, ai/chat, ai/proactive-guidance, ai/intelligent-summary, compliance).
- ✅ `getGPNet2CaseByIdAdmin` — the admin-bypass path in `requireCaseOwnership`, which guards every `/api/cases/:id/*` subroute.
- ✅ `GET /api/admin/organizations` list + single + PUT (write gate) + DELETE + POST/DELETE logo.
- ❌ `/api/control/overview` aggregate counts — Lisa will see global totals that include hidden orgs' cases/users. Documented in [`.planning/work-gpnet-only-flag.md`](../../.planning/work-gpnet-only-flag.md) Out-of-scope. Future fix.
- ❌ `/api/agents/*` (Alex agent tools) — call `getCases` and various by-id methods directly. Alex tools generally run admin-scoped; if Lisa interacts with Alex she could surface gpnetOnly data. Future fix.
- ❌ Audit-event search, notification listing for admins, freshdesk sync — not user-facing for v0 use case.

**Invariant required for safety:**
gpnetOnly orgs must only contain admin users who are authorised for full cross-tenant visibility. Adding a regular employer/clinician to a gpnetOnly org does no harm (non-admins are tenant-scoped regardless), but adding a Preventli-side admin to a gpnetOnly org *would* promote them — operational discipline.

**Reissuing tokens:** flipping an org's flag takes effect on the next authed request (because the middleware does a fresh DB lookup per admin request). No token reissue needed.
