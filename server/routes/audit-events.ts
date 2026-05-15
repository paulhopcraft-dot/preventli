import { Router } from "express";
import { authorize } from "../middleware/auth";
import { db } from "../db";
import { auditEvents } from "@shared/schema";
import { and, eq, gte, like, or, desc, count, sql } from "drizzle-orm";
import { createLogger } from "../lib/logger";

const router = Router();
const logger = createLogger("AuditEvents");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  user: string;
  caseId: string;
  workerName: string;
  details: string;
  category: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a DB eventType to a human-readable action label.
 */
function eventTypeToAction(eventType: string): string {
  const map: Record<string, string> = {
    "user.login": "User Login",
    "user.logout": "User Logout",
    "user.password_change": "Password Changed",
    "user.password_change_failed": "Password Change Failed",
    "case.view": "Case Viewed",
    "case.list": "Case List Viewed",
    "case.create": "Case Created",
    "case.update": "Case Updated",
    "case.close": "Case Closed",
    "certificate.view": "Certificate Viewed",
    "certificate.create": "Certificate Created",
    "certificate.update": "Certificate Updated",
    "certificate.delete": "Certificate Deleted",
    "action.create": "Action Created",
    "action.update": "Action Updated",
    "action.complete": "Action Completed",
    "termination.create": "Termination Process Started",
    "termination.update": "Termination Process Updated",
    "termination.complete": "Termination Process Completed",
    "ai.summary.generate": "AI Summary Generated",
    "ai.email_draft.generate": "AI Email Draft Generated",
    "webhook.received": "Webhook Received",
    "invite.create": "Invite Created",
    "invite.accept": "Invite Accepted",
    "contact.create": "Contact Created",
    "contact.update": "Contact Updated",
    "access.denied": "Access Denied",
    "compliance.dashboard.view": "Compliance Dashboard Viewed",
    "compliance.dashboard.error": "Compliance Dashboard Error",
    "partner_client_switch": "Client Context Switched",
    "partner_client_list": "Client List Viewed",
  };
  return map[eventType] ?? eventType.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Derive a UI category from the eventType prefix.
 * Must match the category values used in AuditLogPage.tsx.
 */
function eventTypeToCategory(eventType: string): string {
  if (eventType.startsWith("ai.")) return "ai";
  if (eventType.startsWith("compliance.")) return "compliance";
  if (eventType.startsWith("case.") || eventType.startsWith("certificate.") || eventType.startsWith("action.") || eventType.startsWith("termination.")) return "case";
  return "status";
}

/**
 * Resolve a human-readable detail string from DB row fields.
 */
function buildDetails(
  eventType: string,
  resourceType: string | null,
  resourceId: string | null,
  metadata: Record<string, unknown> | null
): string {
  if (metadata?.details && typeof metadata.details === "string") return metadata.details;
  const parts: string[] = [];
  if (resourceType) parts.push(resourceType);
  if (resourceId) parts.push(`#${resourceId}`);
  return parts.join(" ") || eventType;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/audit-events
 * Returns audit log entries for the current user's organisation.
 *
 * Query params:
 *   limit      - max rows (default 100, max 500)
 *   offset     - skip N rows (default 0)
 *   category   - filter: all | case | status | ai | compliance
 *   dateFrom   - ISO date string; only entries at or after this timestamp
 *   search     - free-text search on eventType / resourceId / metadata fields
 */
router.get("/", authorize(), async (req, res) => {
  try {
    const { organizationId, id: userId } = req.user!;

    const rawLimit = parseInt(req.query.limit as string, 10);
    const rawOffset = parseInt(req.query.offset as string, 10);
    const limit = isNaN(rawLimit) ? 100 : Math.min(rawLimit, 500);
    const offset = isNaN(rawOffset) ? 0 : Math.max(rawOffset, 0);
    const category = (req.query.category as string) || "all";
    const dateFrom = req.query.dateFrom as string | undefined;
    const search = req.query.search as string | undefined;

    // Build WHERE conditions
    const conditions = [eq(auditEvents.organisationId, organizationId)];

    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      if (!isNaN(fromDate.getTime())) {
        conditions.push(gte(auditEvents.timestamp, fromDate));
      }
    }

    if (category && category !== "all") {
      // Map UI category to eventType prefix patterns
      const prefixes: Record<string, string[]> = {
        ai: ["ai."],
        compliance: ["compliance."],
        case: ["case.", "certificate.", "action.", "termination."],
        status: [], // handled below as "everything else"
      };

      const matchPrefixes = prefixes[category];
      if (matchPrefixes && matchPrefixes.length > 0) {
        // Drizzle doesn't have an "OR LIKE" shorthand — build raw SQL
        const likeConditions = matchPrefixes
          .map((p) => sql`${auditEvents.eventType} LIKE ${p + "%"}`)
          .reduce((acc, cond) => sql`${acc} OR ${cond}`);
        conditions.push(sql`(${likeConditions})`);
      } else if (category === "status") {
        // status = everything NOT in the other prefixes
        conditions.push(
          sql`${auditEvents.eventType} NOT LIKE ${"ai.%"} AND ${auditEvents.eventType} NOT LIKE ${"compliance.%"} AND ${auditEvents.eventType} NOT LIKE ${"case.%"} AND ${auditEvents.eventType} NOT LIKE ${"certificate.%"} AND ${auditEvents.eventType} NOT LIKE ${"action.%"} AND ${auditEvents.eventType} NOT LIKE ${"termination.%"}`
        );
      }
    }

    if (search && search.trim()) {
      const pattern = `%${search.trim().toLowerCase()}%`;
      conditions.push(
        sql`(LOWER(${auditEvents.eventType}) LIKE ${pattern} OR LOWER(COALESCE(${auditEvents.resourceId}, '')) LIKE ${pattern} OR LOWER(COALESCE(${auditEvents.resourceType}, '')) LIKE ${pattern} OR LOWER(COALESCE(${auditEvents.metadata}::text, '')) LIKE ${pattern})`
      );
    }

    const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

    // Execute query + count in parallel
    const [rows, countResult] = await Promise.all([
      db
        .select()
        .from(auditEvents)
        .where(whereClause)
        .orderBy(desc(auditEvents.timestamp))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(auditEvents)
        .where(whereClause),
    ]);

    const total = countResult[0]?.total ?? 0;

    const entries: AuditEntry[] = rows.map((row) => {
      const meta = (row.metadata as Record<string, unknown> | null) ?? null;
      const category = eventTypeToCategory(row.eventType);
      const action = eventTypeToAction(row.eventType);

      // workerName may be embedded in metadata by the audit logger
      const workerName =
        (meta?.workerName as string | undefined) ??
        (meta?.caseName as string | undefined) ??
        row.resourceId ??
        "";

      const details = buildDetails(row.eventType, row.resourceType, row.resourceId, meta);

      return {
        id: row.id,
        timestamp: row.timestamp.toISOString(),
        action,
        user: row.userId ?? "system",
        caseId: row.resourceId ?? "",
        workerName,
        details,
        category,
      };
    });

    logger.info(`Fetched ${entries.length} audit entries (total: ${total})`, {
      organizationId,
      userId,
      category,
      search,
    });

    res.json({ entries, total });
  } catch (error) {
    logger.error("Error fetching audit events:", undefined, error);
    res.status(500).json({ error: "Failed to retrieve audit events" });
  }
});

export default router;
