import { describe, it, expect, vi } from "vitest";

// Avoid pulling DATABASE_URL through transitive storage import.
vi.mock("../storage", () => ({ storage: {} }));
vi.mock("../lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../services/inboundEmailService", () => ({
  processInboundEmail: vi.fn(),
}));

import { postmarkToInternal, type PostmarkInboundPayload } from "./postmark-inbound";

describe("postmarkToInternal", () => {
  it("maps required fields end-to-end", () => {
    const postmark: PostmarkInboundPayload = {
      From: "gp@clinic.example",
      FromName: "Dr Smith",
      To: "support@preventli.ai",
      Subject: "Medical Certificate - Sarah Chen",
      MessageID: "abc-123",
      TextBody: "Please find attached.",
      HtmlBody: "<p>Please find attached.</p>",
      Date: "2026-05-15T10:00:00Z",
    };
    const internal = postmarkToInternal(postmark);
    expect(internal.fromEmail).toBe("gp@clinic.example");
    expect(internal.fromName).toBe("Dr Smith");
    expect(internal.toEmail).toBe("support@preventli.ai");
    expect(internal.subject).toBe("Medical Certificate - Sarah Chen");
    expect(internal.messageId).toBe("abc-123");
    expect(internal.bodyText).toBe("Please find attached.");
    expect(internal.bodyHtml).toBe("<p>Please find attached.</p>");
    expect(internal.source).toBe("postmark");
    expect(internal.receivedAt).toBe("2026-05-15T10:00:00Z");
  });

  it("prefers FromFull over From/FromName when both present", () => {
    const internal = postmarkToInternal({
      From: "fallback@example.com",
      FromName: "Fallback",
      FromFull: { Email: "primary@clinic.example", Name: "Dr Primary" },
      Subject: "X",
    } as PostmarkInboundPayload);
    expect(internal.fromEmail).toBe("primary@clinic.example");
    expect(internal.fromName).toBe("Dr Primary");
  });

  it("falls back to From/FromName when FromFull absent", () => {
    const internal = postmarkToInternal({
      From: "fallback@example.com",
      FromName: "Fallback",
      Subject: "X",
    } as PostmarkInboundPayload);
    expect(internal.fromEmail).toBe("fallback@example.com");
    expect(internal.fromName).toBe("Fallback");
  });

  it("extracts inReplyTo from Headers (case-insensitive)", () => {
    const internal = postmarkToInternal({
      From: "gp@clinic.example",
      Subject: "Re: Sarah Chen",
      Headers: [
        { Name: "Received", Value: "from mta" },
        { Name: "In-Reply-To", Value: "<original-msg-id@preventli.ai>" },
      ],
    } as PostmarkInboundPayload);
    expect(internal.inReplyTo).toBe("<original-msg-id@preventli.ai>");
  });

  it("handles lowercased in-reply-to header", () => {
    const internal = postmarkToInternal({
      From: "gp@clinic.example",
      Subject: "Re: Sarah Chen",
      Headers: [{ Name: "in-reply-to", Value: "<msg-1@preventli.ai>" }],
    } as PostmarkInboundPayload);
    expect(internal.inReplyTo).toBe("<msg-1@preventli.ai>");
  });

  it("returns undefined inReplyTo when Headers absent or empty", () => {
    expect(
      postmarkToInternal({
        From: "gp@clinic.example",
        Subject: "X",
      } as PostmarkInboundPayload).inReplyTo,
    ).toBeUndefined();
    expect(
      postmarkToInternal({
        From: "gp@clinic.example",
        Subject: "X",
        Headers: [],
      } as PostmarkInboundPayload).inReplyTo,
    ).toBeUndefined();
  });

  it("maps attachments preserving filename / contentType / sizeBytes / base64", () => {
    const internal = postmarkToInternal({
      From: "gp@clinic.example",
      Subject: "Cert attached",
      Attachments: [
        {
          Name: "cert.pdf",
          ContentType: "application/pdf",
          ContentLength: 12345,
          Content: "JVBERi0xLjQ=",
        },
        {
          Name: "ref.png",
          ContentType: "image/png",
          ContentLength: 2048,
        },
      ],
    } as PostmarkInboundPayload);
    expect(internal.attachments).toHaveLength(2);
    expect(internal.attachments![0]).toEqual({
      filename: "cert.pdf",
      contentType: "application/pdf",
      sizeBytes: 12345,
      base64Data: "JVBERi0xLjQ=",
    });
    expect(internal.attachments![1].base64Data).toBeUndefined();
  });

  it("omits attachments key when Postmark omits it", () => {
    const internal = postmarkToInternal({
      From: "gp@clinic.example",
      Subject: "X",
    } as PostmarkInboundPayload);
    expect(internal.attachments).toBeUndefined();
  });

  it("always tags source as 'postmark'", () => {
    const internal = postmarkToInternal({
      From: "gp@clinic.example",
      Subject: "X",
    } as PostmarkInboundPayload);
    expect(internal.source).toBe("postmark");
  });
});
