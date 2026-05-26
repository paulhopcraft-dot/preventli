/**
 * Telegram ping for newly-drafted inbound replies.
 *
 * Separate webhook (DRAFT_TELEGRAM_WEBHOOK) from the operational alert
 * channel (ALERT_TELEGRAM_WEBHOOK) so draft notifications don't pollute
 * the on-call channel. Fail-soft: missing env var = no-op, no exception.
 */

import { createLogger } from "./logger";

const log = createLogger("DraftTelegram");

export interface DraftPingPayload {
  workerName: string;
  mailbox: string;
  subject: string;
  caseId: string;
}

/**
 * Post a short text notification to the configured draft Telegram channel.
 * Always async, never throws — webhook failure must not break the inbound
 * pipeline.
 */
export async function pingDraftTelegram(payload: DraftPingPayload): Promise<void> {
  const url = process.env.DRAFT_TELEGRAM_WEBHOOK;
  if (!url) {
    log.info("DRAFT_TELEGRAM_WEBHOOK not configured — skipping ping", {
      caseId: payload.caseId,
    });
    return;
  }

  const text = `New draft for ${payload.workerName} (${payload.caseId}) in ${payload.mailbox} — ${payload.subject}`;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    log.warn("Telegram draft ping failed", { caseId: payload.caseId }, err as Error);
  }
}
