import { storage } from "../storage";
import { calculateEngagementScore, type EngagementEvent } from "./engagementScore";
import { createLogger } from "../lib/logger";

const log = createLogger("EngagementRecompute");

/**
 * Pull all relevant events for a worker, run the pure formula, persist a new score row.
 * Best-effort — logs but does not throw.
 * Triggered by case-mutation hooks (cert added, appointment recorded, message in/out, etc).
 */
export async function recomputeEngagementFor(workerId: string, triggeredBy: string): Promise<void> {
  try {
    // Gather events — for v1, derive from existing data:
    //   - certificates table → cert.received (one event per cert)
    //   - contact_suppressions → contact.suppressed (one event per row)
    //   - audit_events → message.responded / message.no-response from event_type patterns
    //
    // For v1, keep this simple: query the most recent ~50 audit events for this worker
    // and translate their event_type to EngagementEvent.type via a small map.
    // Anything we don't recognize gets skipped.
    const recentAudit = await storage.getAuditEventsByWorker(workerId, 50);
    const events: EngagementEvent[] = recentAudit
      .map((row) => mapAuditToEvent(row))
      .filter((e): e is EngagementEvent => e !== null);

    const result = calculateEngagementScore(events);
    await storage.recordEngagementScore({
      workerId,
      score: result.score.toString(), // numeric column wants string
      components: result.components as unknown as Record<string, number>,
      triggeredBy,
    } as any);
    log.info("Engagement score recomputed", { workerId, score: result.score, triggeredBy });
  } catch (err) {
    log.error("Engagement recompute failed", { workerId }, err);
  }
}

function mapAuditToEvent(row: { eventType: string; createdAt: Date | null }): EngagementEvent | null {
  const t = row.eventType;
  const occurredAt = row.createdAt ?? new Date();
  // Best-effort mapping — extend as event_type taxonomy grows
  if (t === "certificate.added" || t.endsWith(".cert-received")) return { type: "cert.received", occurredAt };
  if (t === "certificate.late" || t.endsWith(".cert-late"))      return { type: "cert.late", occurredAt };
  if (t.endsWith(".appointment-attended"))                        return { type: "appointment.attended", occurredAt };
  if (t.endsWith(".appointment-noshow"))                          return { type: "appointment.noshow", occurredAt };
  if (t === "message.responded")                                  return { type: "message.responded", occurredAt };
  if (t === "message.no-response")                                return { type: "message.no-response", occurredAt };
  if (t === "contact.suppressed")                                 return { type: "contact.suppressed", occurredAt };
  return null;
}
