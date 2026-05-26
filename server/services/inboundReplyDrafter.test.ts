import { describe, it, expect, vi } from "vitest";

// Stub storage + transitive imports — same pattern as inboundEmailService.test.ts.
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../lib/logger", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../lib/claude-cli", () => ({ callClaude: vi.fn() }));
vi.mock("./smartSummary", () => ({ fetchCaseContext: vi.fn() }));
vi.mock("../lib/draftTelegram", () => ({ pingDraftTelegram: vi.fn() }));

import { buildDraftPrompt, buildReplySubject } from "./inboundReplyDrafter";
import type { InboundMailboxConfig } from "./inboundMailbox";

const jacqui: InboundMailboxConfig = {
  mailbox: "support@gpnet.au",
  signerName: "Jacqui",
  signature: "Kind regards,\nJacqui\nGPNet — support@gpnet.au",
};

const jacinta: InboundMailboxConfig = {
  mailbox: "jacinta.bailey@gpnet.au",
  signerName: "Jacinta Bailey",
  signature: "Kind regards,\nJacinta Bailey\nClient Relationship Manager\nGPNet — jacinta.bailey@gpnet.au",
};

describe("buildDraftPrompt", () => {
  const baseArgs = {
    workerName: "Sam Tester",
    companyName: "Acme Pty Ltd",
    workStatus: "Off work",
    riskLevel: "Medium",
    caseSummary: "Lower back strain, RTW planned.",
    inbound: {
      messageId: "<msg-1@example.com>",
      fromEmail: "sender@example.com",
      fromName: "Dr Lee",
      subject: "Cert update",
      bodyText: "Sam will be off another 2 weeks.",
    },
  };

  it("includes signer name + mailbox in the system instruction", () => {
    const prompt = buildDraftPrompt({ ...baseArgs, mailbox: jacqui });
    expect(prompt).toContain("Jacqui");
    expect(prompt).toContain("support@gpnet.au");
  });

  it("embeds the inbound subject and body", () => {
    const prompt = buildDraftPrompt({ ...baseArgs, mailbox: jacqui });
    expect(prompt).toContain("Cert update");
    expect(prompt).toContain("Sam will be off another 2 weeks");
  });

  it("includes worker + company case context", () => {
    const prompt = buildDraftPrompt({ ...baseArgs, mailbox: jacqui });
    expect(prompt).toContain("Sam Tester");
    expect(prompt).toContain("Acme Pty Ltd");
  });

  it("appends the literal signature block for the chosen mailbox", () => {
    const prompt = buildDraftPrompt({ ...baseArgs, mailbox: jacinta });
    expect(prompt).toContain("Jacinta Bailey");
    expect(prompt).toContain("Client Relationship Manager");
  });

  it("truncates very long inbound bodies (no megabyte prompts)", () => {
    const huge = "x".repeat(20_000);
    const prompt = buildDraftPrompt({
      ...baseArgs,
      mailbox: jacqui,
      inbound: { ...baseArgs.inbound, bodyText: huge },
    });
    // Body is capped at 4000 chars — full 20k must not appear.
    expect(prompt.length).toBeLessThan(huge.length);
  });

  it("handles missing inbound body without crashing", () => {
    const prompt = buildDraftPrompt({
      ...baseArgs,
      mailbox: jacqui,
      inbound: { ...baseArgs.inbound, bodyText: null },
    });
    expect(prompt).toContain("(no body text)");
  });
});

describe("buildReplySubject", () => {
  it("prepends Re: when missing", () => {
    expect(buildReplySubject("Cert update")).toBe("Re: Cert update");
  });

  it("does not double-prepend when Re: already present", () => {
    expect(buildReplySubject("Re: Cert update")).toBe("Re: Cert update");
  });

  it("is case-insensitive on the existing Re: marker", () => {
    expect(buildReplySubject("RE: Cert update")).toBe("RE: Cert update");
    expect(buildReplySubject("re: Cert update")).toBe("re: Cert update");
  });

  it("trims whitespace", () => {
    expect(buildReplySubject("  Cert update  ")).toBe("Re: Cert update");
  });
});
