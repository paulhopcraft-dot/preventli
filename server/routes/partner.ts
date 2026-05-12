/**
 * Partner-tier routes — only partner-role users hit these.
 *
 *   GET    /api/partner/clients    → list of accessible client orgs
 *   POST   /api/partner/active-org → pick a client (mints new JWT)
 *   DELETE /api/partner/active-org → clear active client (back to picker)
 *   GET    /api/partner/me         → partner org + active org info for header
 *
 * See docs/DECISIONS.md (2026-05-04) and .planning/partner-tier/PLAN.md task B.
 */
import { Router, Response } from "express";
import { z } from "zod";
import { eq, and, count, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  partnerUserOrganizations,
  organizations,
  workerCases,
  users,
  insurers,
} from "@shared/schema";
import {
  createPartnerClientSchema,
  updatePartnerClientSchema,
} from "@shared/partnerClient";
import { authorize, type AuthRequest } from "../middleware/auth";
import { generateAccessToken, setAuthCookieExternal } from "../controllers/auth";
import { logger } from "../lib/logger";
import { logAuditEvent, AuditEventTypes, getRequestMetadata } from "../services/auditLogger";

const router = Router();

// All partner endpoints require the partner role.
const requirePartner = authorize(["partner"]);

/**
 * GET /api/partner/clients
 *
 * Returns the list of client organisations this partner user can act on,
 * with an open-case count for each. Used by the picker page sidebar.
 */
router.get("/clients", requirePartner, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    // Join access table with organizations to get name/logo.
    // Sorted alphabetically because partners with many clients (50+) need a
    // predictable scan order in the sidebar.
    const accessibleOrgs = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        logoUrl: organizations.logoUrl,
        kind: organizations.kind,
      })
      .from(partnerUserOrganizations)
      .innerJoin(
        organizations,
        eq(partnerUserOrganizations.organizationId, organizations.id),
      )
      .where(eq(partnerUserOrganizations.userId, userId))
      .orderBy(organizations.name);

    // Open case count per org. One query per org is acceptable — a partner
    // user typically has 1–20 clients, not thousands. If this grows, switch
    // to a single GROUP BY.
    const clientsWithCounts = await Promise.all(
      accessibleOrgs.map(async (org) => {
        const [{ n }] = await db
          .select({ n: count() })
          .from(workerCases)
          .where(
            and(
              eq(workerCases.organizationId, org.id),
              eq(workerCases.caseStatus, "open"),
            ),
          );
        return {
          id: org.id,
          name: org.name,
          logoUrl: org.logoUrl,
          openCaseCount: Number(n),
        };
      }),
    );

    res.json({ clients: clientsWithCounts });
  } catch (err) {
    logger.api.error("[partner] GET /clients failed", {}, err);
    res.status(500).json({ error: "Internal Server Error", message: "Failed to load clients" });
  }
});

/**
 * POST /api/partner/active-org { organizationId }
 *
 * Verifies the partner user has access to the requested organisation, then
 * mints a fresh JWT with activeOrganizationId set and returns it via cookie.
 */
const activeOrgSchema = z.object({
  organizationId: z.string().min(1),
});

router.post("/active-org", requirePartner, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = activeOrgSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "organizationId is required",
        details: parsed.error.flatten(),
      });
    }
    const { organizationId } = parsed.data;
    const userId = req.user!.id;

    // Verify access
    const access = await db
      .select({ orgId: partnerUserOrganizations.organizationId })
      .from(partnerUserOrganizations)
      .where(
        and(
          eq(partnerUserOrganizations.userId, userId),
          eq(partnerUserOrganizations.organizationId, organizationId),
        ),
      )
      .limit(1);

    if (access.length === 0) {
      return res.status(403).json({
        error: "Forbidden",
        message: "You do not have access to this organisation.",
      });
    }

    // Mint new access token with the active org set. The JWT.organizationId
    // field carries the active org so existing route filters Just Work.
    const accessToken = generateAccessToken(
      userId,
      req.user!.email,
      req.user!.role,
      organizationId, // organizationId in JWT = active org for partner
      organizationId, // activeOrganizationId in JWT = same (explicit "picked")
    );
    setAuthCookieExternal(res, accessToken);

    res.json({
      success: true,
      data: { activeOrganizationId: organizationId, accessToken },
    });
  } catch (err) {
    logger.api.error("[partner] POST /active-org failed", {}, err);
    res.status(500).json({ error: "Internal Server Error", message: "Failed to set active organisation" });
  }
});

