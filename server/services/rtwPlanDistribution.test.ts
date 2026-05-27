import { describe, it, expect } from "vitest";
import {
  resolveRecipients,
  RecipientResolutionError,
  type RecipientResolverContact,
  type RecipientResolverInput,
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
