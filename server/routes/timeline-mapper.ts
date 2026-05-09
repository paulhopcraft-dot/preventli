// Pure mapping helpers for the worker-health-timeline endpoint.
// Extracted from server/routes/workers.ts so unit tests can exercise the
// mapping logic without standing up the full Express router.
//
// Each mapper takes a typed DB row and returns a WorkerHealthTimelineEvent.

import type {
  PreEmploymentAssessmentDB,
  WorkerCaseDB,
  MedicalCertificateDB,
} from "@shared/schema";
import type {
  WorkerHealthTimelineEvent,
  WorkerHealthTimelineBadgeTone,
} from "@shared/types/timeline";

function humanise(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function humaniseClearance(level: string): string {
  return humanise(level);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)) + "…";
}

function formatDate(d: Date): string {
  // dd MMM yyyy in en-AU to match the client formatter pattern.
  return d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function toneFromClearance(level: string | null): WorkerHealthTimelineBadgeTone {
  switch (level) {
    case "cleared_unconditional":
    case "cleared_conditional":
      return "green";
    case "cleared_with_restrictions":
      return "amber";
    case "not_cleared":
      return "red";
    case "requires_review":
    case "pending_review":
      return "amber";
    default:
      return "gray";
  }
}

export function toneFromCaseStatus(row: WorkerCaseDB): WorkerHealthTimelineBadgeTone {
  const closed = row.caseStatus === "closed" || row.currentStatus?.toLowerCase() === "closed" || row.currentStatus?.toLowerCase() === "resolved";
  if (closed) return "gray";
  const risk = (row.riskLevel ?? "").toLowerCase();
  if (risk === "high") return "red";
  if (risk === "medium") return "amber";
  return "blue";
}

export function assessmentToEvent(a: PreEmploymentAssessmentDB): WorkerHealthTimelineEvent {
  const dateValue = a.completedDate ?? a.sentAt ?? a.createdAt ?? new Date();
  const date = (dateValue instanceof Date ? dateValue : new Date(dateValue)).toISOString();
  const clearance = a.clearanceLevel ?? null;
  const event: WorkerHealthTimelineEvent = {
    id: a.id,
    type: "assessment",
    date,
    title: `${humanise(a.assessmentType)} — ${a.positionTitle}`,
    deepLink: `/assessments/${a.id}`,
    sourceId: a.id,
  };
  if (clearance) {
    event.subtitle = humaniseClearance(clearance);
    event.badge = { label: humaniseClearance(clearance), tone: toneFromClearance(clearance) };
  }
  return event;
}

export function caseToEvent(c: WorkerCaseDB): WorkerHealthTimelineEvent {
  const dateValue = c.dateOfInjury ?? c.createdAt ?? new Date();
  const date = (dateValue instanceof Date ? dateValue : new Date(dateValue)).toISOString();
  const subtitleParts = [c.currentStatus, c.workStatus].filter((v): v is string => Boolean(v));
  const badgeLabel = c.riskLevel ?? c.currentStatus ?? "Case";
  const event: WorkerHealthTimelineEvent = {
    id: c.id,
    type: "case",
    date,
    title: truncate(c.summary ?? "Case", 80),
    badge: { label: badgeLabel, tone: toneFromCaseStatus(c) },
    deepLink: `/employer/case/${c.id}`,
    sourceId: c.id,
  };
  if (subtitleParts.length > 0) {
    event.subtitle = subtitleParts.join(" — ");
  }
  return event;
}

export function certificateToEvent(cert: MedicalCertificateDB, now: Date = new Date()): WorkerHealthTimelineEvent {
  const issueDate = cert.issueDate instanceof Date ? cert.issueDate : new Date(cert.issueDate);
  const start = cert.startDate instanceof Date ? cert.startDate : (cert.startDate ? new Date(cert.startDate) : null);
  const end = cert.endDate instanceof Date ? cert.endDate : (cert.endDate ? new Date(cert.endDate) : null);
  const isCurrent = end !== null && end.getTime() >= now.getTime();
  const event: WorkerHealthTimelineEvent = {
    id: cert.id,
    type: "certificate",
    date: issueDate.toISOString(),
    title: `Medical certificate — ${cert.capacity ?? "capacity TBD"}`,
    badge: {
      label: isCurrent ? "Current" : "Expired",
      tone: isCurrent ? "blue" : "gray",
    },
    deepLink: `/employer/case/${cert.caseId}?tab=treatment`,
    sourceId: cert.id,
  };
  if (start && end) {
    event.subtitle = `${formatDate(start)} to ${formatDate(end)}`;
  }
  return event;
}

/**
 * Merge and sort timeline events by `date` descending. Stable sort behavior
 * is sufficient — ties are broken by the input array order (assessments
 * before cases before certificates per the route's call order).
 */
export function mergeAndSortTimelineEvents(
  assessments: PreEmploymentAssessmentDB[],
  cases: WorkerCaseDB[],
  certificates: MedicalCertificateDB[],
  now: Date = new Date(),
): WorkerHealthTimelineEvent[] {
  const events: WorkerHealthTimelineEvent[] = [
    ...assessments.map(assessmentToEvent),
    ...cases.map(caseToEvent),
    ...certificates.map((c) => certificateToEvent(c, now)),
  ];
  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return events;
}