/**
 * DELETE /api/partner/active-org
 *
 * Clears the active client (used by the "Switch client" link). Mints a fresh
 * JWT with activeOrganizationId=null and the user's home org back in
 * organizationId, so subsequent requests fall through to the picker.
 */
router.delete("/active-org", requirePartner, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;

    // Get the user's home org (workbetter.id) — currently req.user.organizationId
    // is the active org; we need the home org from the DB.
    const homeRow = await db
      .select({ orgId: users.organizationId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (homeRow.length === 0) {
      return res.status(401).json({ error: "Unauthorized", message: "User not found" });
    }
    const homeOrgId = homeRow[0].orgId;

    const accessToken = generateAccessToken(
      userId,
      req.user!.email,
      req.user!.role,
      homeOrgId,
      null, // cleared
    );
    setAuthCookieExternal(res, accessToken);

    res.json({ success: true, data: { activeOrganizationId: null } });
  } catch (err) {
    logger.api.error("[partner] DELETE /active-org failed", {}, err);
    res.status(500).json({ error: "Internal Server Error", message: "Failed to clear active organisation" });
  }
});

/**
 * GET /api/partner/me
 *
 * Returns header-relevant context: partner org info and active org info.
 * Used by the header component to render "{partnerName} | {activeName}".
 */
router.get("/me", requirePartner, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const activeOrgId = req.activeOrganizationId ?? null;

    // Home org (the partner org itself) — read from users.organizationId
    const homeRow = await db
      .select({ orgId: users.organizationId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (homeRow.length === 0) {
      return res.status(401).json({ error: "Unauthorized", message: "User not found" });
    }
    const partnerOrgId = homeRow[0].orgId;

    const partnerOrgRow = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        logoUrl: organizations.logoUrl,
        kind: organizations.kind,
      })
      .from(organizations)
      .where(eq(organizations.id, partnerOrgId))
      .limit(1);

    let activeOrg: { id: string; name: string; logoUrl: string | null } | null = null;
    if (activeOrgId && activeOrgId !== partnerOrgId) {
      const activeRow = await db
        .select({
          id: organizations.id,
          name: organizations.name,
          logoUrl: organizations.logoUrl,
        })
        .from(organizations)
        .where(eq(organizations.id, activeOrgId))
        .limit(1);
      if (activeRow.length > 0) {
        activeOrg = activeRow[0];
      }
    }

    res.json({
      partnerOrg: partnerOrgRow[0] ?? null,
      activeOrg,
    });
  } catch (err) {
    logger.api.error("[partner] GET /me failed", {}, err);
    res.status(500).json({ error: "Internal Server Error", message: "Failed to load partner context" });
  }
});

// ============================================
// Slice 2 — partner self-service client setup
// ============================================

/**
 * Build a kebab-case slug from a name; append -2, -3 ... on collision.
 * `organizations.slug` has a unique constraint, so race-induced collisions
 * become a 23505 unique-violation we treat as 409.
 */
async function generateUniqueSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "client";

  for (let suffix = 0; suffix < 25; suffix++) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const existing = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, candidate))
      .limit(1);
    if (existing.length === 0) return candidate;
  }
  // Fallback: timestamp suffix. Effectively unique.
  return `${base}-${Date.now()}`;
}

/**
 * Strip PII from an org row before sending to the audit log payload.
 * Keep name + state for forensic readability; drop emails / phones / notes.
 */
