import { describe, it, expect } from "vitest";
import { detectGpEscalation } from "./gpEscalation";

const TODAY = new Date("2026-05-15T00:00:00.000Z");

describe("detectGpEscalation", () => {
  it("returns no_certificate when latestCert is null", () => {
    const r = detectGpEscalation({ latestCert: null, today: TODAY, thresholdDays: 7 });
    expect(r.escalated).toBe(false);
    expect(r.reason).toBe("no_certificate");
    expect(r.daysOverdue).toBe(0);
  });

  it("returns no_end_date when endDate is null", () => {
    const r = detectGpEscalation({ latestCert: { endDate: null }, today: TODAY, thresholdDays: 7 });
    expect(r.escalated).toBe(false);
    expect(r.reason).toBe("no_end_date");
  });

  it("returns no_end_date when endDate is an invalid string", () => {
    const r = detectGpEscalation({ latestCert: { endDate: "not-a-date" }, today: TODAY, thresholdDays: 7 });
    expect(r.escalated).toBe(false);
    expect(r.reason).toBe("no_end_date");
  });

  it("returns cert_current when endDate is in the future", () => {
    const future = new Date("2026-06-01T00:00:00.000Z");
    const r = detectGpEscalation({ latestCert: { endDate: future }, today: TODAY, thresholdDays: 7 });
    expect(r.escalated).toBe(false);
    expect(r.reason).toBe("cert_current");
  });

  it("returns cert_current when expired but within threshold", () => {
    // expired 5 days ago, threshold 7 → still current
    const fiveDaysAgo = new Date(TODAY.getTime() - 5 * 24 * 60 * 60 * 1000);
    const r = detectGpEscalation({ latestCert: { endDate: fiveDaysAgo }, today: TODAY, thresholdDays: 7 });
    expect(r.escalated).toBe(false);
    expect(r.reason).toBe("cert_current");
  });

  it("escalates on threshold boundary (daysSinceExpiry === thresholdDays)", () => {
    const sevenDaysAgo = new Date(TODAY.getTime() - 7 * 24 * 60 * 60 * 1000);
    const r = detectGpEscalation({ latestCert: { endDate: sevenDaysAgo }, today: TODAY, thresholdDays: 7 });
    expect(r.escalated).toBe(true);
    expect(r.reason).toBe("cert_expired_no_followup");
    expect(r.daysOverdue).toBe(7);
  });

  it("escalates when well past threshold", () => {
    const thirtyDaysAgo = new Date(TODAY.getTime() - 30 * 24 * 60 * 60 * 1000);
    const r = detectGpEscalation({ latestCert: { endDate: thirtyDaysAgo }, today: TODAY, thresholdDays: 7 });
    expect(r.escalated).toBe(true);
    expect(r.daysOverdue).toBe(30);
  });

  it("respects a custom threshold (org config)", () => {
    const tenDaysAgo = new Date(TODAY.getTime() - 10 * 24 * 60 * 60 * 1000);
    const lenient = detectGpEscalation({ latestCert: { endDate: tenDaysAgo }, today: TODAY, thresholdDays: 14 });
    expect(lenient.escalated).toBe(false);
    const strict = detectGpEscalation({ latestCert: { endDate: tenDaysAgo }, today: TODAY, thresholdDays: 3 });
    expect(strict.escalated).toBe(true);
    expect(strict.daysOverdue).toBe(10);
  });

  it("accepts endDate as ISO string", () => {
    const tenDaysAgoIso = new Date(TODAY.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const r = detectGpEscalation({ latestCert: { endDate: tenDaysAgoIso }, today: TODAY, thresholdDays: 7 });
    expect(r.escalated).toBe(true);
    expect(r.daysOverdue).toBe(10);
  });
});
