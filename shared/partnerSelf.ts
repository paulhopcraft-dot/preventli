import { z } from "zod";
import { auStateCodes } from "./schema";

const optionalEmpty = (s: z.ZodString) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? undefined : v))
    .pipe(s.optional());

const postcodeSchema = z
  .string()
  .regex(/^\d{4}$/, "Postcode must be exactly 4 digits");

const phoneSchema = z.string().max(50);

const notificationEmailsSchema = z.string().transform((v, ctx) => {
  const trimmed = v.trim();
  if (trimmed === "") return "";
  const parts = trimmed
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  if (parts.length > 10) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Maximum 10 notification emails",
    });
    return z.NEVER;
  }
  for (const p of parts) {
    const result = z.string().email().safeParse(p);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid email: ${p}`,
      });
      return z.NEVER;
    }
  }
  return parts.join(", ");
});

const partnerSelfFields = {
  name: z.string().min(2, "Name must be at least 2 characters").max(200),
  logoUrl: optionalEmpty(z.string().max(500)),
  addressLine1: optionalEmpty(z.string().max(200)),
  addressLine2: optionalEmpty(z.string().max(200)),
  suburb: optionalEmpty(z.string().max(100)),
  state: z.enum(auStateCodes).optional(),
  postcode: optionalEmpty(postcodeSchema),
  contactName: optionalEmpty(z.string().max(200)),
  contactEmail: optionalEmpty(z.string().email()),
  contactPhone: optionalEmpty(phoneSchema),
  rtwCoordinatorName: optionalEmpty(z.string().max(200)),
  rtwCoordinatorEmail: optionalEmpty(z.string().email()),
  rtwCoordinatorPhone: optionalEmpty(phoneSchema),
  hrContactName: optionalEmpty(z.string().max(200)),
  hrContactEmail: optionalEmpty(z.string().email()),
  hrContactPhone: optionalEmpty(phoneSchema),
  notificationEmails: notificationEmailsSchema.optional(),
  notes: optionalEmpty(z.string().max(2000)),
};

export const updatePartnerSelfSchema = z.object(partnerSelfFields).partial();

export type UpdatePartnerSelfInput = z.infer<typeof updatePartnerSelfSchema>;