function auditSafeOrg(org: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  const piiKeys = new Set([
    "contactEmail",
    "contactPhone",
    "rtwCoordinatorEmail",
    "rtwCoordinatorPhone",
    "hrContactEmail",
    "hrContactPhone",
    "insurerClaimContactEmail",
    "notificationEmails",
    "notes",
  ]);
  for (const [k, v] of Object.entries(org)) {
    if (!piiKeys.has(k)) safe[k] = v;
  }
  return safe;
}

/**
 * POST /api/partner/clients
 *
 * Create a new client organisation (kind='employer'), and link it into
 * partner_user_organizations for the calling partner user. Audit logged.
 */
router.post("/clients", requirePartner, async (req: AuthRequest, res: Response) => {
  try {
    const parsed = createPartnerClientSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Invalid client data",
        details: parsed.error.flatten(),
      });
    }
    const userId = req.user!.id;
    const data = parsed.data;

    const slug = await generateUniqueSlug(data.name);

    // Single transaction: insert org + access row.
    const result = await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(organizations)
        .values({
          name: data.name,
          slug,
          kind: "employer",
          isActive: true,
          logoUrl: data.logoUrl ?? null,
          contactName: data.contactName ?? null,
          contactEmail: data.contactEmail ?? null,
          contactPhone: data.contactPhone ?? null,
          insurerId: data.insurerId ?? null,
          abn: data.abn ?? null,
          worksafeState: data.worksafeState ?? null,
          policyNumber: data.policyNumber ?? null,
          wicCode: data.wicCode ?? null,
          addressLine1: data.addressLine1 ?? null,
          addressLine2: data.addressLine2 ?? null,
          suburb: data.suburb ?? null,
          state: data.state ?? null,
          postcode: data.postcode ?? null,
          insurerClaimContactEmail: data.insurerClaimContactEmail ?? null,
          rtwCoordinatorName: data.rtwCoordinatorName ?? null,
          rtwCoordinatorEmail: data.rtwCoordinatorEmail ?? null,
          rtwCoordinatorPhone: data.rtwCoordinatorPhone ?? null,
          hrContactName: data.hrContactName ?? null,
          hrContactEmail: data.hrContactEmail ?? null,
          hrContactPhone: data.hrContactPhone ?? null,
          notificationEmails: data.notificationEmails ?? null,
          employeeCount: data.employeeCount ?? null,
          notes: data.notes ?? null,
        } as any)
        .returning();

      await tx.insert(partnerUserOrganizations).values({
        userId,
        organizationId: inserted.id,
        grantedBy: userId,
      } as any);

      return inserted;
    });

    const meta = getRequestMetadata(req);
    await logAuditEvent({
      userId,
      organizationId: result.id,
      eventType: AuditEventTypes.PARTNER_CLIENT_CREATED,
      resourceType: "organization",
      resourceId: result.id,
      metadata: { client: auditSafeOrg(result) },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    res.status(201).json({ client: result });
  } catch (err: unknown) {
    // Postgres unique-violation = 23505. Slug race produces this.
    const code = (err as { code?: string })?.code;
    if (code === "23505") {
      return res.status(409).json({ error: "Conflict", message: "Client slug already exists; try a different name." });
    }
    logger.api.error("[partner] POST /clients failed", {}, err);
    res.status(500).json({ error: "Internal Server Error", message: "Failed to create client" });
  }
});

/**
 * GET /api/partner/clients/:id
 *
 * Single client detail. Used by the edit form to pre-fill. Access-checked
 * against partner_user_organizations.
 */
router.get("/clients/:id", requirePartner, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;

    const access = await db
      .select({ orgId: partnerUserOrganizations.organizationId })
      .from(partnerUserOrganizations)
      .where(
        and(
          eq(partnerUserOrganizations.userId, userId),
          eq(partnerUserOrganizations.organizationId, id),
        ),
      )
      .limit(1);

    if (access.length === 0) {
      return res.status(403).json({ error: "Forbidden", message: "No access to this client." });
    }

    const rows = await db
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, id), eq(organizations.kind, "employer")))
      .limit(1);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Not Found", message: "Client not found." });
    }

    res.json({ client: rows[0] });
  } catch (err) {
    logger.api.error("[partner] GET /clients/:id failed", {}, err);
    res.status(500).json({ error: "Internal Server Error", message: "Failed to load client" });
  }
});

