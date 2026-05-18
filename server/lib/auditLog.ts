/**
 * auditLog — thin helper for business-event audit logging via the new
 * audit_events columns (caseId, workerId, actor, payload, llmModel, …).
 *
 * Distinct from server/services/auditLogger.ts (which writes the legacy
 * security/compliance columns). Both coexist: legacy for security events,
 * this for business-event sourcing introduced in the funding-bundle.
 *
 * INVARIANT: failures are caught and logged — this function NEVER throws.
 * Audit logging must never block a user-facing mutation.
 */

import { storage } from "../storage";
import { logger } from "./logger";

export interface AuditLogInput {
  caseId?: string | null;
  workerId?: string | null;
  eventType: string;         // e.g. "case.status-changed", "certificate.added", "rtw-plan.updated"
  actor: string;             // user_id or literal "alex"
  payload?: Record<string, unknown>;
  llm?: { model: string; prompt: string; response: string };
}

export async function auditLog(input: AuditLogInput): Promise<void> {
  try {
    await storage.createAuditEvent({
      caseId: input.caseId ?? null,
      workerId: input.workerId ?? null,
      eventType: input.eventType,
      actor: input.actor,
      payload: input.payload ?? null,
      llmModel: input.llm?.model ?? null,
      llmPrompt: input.llm?.prompt ?? null,
      llmResponse: input.llm?.response ?? null,
    } as any);
  } catch (err) {
    // Never rethrow — audit failures must not block business operations
    logger.audit.error("[auditLog] Failed to write audit event", {
      eventType: input.eventType,
      actor: input.actor,
      caseId: input.caseId ?? undefined,
    }, err);
  }
}
