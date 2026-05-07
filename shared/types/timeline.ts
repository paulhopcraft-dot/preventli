// Worker health timeline event shape.
//
// Named WorkerHealthTimelineEvent (not just TimelineEvent) to avoid collision
// with the case-scoped `TimelineEvent` interface in shared/schema.ts:1186.
// This type is consumed by the worker-profile health-timeline endpoint and
// the matching client component.

export type WorkerHealthTimelineEventType = "assessment" | "case" | "certificate";

export type WorkerHealthTimelineBadgeTone = "green" | "amber" | "red" | "blue" | "gray";

export interface WorkerHealthTimelineEventBadge {
  label: string;
  tone: WorkerHealthTimelineBadgeTone;
}

export interface WorkerHealthTimelineEvent {
  id: string;
  type: WorkerHealthTimelineEventType;
  date: string;            // ISO 8601, used for sort
  title: string;           // e.g. "Pre-employment: Warehouse Operative"
  subtitle?: string;       // e.g. "Cleared unconditional"
  badge?: WorkerHealthTimelineEventBadge;
  deepLink: string;        // e.g. "/assessments/abc", "/employer/case/xyz?tab=treatment"
  sourceId: string;        // original record ID for deduplication
}
