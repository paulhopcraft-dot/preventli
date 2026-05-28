# gpnet-only visibility flag — Plan (post-council, revised)

## Goal
Org-level boolean `gpnetOnly`. When true, the org + its cases (list + by-id) are invisible to Preventli-side admins (e.g. Lisa). GPNet-side users (admin in a gpnetOnly home org, including Paul) see everything. Non-admin users tenant-scoped — flag is a no-op for them.

## Role-taxonomy decoding (orientation finding)
Existing `UserRole`: `admin | employer | clinician | insurer | partner`. No GPNet/Preventli role. Split rides on **viewer's HOME-org `gpnetOnly` flag**:

| Viewer | Home-org gpnetOnly? | Visibility |
|---|---|---|
| `admin` | `true` (GPNet org, Paul) | All orgs |
| `admin` | `false` (Preventli org, Lisa) | Non-gpnetOnly orgs only |
| non-admin | any | Their own org (existing tenant scope) |
| `partner` | any | Active client scope — no extra filter |

**Critical**: home-org = `users.organizationId` resolved by `decoded.id`. For partner-role users `req.user.organizationId` gets overwritten to the active client org — so the lookup must go to the `users` table fresh, never lean on `req.user.organizationId`.

## Council-driven additions (vs v0 plan)
1. Gate `getCasesPaginated` AND `getCases` (dashboard uses Paginated — primary leak surface)
2. Gate `requireCaseOwnership` admin bypass at `caseOwnership.ts:57` — closes case-by-id leak for all `/api/cases/:id/*` subroutes (14+ agent-tool callsites inherit)
3. Gate `GET /api/admin/organizations` list — Lisa shouldn't see gpnetOnly org names/contacts
4. **Privilege-escalation gate** on PUT `/api/admin/organizations/:id` — only viewers with `homeOrgIsGpnetOnly === true` can write the `gpnetOnly` field. Prevents Lisa self-promoting by flipping her own org to gpnetOnly.
5. Skip home-org lookup when `role !== 'admin'` (perf — 95%+ of requests)
6. Add behavioural test asserting the predicate's SQL fragment shape (not just bool policy)

## Files to touch
| File | Change |
|---|---|
| `shared/schema.ts` | Add `gpnetOnly: boolean("gpnet_only").notNull().default(false)` to `organizations` |
| `server/lib/orgVisibility.ts` | NEW — `Viewer` type, `shouldExcludeGpnetOnlyOrgs`, `gpnetOnlyExclusionPredicate(orgIdColumn)` |
| `server/lib/orgVisibility.test.ts` | NEW — vitest unit tests (policy + predicate fragment shape) |
| `server/middleware/auth.ts` | Lookup `homeOrgIsGpnetOnly` from `users`+`organizations` join keyed on `decoded.id` (admin only); attach to `req.user` |
| `server/middleware/caseOwnership.ts` | Apply predicate in admin-bypass branch — block case access when viewer Preventli-side admin AND case org is gpnetOnly |
| `server/storage.ts` | Apply predicate to `getCases` AND `getCasesPaginated`. Signatures gain a `Viewer` (admin overload). |
| `server/routes.ts` | Plumb `viewer` into the 2 call-sites of `getCasesPaginated`/`getCases` updated in v0 |
| `server/routes/admin/organizations.ts` | GET list — apply predicate. GET single — apply predicate (404 if hidden). PUT — gate the `gpnetOnly` field write to viewer.homeOrgIsGpnetOnly===true. Surface field in GET response. |
| `client/src/pages/admin/CompanyForm.tsx` | Add Switch for `gpnetOnly`; render only when viewer is GPNet-side admin |
| `docs/adr/0001-storage-layer-visibility-filter.md` | NEW — ADR with consequences + v0 boundary + future-work list |
| `~/.claude/verify/gpnet-only-flag.sh` | Verify script |

## Approach
- **Schema first.** Additive column, default false, `npm run db:push`.
- **Pure helper** (`orgVisibility.ts`):
  ```ts
  export type Viewer = {
    userId: string;
    role: UserRole;
    organizationId: string;           // active org id
    homeOrgId: string;                // persistent home org (= users.organizationId)
    homeOrgIsGpnetOnly: boolean;
  };
  export function shouldExcludeGpnetOnlyOrgs(viewer: Viewer): boolean;
  export function gpnetOnlyExclusionPredicate(
    viewer: Viewer,
    orgIdColumn: AnyPgColumn
  ): SQL | undefined;
  export function isGpnetSideAdmin(viewer: Viewer): boolean;
  ```
  Predicate uses `NOT EXISTS (SELECT 1 FROM organizations WHERE id = <col> AND gpnet_only = true)` — parameterised over the orgId column.
