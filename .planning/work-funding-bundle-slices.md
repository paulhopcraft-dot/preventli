# Slice list — funding-bundle

18 vertical slices across 4 phases. Each is independently demoable.
Dependency order: must complete N before N+1 within phase, phases in order.

---

## Phase 0 — Shared audit-trail infra + seed updates (3 slices)

### 0.1 audit_events table + boot-time migration + storage methods
**Files:** `shared/schema.ts`, `server/index.ts` (migration block), `server/storage.ts`
**Demo:** A clinician hits any API mutation → row appears in audit_events.
**Verify:** scoped tsc clean; INSERT/SELECT smoke test; `auditLog()` exported from storage.
**Blocked by:** none.

### 0.2 auditLog() helper + middleware + first 3 routes wired
**Files:** `server/lib/auditLog.ts` (new), `server/routes/cases.ts` (wire), `server/routes/certificates.ts` (wire), `server/routes/rtwPlans.ts` (wire)
**Demo:** PATCH /api/cases/:id → returns 200 + audit_events row written.
**Verify:** integration test asserts `auditLog()` called on the 3 wired mutations.
**Blocked by:** 0.1.

### 0.3 GET /api/audit-events endpoint + admin UI link from case detail
**Files:** `server/routes/admin/audit-events.ts` (new), `client/src/components/AuditTrailLink.tsx` (new), mount on case detail page
**Demo:** admin clicks "View audit trail" on a case → modal shows scoped events.
**Verify:** route returns 401 unauth, 200 with admin; UI link visible on case detail.
**Blocked by:** 0.2.

---

## Phase 1 — Contact cadence guardrails (5 slices)

### 1.1 contact_suppressions table + boot-time migration + storage CRUD
**Files:** `shared/schema.ts`, `server/index.ts` (migration), `server/storage.ts`
**Demo:** INSERT/SELECT smoke test on the new table.
**Verify:** scoped tsc; table exists post-boot; storage methods typed.
**Blocked by:** 0.1.

### 1.2 POST + DELETE contact-suppression endpoints + auditLog wire
**Files:** `server/routes/contact-suppressions.ts` (new), mount in `server/routes.ts`
**Demo:** curl POST → row created + audit_events entry written.
**Verify:** integration test for create/destroy + audit_events assertion.
**Blocked by:** 1.1, 0.2.

### 1.3 isOutreachAllowed(workerId) helper + integrate into 2 existing outbound paths
**Files:** `server/lib/contactGuard.ts` (new), wire into `server/services/notificationScheduler.ts` + `server/services/rtwAutoDrafter.ts`
**Demo:** when worker is suppressed, scheduler logs "skipped: suppressed" instead of sending.
**Verify:** unit test on `isOutreachAllowed`; integration test asserts skip behavior.
**Blocked by:** 1.1.

### 1.4 Alex distress-signal detector + LLM-decision logging
**Files:** `server/services/distressDetector.ts` (new), wire into `server/routes/inbound-email.ts` post-receive
**Demo:** demo email with "stop contacting me" → detector flags + auto-creates suppression + logs model/prompt/response on audit_events.
**Verify:** unit test on detector with sample inputs; integration test asserts LLM decision logged.
**Blocked by:** 1.2.

### 1.5 ContactSuppressionBadge UI on case detail + suppress/unsuppress mutation
**Files:** `client/src/components/ContactSuppressionBadge.tsx` (new), mount on `client/src/pages/UnifiedCaseWorkspace.tsx`
**Demo:** clinician clicks "Pause outreach" → badge updates, audit trail shows action.
**Verify:** Playwright E2E for mark-distressed flow.
**Blocked by:** 1.2.

---

## Phase 2 — Premium calculator (5 slices)

### 2.1 HITL — premium formula + source citation captured
**Type:** HITL
**Files:** `config/premium-formula.ts` (new), `docs/adr/0001-premium-impact-formula.md` (new)
**Demo:** formula coefficients + source citation visible in config; ADR explains tradeoffs.
**Verify:** ADR file present; formula module exports `calculate(caseInput): { saved, baseline, components }`.
**Blocked by:** Paul provides the formula. Loop pauses with HITL CARD.

### 2.2 case_premium_impacts table + boot-time migration + recompute on case mutation
**Files:** `shared/schema.ts`, `server/index.ts` (migration), `server/services/premiumImpact.ts` (new)
**Demo:** updating a case triggers recompute; row appears in case_premium_impacts.
**Verify:** integration test asserts row exists after case update.
**Blocked by:** 2.1.

