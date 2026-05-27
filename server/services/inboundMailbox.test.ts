import { describe, it, expect } from "vitest";
import { resolveInboundMailbox } from "./inboundMailbox";

describe("resolveInboundMailbox", () => {
  it("resolves support@gpnet.au with Jacqui signature", () => {
    const cfg = resolveInboundMailbox("support@gpnet.au");
    expect(cfg).not.toBeNull();
    expect(cfg!.mailbox).toBe("support@gpnet.au");
    expect(cfg!.signerName).toBe("Jacqui");
    expect(cfg!.signature).toContain("Jacqui");
  });

  it("resolves jacinta.bailey@gpnet.au with escalation signature", () => {
    const cfg = resolveInboundMailbox("jacinta.bailey@gpnet.au");
    expect(cfg).not.toBeNull();
    expect(cfg!.mailbox).toBe("jacinta.bailey@gpnet.au");
    expect(cfg!.signerName).toBe("Jacinta Bailey");
    expect(cfg!.signature).toContain("Customer Service Manager");
  });

  it("returns null for lisah@preventli.ai — Lisa replies manually, NEVER AI-drafted", () => {
    expect(resolveInboundMailbox("lisah@preventli.ai")).toBeNull();
  });

  it("returns null for unknown mailbox", () => {
    expect(resolveInboundMailbox("random@example.com")).toBeNull();
  });

  it("returns null on missing/empty input", () => {
    expect(resolveInboundMailbox(null)).toBeNull();
    expect(resolveInboundMailbox(undefined)).toBeNull();
    expect(resolveInboundMailbox("")).toBeNull();
  });

  it("strips angle-bracket display name format", () => {
    const cfg = resolveInboundMailbox('"Jacqui Nichol" <support@gpnet.au>');
    expect(cfg).not.toBeNull();
    expect(cfg!.signerName).toBe("Jacqui");
  });

  it("is case-insensitive on the address", () => {
    expect(resolveInboundMailbox("SUPPORT@GPNet.AU")).not.toBeNull();
    expect(resolveInboundMailbox("Jacinta.Bailey@gpnet.au")).not.toBeNull();
  });

  it("takes the first address when multiple are comma-separated", () => {
    const cfg = resolveInboundMailbox("support@gpnet.au, cc@other.com");
    expect(cfg).not.toBeNull();
    expect(cfg!.mailbox).toBe("support@gpnet.au");
  });
});
