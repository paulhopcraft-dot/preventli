# GPNet Implementation Plan

This file is for engineering leadership: how to actually build GPNet in a sane order.

---

## 1. Foundations

1. **Repo structure**
   - `/server` – Express app + Drizzle + controllers
   - `/client` – React app + Vite + React Query
   - `/shared` – Schema, types

2. **Basic DB schema**
   - Users, Organisations, Workers, Cases
   - Minimal Documents, TimelineEvent

3. **Auth & Security**
   - JWT auth with `/auth/login`, `/auth/me`, `/auth/logout`
   - Invite-based registration
   - CSRF, rate limiting, helmet
   - No dev bypasses

---

## 2. Phase Breakdown

### Phase 1 — Auth, Shell, and Basic Cases

- Implement:
  - Auth flows in frontend (login, session restore, logout)
  - Case list & case detail skeleton (no advanced functionality)
- Outcome:
  - You can log in and click around real seeded cases.

### Phase 2 — Timeline Engine

- Implement:
  - TimelineEvent schema
  - Storage logic aggregating events from seed data
  - `/api/cases/:id/timeline`
  - TimelineCard in CaseDetailPanel
- Outcome:
  - One screen shows "what happened" in a case.

### Phase 3 — Certificate Engine v1

- Implement:
  - Certificate schema
  - Storage & service for certificates
  - `/api/cases/:id/certificates`
  - Ingestion from seed data / manual entry
- Outcome:
  - Certificates exist and appear in the Timeline.

### Phase 4 — Certificate UI + Compliance + Action Queue v1

- Implement:
  - CertificateCard in CaseDetailPanel
  - Compliance Engine v1 (certificate rules)
  - Action model
  - Actions created from compliance state
  - ActionQueueCard on Dashboard
- Outcome:
  - System now says "These are the workers you need to chase certificates for".

### Phase 5 — Weekly Check-ins & Basic Worker Monitoring

- Implement:
  - Check-in model & endpoints
  - Simple UI to show last X check-ins per worker
  - Manual creation / stubbed automation

### Phase 6 — Smart Summary v1

- Implement:
  - `/api/cases/:id/summary`
  - SummaryCard component
  - LLM prompt anchored to TimelineEvents + Certificates + Actions

### Phase 7 — Integration Hardening (Freshdesk & Webhooks)

- Implement:
  - Robust Freshdesk email ingestion
  - JotForm webhooks with authentication
  - Document + Case linking rules
  - Timeline events for all incoming/outgoing messages

### Phase 8 — RTW Planning v1

- Implement:
  - RTWPlan model
  - UI to define phased RTW plans
  - Timeline events when plan phases change

### Phase 9 — Behaviour & Risk Signals

- Implement:
  - Basic sentiment scoring & flags
  - Display in CaseDetailPanel and Summary

### Phase 10 — Reporting & Exports

- Implement:
  - Org-level summary panes
  - Downloads for audits
  - Multi-case filters and exports

---

## 3. Engineering Practices

- Use TypeScript end-to-end.
- Keep controllers thin; push logic into services/storage.
- For every new module:
  - Add tests (Vitest + supertest / RTL).
  - Add at least:
    - 1 backend test file
    - 1 minimal frontend component test
    - 1 manual test checklist in a `MODULE_TESTING.md`

- Never add dev-only bypasses for auth/security.
- Use feature flags or env gates for risky automation (Auto-Send etc.).

---

## 4. How to Use These Specs With Claude

When using Claude Code:

1. Feed it:
   - `GPNET_MASTER_OVERVIEW.md`
   - `ARCHITECTURE.md`
   - `CORE_MODULES.md`
   - The relevant section of `IMPLEMENTATION_PLAN.md`
2. Then ask for:
   - A plan for the specific module
   - Implementation changes (with repo read first)
   - Tests and manual instructions

Always force Claude to:

- Read repo first
- Generate a plan
- Auto-approve and implement
- Show full file contents for changed files

These four documents, together, are enough for a capable team (or Claude + you) to implement the full GPNet case management platform from scratch.
