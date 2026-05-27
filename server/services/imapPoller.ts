/**
 * IMAP poller — Phase 3 of email-drafter.
 *
 * Polls GPNet IMAP mailboxes on a node-cron schedule and forwards each new
 * message into the existing inbound pipeline (processInboundEmail). The v0
 * AI-drafter (commit 6b8a2c5) then generates an auto-reply draft.
 *
 * Design notes (council-revised plan in .planning/work-imap-poller.md):
 *   - Cursor: UID-keyed per mailbox in imap_mailbox_state table
 *   - First run: cursor = uidNext - 1 (no historical replay)
 *   - UIDVALIDITY change: full-fetch + Message-Id dedup (handled in
 *     processInboundEmail via getCaseEmailByMessageId)
 *   - Failure policy: parse fail → advance cursor (poison-message tolerance);
 *     dispatch fail (processInboundEmail throws) → hold cursor for retry
 *   - Re-entrancy: isRunning guard prevents overlapping ticks
 *   - Loop guard: bounces, auto-replies, and self-loops rejected pre-dispatch
 *   - TLS pinned in code: secure: true, rejectUnauthorized: true
 *   - Credentials redacted from error messages before logging
 *
 * Three pure functions form the testable spine:
 *   - decideNextCursor
 *   - shouldRejectAsLoop
 *   - imapMessageToInternal
 */

import cron from "node-cron";
import { ImapFlow, type FetchMessageObject } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import {
  processInboundEmail,
  type InboundEmailPayload,
} from "./inboundEmailService";
import { storage } from "../storage";
import { createLogger } from "../lib/logger";

const log = createLogger("ImapPoller");

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Drop any single attachment exceeding this size. */
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Skip an entire message whose attachments collectively exceed this. */
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────

export interface ImapMailboxCredentials {
  /** Canonical lowercase mailbox address — also used as state PK. */
  mailbox: string;
  /** IMAP auth username (usually the same as mailbox). */
  user: string;
  /** IMAP auth password. */
  pass: string;
}

export interface ImapPollerConfig {
  host: string;
  port: number;
  mailboxes: ImapMailboxCredentials[];
}

/**
 * Build the poller config from environment variables.
 * Missing per-mailbox creds → skip that mailbox with a warning (don't crash).
 * Missing IMAP_HOST → returns null, caller should not start.
 */
