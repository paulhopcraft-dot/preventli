import crypto from "crypto";
import { createLogger } from "../lib/logger";
import { auditLog } from "../lib/auditLog";

const log = createLogger("InsurerStub");

/**
 * Insurer escalation threshold — engagement score below this enables
 * the escalate button + can be passed to pushEscalation.
 * Per ADR-0002, tunable per-org later.
 */
export const ESCALATION_THRESHOLD = 40;

export interface EscalationPayload {
  caseId: string;
  workerName: string;
  triggeredByUserId: string;
  scoreAtTrigger: number;
  thresholdAtTrigger: number;
  messageBody: string;
}

export interface EscalationResult {
  ok: boolean;
  escalationId: string;
  stubResponse: { acknowledged: boolean; ticket: string };
}

/**
 * Stub insurer push. Real adapter wires in v2 — for now, we record
 * the escalation, write audit_events, and return a synthetic ack.
 * The UI deliberately surfaces "logged for follow-up via existing
 * channels" rather than implying the insurer received an HTTP push.
 * See ADR-0002 for the framing rationale.
 */
export async function pushEscalation(payload: EscalationPayload): Promise<EscalationResult> {
  // NOTE: actual storage write (insurer_escalations row) happens in slice 3.3 / 3.4
  // where the call site has the storage instance + caseId in scope. This module
  // ONLY handles the simulated push + logging.
  const ticket = `STUB-${crypto.randomUUID()}`;
  log.info("Insurer push (STUB) — would have sent", {
    caseId: payload.caseId,
    workerName: payload.workerName,
    scoreAtTrigger: payload.scoreAtTrigger,
    threshold: payload.thresholdAtTrigger,
    ticket,
  });
  // Best-effort audit log (do not throw on failure)
  try {
    await auditLog({
      caseId: payload.caseId,
      eventType: "insurer.escalated",
      actor: payload.triggeredByUserId,
      payload: {
        scoreAtTrigger: payload.scoreAtTrigger,
        thresholdAtTrigger: payload.thresholdAtTrigger,
        messageBodyPreview: payload.messageBody.slice(0, 200),
        ticket,
      },
    });
  } catch (err) {
    log.error("Audit log failed during insurer push", {}, err);
  }
  return {
    ok: true,
    escalationId: ticket,
    stubResponse: { acknowledged: true, ticket },
  };
}