/**
 * PATCH /api/partner/clients/:id
 *
 * Partial update. Only fields present in the body are touched. Access-checked.
 */
router.patch("/clients/:id", requirePartner, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;

    const parsed = updatePartnerClientSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Invalid client data",
        details: parsed.error.flatten(),
      });
    }

    const access = await db
      .select({ orgId: partnerUserOrganizations.organizationId })
      .from(partnerUserOrganizations)
      .where(
        and(
          eq(partnerUserOrganizations.userId, userId),
          eq(partnerUserOrganizations.organizationId, id),
        ),
      )
      .limit(1);

    if (access.length === 0) {
      return res.status(403).json({ error: "Forbidden", message: "No access to this client." });
    }

    const existingRows = await db
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, id), eq(organizations.kind, "employer")))
      .limit(1);
    if (existingRows.length === 0) {
      return res.status(404).json({ error: "Not Found", message: "Client not found." });
    }
    const existing = existingRows[0];

    // Build the update set from defined fields only. Empty strings collapse
    // to null (the Zod transform on optional fields delivers `undefined` for
    // empty input, so `undefined` here means "not in the patch").
    const data = parsed.data;
    const updateSet: Record<string, unknown> = { updatedAt: new Date() };
    const fieldKeys = [
      "name",
      "logoUrl",
      "contactName",
      "contactEmail",
      "contactPhone",
      "insurerId",
      "abn",
      "worksafeState",
      "policyNumber",
      "wicCode",
      "addressLine1",
      "addressLine2",
      "suburb",
      "state",
      "postcode",
      "insurerClaimContactEmail",
      "rtwCoordinatorName",
      "rtwCoordinatorEmail",
      "rtwCoordinatorPhone",
      "hrContactName",
      "hrContactEmail",
      "hrContactPhone",
      "notificationEmails",
      "employeeCount",
      "notes",
    ] as const;
    const changedFields: string[] = [];
    for (const k of fieldKeys) {
      if (k in data && (data as Record<string, unknown>)[k] !== undefined) {
        updateSet[k] = (data as Record<string, unknown>)[k];
        if ((existing as Record<string, unknown>)[k] !== updateSet[k]) {
          changedFields.push(k);
        }
      }
    }

    const [updated] = await db
      .update(organizations)
      .set(updateSet)
      .where(eq(organizations.id, id))
      .returning();

    if (changedFields.length > 0) {
      const meta = getRequestMetadata(req);
      await logAuditEvent({
        userId,
        organizationId: id,
        eventType: AuditEventTypes.PARTNER_CLIENT_UPDATED,
        resourceType: "organization",
        resourceId: id,
        metadata: {
          changedFields,
          name: updated.name,
          state: updated.state,
        },
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
    }

    res.json({ client: updated });
  } catch (err) {
    logger.api.error("[partner] PATCH /clients/:id failed", {}, err);
    res.status(500).json({ error: "Internal Server Error", message: "Failed to update client" });
  }
});

/**
 * DELETE /api/partner/clients/:id
 *
 * Remove a client the calling partner user created. Blocked if the org has
 * any worker cases — prevents accidental data loss. Access-checked.
 */
