import { describe, it, expect } from "vitest";
import { composeBriefingAlerts } from "./briefingAlerts";
import type { WorkerCase } from "@shared/schema";

function makeCase(overrides: Partial<WorkerCase> & { id: string; workerName: string }): WorkerCase {
  return {
    id: overrides.id,
    organizationId: "org-test",
    workerName: overrides.workerName,
    company: "TestCo",
    dateOfInjury: "2026-01-01",
    riskLevel: "Medium" as any,
    workStatus: "Off work" as any,
    hasCertificate: true,
    complianceIndicator: "Medium" as any,
    currentStatus: "active",
    nextStep: "tbd",
    owner: "test",
    dueDate: "2026-06-01",
    summary: "",
    ticketIds: [overrides.id],
    ticketCount: 1,
    ...overrides,
  } as WorkerCase;
}

describe("composeBriefingAlerts", () => {
  it("returns empty when no cases trigger", () => {
    expect(composeBriefingAlerts([])).toEqual([]);
    expect(
      composeBriefingAlerts([
        makeCase({ id: "c1", workerName: "Calm Casey" }),
      ]),
    ).toEqual([]);
  });

  it("flags GP escalation with high severity when 14+ days overdue", () => {
    const alerts = composeBriefingAlerts([
      makeCase({
        id: "c1",
        workerName: "Sarah Chen",
        gpEscalation: { escalated: true, daysOverdue: 18, reason: "cert_expired_no_followup" },
      }),
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].category).toBe("gp_escalation");
    expect(alerts[0].severity).toBe("high");
    expect(alerts[0].title).toBe("Sarah Chen's GP certificate is 18 days overdue");
    expect(alerts[0].suggestedAction).toContain("IME");
  });

  it("flags GP escalation with medium severity when 7-13 days overdue", () => {
    const alerts = composeBriefingAlerts([
      makeCase({
        id: "c1",
        workerName: "Marcus Tanaka",
        gpEscalation: { escalated: true, daysOverdue: 9, reason: "cert_expired_no_followup" },
      }),
    ]);
    expect(alerts[0].severity).toBe("medium");
    expect(alerts[0].suggestedAction).toContain("Chase the GP");
    expect(alerts[0].title).toContain("9 days");
  });

  it("flags 'Very Low' compliance as high severity (with reason)", () => {
    const alerts = composeBriefingAlerts([
      makeCase({
        id: "c1",
        workerName: "Priya Reddy",
        complianceIndicator: "Very Low" as any,
        compliance: { indicator: "Very Low", reason: "No certificate on file for 30 days" } as any,
      }),
    ]);
    expect(alerts[0].category).toBe("compliance");
    expect(alerts[0].severity).toBe("high");
    expect(alerts[0].detail).toBe("No certificate on file for 30 days");
  });

  it("flags 'Low' compliance as medium severity (with reason)", () => {
    const alerts = composeBriefingAlerts([
      makeCase({
        id: "c1",
        workerName: "James O'Brien",
        complianceIndicator: "Low" as any,
        compliance: { indicator: "Low", reason: "RTW plan overdue" } as any,
      }),
    ]);
    expect(alerts[0].severity).toBe("medium");
  });

  it("REFUSES to surface low compliance without a stored reason (compliance-reason-required rule)", () => {
    const alerts = composeBriefingAlerts([
      makeCase({
        id: "c1",
        workerName: "Liam Brennan",
        complianceIndicator: "Very Low" as any,
        compliance: undefined,
      }),
    ]);
    expect(alerts).toHaveLength(0);
  });

  it("sorts high before medium before low", () => {
    const alerts = composeBriefingAlerts([
      makeCase({
        id: "c1",
        workerName: "Medium Compliance Casey",
        complianceIndicator: "Low" as any,
        compliance: { indicator: "Low", reason: "RTW overdue" } as any,
      }),
      makeCase({
        id: "c2",
        workerName: "High GP Henry",
        gpEscalation: { escalated: true, daysOverdue: 20, reason: "cert_expired_no_followup" },
      }),
      makeCase({
        id: "c3",
        workerName: "Medium GP Mira",
        gpEscalation: { escalated: true, daysOverdue: 8, reason: "cert_expired_no_followup" },
      }),
    ]);
    // High first, then within "medium" tier GP escalation beats compliance.
    expect(alerts.map(a => a.workerName)).toEqual(["High GP Henry", "Medium GP Mira", "Medium Compliance Casey"]);
  });

  it("breaks ties at same severity by preferring GP escalation over compliance", () => {
    const alerts = composeBriefingAlerts([
      makeCase({
        id: "c1",
        workerName: "Compliance Carla",
        complianceIndicator: "Very Low" as any,
        compliance: { indicator: "Very Low", reason: "missing cert" } as any,
      }),
      makeCase({
        id: "c2",
        workerName: "GP Greg",
        gpEscalation: { escalated: true, daysOverdue: 15, reason: "cert_expired_no_followup" },
      }),
    ]);
    expect(alerts[0].workerName).toBe("GP Greg");
    expect(alerts[1].workerName).toBe("Compliance Carla");
  });

  it("respects the limit parameter", () => {
    const cases = Array.from({ length: 10 }, (_, i) =>
      makeCase({
        id: `c${i}`,
        workerName: `Worker ${i}`,
        gpEscalation: { escalated: true, daysOverdue: 20 - i, reason: "cert_expired_no_followup" },
      }),
    );
    expect(composeBriefingAlerts(cases, 3)).toHaveLength(3);
    expect(composeBriefingAlerts(cases, 100)).toHaveLength(10);
  });

  it("uses singular day for daysOverdue === 1", () => {
    const alerts = composeBriefingAlerts([
      makeCase({
        id: "c1",
        workerName: "Just Over Joey",
        gpEscalation: { escalated: true, daysOverdue: 1, reason: "cert_expired_no_followup" },
      }),
    ]);
    expect(alerts[0].title).toContain("1 day overdue");
    expect(alerts[0].title).not.toContain("1 days");
  });

  it("can yield multiple alerts per case (independent dimensions)", () => {
    const alerts = composeBriefingAlerts([
      makeCase({
        id: "c1",
        workerName: "Multi-Issue Mike",
        gpEscalation: { escalated: true, daysOverdue: 20, reason: "cert_expired_no_followup" },
        complianceIndicator: "Very Low" as any,
        compliance: { indicator: "Very Low", reason: "no recent cert" } as any,
      }),
    ]);
    expect(alerts).toHaveLength(2);
    expect(new Set(alerts.map(a => a.category))).toEqual(new Set(["gp_escalation", "compliance"]));
  });
});
