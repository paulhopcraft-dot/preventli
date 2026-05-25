import { describe, it, expect } from "vitest";
import { updatePartnerSelfSchema } from "./partnerSelf";

describe("updatePartnerSelfSchema", () => {
  describe("partial behaviour", () => {
    it("accepts an empty object (partner saves nothing)", () => {
      const result = updatePartnerSelfSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts a single dirty field (partner edits only contactEmail)", () => {
      const result = updatePartnerSelfSchema.safeParse({
        contactEmail: "ops@example.com",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.contactEmail).toBe("ops@example.com");
        expect("name" in result.data).toBe(false);
      }
    });
  });

  describe("clear-field semantics (PartnerSelfSetupForm.tsx dirty-field bug)", () => {
    it("turns empty string into undefined for optional text fields", () => {
      const result = updatePartnerSelfSchema.safeParse({
        contactPhone: "",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.contactPhone).toBeUndefined();
      }
    });

    it("turns empty string into undefined for optional email fields", () => {
      const result = updatePartnerSelfSchema.safeParse({
        rtwCoordinatorEmail: "",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.rtwCoordinatorEmail).toBeUndefined();
      }
    });

    it("preserves the key in the parsed object so the PATCH handler clears it", () => {
      // The PATCH handler uses `k in data` to distinguish "untouched" from
      // "deliberately cleared". After the optionalEmpty transform turns ""
      // into undefined the key must still be present.
      const result = updatePartnerSelfSchema.safeParse({
        contactPhone: "",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect("contactPhone" in result.data).toBe(true);
      }
    });
  });

  describe("name", () => {
    it("accepts a valid name", () => {
      const result = updatePartnerSelfSchema.safeParse({ name: "Test Partner" });
      expect(result.success).toBe(true);
    });

    it("rejects a name shorter than 2 characters", () => {
      const result = updatePartnerSelfSchema.safeParse({ name: "A" });
      expect(result.success).toBe(false);
    });

    it("rejects empty string as name (min(2) still applies under partial)", () => {
      const result = updatePartnerSelfSchema.safeParse({ name: "" });
      expect(result.success).toBe(false);
    });
  });

  describe("address validation", () => {
    it("accepts a valid 4-digit postcode", () => {
      const result = updatePartnerSelfSchema.safeParse({ postcode: "3000" });
      expect(result.success).toBe(true);
    });

    it("rejects a non-4-digit postcode", () => {
      const result = updatePartnerSelfSchema.safeParse({ postcode: "30000" });
      expect(result.success).toBe(false);
    });

    it("accepts a valid AU state code", () => {
      const result = updatePartnerSelfSchema.safeParse({ state: "VIC" });
      expect(result.success).toBe(true);
    });

    it("rejects an unknown state code", () => {
      const result = updatePartnerSelfSchema.safeParse({ state: "ZZZ" });
      expect(result.success).toBe(false);
    });
  });

  describe("email validation", () => {
    it("rejects a malformed email", () => {
      const result = updatePartnerSelfSchema.safeParse({
        contactEmail: "not-an-email",
      });
      expect(result.success).toBe(false);
    });

    it("accepts a valid email", () => {
      const result = updatePartnerSelfSchema.safeParse({
        hrContactEmail: "hr@example.com",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("notificationEmails", () => {
    it("normalises a comma-separated list to lowercase + trimmed", () => {
      const result = updatePartnerSelfSchema.safeParse({
        notificationEmails: "  Ops@Example.COM ,  Alerts@Example.com  ",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.notificationEmails).toBe(
          "ops@example.com, alerts@example.com",
        );
      }
    });

    it("rejects an entry that is not a valid email", () => {
      const result = updatePartnerSelfSchema.safeParse({
        notificationEmails: "ops@example.com, not-an-email",
      });
      expect(result.success).toBe(false);
    });

    it("rejects more than 10 addresses", () => {
      const eleven = Array.from({ length: 11 }, (_, i) => `u${i}@example.com`).join(", ");
      const result = updatePartnerSelfSchema.safeParse({
        notificationEmails: eleven,
      });
      expect(result.success).toBe(false);
    });

    it("returns empty string when input is empty (not undefined)", () => {
      // Intentional asymmetry with optionalEmpty — notificationEmailsSchema
      // returns "" so the PATCH handler can still clear via `?? null`.
      const result = updatePartnerSelfSchema.safeParse({
        notificationEmails: "",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.notificationEmails).toBe("");
      }
    });
  });

  describe("client-only fields excluded by design", () => {
    // Partners shouldn't be able to PATCH these via self-edit — the
    // schema's keyof is the contract. Any future addition should fail
    // these tests until deliberately removed from the exclude list.
    it("does not include abn", () => {
      const shape = updatePartnerSelfSchema.shape;
      expect("abn" in shape).toBe(false);
    });

    it("does not include insurerId", () => {
      const shape = updatePartnerSelfSchema.shape;
      expect("insurerId" in shape).toBe(false);
    });

    it("does not include policyNumber", () => {
      const shape = updatePartnerSelfSchema.shape;
      expect("policyNumber" in shape).toBe(false);
    });

    it("does not include wicCode", () => {
      const shape = updatePartnerSelfSchema.shape;
      expect("wicCode" in shape).toBe(false);
    });

    it("does not include worksafeState", () => {
      const shape = updatePartnerSelfSchema.shape;
      expect("worksafeState" in shape).toBe(false);
    });

    it("does not include employeeCount", () => {
      const shape = updatePartnerSelfSchema.shape;
      expect("employeeCount" in shape).toBe(false);
    });
  });
});