router.delete("/clients/:id", requirePartner, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const id = req.params.id as string;

    // Access check.
    const access = await db
      .select({ orgId: partnerUserOrganizations.organizationId })
      .from(partnerUserOrganizations)
      .where(
        and(
          eq(partnerUserOrganizations.userId, userId),
          eq(partnerUserOrganizations.organizationId, id),
        ),
      )
      .limit(1);

    if (access.length === 0) {
      return res.status(403).json({ error: "Forbidden", message: "No access to this client." });
    }

    // Block deletion if there are any cases attached.
    const [{ n }] = await db
      .select({ n: count() })
      .from(workerCases)
      .where(eq(workerCases.organizationId, id));

    if (Number(n) > 0) {
      return res.status(409).json({
        error: "Conflict",
        message: `Cannot delete client with ${n} existing case(s). Archive cases first.`,
      });
    }

    // Remove the org record (cascades to partnerUserOrganizations via FK).
    await db.delete(organizations).where(eq(organizations.id, id));

    const meta = getRequestMetadata(req);
    await logAuditEvent({
      userId,
      organizationId: id,
      eventType: AuditEventTypes.PARTNER_CLIENT_UPDATED,
      resourceType: "organization",
      resourceId: id,
      metadata: { action: "deleted" },
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    res.status(204).send();
  } catch (err) {
    logger.api.error("[partner] DELETE /clients/:id failed", {}, err);
    res.status(500).json({ error: "Internal Server Error", message: "Failed to delete client" });
  }
});

/**
 * GET /api/partner/cases
 *
 * Cross-client cases list for the partner workspace. Returns every case
 * the calling partner user can see (joined across their accessible orgs).
 * Optional ?organizationId= filters to one org (after access check).
 *
 * Ordering: open cases first; then risk High > Medium > Low; then due date asc.
 * That's the rough "next action priority" — overdue high-risk surfaces top.
 */
router.get("/cases", requirePartner, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const filterOrgId = typeof req.query.organizationId === "string" ? req.query.organizationId : undefined;

    const accessRows = await db
      .select({ orgId: partnerUserOrganizations.organizationId })
      .from(partnerUserOrganizations)
      .where(eq(partnerUserOrganizations.userId, userId));
    const accessibleOrgIds = accessRows.map((r) => r.orgId);

    if (accessibleOrgIds.length === 0) {
      return res.json({ cases: [] });
    }

    if (filterOrgId && !accessibleOrgIds.includes(filterOrgId)) {
      return res.status(403).json({ error: "Forbidden", message: "No access to this client." });
    }

    const targetIds = filterOrgId ? [filterOrgId] : accessibleOrgIds;

    const rows = await db
      .select({
        id: workerCases.id,
        organizationId: workerCases.organizationId,
        organizationName: organizations.name,
        workerId: workerCases.workerId,
        workerName: workerCases.workerName,
        company: workerCases.company,
        riskLevel: workerCases.riskLevel,
        workStatus: workerCases.workStatus,
        // `summary` doubles as the injury / case-type description rendered in
        // the workspace cases table (column "Injury").
        summary: workerCases.summary,
        currentStatus: workerCases.currentStatus,
        nextStep: workerCases.nextStep,
        dueDate: workerCases.dueDate,
        caseStatus: workerCases.caseStatus,
      })
      .from(workerCases)
      .innerJoin(organizations, eq(workerCases.organizationId, organizations.id))
      .where(inArray(workerCases.organizationId, targetIds));

    const riskRank: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
    const sorted = rows.slice().sort((a, b) => {
      if (a.caseStatus !== b.caseStatus) return a.caseStatus === "open" ? -1 : 1;
      const r = (riskRank[a.riskLevel] ?? 99) - (riskRank[b.riskLevel] ?? 99);
      if (r !== 0) return r;
      return (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
    });

    res.json({ cases: sorted });
  } catch (err) {
    logger.api.error("[partner] GET /cases failed", {}, err);
    res.status(500).json({ error: "Internal Server Error", message: "Failed to load cases" });
  }
});

/**
 * GET /api/partner/insurers
 *
 * Active insurers list for the client setup form's insurer dropdown.
 * Partner-role users cannot reach /api/admin/insurers (admin-only),
 * so we expose a read-only slice here.
 */
router.get("/insurers", requirePartner, async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await db
      .select({ id: insurers.id, name: insurers.name, code: insurers.code })
      .from(insurers)
      .where(eq(insurers.isActive, true))
      .orderBy(insurers.name);
    res.json({ insurers: rows });
  } catch (err) {
    logger.api.error("[partner] GET /insurers failed", {}, err);
    res.status(500).json({ error: "Internal Server Error", message: "Failed to load insurers" });
  }
});

export default router;
