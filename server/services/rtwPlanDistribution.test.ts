import { describe, it, expect } from "vitest";
import {
  resolveRecipients,
  RecipientResolutionError,
  buildDistributionPreview,
  computeDistributionStatus,
  renderGreeting,
  renderAsk,
  type DistributionTrackingRecord,
  type RecipientResolverContact,
  type RecipientResolverInput,
  type ResolvedRecipient,
} from "./rtwPlanDistribution";

function contact(
  overrides: Partial<RecipientResolverContact> & { id: string; role: string; name: string },
): RecipientResolverContact {
  return {
    id: overrides.id,
    role: overrides.role,
    name: overrides.name,
    email: overrides.email ?? `${overrides.role}@example.test`,
    isActive: overrides.isActive ?? true,
  };
}

function input(overrides: Partial<RecipientResolverInput> = {}): RecipientResolverInput {
  return {
    workerName: "Jane Worker",
    workerEmail: "jane.worker@example.test",
    claimNumber: null,
    contacts: [
      contact({ id: "c-mgr", role: "employer_primary", name: "Mick Manager" }),
      contact({ id: "c-gp", role: "treating_gp", name: "Dr Greg Practitioner" }),
    ],
    ...overrides,
  };
}

describe("resolveRecipients (RTW multi-party distribution)", () => {
  it("preventative case (no WorkCover, no physio): worker + manager + doctor, all gating", () => {
    const recipients = resolveRecipients(input());

    expect(recipients).toHaveLength(3);
    expect(recipients.map((r) => r.role)).toEqual(["worker", "manager", "doctor"]);
    expect(recipients.every((r) => r.isGating)).toBe(true);
    expect(recipients[0].email).toBe("jane.worker@example.test");
    expect(recipients[1].contactId).toBe("c-mgr");
    expect(recipients[2].contactId).toBe("c-gp");
  });

  it("preventative case with physio: worker + manager + doctor + physio, all gating", () => {
    const recipients = resolveRecipients(
      input({
        contacts: [
          contact({ id: "c-mgr", role: "employer_primary", name: "Mick Manager" }),
          contact({ id: "c-gp", role: "treating_gp", name: "Dr Greg" }),
          contact({ id: "c-physio", role: "physiotherapist", name: "Pat Physio" }),
        ],
      }),
    );

    expect(recipients).toHaveLength(4);
    expect(recipients.map((r) => r.role)).toEqual([
      "worker",
      "manager",
      "doctor",
      "physio",
    ]);
    expect(recipients.every((r) => r.isGating)).toBe(true);
    expect(recipients[3].contactId).toBe("c-physio");
  });

  it("WorkCover claim with full party set: insurer included as courtesy (not gating)", () => {
    const recipients = resolveRecipients(
      input({
        claimNumber: "WC-2026-12345",
        contacts: [
          contact({ id: "c-mgr", role: "employer_primary", name: "Mick Manager" }),
          contact({ id: "c-gp", role: "treating_gp", name: "Dr Greg" }),
          contact({ id: "c-physio", role: "physiotherapist", name: "Pat Physio" }),
          contact({ id: "c-ins", role: "insurer", name: "Casey CaseManager", email: "csm@allianz.test" }),
        ],
      }),
    );

    expect(recipients).toHaveLength(5);
    const insurer = recipients.find((r) => r.role === "insurer");
    expect(insurer).toBeDefined();
    expect(insurer!.contactId).toBe("c-ins");
    expect(insurer!.email).toBe("csm@allianz.test");
    expect(insurer!.isGating).toBe(false);

    const gating = recipients.filter((r) => r.isGating);
    expect(gating.map((r) => r.role)).toEqual(["worker", "manager", "doctor", "physio"]);
  });

  it("WorkCover claim missing insurer contact: throws MISSING_INSURER_FOR_WORKCOVER", () => {
    expect(() =>
      resolveRecipients(
        input({
          claimNumber: "WC-2026-00099",
          // contacts: only manager + doctor, no insurer
        }),
      ),
    ).toThrowError(RecipientResolutionError);

    try {
      resolveRecipients(input({ claimNumber: "WC-2026-00099" }));
    } catch (err) {
      expect(err).toBeInstanceOf(RecipientResolutionError);
      expect((err as RecipientResolutionError).code).toBe("MISSING_INSURER_FOR_WORKCOVER");
    }
  });

  it("missing worker email: throws MISSING_WORKER_EMAIL", () => {
    try {
      resolveRecipients(input({ workerEmail: null }));
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RecipientResolutionError);
      expect((err as RecipientResolutionError).code).toBe("MISSING_WORKER_EMAIL");
    }
  });

  it("missing manager contact: throws MISSING_MANAGER", () => {
    try {
      resolveRecipients(
        input({
          contacts: [contact({ id: "c-gp", role: "treating_gp", name: "Dr Greg" })],
        }),
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RecipientResolutionError);
      expect((err as RecipientResolutionError).code).toBe("MISSING_MANAGER");
    }
  });

  it("missing doctor contact: throws MISSING_DOCTOR", () => {
    try {
      resolveRecipients(
        input({
          contacts: [contact({ id: "c-mgr", role: "employer_primary", name: "Mick" })],
        }),
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RecipientResolutionError);
      expect((err as RecipientResolutionError).code).toBe("MISSING_DOCTOR");
    }
  });

  it("inactive manager contact does NOT satisfy the requirement (still throws)", () => {
    try {
      resolveRecipients(
        input({
          contacts: [
            contact({ id: "c-mgr", role: "employer_primary", name: "Mick", isActive: false }),
            contact({ id: "c-gp", role: "treating_gp", name: "Dr Greg" }),
          ],
        }),
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RecipientResolutionError);
      expect((err as RecipientResolutionError).code).toBe("MISSING_MANAGER");
    }
  });

  it("manager with empty-string email does NOT satisfy the requirement", () => {
    try {
      resolveRecipients(
        input({
          contacts: [
            contact({ id: "c-mgr", role: "employer_primary", name: "Mick", email: "" }),
            contact({ id: "c-gp", role: "treating_gp", name: "Dr Greg" }),
          ],
        }),
      );
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(RecipientResolutionError);
      expect((err as RecipientResolutionError).code).toBe("MISSING_MANAGER");
    }
  });
});