- **Middleware.** After `authorize()` runs, if `decoded.role === 'admin'`: SELECT `organizationId` from users where id = decoded.id, then SELECT `gpnetOnly` from organizations where id = ... . Attach `req.user.homeOrgIsGpnetOnly` + `req.user.homeOrgId`. Non-admin path: skip lookup entirely, leave fields undefined (predicate treats undefined as "no exclusion").
- **Storage.** `getCases` + `getCasesPaginated` accept a `Viewer` alongside `organizationId, isAdmin`. Internally call `gpnetOnlyExclusionPredicate` and AND into the where clause when defined.
- **caseOwnership middleware.** In the `user.role === 'admin'` branch, after the `getGPNet2CaseByIdAdmin` fetch, if the returned case's `organizationId` belongs to a gpnetOnly org AND `req.user.homeOrgIsGpnetOnly !== true` → 403.
- **Admin org route.** GET list applies the predicate. GET single returns 404 if hidden (don't leak existence). PUT body validation: if `data.gpnetOnly` is in the diff AND `req.user.homeOrgIsGpnetOnly !== true` → 403.
- **UI.** Switch rendered only when `currentUser.homeOrgIsGpnetOnly === true`. Backend gate is the source of truth — UI hide is UX, not security.

## Verify criterion (deterministic shell script)
1. `shared/schema.ts` contains `gpnetOnly: boolean("gpnet_only")` in `organizations`
2. `server/lib/orgVisibility.ts` exists, exports `Viewer`, `shouldExcludeGpnetOnlyOrgs`, `gpnetOnlyExclusionPredicate`, `isGpnetSideAdmin`
3. `server/lib/orgVisibility.test.ts` exists
4. `shouldExcludeGpnetOnlyOrgs` name appears ONLY in `server/lib/orgVisibility.*`, `server/storage.ts`, `server/middleware/auth.ts`, `server/middleware/caseOwnership.ts`, `server/routes/admin/organizations.ts` — `grep -r` against `client/` and other `server/routes/*` returns 0 (leak-proof)
5. `client/src/pages/admin/CompanyForm.tsx` references `gpnetOnly`
6. `server/middleware/caseOwnership.ts` calls into the helper module
7. `server/routes/admin/organizations.ts` rejects `gpnetOnly` PUTs from non-gpnet-side viewers (grep for the gate)
8. `docs/adr/0001-storage-layer-visibility-filter.md` exists with `## Consequences` section
9. `npm test -- orgVisibility` passes
10. Scoped tsc clean for changed files

## Test plan
- **Unit (new):** `orgVisibility.test.ts` covers:
  1. `shouldExcludeGpnetOnlyOrgs` — 4 viewer permutations (admin×gpnet, admin×non-gpnet, employer×*, partner×*)
  2. `gpnetOnlyExclusionPredicate` returns `undefined` for Paul/non-admin; returns a non-null SQL fragment for Lisa
  3. `isGpnetSideAdmin` — true for admin+homeOrgIsGpnetOnly; false otherwise (used for the PUT gate)
- **Smoke:** `npm test` for regressions
- **Behavioural assertion** (lightweight): inspect the predicate's SQL fragment via Drizzle's `getSQL().sql` and assert it contains the gpnet_only literal + parameterised orgId. Closes code-reviewer's "structural-only verify" gap without standing up a test DB.

## Estimate (active hours, revised)
- Schema + db:push: 15 min
- Helper module + tests (incl. SQL fragment test): 50 min
- Middleware extension (admin-only DB lookup, partner-aware home-org): 35 min
- caseOwnership middleware gate: 20 min
- `getCases` + `getCasesPaginated` predicate wiring: 35 min
- Admin org route: list filter + PUT escalation gate + single GET 404: 35 min
- UI Switch + visibility gate: 25 min
- ADR write: 30 min
- Verify script + iteration buffer: 35 min

**Total: ~4:20 active.** Within 5h budget. Tight buffer — anything unexpected and I stop and surface.

## Schedule risks
1. Drizzle `db:push` drift (worktree 4 commits behind origin/main — within tolerance)
2. caseOwnership middleware refactor surface — touches a hot path; need careful test to not regress non-admin flows

## ADR? Yes
**Hard-to-reverse:** changing visibility layer later means re-auditing every storage call. **Surprising:** most apps filter at the route. **Real trade-off:** storage-layer leak-proof but every caller must use the helper; route-layer leaky-by-default but trivial per-route. We pick storage. ADR documents the trade-off, the v0 boundary, and the limitations (no per-user temp visibility, control-tower not yet scoped).

## Out of scope (explicit, council-confirmed)
- Trusted-sender registry, parent_tenant_id, admin triage UI, IMAP poller, data migration
- `/api/control/overview` count-scoping (separate small fix — Lisa sees inflated aggregate counts)
- The 7+ other `req.user!.role === 'admin' ? undefined` route patterns in `server/routes.ts` (smart-actions, workspace/stats, ai/chat, etc.) — gradual rollout per route owner; v0 closes the user-visible dashboard list + by-id paths
- Per-user temporary GPNet visibility (would need a separate `users.gpnet_visibility_override` mechanism — ADR notes the limitation)
- JWT caching of home-org gpnetOnly (defer; per-request lookup is admin-only and cheap)
