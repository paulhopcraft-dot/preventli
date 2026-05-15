import { db } from "../db";
import { auditEvents } from "@shared/schema";
import type { Request } from "express";
import { logger } from "../lib/logger";

/**
 * Audit Event Types - Comprehensive list of security and operational events
 * to be logged for compliance and forensics.
 */
export const AuditEventTypes = {
  // Authentication events
  USER_LOGIN: "user.login",
  USER_LOGOUT: "user.logout",
  USER_REGISTER: "user.register",
  LOGIN_FAILED: "user.login_failed",

  // Case operations
  CASE_VIEW: "case.view",
  CASE_LIST: "case.list",
  CASE_CREATE: "case.create",
  CASE_UPDATE: "case.update",

  // AI operations
  AI_SUMMARY_GENERATE: "ai.summary.generate",
  AI_EMAIL_DRAFT: "ai.email_draft.generate",

  // Certificate operations
  CERTIFICATE_CREATE: "certificate.create",
  CERTIFICATE_UPDATE: "certificate.update",
  CERTIFICATE_DELETE: "certificate.delete",

  // Action operations
  ACTION_CREATE: "action.create",
  ACTION_UPDATE: "action.update",
  ACTION_COMPLETE: "action.complete",

  // Termination workflow
  TERMINATION_START: "termination.start",
  TERMINATION_STEP: "termination.step",
  TERMINATION_COMPLETE: "termination.complete",

  // Webhooks
  WEBHOOK_RECEIVED: "webhook.received",
  WEBHOOK_PROCESSED: "webhook.processed",
  WEBHOOK_FAILED: "webhook.failed",

  // Invites
  INVITE_CREATED: "invite.created",
  INVITE_ACCEPTED: "invite.accepted",

  // Contact operations
  CONTACT_CREATED: "contact.created",
  CONTACT_UPDATED: "contact.updated",
  CONTACT_DELETED: "contact.deleted",

  // Authorization - CRITICAL for security monitoring
  ACCESS_DENIED: "access.denied",

  // Compliance dashboard
  COMPLIANCE_DASHBOARD_VIEW: "compliance.dashboard.view",
  COMPLIANCE_DASHBOARD_ERROR: "compliance.dashboard.error",

  // Partner-tier client management (slice 2)
  PARTNER_CLIENT_CREATED: "partner_client_created",
  PARTNER_CLIENT_UPDATED: "partner_client_updated",
  PARTNER_CLIENT_REMOVED: "partner_client_removed",
  PARTNER_SELF_UPDATED: "partner_self_updated",

  // Password management
  USER_PASSWORD_CHANGE: "user.password_change",
  USER_PASSWORD_CHANGE_FAILED: "user.password_change_failed",

  // RTW Auto-Draft
  RTW_AUTO_DRAFT_CREATED: "rtw_plan.auto_draft.created",
  RTW_AUTO_DRAFT_SKIPPED: "rtw_plan.auto_draft.skipped",
} as const;

export type AuditEventType = typeof AuditEventTypes[keyof typeof AuditEventTypes];

interface AuditLogParams {
  userId: string | null;
  organizationId: string | null;
  eventType: AuditEventType;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Log an audit event for security, compliance, and forensics.
 *
 * IMPORTANT: This function NEVER throws errors - audit logging failures are
 * logged to console but don't block the main operation. This ensures that
 * audit logging problems don't bring down the application.
 *
 * @param params - Audit log parameters
 * @returns Promise<void> - Always resolves, never rejects
 */
export async function logAuditEvent(params: AuditLogParams): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      userId: params.userId,
      organisationId: params.organizationId, // Note: British spelling in DB schema
      eventType: params.eventType,
      resourceType: params.resourceType ?? null,
      resourceId: params.resourceId ?? null,
      metadata: {
        ...params.metadata,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        timestamp: new Date().toISOString(),
      },
    } as any);
  } catch (error) {
    // CRITICAL: Don't let audit logging failures break the application
    // Log for ops monitoring, but don't throw
    logger.audit.error("Failed to log audit event", {
      eventType: params.eventType,
      userId: params.userId,
      organizationId: params.organizationId,
    }, error);
  }
}

/**
 * Helper function to extract request metadata for audit logging.
 * Safely extracts IP address and user agent from Express request.
 *
 * @param req - Express Request object
 * @returns Object with ipAddress and userAgent
 */
export function getRequestMetadata(req: Request): { ipAddress: string; userAgent: string } {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || "unknown",
    userAgent: req.get("user-agent") || "unknown",
  };
}
