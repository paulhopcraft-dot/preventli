# Preventli System Audit

**Date:** 2026-03-05
**Auditor:** Senior Principal Architect Review
**Scope:** Full repository — `/mnt/d/dev/gpnet3`
**Method:** Direct code inspection (no speculation)

---

## 1. Repository Architecture Summary

### Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Frontend | React + TypeScript + Vite | React 18.3, Vite 5.4 |
| State Management | TanStack Query | v5.90 |
| UI Components | Radix UI + shadcn/ui + Tailwind CSS | Tailwind 3.4 |
| Backend | Node.js + Express + TypeScript | Express 4.21 |
| ORM | Drizzle ORM | v0.39 |
| Database | PostgreSQL | 16 (docker-compose) |
| Auth | JWT + bcrypt + CSRF (double-submit cookie) | JWT 9.0, bcrypt 6.0 |
| AI (primary) | Claude CLI subprocess (Max plan OAuth) | `/usr/bin/claude` |
| AI (secondary) | Anthropic SDK, OpenAI SDK | SDK installed, selective use |
| AI (local dev) | Ollama / Llama 3.1 | localhost:11434 |
| Email | Nodemailer (SMTP) + SendGrid inbound | Nodemailer 7.0 |
| External CRM | Freshdesk API | REST API |
| File Storage | Local disk (`public/uploads/`) | Multer 2.0 |
| Testing | Vitest (unit) + Playwright (E2E) | Vitest 1.5, Playwright 1.46 |
| Scheduled Tasks | node-cron | v4.2 |
| Vector DB | Pinecone SDK | Installed, **not used in server** |

### Languages

- TypeScript (all backend and frontend)
- SQL (migrations)

---

