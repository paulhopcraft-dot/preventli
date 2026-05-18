import { describe, it, expect } from "vitest";
import {
  calculateEngagementScore,
  ENGAGEMENT_WEIGHTS,
  type EngagementEvent,
} from "./engagementScore";

// Helper: build a date N days ago from now
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

describe("calculateEngagementScore", () => {
  it("empty events → score 50, eventCount 0, all components 50", () => {
    const result = calculateEngagementScore([]);
    expect(result.score).toBe(50);
    expect(result.eventCount).toBe(0);
    expect(result.components.certificateCompliance).toBe(50);
    expect(result.components.appointmentAttendance).toBe(50);
    expect(result.components.responseRate).toBe(50);
    expect(result.components.recencyBonus).toBe(50);
    expect(result.formulaVersion).toBe("v1");
  });

  it("all-positive recent events → score >= 90", () => {
    const events: EngagementEvent[] = [
      // 5 cert.received
      ...Array.from({ length: 5 }, () => ({ type: "cert.received", occurredAt: daysAgo(3) })),
      // 5 appointment.attended
      ...Array.from({ length: 5 }, () => ({ type: "appointment.attended", occurredAt: daysAgo(5) })),
      // 5 message.responded
      ...Array.from({ length: 5 }, () => ({ type: "message.responded", occurredAt: daysAgo(7) })),
    ];
    const result = calculateEngagementScore(events);
    expect(result.score).toBeGreaterThanOrEqual(90);
    expect(result.eventCount).toBe(15);
    expect(result.components.certificateCompliance).toBe(100);
    expect(result.components.appointmentAttendance).toBe(100);
    expect(result.components.responseRate).toBe(100);
    expect(result.components.recencyBonus).toBe(100);
  });

  it("all-negative recent events → score <= 30", () => {
    const events: EngagementEvent[] = [
      // 5 cert.late
      ...Array.from({ length: 5 }, () => ({ type: "cert.late", occurredAt: daysAgo(3) })),
      // 5 appointment.noshow
      ...Array.from({ length: 5 }, () => ({ type: "appointment.noshow", occurredAt: daysAgo(5) })),
      // 5 message.no-response
      ...Array.from({ length: 5 }, () => ({ type: "message.no-response", occurredAt: daysAgo(7) })),
    ];
    const result = calculateEngagementScore(events);
    expect(result.score).toBeLessThanOrEqual(30);
    expect(result.components.certificateCompliance).toBe(0);
    expect(result.components.appointmentAttendance).toBe(0);
    expect(result.components.responseRate).toBe(0);
    // recencyBonus = 100 (events are recent) but total is still low due to other components
  });

  it("mixed events with one contact.suppressed → score is dampened", () => {
    // Perfect score events (all positive, recent)
    const baseEvents: EngagementEvent[] = [
      ...Array.from({ length: 5 }, () => ({ type: "cert.received", occurredAt: daysAgo(3) })),
      ...Array.from({ length: 5 }, () => ({ type: "appointment.attended", occurredAt: daysAgo(5) })),
      ...Array.from({ length: 5 }, () => ({ type: "message.responded", occurredAt: daysAgo(7) })),
    ];
    const withSuppression: EngagementEvent[] = [
      ...baseEvents,
      { type: "contact.suppressed", occurredAt: daysAgo(10) },
    ];

    const baseResult = calculateEngagementScore(baseEvents);
    const suppressedResult = calculateEngagementScore(withSuppression);

    // Suppressed score should be lower by exactly 10 points
    expect(suppressedResult.score).toBe(Math.max(0, baseResult.score - 10));
    expect(suppressedResult.eventCount).toBe(baseEvents.length + 1);
  });

  it("recency: events all >30 days old → recencyBonus = 0", () => {
    const events: EngagementEvent[] = [
      { type: "cert.received", occurredAt: daysAgo(45) },
      { type: "appointment.attended", occurredAt: daysAgo(60) },
      { type: "message.responded", occurredAt: daysAgo(35) },
    ];
    const result = calculateEngagementScore(events);
    expect(result.components.recencyBonus).toBe(0);
  });

  it("recency: most recent event 15-30 days ago → recencyBonus = 50", () => {
    const events: EngagementEvent[] = [
      { type: "cert.received", occurredAt: daysAgo(20) },
    ];
    const result = calculateEngagementScore(events);
    expect(result.components.recencyBonus).toBe(50);
  });

  it("weights sum to 1.0 (sanity check on ENGAGEMENT_WEIGHTS constant)", () => {
    const total = Object.values(ENGAGEMENT_WEIGHTS).reduce((sum, w) => sum + w, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });

  it("score is clamped to 0 when multiple suppressions push below zero", () => {
    // Minimal events + many suppressions
    const events: EngagementEvent[] = [
      { type: "cert.late", occurredAt: daysAgo(5) },
      ...Array.from({ length: 15 }, () => ({ type: "contact.suppressed", occurredAt: daysAgo(10) })),
    ];
    const result = calculateEngagementScore(events);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("mixed positive and negative → score between 30 and 70", () => {
    const events: EngagementEvent[] = [
      { type: "cert.received", occurredAt: daysAgo(5) },
      { type: "cert.late", occurredAt: daysAgo(10) },
      { type: "appointment.attended", occurredAt: daysAgo(7) },
      { type: "appointment.noshow", occurredAt: daysAgo(14) },
      { type: "message.responded", occurredAt: daysAgo(3) },
      { type: "message.no-response", occurredAt: daysAgo(8) },
    ];
    const result = calculateEngagementScore(events);
    expect(result.score).toBeGreaterThanOrEqual(30);
    expect(result.score).toBeLessThanOrEqual(70);
    // 50/50 on all components = 50, plus recency bonus pushes above 50
    expect(result.components.certificateCompliance).toBe(50);
    expect(result.components.appointmentAttendance).toBe(50);
    expect(result.components.responseRate).toBe(50);
  });
});
