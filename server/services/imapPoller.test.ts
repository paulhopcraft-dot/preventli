import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  decideNextCursor,
  shouldRejectAsLoop,
  imapMessageToInternal,
  totalAttachmentBytes,
  processFetchedMessage,
  buildConfigFromEnv,
} from "./imapPoller";

// ─────────────────────────────────────────────────────────────────────────────
// Mock the dispatch boundary so processFetchedMessage tests don't hit the DB.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("./inboundEmailService", () => ({
  processInboundEmail: vi.fn(),
}));
vi.mock("../storage", () => ({ storage: {} }));

import { processInboundEmail } from "./inboundEmailService";
const dispatchSpy = processInboundEmail as unknown as ReturnType<typeof vi.fn>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function rfc822(
  parts: {
    from?: string;
    to?: string;
    subject?: string;
    messageId?: string;
    inReplyTo?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Buffer {
  const lines: string[] = [];
  if (parts.from) lines.push(`From: ${parts.from}`);
  if (parts.to) lines.push(`To: ${parts.to}`);
  if (parts.subject) lines.push(`Subject: ${parts.subject}`);
  if (parts.messageId) lines.push(`Message-ID: ${parts.messageId}`);
  if (parts.inReplyTo) lines.push(`In-Reply-To: ${parts.inReplyTo}`);
  if (parts.headers) {
    for (const [k, v] of Object.entries(parts.headers)) lines.push(`${k}: ${v}`);
  }
  lines.push("");
  lines.push(parts.body ?? "Hello world");
  return Buffer.from(lines.join("\r\n"), "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// decideNextCursor
// ─────────────────────────────────────────────────────────────────────────────

describe("decideNextCursor", () => {
  it("first-run seeds cursor to uidNext - 1 with no replay", () => {
    const d = decideNextCursor(null, 1000, 42);
    expect(d.mode).toBe("first-run");
    expect(d.cursor).toBe(41);
    expect(d.uidValidity).toBe(1000);
  });

  it("first-run clamps to 0 when uidNext is 1 (empty mailbox)", () => {
    const d = decideNextCursor(null, 1000, 1);
    expect(d.cursor).toBe(0);
  });

  it("flags uidvalidity-changed when server uidValidity differs from stored", () => {
    const d = decideNextCursor({ uidValidity: 1000, lastSeenUid: 50 }, 1001, 60);
    expect(d.mode).toBe("uidvalidity-changed");
    expect(d.cursor).toBe(0);
    expect(d.uidValidity).toBe(1001);
  });

  it("normal mode reuses stored lastSeenUid", () => {
    const d = decideNextCursor({ uidValidity: 1000, lastSeenUid: 50 }, 1000, 60);
    expect(d.mode).toBe("normal");
    expect(d.cursor).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// shouldRejectAsLoop
// ─────────────────────────────────────────────────────────────────────────────

describe("shouldRejectAsLoop", () => {
  async function parse(buf: Buffer) {
    const { simpleParser } = await import("mailparser");
    return simpleParser(buf);
  }

  it("accepts a normal message", async () => {
    const p = await parse(
      rfc822({ from: "doctor@clinic.example", to: "support@gpnet.au", subject: "Hi" }),
    );
    expect(shouldRejectAsLoop(p, "support@gpnet.au").reject).toBe(false);
  });

  it("rejects Auto-Submitted: auto-replied", async () => {
    const p = await parse(
      rfc822({
        from: "ooo@example.com",
        to: "support@gpnet.au",
        subject: "Out of office",
        headers: { "Auto-Submitted": "auto-replied" },
      }),
    );
    const r = shouldRejectAsLoop(p, "support@gpnet.au");
    expect(r.reject).toBe(true);
    expect(r.reason).toMatch(/auto-replied/i);
  });

  it("rejects Precedence: bulk", async () => {
    const p = await parse(
      rfc822({
        from: "list@example.com",
        to: "support@gpnet.au",
        subject: "Newsletter",
        headers: { Precedence: "bulk" },
      }),
    );
    expect(shouldRejectAsLoop(p, "support@gpnet.au").reject).toBe(true);
  });

  it("rejects empty Return-Path (bounce envelope)", async () => {
    const p = await parse(
      rfc822({
        from: "real@example.com",
        to: "support@gpnet.au",
        subject: "Returned mail",
        headers: { "Return-Path": "<>" },
      }),
    );
    expect(shouldRejectAsLoop(p, "support@gpnet.au").reject).toBe(true);
  });

  it("rejects mailer-daemon sender", async () => {
    const p = await parse(
      rfc822({ from: "MAILER-DAEMON@example.com", to: "support@gpnet.au", subject: "Bounce" }),
    );
    expect(shouldRejectAsLoop(p, "support@gpnet.au").reject).toBe(true);
  });

  it("rejects noreply sender", async () => {
    const p = await parse(
      rfc822({ from: "noreply@service.example", to: "support@gpnet.au", subject: "Receipt" }),
    );
    expect(shouldRejectAsLoop(p, "support@gpnet.au").reject).toBe(true);
  });

  it("rejects self-loop (from === ownMailbox)", async () => {
    const p = await parse(
      rfc822({ from: "support@gpnet.au", to: "support@gpnet.au", subject: "Re: case" }),
    );
    const r = shouldRejectAsLoop(p, "support@gpnet.au");
    expect(r.reject).toBe(true);
    expect(r.reason).toMatch(/self-loop/i);
  });

  it("rejects sister GPNet mailbox sender (jacinta to support)", async () => {
    const p = await parse(
      rfc822({
        from: "jacinta.bailey@gpnet.au",
        to: "support@gpnet.au",
        subject: "FW: case escalation",
      }),
    );
    expect(shouldRejectAsLoop(p, "support@gpnet.au").reject).toBe(true);
  });

  it("rejects sister GPNet mailbox sender in the reverse direction (support to jacinta)", async () => {
    const p = await parse(
      rfc822({
        from: "support@gpnet.au",
        to: "jacinta.bailey@gpnet.au",
        subject: "FW: escalation",
      }),
    );
    expect(shouldRejectAsLoop(p, "jacinta.bailey@gpnet.au").reject).toBe(true);
  });

  it("ignores Auto-Submitted: no (RFC-compliant explicit non-auto)", async () => {
    const p = await parse(
      rfc822({
        from: "doctor@clinic.example",
        to: "support@gpnet.au",
        subject: "Hi",
        headers: { "Auto-Submitted": "no" },
      }),
    );
    expect(shouldRejectAsLoop(p, "support@gpnet.au").reject).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// imapMessageToInternal
// ─────────────────────────────────────────────────────────────────────────────

describe("imapMessageToInternal", () => {
  async function parse(buf: Buffer) {
    const { simpleParser } = await import("mailparser");
    return simpleParser(buf);
  }

  it("maps headers + body into InboundEmailPayload", async () => {
    const p = await parse(
      rfc822({
        from: "Dr Lee <doctor@clinic.example>",
        to: "support@gpnet.au",
        subject: "Cert for Jane Doe",
        messageId: "<abc@clinic.example>",
        inReplyTo: "<prev@thread.example>",
        body: "Please find attached.",
      }),
    );
    const payload = imapMessageToInternal(p, "support@gpnet.au");
    expect(payload.source).toBe("imap");
    expect(payload.fromEmail).toBe("doctor@clinic.example");
    expect(payload.fromName).toBe("Dr Lee");
    expect(payload.toEmail).toBe("support@gpnet.au");
    expect(payload.subject).toBe("Cert for Jane Doe");
    expect(payload.messageId).toBe("<abc@clinic.example>");
    expect(payload.inReplyTo).toBe("<prev@thread.example>");
    expect(payload.bodyText).toContain("Please find attached.");
  });

  it("falls back to '(no subject)' for empty subject", async () => {
    const p = await parse(rfc822({ from: "x@y.example", to: "support@gpnet.au" }));
    const payload = imapMessageToInternal(p, "support@gpnet.au");
    expect(payload.subject).toBe("(no subject)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// totalAttachmentBytes
// ─────────────────────────────────────────────────────────────────────────────

describe("totalAttachmentBytes", () => {
  it("returns 0 when no attachments", () => {
    expect(totalAttachmentBytes({ attachments: [] } as any)).toBe(0);
  });

  it("sums all attachment sizes (including over-cap items)", () => {
    expect(
      totalAttachmentBytes({
        attachments: [{ size: 1024 }, { size: 50 * 1024 * 1024 }, { size: 0 }],
      } as any),
    ).toBe(1024 + 50 * 1024 * 1024);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// processFetchedMessage — the failure-policy spine (code-reviewer's data-loss
// gate). Hold cursor on dispatch failure; advance on every other outcome.
// ─────────────────────────────────────────────────────────────────────────────

describe("processFetchedMessage", () => {
  beforeEach(() => {
    dispatchSpy.mockReset();
  });

  it("advances cursor on successful dispatch", async () => {
    dispatchSpy.mockResolvedValueOnce({});
    const r = await processFetchedMessage(
      rfc822({ from: "ok@example.com", to: "support@gpnet.au", subject: "Hi" }),
      "support@gpnet.au",
    );
    expect(r.advance).toBe(true);
    expect((r as any).kind).toBe("dispatched");
    expect(dispatchSpy).toHaveBeenCalledOnce();
  });

  it("HOLDS cursor when processInboundEmail throws (data-loss gate)", async () => {
    dispatchSpy.mockRejectedValueOnce(new Error("DB connection refused"));
    const r = await processFetchedMessage(
      rfc822({ from: "ok@example.com", to: "support@gpnet.au", subject: "Hi" }),
      "support@gpnet.au",
    );
    expect(r.advance).toBe(false);
    expect((r as any).kind).toBe("dispatch-failed");
  });

  it("advances cursor + skips dispatch on loop-rejected message", async () => {
    const r = await processFetchedMessage(
      rfc822({
        from: "mailer-daemon@isp.example",
        to: "support@gpnet.au",
        subject: "Bounce",
      }),
      "support@gpnet.au",
    );
    expect(r.advance).toBe(true);
    expect((r as any).kind).toBe("loop-rejected");
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("advances cursor on parse failure (poison-message tolerance)", async () => {
    const throwingParser = vi.fn().mockRejectedValue(new Error("bad MIME"));
    const r = await processFetchedMessage(
      Buffer.from("garbage"),
      "support@gpnet.au",
      throwingParser,
    );
    expect(r.advance).toBe(true);
    expect((r as any).kind).toBe("parse-failed");
    expect(dispatchSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// buildConfigFromEnv
// ─────────────────────────────────────────────────────────────────────────────

describe("buildConfigFromEnv", () => {
  it("returns null when IMAP_HOST is unset", () => {
    expect(buildConfigFromEnv({})).toBeNull();
  });

  it("includes both mailboxes when all creds present", () => {
    const cfg = buildConfigFromEnv({
      IMAP_HOST: "mail.gpnet.au",
      IMAP_SUPPORT_USER: "support@gpnet.au",
      IMAP_SUPPORT_PASS: "x",
      IMAP_JACINTA_USER: "jacinta.bailey@gpnet.au",
      IMAP_JACINTA_PASS: "y",
    } as NodeJS.ProcessEnv);
    expect(cfg?.host).toBe("mail.gpnet.au");
    expect(cfg?.port).toBe(993);
    expect(cfg?.mailboxes.map((m) => m.mailbox).sort()).toEqual([
      "jacinta.bailey@gpnet.au",
      "support@gpnet.au",
    ]);
  });

  it("skips a mailbox with missing creds rather than crashing", () => {
    const cfg = buildConfigFromEnv({
      IMAP_HOST: "mail.gpnet.au",
      IMAP_SUPPORT_USER: "support@gpnet.au",
      IMAP_SUPPORT_PASS: "x",
      // jacinta creds omitted
    } as NodeJS.ProcessEnv);
    expect(cfg?.mailboxes).toHaveLength(1);
    expect(cfg?.mailboxes[0].mailbox).toBe("support@gpnet.au");
  });

  it("honours IMAP_PORT override", () => {
    const cfg = buildConfigFromEnv({
      IMAP_HOST: "mail.gpnet.au",
      IMAP_PORT: "1993",
      IMAP_SUPPORT_USER: "support@gpnet.au",
      IMAP_SUPPORT_PASS: "x",
    } as NodeJS.ProcessEnv);
    expect(cfg?.port).toBe(1993);
  });
});