export function buildConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ImapPollerConfig | null {
  const host = env.IMAP_HOST;
  if (!host) return null;
  const port = env.IMAP_PORT ? parseInt(env.IMAP_PORT, 10) : 993;

  const mailboxes: ImapMailboxCredentials[] = [];

  const supportUser = env.IMAP_SUPPORT_USER;
  const supportPass = env.IMAP_SUPPORT_PASS;
  if (supportUser && supportPass) {
    mailboxes.push({ mailbox: "support@gpnet.au", user: supportUser, pass: supportPass });
  } else {
    log.warn("IMAP support mailbox skipped — IMAP_SUPPORT_USER or IMAP_SUPPORT_PASS unset");
  }

  const jacintaUser = env.IMAP_JACINTA_USER;
  const jacintaPass = env.IMAP_JACINTA_PASS;
  if (jacintaUser && jacintaPass) {
    mailboxes.push({ mailbox: "jacinta.bailey@gpnet.au", user: jacintaUser, pass: jacintaPass });
  } else {
    log.warn("IMAP jacinta mailbox skipped — IMAP_JACINTA_USER or IMAP_JACINTA_PASS unset");
  }

  return { host, port, mailboxes };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure: cursor decision
// ─────────────────────────────────────────────────────────────────────────────

export interface MailboxCursorState {
  uidValidity: number;
  lastSeenUid: number;
}

export type CursorMode = "first-run" | "uidvalidity-changed" | "normal";

export interface NextCursorDecision {
  /** UID to use as "last seen" for the upcoming fetch. */
  cursor: number;
  mode: CursorMode;
  /** What UIDVALIDITY to write back to state after the poll. */
  uidValidity: number;
}

/**
 * Decide the cursor for the next fetch from a mailbox.
 *
 *   - First run (no prior state): seed cursor to uidNext - 1; no replay.
 *   - UIDVALIDITY changed: cursor reset to 0; caller fetches 1:* and relies on
 *     processInboundEmail's Message-Id dedup to skip duplicates.
 *   - Normal: use the stored lastSeenUid.
 */
export function decideNextCursor(
  prev: MailboxCursorState | null,
  serverUidValidity: number,
  serverUidNext: number,
): NextCursorDecision {
  if (prev === null) {
    // uidNext points to the UID the next NEW message will get. Subtract 1 so
    // we capture the current high-water mark without re-processing history.
    return {
      cursor: Math.max(0, serverUidNext - 1),
      mode: "first-run",
      uidValidity: serverUidValidity,
    };
  }
  if (prev.uidValidity !== serverUidValidity) {
    return { cursor: 0, mode: "uidvalidity-changed", uidValidity: serverUidValidity };
  }
  return { cursor: prev.lastSeenUid, mode: "normal", uidValidity: serverUidValidity };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure: loop / bounce / self-reply filter
// ─────────────────────────────────────────────────────────────────────────────

export interface LoopDecision {
  reject: boolean;
  reason?: string;
}

const AUTO_SUBMITTED_PATTERN = /auto-(replied|generated|notified)/i;
const BULK_PRECEDENCE_PATTERN = /^(bulk|list|junk|auto_reply)$/i;
const BOUNCE_LOCALPART_PATTERN =
  /^(mailer-daemon|noreply|no-reply|postmaster|bounces?|notifications?)@/i;

/**
 * Reject mail that would feed an auto-reply loop. Pure function — inputs are
 * ParsedMail headers + the mailbox we polled from.
 *
 * Reject when:
 *   1. Auto-Submitted header is set to anything other than "no"
 *   2. Precedence header is bulk/list/junk
 *   3. Return-Path is empty (<>) — convention for bounce envelopes
 *   4. Sender local-part is mailer-daemon / noreply / postmaster / etc.
 *   5. Sender IS one of our own AI-drafted mailboxes (self-loop)
 */
export function shouldRejectAsLoop(parsed: ParsedMail, ownMailbox: string): LoopDecision {
  const headers = parsed.headers;

  const autoSubmitted = headerValue(headers, "auto-submitted");
  if (autoSubmitted && !/^no\b/i.test(autoSubmitted) && AUTO_SUBMITTED_PATTERN.test(autoSubmitted)) {
    return { reject: true, reason: `Auto-Submitted: ${autoSubmitted}` };
  }

  const precedence = headerValue(headers, "precedence");
  if (precedence && BULK_PRECEDENCE_PATTERN.test(precedence.trim())) {
    return { reject: true, reason: `Precedence: ${precedence}` };
  }

  // Return-Path: <> is the SMTP convention for bounce envelopes. mailparser
  // normalises the parsed headers value into an address object (empty), so
  // check the raw header line instead.
  const returnPathLine = parsed.headerLines?.find(
    (h: { key: string; line: string }) => h.key?.toLowerCase() === "return-path",
  )?.line;
  if (returnPathLine && /:\s*<\s*>\s*$/.test(returnPathLine)) {
    return { reject: true, reason: "Empty Return-Path (bounce envelope)" };
  }

  if (headerValue(headers, "x-auto-response-suppress")) {
    return { reject: true, reason: "X-Auto-Response-Suppress present" };
  }

  const fromAddr = extractFromAddress(parsed);
  if (!fromAddr) {
    return { reject: true, reason: "Missing From address" };
  }

  if (BOUNCE_LOCALPART_PATTERN.test(fromAddr)) {
    return { reject: true, reason: `Bounce/auto sender: ${fromAddr}` };
  }

  // Self-loop guard: drafter sends from support@gpnet.au; if a reply arrives
  // FROM that same address (e.g. a misconfigured forward), don't auto-reply.
  if (fromAddr.toLowerCase() === ownMailbox.toLowerCase()) {
    return { reject: true, reason: `Self-loop: from === ownMailbox (${ownMailbox})` };
  }
  // Also guard the sister mailbox — Jacqui/Jacinta forwarding between each
  // other is normal human use, but auto-drafting on top would still spiral.
  const SISTER_GPNET_MAILBOXES = ["support@gpnet.au", "jacinta.bailey@gpnet.au"];
  if (
    SISTER_GPNET_MAILBOXES.includes(fromAddr.toLowerCase()) &&
    SISTER_GPNET_MAILBOXES.includes(ownMailbox.toLowerCase())
  ) {
    return { reject: true, reason: `Self-loop: GPNet-to-GPNet from ${fromAddr}` };
  }

  return { reject: false };
}

function headerValue(headers: ParsedMail["headers"], name: string): string | null {
  const v = headers.get(name);
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  // mailparser sometimes returns parsed objects (e.g. addresses); fall back to JSON
  return String(v);
}

function extractFromAddress(parsed: ParsedMail): string | null {
  const from = parsed.from;
  if (!from) return null;
  // mailparser returns AddressObject — `value` is an array of {address, name}
  const first = from.value?.[0]?.address;
  return first ? first.toLowerCase() : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure: ParsedMail → InboundEmailPayload
// ─────────────────────────────────────────────────────────────────────────────

export function imapMessageToInternal(
  parsed: ParsedMail,
  toEmail: string,
): InboundEmailPayload {
  const fromAddr = extractFromAddress(parsed) || "";
  const fromName = parsed.from?.value?.[0]?.name || undefined;

  // attachments: drop oversize, enforce total cap (skip-message is caller's
  // job — here we just translate). Caller MUST check total before dispatching.
  const attachments = (parsed.attachments || [])
    .filter((a) => (a.size ?? 0) <= MAX_ATTACHMENT_BYTES)
    .map((a) => ({
      filename: a.filename || "attachment",
      contentType: a.contentType || "application/octet-stream",
      sizeBytes: a.size ?? (a.content ? a.content.length : 0),
      base64Data: a.content ? Buffer.from(a.content).toString("base64") : undefined,
    }));

  return {
    messageId: parsed.messageId,
    inReplyTo: typeof parsed.inReplyTo === "string" ? parsed.inReplyTo : undefined,
    fromEmail: fromAddr,
    fromName,
    toEmail,
    subject: parsed.subject || "(no subject)",
    bodyText: parsed.text || undefined,
    bodyHtml: typeof parsed.html === "string" ? parsed.html : undefined,
    attachments,
    source: "imap",
    receivedAt: parsed.date || undefined,
  };
}

/**
 * Total attachment byte size for cap enforcement.
 * Counts ALL attachments (not just under-cap ones), so a 30MB monster pulls
 * the whole message over the total cap and skip-message kicks in.
 */
export function totalAttachmentBytes(parsed: ParsedMail): number {
  return (parsed.attachments || []).reduce((acc, a) => acc + (a.size ?? 0), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-mailbox poll result (returned for tests + status surface)
// ─────────────────────────────────────────────────────────────────────────────

export interface MailboxPollResult {
  mailbox: string;
  fetched: number;
  dispatched: number;
  rejectedAsLoop: number;
  parseFailed: number;
  dispatchFailed: number;
  attachmentSkipped: number;
  cursorAdvancedTo: number | null;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ImapPoller class — lifecycle + scheduling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process a single fetched IMAP message: parse → loop-filter → attachment-cap
 * → dispatch. Exposed for unit tests with a mock fetched message.
 *
 * Returns whether the cursor should advance past this UID:
 *   - "advance": message handled (success, loop-rejected, parse-failed, or
 *     attachment-skipped — all permanent decisions)
 *   - "hold": dispatch threw (DB down, etc.) — re-fetch next tick, let the
 *     Message-Id dedup in processInboundEmail handle the re-attempt
 */
export type ProcessOutcome =
  | { advance: true; kind: "dispatched" | "loop-rejected" | "parse-failed" | "attachment-skipped" }
  | { advance: false; kind: "dispatch-failed"; error: Error };

/** Parser dependency-injection seam so tests can force parse failure. */
export type SimpleParserFn = (raw: Buffer) => Promise<ParsedMail>;

export async function processFetchedMessage(
  rawSource: Buffer,
  ownMailbox: string,
  parser: SimpleParserFn = simpleParser,
): Promise<ProcessOutcome> {
  let parsed: ParsedMail;
  try {
    parsed = await parser(rawSource);
  } catch (err) {
    log.warn("IMAP message parse failed — advancing cursor past poison message", {
      mailbox: ownMailbox,
      error: err instanceof Error ? err.message : String(err),
    });
    return { advance: true, kind: "parse-failed" };
  }

  const loop = shouldRejectAsLoop(parsed, ownMailbox);
  if (loop.reject) {
    log.info("IMAP message rejected as loop", { mailbox: ownMailbox, reason: loop.reason });
    return { advance: true, kind: "loop-rejected" };
  }

  // Build the payload. If total attachment bytes exceed the cap, strip the
  // attachments but still dispatch — the case timeline should still get the
  // subject + body via the discussion-note path. Permanent attachment loss
  // is better than permanent email loss for human-triage workflows.
  const oversizeAttachments = totalAttachmentBytes(parsed) > MAX_TOTAL_ATTACHMENT_BYTES;
  let payload = imapMessageToInternal(parsed, ownMailbox);
  if (oversizeAttachments) {
    log.warn("IMAP message attachment total exceeds cap — stripping attachments, still dispatching", {
      mailbox: ownMailbox,
      totalBytes: totalAttachmentBytes(parsed),
      cap: MAX_TOTAL_ATTACHMENT_BYTES,
      messageId: parsed.messageId,
    });
    payload = { ...payload, attachments: [] };
  }

  try {
    await processInboundEmail(payload);
    return {
      advance: true,
      kind: oversizeAttachments ? "attachment-skipped" : "dispatched",
    };
  } catch (err) {
    return { advance: false, kind: "dispatch-failed", error: err as Error };
  }
}

export class ImapPoller {
  private task: ReturnType<typeof cron.schedule> | null = null;
  private isRunning = false;
  private lastRun: Date | null = null;
  private lastResultByMailbox: Map<string, MailboxPollResult> = new Map();
  private config: ImapPollerConfig | null = null;

  start(config: ImapPollerConfig, cronExpression: string): void {
    if (this.task) {
      log.warn("IMAP poller already running");
      return;
    }
    if (config.mailboxes.length === 0) {
      log.warn("IMAP poller not started — no mailboxes configured");
      return;
    }
    this.config = config;
    log.info("Starting IMAP poller", {
      cronExpression,
      mailboxes: config.mailboxes.map((m) => m.mailbox),
      host: config.host,
      port: config.port,
    });
    this.task = cron.schedule(cronExpression, () => {
      this.tick().catch((err) => {
        log.error("IMAP poller tick threw at top level", {}, err);
      });
    });
  }

  stop(): void {
    if (this.task) {
      this.task.stop();
      this.task = null;
      log.info("IMAP poller stopped");
    }
  }

  getStatus(): {
    running: boolean;
    lastRun: Date | null;
    lastResults: MailboxPollResult[];
  } {
    return {
      running: this.isRunning,
      lastRun: this.lastRun,
      lastResults: Array.from(this.lastResultByMailbox.values()),
    };
  }

  async triggerManualPoll(): Promise<MailboxPollResult[]> {
    return this.tick();
  }

  private async tick(): Promise<MailboxPollResult[]> {
    if (this.isRunning) {
      log.info("IMAP poller tick skipped — previous tick still running");
      return [];
    }
    if (!this.config) return [];

    this.isRunning = true;
    this.lastRun = new Date();
    const results: MailboxPollResult[] = [];

    try {
      // Sequential per mailbox so one mailbox's hung connection doesn't fan
      // out into parallel connection limits on the GPNet server. Per-mailbox
      // try/catch isolates failures.
      for (const mailbox of this.config.mailboxes) {
        try {
          const result = await this.pollMailbox(mailbox, this.config.host, this.config.port);
          results.push(result);
          this.lastResultByMailbox.set(mailbox.mailbox, result);
        } catch (err) {
          const result: MailboxPollResult = {
            mailbox: mailbox.mailbox,
            fetched: 0,
            dispatched: 0,
            rejectedAsLoop: 0,
            parseFailed: 0,
            dispatchFailed: 0,
            attachmentSkipped: 0,
            cursorAdvancedTo: null,
            error: redactCredentials(err, mailbox.pass),
          };
          results.push(result);
          this.lastResultByMailbox.set(mailbox.mailbox, result);
          log.error("IMAP poll mailbox failed", { mailbox: mailbox.mailbox, error: result.error });
        }
      }
    } finally {
      this.isRunning = false;
    }

    return results;
  }

  private async pollMailbox(
    creds: ImapMailboxCredentials,
    host: string,
    port: number,
  ): Promise<MailboxPollResult> {
    const result: MailboxPollResult = {
      mailbox: creds.mailbox,
      fetched: 0,
      dispatched: 0,
      rejectedAsLoop: 0,
      parseFailed: 0,
      dispatchFailed: 0,
      attachmentSkipped: 0,
      cursorAdvancedTo: null,
    };

    const client = new ImapFlow({
      host,
      port,
      secure: true,
      auth: { user: creds.user, pass: creds.pass },
      tls: { rejectUnauthorized: true },
      logger: false,
    });

    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const mailbox = client.mailbox;
        if (!mailbox || typeof mailbox === "boolean") {
          throw new Error("IMAP mailbox metadata unavailable after SELECT");
        }
        const uidValidity = Number(mailbox.uidValidity);
        const uidNext = Number(mailbox.uidNext);

        const prev = await storage.getImapMailboxState(creds.mailbox);
        const decision = decideNextCursor(
          prev ? { uidValidity: prev.uidValidity, lastSeenUid: prev.lastSeenUid } : null,
          uidValidity,
          uidNext,
        );

        if (decision.mode === "first-run") {
          log.info("IMAP first-run — seeding cursor without replay", {
            mailbox: creds.mailbox,
            cursor: decision.cursor,
          });
          await storage.upsertImapMailboxState({
            mailbox: creds.mailbox,
            uidValidity: decision.uidValidity,
            lastSeenUid: decision.cursor,
            lastPolledAt: new Date(),
          });
          result.cursorAdvancedTo = decision.cursor;
          return result;
        }

        if (decision.mode === "uidvalidity-changed") {
          log.warn("IMAP UIDVALIDITY changed — full fetch + Message-Id dedup", {
            mailbox: creds.mailbox,
            oldUidValidity: prev?.uidValidity,
            newUidValidity: uidValidity,
          });
        }

        // Build fetch range. Normal: cursor+1:*; uidvalidity-changed: 1:*.
        const fetchRange =
          decision.mode === "uidvalidity-changed" ? "1:*" : `${decision.cursor + 1}:*`;

        let highestUidProcessed = decision.cursor;
        let dispatchFailed = false;

        for await (const msg of client.fetch(
          { uid: fetchRange },
          { source: true, uid: true, envelope: true },
        )) {
          const m = msg as FetchMessageObject;
          if (!m.source || typeof m.uid !== "number") continue;
          result.fetched++;

          const outcome = await processFetchedMessage(m.source as Buffer, creds.mailbox);

          if (outcome.advance) {
            switch (outcome.kind) {
              case "dispatched":
                result.dispatched++;
                break;
              case "loop-rejected":
                result.rejectedAsLoop++;
                break;
              case "parse-failed":
                result.parseFailed++;
                break;
              case "attachment-skipped":
                result.attachmentSkipped++;
                break;
            }
            highestUidProcessed = Math.max(highestUidProcessed, m.uid);
          } else if (outcome.kind === "dispatch-failed") {
            // dispatch-failed: hold cursor at the last successfully processed
            // UID. Break the loop so we don't skip past this message. Next
            // tick will retry; processInboundEmail's getCaseEmailByMessageId
            // dedupes if a partial write happened.
            result.dispatchFailed++;
            log.error("IMAP dispatch failed — holding cursor for retry", {
              mailbox: creds.mailbox,
              uid: m.uid,
              error: redactCredentials(outcome.error, creds.pass),
            }, outcome.error);
            dispatchFailed = true;
            break;
          }
        }

        await storage.upsertImapMailboxState({
          mailbox: creds.mailbox,
          uidValidity: decision.uidValidity,
          lastSeenUid: highestUidProcessed,
          lastPolledAt: new Date(),
          lastErrorAt: dispatchFailed ? new Date() : null,
          lastError: dispatchFailed ? "Dispatch failed — cursor held for retry" : null,
        });
        result.cursorAdvancedTo = highestUidProcessed;
      } finally {
        lock.release();
      }
    } finally {
      try {
        await client.logout();
      } catch {
        // best-effort disconnect
      }
    }

    return result;
  }
}

/**
 * Redact credentials from error messages before logging. Defensive: imapflow
 * doesn't put the password in error strings, but third-party libs sometimes do.
 */
function redactCredentials(err: unknown, password: string): string {
  const message = err instanceof Error ? err.message : String(err);
  if (!password) return message;
  return message.split(password).join("[REDACTED]");
}

// Singleton — started by server/index.ts when IMAP_POLLER_ENABLED=true
export const imapPoller = new ImapPoller();