// ============================================================================
// Phase 2 — Templates + preview builder + status computer
// ============================================================================

function resolved(
  role: ResolvedRecipient["role"],
  overrides: Partial<ResolvedRecipient> = {},
): ResolvedRecipient {
  // Use the 'in' operator so callers can pass explicit `null` for contactId
  // (e.g. the worker recipient) without it being clobbered by the default.
  return {
    role,
    contactId: "contactId" in overrides ? overrides.contactId! : `c-${role}`,
    name: overrides.name ?? `${role}-name`,
    email: overrides.email ?? `${role}@example.test`,
    isGating: overrides.isGating ?? role !== "insurer",
  };
}

describe("renderGreeting (per-role templates)", () => {
  const ctx = {
    workerName: "Jane Worker",
    companyName: "Acme Pty Ltd",
    recipientName: "—",
    claimNumber: null as string | null,
  };

  it("worker greeting references company and asks for thoughts", () => {
    const out = renderGreeting("worker", { ...ctx, recipientName: "Jane Worker" });
    expect(out).toContain("Hi Jane Worker");
    expect(out).toContain("Acme Pty Ltd");
    expect(out).toMatch(/thoughts/i);
  });

  it("manager greeting names the worker and asks about role workability", () => {
    const out = renderGreeting("manager", { ...ctx, recipientName: "Mick Manager" });
    expect(out).toContain("Hi Mick Manager");
    expect(out).toContain("Jane Worker");
    expect(out).toMatch(/role.*workable|workable.*role/i);
  });

  it("doctor greeting uses 'Dr <lastName>' salutation", () => {
    const out = renderGreeting("doctor", { ...ctx, recipientName: "Greg Practitioner" });
    expect(out).toContain("Dear Dr Practitioner");
    expect(out).toMatch(/vary.*constraints|add to/i);
  });

  it("doctor greeting handles single-name input gracefully", () => {
    const out = renderGreeting("doctor", { ...ctx, recipientName: "Smith" });
    expect(out).toContain("Dear Dr Smith");
  });

  it("physio greeting uses 'Dear <fullName>' (not Dr)", () => {
    const out = renderGreeting("physio", { ...ctx, recipientName: "Pat Physio" });
    expect(out).toContain("Dear Pat Physio");
    expect(out).not.toContain("Dr Pat");
  });

  it("insurer greeting includes claim number and is courtesy-toned", () => {
    const out = renderGreeting("insurer", {
      ...ctx,
      recipientName: "Carla Manager",
      claimNumber: "WC-12345",
    });
    expect(out).toContain("Carla Manager");
    expect(out).toContain("WC-12345");
    expect(out).toMatch(/courtesy notification/i);
  });

  // (Removed: insurer-with-null-claim-number test — resolveRecipients guarantees
  // claimNumber is non-empty whenever role='insurer' is in the recipient list.
  // The fallback string was dead code and has been removed.)
});