### 2.3 GET /api/cases/:id/premium-impact endpoint + cache
**Files:** `server/routes/premium-impact.ts` (new), mount in `server/routes.ts`
**Demo:** curl returns `{ savedDollars, baselineDollars, components, formulaVersion }`.
**Verify:** integration test; cache invalidates on case mutation.
**Blocked by:** 2.2.

### 2.4 PremiumImpactCard UI on case detail right column
**Files:** `client/src/components/PremiumImpactCard.tsx` (new), mount on UnifiedCaseWorkspace
**Demo:** card shows "$X saved" + breakdown chips; Marcus shows non-zero.
**Verify:** Playwright E2E asserts card renders with non-empty dollar.
**Blocked by:** 2.3.

### 2.5 GET /api/cases/portfolio-summary + PortfolioImpactCard on CFO dashboard
**Files:** `server/routes/portfolio-summary.ts` (new), `client/src/components/PortfolioImpactCard.tsx` (new), mount on ReportsPage (or wherever CFO lands)
**Demo:** org-scoped aggregate "$ saved across N cases" visible.
**Verify:** Playwright E2E asserts portfolio card renders.
**Blocked by:** 2.3.

---

## Phase 3 — Engagement scoring + insurer escalation (5 slices)

### 3.1 worker_engagement_scores table + boot-time migration + scoring formula
**Files:** `shared/schema.ts`, `server/index.ts` (migration), `server/services/engagementScore.ts` (new — pure function)
**Demo:** unit test: given event history, returns 0-100 score + components.
**Verify:** unit tests cover edge cases (no events, all positive, all negative).
**Blocked by:** 0.1.

### 3.2 HITL — insurer-escalation criteria + stub adapter format
**Type:** HITL
**Files:** `docs/adr/0002-insurer-escalation.md` (new), `server/services/insurerStub.ts` (new — stub adapter)
**Demo:** ADR documents threshold + endpoint format; stub adapter logs push + returns success.
**Verify:** ADR present; stub adapter exports `pushEscalation(payload): Promise<{ ok, stubResponse }>`.
**Blocked by:** Paul provides criteria. Loop pauses with HITL CARD.

### 3.3 Score recompute hook on 5 event types + insurer_escalations table
**Files:** `shared/schema.ts`, `server/index.ts` (migration), wire scoring hook into 5 existing handlers (certificate, appointment, contact, case-update, message)
**Demo:** worker engagement score updates as events fire; threshold-breach emits prepped escalation.
**Verify:** integration test simulates event sequence → asserts score changes + escalation row written.
**Blocked by:** 3.1, 3.2.

### 3.4 GET /api/workers/:id/engagement-score + POST /api/cases/:id/escalate-to-insurer
**Files:** `server/routes/engagement.ts` (new), mount in `server/routes.ts`
**Demo:** curl GET returns score + components; POST returns 200 + stub response logged.
**Verify:** integration tests on both endpoints + audit_events assertions.
**Blocked by:** 3.3.

### 3.5 EngagementScoreBadge + EscalateToInsurerButton UI
**Files:** `client/src/components/EngagementScoreBadge.tsx`, `client/src/components/EscalateToInsurerButton.tsx`, mount on UnifiedCaseWorkspace + WorkerProfile
**Demo:** clinician sees score badge; below threshold the escalate button enables; click → toast + audit visible.
**Verify:** Playwright E2E for the full escalate flow.
**Blocked by:** 3.4.

---

## Master verify (`~/.claude/verify/funding-bundle-all-slices.sh`)

- All 18 issues labeled `funding-bundle` are CLOSED
- Each per-slice verify script returns 0
- Grep checks:
  - `audit_events`, `contact_suppressions`, `case_premium_impacts`, `worker_engagement_scores`, `insurer_escalations` defined in shared/schema.ts
  - `auditLog(` called from ≥6 route files
  - `ContactSuppressionBadge`, `PremiumImpactCard`, `EngagementScoreBadge`, `EscalateToInsurerButton`, `PortfolioImpactCard` mounted in at least one parent component
  - `config/premium-formula.ts` exists + ADR-0001 + ADR-0002 exist
- Scoped tsc on changed-dirs: no new errors vs baseline (baseline=1)
