/**
 * Organisation visibility — one-way "GPNet-only" curtain.
 *
 * Background: `organizations.gpnetOnly` is a boolean. When true, the org and
 * its case data are invisible to admins whose home org is NOT gpnetOnly
 * (Preventli-side admins, e.g. Lisa). GPNet-side admins — admin users whose
 * home org IS gpnetOnly (e.g. Paul) — see everything. Non-admin users are
 * already tenant-scoped, so the flag is a no-op for them.
 *
 * Why home-org and not the active org: `req.user.organizationId` gets
 * overwritten to the active CLIENT org for partner-role users. The "Paul vs
 * Lisa" distinction lives on the persistent home org (`users.organizationId`),
 * never on the JWT-derived active org. The middleware resolves `homeOrgId`
 * and `homeOrgIsGpnetOnly` from the database, not from `req.user.organizationId`.
 *
 * Why a single named helper: the visibility decision lives in one place, so
 * new tables/queries can plug in without re-deriving the policy. The helper
 * name should appear ONLY at the storage/middleware boundary — never inside
 * `client/` or `server/routes/*.ts` (except `admin/organizations.ts`, which
 * is itself the visibility boundary for the org table).
 */

import { sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { UserRole } from "@shared/schema";
import type { AuthRequest } from "../middleware/auth";

export interface Viewer {
  userId: string;
  role: UserRole;
  /** Active org id — same as homeOrgId for non-partner roles. */
  organizationId: string;
  /** Persistent home org id, drawn from users.organizationId. */
  homeOrgId: string;
  /** Whether the viewer's home org has gpnetOnly=true. */
  homeOrgIsGpnetOnly: boolean;
}

/**
 * Build a Viewer from an authed request. Throws if req.user is missing —
 * callers should be downstream of `authorize()` which populates it.
 */
export function viewerFromRequest(req: AuthRequest): Viewer {
  if (!req.user) {
    throw new Error("viewerFromRequest called without an authed user — wire authorize() first");
  }
  return {
    userId: req.user.id,
    role: req.user.role,
    organizationId: req.user.organizationId,
    homeOrgId: req.user.homeOrgId ?? req.user.organizationId,
    homeOrgIsGpnetOnly: req.user.homeOrgIsGpnetOnly ?? false,
  };
}

/**
 * Returns true when the gpnetOnly curtain applies to this viewer.
 * Lisa-shape (admin in non-gpnetOnly home org) → true. Everyone else → false.
 */
export function shouldExcludeGpnetOnlyOrgs(viewer: Viewer): boolean {
  if (viewer.role !== "admin") return false;
  return viewer.homeOrgIsGpnetOnly === false;
}

/**
 * True for admin users whose home org is gpnetOnly. Used to gate writes that
 * could escalate visibility (e.g. flipping an org's gpnetOnly flag).
 */
export function isGpnetSideAdmin(viewer: Viewer): boolean {
  return viewer.role === "admin" && viewer.homeOrgIsGpnetOnly === true;
}

/**
 * Default the gpnetOnly flag when a new organisation is being created via the
 * admin API. Private-by-default for GPNet-side admins (Paul, the superuser):
 * onboard a client privately, opt-in to share with Preventli-side admins
 * later. Preventli-side creators are unaffected — the flag stays whatever they
 * sent (typically false / unset → false at the schema level).
 *
 * Pure function so the route handler stays a thin wrapper and the policy is
 * unit-testable in isolation. Pair with the privilege-escalation gate that
 * rejects `gpnetOnly=true` from non-GPNet-side admins.
 */
export function shouldDefaultGpnetOnly(
  submittedValue: boolean | undefined,
  isGpnetAdmin: boolean,
): boolean | undefined {
  if (submittedValue !== undefined) return submittedValue;
  if (isGpnetAdmin) return true;
  return undefined; // let the DB schema default (false) apply
}

/**
 * Returns a Drizzle SQL fragment that, when ANDed into a query's WHERE clause,
 * excludes rows whose `orgIdColumn` points to a gpnetOnly organisation.
 * Returns `undefined` when no exclusion is needed (so callers can omit the
 * predicate without conditional logic).
 *
 * Implementation: `NOT EXISTS (SELECT 1 FROM organizations WHERE id = <col>
 * AND gpnet_only = true)`. Uses a correlated subquery because gpnetOnly is
 * expected to be set on a tiny number of orgs in practice (1-3), so the
 * planner can use the organizations PK index efficiently.
 */
export function gpnetOnlyExclusionPredicate(
  viewer: Viewer,
  orgIdColumn: AnyPgColumn,
): SQL | undefined {
  if (!shouldExcludeGpnetOnlyOrgs(viewer)) return undefined;
  return sql`NOT EXISTS (SELECT 1 FROM organizations WHERE id = ${orgIdColumn} AND gpnet_only = true)`;
}