describe("renderAsk", () => {
  it("renders a distinct closing ask per role", () => {
    const asks = new Set([
      renderAsk("worker"),
      renderAsk("manager"),
      renderAsk("doctor"),
      renderAsk("physio"),
      renderAsk("insurer"),
    ]);
    expect(asks.size).toBeGreaterThanOrEqual(4); // doctor + physio may share copy
    expect(renderAsk("insurer")).toMatch(/no action required/i);
  });
});

describe("buildDistributionPreview", () => {
  it("produces one envelope per recipient, in input order", () => {
    const recipients: ResolvedRecipient[] = [
      resolved("worker", { contactId: null, name: "Jane Worker", email: "jane@x.test" }),
      resolved("manager", { name: "Mick Manager", email: "mick@x.test" }),
      resolved("doctor", { name: "Greg Practitioner", email: "greg@x.test" }),
    ];
    const preview = buildDistributionPreview({
      recipients,
      workerName: "Jane Worker",
      companyName: "Acme Pty Ltd",
      claimNumber: null,
      planBody: "Plan body goes here.",
      subject: "RTW plan for Jane Worker",
    });

    expect(preview).toHaveLength(3);
    expect(preview.map((p) => p.role)).toEqual(["worker", "manager", "doctor"]);
    expect(preview[0].subject).toBe("RTW plan for Jane Worker");
    expect(preview[0].to).toBe("jane@x.test");
    // greeting + body + ask all present
    expect(preview[0].body).toContain("Hi Jane Worker");
    expect(preview[0].body).toContain("Plan body goes here.");
    expect(preview[0].body).toMatch(/comfortable starting/i);
    expect(preview[2].body).toContain("Dear Dr Practitioner");
  });

  it("includes claim number in insurer envelope only", () => {
    const recipients: ResolvedRecipient[] = [
      resolved("worker", { contactId: null }),
      resolved("manager"),
      resolved("doctor"),
      resolved("insurer", { isGating: false, name: "Carla CM" }),
    ];
    const preview = buildDistributionPreview({
      recipients,
      workerName: "Jane",
      companyName: "Acme",
      claimNumber: "WC-99",
      planBody: "body",
      subject: "s",
    });
    expect(preview.find((p) => p.role === "insurer")!.body).toContain("WC-99");
    expect(preview.find((p) => p.role === "worker")!.body).not.toContain("WC-99");
    expect(preview.find((p) => p.role === "insurer")!.isGating).toBe(false);
  });

  it("propagates contactId for tracking (null for worker, populated for others)", () => {
    const recipients: ResolvedRecipient[] = [
      resolved("worker", { contactId: null }),
      resolved("manager", { contactId: "c-mgr-123" }),
      resolved("doctor", { contactId: "c-gp-456" }),
    ];
    const preview = buildDistributionPreview({
      recipients,
      workerName: "Jane",
      companyName: "Acme",
      claimNumber: null,
      planBody: "body",
      subject: "s",
    });
    expect(preview[0].contactId).toBeNull();
    expect(preview[1].contactId).toBe("c-mgr-123");
    expect(preview[2].contactId).toBe("c-gp-456");
  });
});