## 2. System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        PREVENTLI SYSTEM                              │
│                                                                      │
│  Browser (React SPA)                                                 │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  React 18 + Vite + TanStack Query + Radix UI + Tailwind    │     │
│  │  Routes: Dashboard, Cases, Certs, RTW, Workers, Admin      │     │
│  └──────────────────────────┬─────────────────────────────────┘     │
│                             │ HTTP (same origin)                    │
│  Express Server (Node.js + TypeScript)                               │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  Middleware Stack (in order):                              │     │
│  │    1. Helmet (security headers)                            │     │
│  │    2. CORS                                                 │     │
│  │    3. Body Parser (JSON + urlencoded)                      │     │
│  │    4. Cookie Parser                                        │     │
│  │    5. General Rate Limiter (10K/15min — effectively off)   │     │
│  │    6. CSRF Token Endpoint                                  │     │
│  │    7. Inbound Email Router (webhook secret auth)           │     │
│  │    8. Conditional CSRF Protection                          │     │
│  │    9. Request Logger                                       │     │
│  │   10. API Routes                                           │     │
│  │   11. CSRF Error Handler                                   │     │
│  │   12. Global Error Handler                                 │     │
│  │   13. Vite Dev Middleware (dev) / Static (prod)            │     │
│  │                                                            │     │
│  │  Route Groups:                                             │     │
│  │    /api/auth/*           → JWT login/register/refresh      │     │
│  │    /api/gpnet2/cases     → Worker cases dashboard          │     │
│  │    /api/cases/:id/*      → Case detail + lifecycle         │     │
│  │    /api/certificates/*   → Medical cert management         │     │
│  │    /api/rtw/*            → Return-to-work plans            │     │
│  │    /api/workers/*        → Worker profiles                 │     │
│  │    /api/actions/*        → Case action queue               │     │
│  │    /api/notifications/*  → Notification management         │     │
│  │    /api/agents/*         → AI agent job management         │     │
│  │    /api/chat/*           → Alex chat widget            │     │
│  │    /api/admin/*          → Organization/user admin         │     │
│  │    /api/intelligence/*   → Intelligence coordinator        │     │
│  │    /api/webhooks/*       → Freshdesk webhooks              │     │
│  │    /api/inbound-email    → Email ingestion                 │     │
│  │    /api/public/*         → Magic-link questionnaire        │     │
│  │    /api/system/health    → Health check (public)           │     │
│  └────────────────────────────────────────────────────────────┘     │
│                             │                                        │
│          ┌──────────────────┼─────────────────────┐                 │
│          │                  │                     │                 │
│  ┌───────▼──────┐  ┌────────▼────────┐  ┌────────▼────────┐        │
│  │  PostgreSQL  │  │ Claude CLI      │  │ External APIs   │        │
│  │  (Drizzle    │  │ /usr/bin/claude  │  │ - Freshdesk     │        │
│  │   ORM)       │  │ (Max plan OAuth)│  │ - SendGrid      │        │
│  │  45+ tables  │  │ subprocess      │  │ - SMTP          │        │
│  └──────────────┘  └─────────────────┘  └─────────────────┘        │
│                                                                      │
│  Background Schedulers (in-process, node-cron):                     │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │  NotificationScheduler  (ENABLE_NOTIFICATIONS=true)        │     │
│  │  SyncScheduler          (DAILY_SYNC_ENABLED=true)          │     │
│  │  ComplianceScheduler    (COMPLIANCE_CHECK_ENABLED=true)    │     │
│  │  AgentScheduler         (AGENTS_ENABLED=true)              │     │
│  │    └── 4 Agents: Coordinator, RTW, Recovery, Certificate   │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  File Storage: Local disk — public/uploads/logos/, job-descriptions/ │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Database Structure

**Technology:** PostgreSQL 16, Drizzle ORM, `drizzle-kit push` for schema sync

### Tables (45 confirmed)

#### Core Case Management
| Table | Purpose |
|---|---|
| `worker_cases` | Primary case records — central entity |
| `medical_certificates` | Certificate tracking and expiry |
| `case_attachments` | File attachments for cases |
| `case_discussion_notes` | Notes thread on cases |
| `case_discussion_insights` | AI-generated discussion insights |
| `case_actions` | Action queue items per case |
| `case_contacts` | Stakeholder contacts (GP, employer, etc.) |
| `case_compliance_checks` | Per-case compliance check results |
| `case_emails` | Inbound/outbound email threads |
| `email_attachments` | Attachments on emails |
| `case_documents` | Document storage references |
| `case_lifecycle_logs` | Audit trail for lifecycle stage changes |

#### RTW (Return-to-Work)
| Table | Purpose |
|---|---|
| `rtw_plans` | RTW plan records |
| `rtw_plan_versions` | Version history for plans |
| `rtw_plan_consents` | Consent records |
| `rtw_plan_duties` | Duties assigned in a plan |
| `rtw_plan_schedule` | Hour/day schedule |
| `rtw_approvals` | Employer approval records |
| `rtw_roles` | Configurable role library |
| `rtw_duties` | Configurable duty library |
| `rtw_duty_demands` | Physical demands per duty |

#### Pre-Employment
| Table | Purpose |
|---|---|
| `pre_employment_assessments` | Assessment records |
| `pre_employment_health_requirements` | Role health requirements |
| `pre_employment_assessment_components` | Component results |
| `pre_employment_health_history` | Candidate health history |
| `workers` | Worker profiles |

#### Compliance
| Table | Purpose |
|---|---|
| `compliance_documents` | Compliance document library |
| `compliance_rules` | Rule definitions |
| `certificate_expiry_alerts` | Alert records for cert expiry |

#### Communication
| Table | Purpose |
|---|---|
| `email_drafts` | AI-generated draft emails |
| `email_templates` | Email template library |
| `notifications` | Notification queue |
| `telehealth_bookings` | Telehealth session bookings |

#### Auth & Users
| Table | Purpose |
|---|---|
| `users` | User accounts |
| `user_invites` | Invite tokens for registration |
| `refresh_tokens` | JWT refresh token store |
| `password_reset_tokens` | Password reset tokens |
| `organizations` | Multi-tenant organisations |
| `insurers` | Insurer records |

#### Documents & Templates
| Table | Purpose |
|---|---|
| `document_templates` | Handlebars document templates |
| `generated_documents` | Generated document records |
| `webhook_form_mappings` | Freshdesk form-to-field mappings |

#### AI / Agents
| Table | Purpose |
|---|---|
| `agent_jobs` | Background agent job tracking |
| `agent_actions` | Actions taken by agents |
| `chat_memory` | Alex chat history by case/worker |
| `audit_events` | System-wide audit log |

### Migration Status

**Problem:** Migration files are duplicated with inconsistent naming schemes:
- `0001_termination_process.sql` (manual) AND `0001_stale_proemial_gods.sql` (drizzle auto)
- `0002_add_clinical_status_json.sql` (manual) AND `0002_cuddly_kronos.sql` (drizzle auto)
- etc.

The project uses `drizzle-kit push` (schema push, no migration runner) alongside some manually named SQL files. This creates ambiguity about what has actually been applied to production.

**No automated migration runner is configured.** Production schema changes require manual intervention.

---

## 4. AI Integration Review

### Claude CLI Subprocess (Primary)

**Files:** `server/lib/claude-cli.ts`, `server/routes/chat.ts`, `server/agents/base-agent.ts`

```
Pattern: spawn("/usr/bin/claude", [...], { env: CLAUDE_ENV, cwd: "/tmp" })
Auth:    Max plan OAuth (no API key)
Timeout: 30–60 seconds
```

**Critical deployment issues:**
- Hardcoded binary path: `/usr/bin/claude` — only works on Paul's WSL machine
- Hardcoded `HOME=/home/paul_clawdbot` — authentication will fail on any other system
- Claude CLI is a desktop tool, **not designed for server deployment**
- No fallback if CLI unavailable — all AI features silently fail or throw

**AI is used for:**
- Alex chat widget (`/api/chat/message`) — advisory
- Case summaries (HybridSummaryService) — advisory
- 4 background agents (coordinator, RTW, recovery, certificate) — **affects business logic**
- Email draft generation — advisory
- Treatment plan generation — **affects business logic**
- Injury date extraction from PDFs — **affects stored data**

### Anthropic SDK (`@anthropic-ai/sdk`)
- Installed as dependency
- Used in `server/services/restrictionExtractor.ts`, `server/services/aiInjuryDateService.ts`, and others
- Requires `ANTHROPIC_API_KEY` — **not present in current `.env`**

### OpenAI SDK (`openai`)
- Installed as dependency
- Found referenced in some service files
- Not clear if actively used in production paths — requires audit

### Ollama / Llama (LlamaSummary)
- `server/services/llamaSummary.ts` points to `http://localhost:11434`
- Development-only — cannot be used in cloud deployment
- Used as fallback in HybridSummaryService

### Pinecone
- `@pinecone-database/pinecone` installed in package.json
- **Zero usage found in server code**
- Dead dependency — should be removed

---

## 5. Security Analysis

### Critical

| # | Issue | Location | Severity |
|---|---|---|---|
| 1 | **Auth rate limiter commented out** | `server/index.ts:74-75` | CRITICAL |
| 2 | **General rate limiter at 10,000 req/15min** — effectively disabled | `server/middleware/security.ts:13-28` | CRITICAL |
| 3 | **Claude CLI hardcoded to local user path** — auth will fail in any deployment | `server/lib/claude-cli.ts:14-20` | CRITICAL (deploy blocker) |
| 4 | **File uploads to local disk** — lost on container restart, not production-safe | `server/services/fileUpload.ts` | CRITICAL |
| 5 | **CSP `unsafe-eval` + `unsafe-inline` applied in production** | `server/middleware/security.ts:194-197` | HIGH |

### High Priority

| # | Issue | Location |
|---|---|---|
| 6 | **No Sentry or external error monitoring** — errors silently lost in production | Logger only writes to stdout |
| 7 | **SMTP not configured** — emails fall back to `console.log` silently | `server/services/emailService.ts` |
| 8 | **CSRF IP-based session identifier** — unreliable behind load balancer/proxy | `server/middleware/security.ts:88` |
| 9 | **SVG upload allowed** for logos — SVG can contain executable scripts (XSS) | `server/services/fileUpload.ts:36` |
| 10 | **Health check path mismatch** — Dockerfile checks `/health`, app serves `/api/system/health` | `docker/Dockerfile.node` vs `server/routes.ts:331` |

### Medium Priority

| # | Issue | Location |
|---|---|---|
| 11 | **Rate limiter state is in-memory** — resets on restart, no Redis backing | `server/middleware/security.ts` |
| 12 | **DB pool no connection limits** — `new Pool({ connectionString })` with no max/idle config | `server/db.ts:11` |
| 13 | **`INBOUND_EMAIL_WEBHOOK_SECRET` not in required env vars list** — `validateSecurityEnvironment` only checks JWT_SECRET, SESSION_SECRET, DATABASE_URL | `server/middleware/security.ts:254-258` |
| 14 | **Refresh token table never cleaned up** — no TTL or cleanup job | `shared/schema.ts` |

### Low Priority

| # | Issue |
|---|---|
| 15 | `autologin.html` served in dev — ensure it cannot be accessed in production |
| 16 | Unused packages (`@pinecone-database/pinecone`) increase attack surface |
| 17 | Duplicate migration files — unclear production schema state |

---

## 6. Observability Assessment

| Tool | Status |
|---|---|
| Sentry / Datadog / Rollbar | **Not found** |
| Custom structured logger | Present — JSON output in production |
| Request duration logging | Present on all `/api` routes |
| Error logging | Present — logs to stdout/stderr |
| Application metrics | **Not found** |
| Performance monitoring | **Not found** |
| Log aggregation (CloudWatch, etc.) | **Not found** — logs go nowhere persistent |
| Health check endpoint | `/api/system/health` → `{"status":"ok"}` (basic, no DB check) |

**Gap:** Errors are logged to stdout and lost. In production there is no way to know if AI agents are failing, emails are not sending, or compliance checks are crashing.

---

## 7. Production Readiness Score

| Category | Score | Notes |
|---|---|---|
| Code Quality | 8/10 | TypeScript strict, Zod validation, Drizzle ORM, good patterns |
| Security | 4/10 | Auth rate limiter off, rate limiter too permissive, CSP loose |
| AI Architecture | 2/10 | Claude CLI subprocess is machine-specific, not deployable |
| Database | 6/10 | Good schema, good migrations, no pool tuning, no backups |
| Observability | 3/10 | Custom logger only, no external monitoring, no metrics |
| Deployment | 2/10 | No app Dockerfile, no CI/CD, no staging, local disk uploads |
| Email | 3/10 | Falls back to console.log silently, SMTP not configured |
| Auth | 7/10 | JWT + CSRF + refresh tokens — solid design, rate limiter off |
| Testing | 7/10 | 53 E2E tests, unit tests in services |

### **Overall: 4.5 / 10**

The application has excellent code quality and a mature feature set, but the deployment infrastructure is essentially non-existent. The AI architecture is fundamentally incompatible with cloud deployment in its current form.
