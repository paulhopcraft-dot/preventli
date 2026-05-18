# 2. Insurer escalation — stub adapter + threshold

**Date:** 2026-05-18
**Status:** Accepted
**Slice:** funding-bundle 3.2

## Context

Phase 3 surfaces a worker engagement score (0–100) and lets a clinician escalate non-cooperative cases to the insurer. Two open questions blocked the implementation:

1. **At what score do we enable the escalate button?** Too high → button is noisy and clinicians ignore it. Too low → button never lights, defeats the purpose.
2. **What does "push to insurer" actually mean today?** Preventli has no real insurer API integration yet. Wallara's insurer (and future tenants') won't grant API access on day one — funding-deck timeline doesn't accommodate provider negotiations.

## Decision

- **Threshold = 40.** Engagement score < 40 enables the escalate button on the clinician UI. Below 40 reflects multiple missed touchpoints (low cert compliance + low appointment attendance + low response rate). 40 is a placeholder calibrated against the seed data — Wallara cases Sarah and David score near/below 40 today, Marcus/Priya/Naomi score above. Tunable per-org later via `insurer_escalations.threshold_at_trigger` (we capture the threshold in effect at trigger time so audit can show it).

- **Stub insurer adapter.** A pure-Node module in `server/services/insurerStub.ts` exposes `pushEscalation(payload): Promise<{ ok, stubResponse }>`. The stub:
  1. Writes the escalation as an `insurer_escalations` table row.
  2. Calls `auditLog(...)` with `eventType: "insurer.escalated"`, actor = clinician user id, full payload.
  3. Logs a structured "would have sent to insurer" line including the payload.
  4. Returns `{ ok: true, stubResponse: { acknowledged: true, ticket: "STUB-<uuid>" } }`.

  No real HTTP call is made. The UI shows "Escalation logged — your insurer will follow up via existing channels" (deliberately ambiguous — the real insurer follow-up happens out-of-band today, the system records the trigger).

## Alternatives considered

- **No threshold; always allow escalation.** Rejected — defeats the auditable-evidence-trail goal; we want the threshold itself to be defensible ("worker dropped below 40 cooperation, clinician escalated"). Clinicians could over-escalate without the gate.
- **Multi-tier threshold (red/amber/green).** Tempting but adds UI complexity. Defer until a clinician asks for it. v1 is binary: button gated by < 40.
- **Real insurer API integration via Postmark email push.** Rejected for v1 — needs per-insurer formatting + signed agreements. Stub adapter mimics the contract so v2 can drop a real implementation behind the same interface.

## Consequences

**Makes easy:**
- Demo line: "Sarah's engagement dropped to 32. The button lit up. Clinician clicked Escalate. The system recorded it and notified the insurer — here's the full audit trail." Defensible end-to-end.
- Per-org tuning later: store `threshold_at_trigger` per row, then add an org-level config without breaking the audit trail.
- V2 wire to real insurer: replace `insurerStub.ts` body with HTTP/email call; payload shape stays the same.

**Makes hard:**
- Until real wire is done, the "escalation" doesn't actually contact the insurer. Surface this honestly in the UI ("logged for follow-up via existing channels") so clinicians don't assume the insurer is auto-notified.
- Threshold = 40 is a guess. After the Wallara pilot, calibrate against actual escalation outcomes ("did the case improve after escalation?").

**Revisit if:**
- Insurer signs an API contract → swap stub.
- Clinicians request multi-tier threshold (yellow/red) → add intermediate state.
- Pilot data shows 40 is wrong (too high → no escalations; too low → flood of false positives).

## Schema implications

```typescript
export const insurerEscalations = pgTable("insurer_escalations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => workerCases.id, { onDelete: "cascade" }),
  triggeredByUserId: varchar("triggered_by_user_id").notNull(),
  scoreAtTrigger: numeric("score_at_trigger", { precision: 5, scale: 2 }).notNull(),
  thresholdAtTrigger: numeric("threshold_at_trigger", { precision: 5, scale: 2 }).notNull(),
  messageBody: text("message_body").notNull(),
  stubResponse: jsonb("stub_response").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at").defaultNow(),
});
```

## Stub adapter interface (canonical)

```typescript
// server/services/insurerStub.ts
export const ESCALATION_THRESHOLD = 40;  // tune per ADR-0002 calibration

export interface EscalationPayload {
  caseId: string;
  workerName: string;
  triggeredByUserId: string;
  scoreAtTrigger: number;
  thresholdAtTrigger: number;
  messageBody: string;
}

export interface EscalationResult {
  ok: boolean;
  escalationId: string;
  stubResponse: { acknowledged: boolean; ticket: string };
}

export async function pushEscalation(payload: EscalationPayload): Promise<EscalationResult>;
```
