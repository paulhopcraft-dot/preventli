/**
 * Inbound Reply Drafter — email-drafter v0.
 *
 * For every inbound email that matches an existing case AND lands in one of
 * the AI-drafted GPNet mailboxes (support@ or jacinta.bailey@), build a
 * Claude-drafted reply, persist it to `email_drafts`, and ping Telegram so
 * Paul knows to review-and-send manually.
 *
 * Strictly fire-and-forget at the call site: webhook responses must NOT
 * depend on drafter success.
 *
 * Out of scope (Phase 2 — do NOT add here):
 *   - Trusted-sender registry / sender provisioning
 *   - org_inbound_aliases multi-tenant routing
 *   - Admin triage UI
 *   - Postmark adapter abstraction
 */

import { callClaude } from "../lib/claude-cli";
import { storage } from "../storage";
import { fetchCaseContext } from "./smartSummary";
import { createLogger } from "../lib/logger";
import { pingDraftTelegram } from "../lib/draftTelegram";
import type { InboundMailboxConfig } from "./inboundMailbox";
import type { InsertEmailDraft } from "@shared/schema";

const log = createLogger("InboundReplyDrafter");

/** Maximum inbound body chars we feed to the LLM. Trims very long forwards. */
const MAX_INBOUND_BODY_CHARS = 4000;

/** LLM timeout — keep tight; webhook handler is already fire-and-forget. */
const DRAFT_TIMEOUT_MS = 45_000;

export interface DraftReplyInput {
  caseId: string;
  organizationId: string;
  mailboxConfig: InboundMailboxConfig;
  inbound: {
    /** Postmark MessageID — becomes In-Reply-To on the outbound draft. */
    messageId?: string | null;
    fromEmail: string;
    fromName?: string | null;
    subject: string;
    bodyText?: string | null;
  };
}

export interface DraftReplyResult {
  draftId: string;
}

/**
 * Build the prompt fed to Claude. Pure function — no I/O. Exported for
 * tests so prompt structure can be asserted directly.
 */
export function buildDraftPrompt(args: {
  workerName: string;
  companyName: string;
  workStatus: string;
  riskLevel: string;
  caseSummary: string;
  mailbox: InboundMailboxConfig;
  inbound: DraftReplyInput["inbound"];
}): string {
  const body = (args.inbound.bodyText ?? "").slice(0, MAX_INBOUND_BODY_CHARS);
  const senderLabel = args.inbound.fromName
    ? `${args.inbound.fromName} <${args.inbound.fromEmail}>`
    : args.inbound.fromEmail;

  return [
    `You are drafting a professional email reply on behalf of ${args.mailbox.signerName}`,
    `from the GPNet mailbox ${args.mailbox.mailbox}. This is an Australian workplace`,
    `injury / return-to-work case management context.`,
    ``,
    `CASE CONTEXT`,
    `- Worker: ${args.workerName}`,
    `- Company: ${args.companyName}`,
    `- Work status: ${args.workStatus}`,
    `- Risk level: ${args.riskLevel}`,
    `- Summary: ${args.caseSummary}`,
    ``,
    `INBOUND EMAIL`,
    `From: ${senderLabel}`,
    `Subject: ${args.inbound.subject}`,
    `Body:`,
    body || "(no body text)",
    ``,
    `INSTRUCTIONS`,
    `- Write a clear, courteous reply suitable for ${args.mailbox.signerName} to send.`,
    `- Acknowledge the inbound content specifically. Do not invent facts not in the context.`,
    `- Keep it concise (under ~200 words unless the inbound demands more).`,
    `- Use plain Australian English. No emoji. No marketing tone.`,
    `- End with this exact signature block on its own lines:`,
    args.mailbox.signature,
    ``,
    `Respond with ONLY the email body text. No preamble, no JSON, no markdown fences.`,
  ].join("\n");
}

/**
 * Build the reply subject. RFC 5322 convention: prepend "Re: " unless one
 * already exists (any case, any leading prefix-list).
 */
export function buildReplySubject(inboundSubject: string): string {
  const trimmed = inboundSubject.trim();
  if (/^re:/i.test(trimmed)) return trimmed;
  return `Re: ${trimmed}`;
}

/**
 * Draft an auto-reply for a matched inbound email and persist it.
 * Throws on persistence failure — callers must wrap in try/catch and
 * never let exceptions reach the webhook response path.
 */
export async function draftReplyForInbound(
  input: DraftReplyInput,
): Promise<DraftReplyResult> {
  const { caseId, organizationId, mailboxConfig, inbound } = input;

  // 1. Fetch case context (reuses the same shape emailDraftService uses).
  const ctx = await fetchCaseContext(storage, caseId, organizationId);
  const summary =
    ctx.workerCase.summary ?? ctx.workerCase.currentStatus ?? "No summary available.";

  // 2. Build prompt + call LLM.
  const prompt = buildDraftPrompt({
    workerName: ctx.workerCase.workerName,
    companyName: ctx.workerCase.company,
    workStatus: ctx.workerCase.workStatus,
    riskLevel: ctx.workerCase.riskLevel,
    caseSummary: summary,
    mailbox: mailboxConfig,
    inbound,
  });

  const body = await callClaude(prompt, DRAFT_TIMEOUT_MS);
  const cleanedBody = body.trim();
  if (!cleanedBody) {
    throw new Error("LLM returned empty body — refusing to persist blank draft");
  }

  // 3. Persist the draft. Existing schema NOT NULL columns:
  //    organizationId, caseId, emailType, recipient, subject, body.
  //    We use emailType="general_response" + recipient="other" — narrowest
  //    semantic fit for a free-form inbound reply.
  // Cast pattern mirrors emailDraftService.ts — Drizzle's $inferInsert for
  // this table is over-strict and the existing service uses the same cast.
  const draftRow: InsertEmailDraft = {
    organizationId,
    caseId,
    emailType: "general_response",
    recipient: "other",
    recipientName: inbound.fromName ?? null,
    recipientEmail: inbound.fromEmail,
    subject: buildReplySubject(inbound.subject),
    body: cleanedBody,
    tone: "formal",
    additionalContext: null,
    caseContextSnapshot: null,
    status: "draft", // Existing semantics: "draft" = not-yet-sent (the "pending" state)
    createdBy: null,
    mailbox: mailboxConfig.mailbox,
    inReplyTo: inbound.messageId ?? null,
  } as any;

  const created = await storage.createEmailDraft(draftRow);

  log.info("Inbound auto-reply draft created", {
    draftId: created.id,
    caseId,
    mailbox: mailboxConfig.mailbox,
    subject: draftRow.subject,
  });

  // 4. Fire-and-forget Telegram ping. Failures never propagate.
  pingDraftTelegram({
    workerName: ctx.workerCase.workerName,
    mailbox: mailboxConfig.mailbox,
    subject: draftRow.subject,
    caseId,
  }).catch(() => {
    /* draftTelegram already logs */
  });

  return { draftId: created.id };
}
