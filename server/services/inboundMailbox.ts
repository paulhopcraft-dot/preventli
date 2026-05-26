/**
 * Inbound mailbox topology — GPNet email-drafter v0.
 *
 * Two AI-drafted inboxes (forwarded to Postmark):
 *   1. support@gpnet.au       — shared front-line. Default voice "Jacqui".
 *   2. jacinta.bailey@gpnet.au — Jacinta's escalation box.
 *
 * One manual inbox (NOT forwarded, NOT drafted):
 *   3. lisah@preventli.ai     — Lisa replies manually.
 *
 * Anything outside these three returns null → no draft generated.
 * Source-of-truth memory: project_gpnet_mailbox_topology.md (2026-05-26).
 */

export interface InboundMailboxConfig {
  /** Canonical lowercase mailbox address (also the From: of the draft). */
  mailbox: string;
  /** Display name used in the prompt's signature line. */
  signerName: string;
  /** Signature block appended to the drafted body. */
  signature: string;
}

const MAILBOXES: Record<string, InboundMailboxConfig> = {
  "support@gpnet.au": {
    mailbox: "support@gpnet.au",
    signerName: "Jacqui",
    signature: [
      "Kind regards,",
      "Jacqui",
      "GPNet — support@gpnet.au",
    ].join("\n"),
  },
  "jacinta.bailey@gpnet.au": {
    mailbox: "jacinta.bailey@gpnet.au",
    signerName: "Jacinta Bailey",
    signature: [
      "Kind regards,",
      "Jacinta Bailey",
      "Client Relationship Manager",
      "GPNet — jacinta.bailey@gpnet.au",
    ].join("\n"),
  },
};

/**
 * Resolve a Postmark `To:` address to an AI-drafted mailbox config.
 * Returns null when:
 *   - toEmail is null/undefined/empty
 *   - toEmail is `lisah@preventli.ai` (manual, NEVER drafted)
 *   - toEmail does not match a known AI-drafted mailbox
 *
 * Comparison is exact-lowercase. Postmark's `To:` may include a display
 * name ("Jacqui <support@gpnet.au>") so we strip the angle-brackets first.
 */
export function resolveInboundMailbox(
  toEmail: string | null | undefined,
): InboundMailboxConfig | null {
  if (!toEmail) return null;

  const addr = extractAddress(toEmail).toLowerCase();
  if (!addr) return null;

  return MAILBOXES[addr] ?? null;
}

/**
 * Extract the bare address from a `To:` header value. Accepts:
 *   - "support@gpnet.au"
 *   - "Jacqui Nichol <support@gpnet.au>"
 *   - "support@gpnet.au, other@x.com"  → takes first
 */
function extractAddress(value: string): string {
  const first = value.split(",")[0]?.trim() ?? "";
  const angle = first.match(/<([^>]+)>/);
  if (angle) return angle[1].trim();
  return first;
}