describe("computeDistributionStatus", () => {
  function track(
    role: DistributionTrackingRecord["role"],
    overrides: Partial<DistributionTrackingRecord> = {},
  ): DistributionTrackingRecord {
    return {
      role,
      isGating: overrides.isGating ?? role !== "insurer",
      lastDistributedAt: overrides.lastDistributedAt ?? null,
      respondedAt: overrides.respondedAt ?? null,
    };
  }

  it("returns 'not_distributed' when no gating contacts have been distributed", () => {
    const result = computeDistributionStatus("not_distributed", [
      track("manager"),
      track("doctor"),
    ]);
    expect(result).toBe("not_distributed");
  });

  it("returns 'awaiting_responses' only when ALL gating parties were distributed and none responded", () => {
    const now = new Date();
    const result = computeDistributionStatus("not_distributed", [
      track("manager", { lastDistributedAt: now }),
      track("doctor", { lastDistributedAt: now }),
    ]);
    expect(result).toBe("awaiting_responses");
  });

  it("partial-distribute (some gating contacts not sent) stays 'not_distributed' — does not flip to awaiting_responses for an email recipient never received", () => {
    const now = new Date();
    // worker + manager sent OK; doctor send failed (lastDistributedAt still null).
    // Plan must NOT transition to awaiting_responses or it will hang forever
    // waiting for a doctor reply that can't come. Practitioner needs to retry
    // the doctor send first.
    const result = computeDistributionStatus("not_distributed", [
      track("worker", { lastDistributedAt: now }),
      track("manager", { lastDistributedAt: now }),
      track("doctor", { lastDistributedAt: null }),
    ]);
    expect(result).toBe("not_distributed");
  });

  it("returns 'all_responded' only when every gating party has respondedAt", () => {
    const now = new Date();
    const result = computeDistributionStatus("awaiting_responses", [
      track("manager", { lastDistributedAt: now, respondedAt: now }),
      track("doctor", { lastDistributedAt: now, respondedAt: now }),
    ]);
    expect(result).toBe("all_responded");
  });

  it("ignores insurer (non-gating) when computing 'all_responded'", () => {
    const now = new Date();
    const result = computeDistributionStatus("awaiting_responses", [
      track("manager", { lastDistributedAt: now, respondedAt: now }),
      track("doctor", { lastDistributedAt: now, respondedAt: now }),
      track("insurer", { isGating: false, lastDistributedAt: now }), // no respondedAt — should not block
    ]);
    expect(result).toBe("all_responded");
  });

  it("stays 'awaiting_responses' if any gating party still hasn't responded", () => {
    const now = new Date();
    const result = computeDistributionStatus("awaiting_responses", [
      track("manager", { lastDistributedAt: now, respondedAt: now }),
      track("doctor", { lastDistributedAt: now, respondedAt: null }),
    ]);
    expect(result).toBe("awaiting_responses");
  });

  it("never downgrades from 'finalised' (terminal state)", () => {
    const result = computeDistributionStatus("finalised", []);
    expect(result).toBe("finalised");
  });

  it("returns 'not_distributed' when tracking list is empty (no gating contacts known)", () => {
    expect(computeDistributionStatus("not_distributed", [])).toBe("not_distributed");
  });
});
