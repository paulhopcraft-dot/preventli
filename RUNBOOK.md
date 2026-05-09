# Preventli — Production Runbook

> Last updated: 2026-04-23 · Version: v0.9.0-beta

This runbook covers standard operating procedures for the Preventli application
hosted on Render. Refer to it for deploys, rollbacks, database recovery,
incident triage, and environment configuration.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Deploy Procedure](#2-deploy-procedure)
3. [Rollback Procedure](#3-rollback-procedure)
4. [Database Backups & Restore](#4-database-backups--restore)
5. [Sentry Triage](#5-sentry-triage)
6. [Rate Limiting & Security Headers](#6-rate-limiting--security-headers)
7. [Scheduled Jobs](#7-scheduled-jobs)
8. [Environment Variable Reference](#8-environment-variable-reference)
9. [DNS & Email Records](#9-dns--email-records)
10. [On-Call Escalation](#10-on-call-escalation)

---

## 1. Architecture Overview

| Component | Provider | Region | Notes |
|-----------|----------|--------|-------|
| API server (Express) | Render Web Service | US-West (Oregon) | Auto-deploy on push to `main` |
| PostgreSQL database | Render PostgreSQL | US-West (Oregon) | Daily backups, PITR available |
| File storage | AWS S3 / local | ap-southeast-2 | `STORAGE_PROVIDER` env flag |
| Transactional email | Resend | USA | `SMTP_HOST=smtp.resend.com` |
| Error monitoring | Sentry | USA | Server + client DSNs |
| Marketing site | Vercel | Global CDN | `preventli-site` repo, auto-deploy |

**Repos:**
- App: `https://github.com/paulhopcraft-dot/preventli`
- Site: `https://github.com/paulhopcraft-dot/preventli-site`

---

## 2. Deploy Procedure

### Normal deploy (auto)

1. Merge PR to `main` → Render auto-detects push and starts a new build.
2. Monitor build in **Render dashboard → Logs** (typically 2–4 min).
3. Render performs a zero-downtime swap — new instance takes over when healthy.

### Manual deploy

```bash
# Trigger a new deploy from the current HEAD without a code change
# Via Render dashboard: Manual Deploy → Deploy latest commit
# Or via Render API:
curl -X POST "https://api.render.com/v1/services/$RENDER_SERVICE_ID/deploys" \
  -H "Authorization: Bearer $RENDER_API_KEY" \
  -H "Content-Type: application/json"
```

### Pre-deploy checklist

- [ ] All CI checks green on the PR
- [ ] `CHANGELOG.md` updated with new version
- [ ] Database migrations run (if schema changed): `npm run drizzle:migrate`
- [ ] Env vars added to Render dashboard if any new vars introduced
- [ ] `VITE_SENTRY_DSN` and `VITE_API_URL` set in Render environment (Vite bakes these into the bundle at build time)

### Post-deploy verification

```bash
# Health check
curl https://app.preventli.ai/api/health

# Expect: {"status":"ok","timestamp":"..."}
```

Check Sentry for a spike in new errors within 5 minutes of deploy.

---

## 3. Rollback Procedure

### Option A — Redeploy previous commit (preferred)

1. Open Render dashboard → **Deploys** tab.
2. Locate the last successful deploy.
3. Click **Redeploy** on that entry.
4. Confirm. Render swaps back within ~3 minutes.

### Option B — Git revert

```bash
git revert HEAD --no-edit
git push origin main
```

This creates a new commit that undoes the bad change and triggers auto-deploy.

### Option C — Emergency branch pin

If `main` is broken and you need time to fix:

1. Render dashboard → **Settings → Branch** → change from `main` to a stable branch.
2. Deploy the stable branch.
3. Fix `main`, then switch back.

### After rollback

- [ ] Verify `/api/health` returns 200
- [ ] Check Sentry error rate returns to baseline
- [ ] Post incident summary in Slack #incidents within 24 hours

---

## 4. Database Backups & Restore

### Render PostgreSQL backups

Render free/paid PostgreSQL instances include **daily automated backups** retained for:
- **Free tier**: 7 days
- **Paid tier**: 30 days (with point-in-time recovery / PITR)

### View available backups

Render dashboard → PostgreSQL → **Backups** tab.

### Restore from backup

> ⚠️ Restore replaces ALL current data. Confirm with team before proceeding.

1. Render dashboard → PostgreSQL → Backups → select backup.
2. Click **Restore** → confirm.
3. Render provisions a new instance from the backup snapshot.
4. Update `DATABASE_URL` in the web service if the connection string changes.
5. Restart the web service.

### Manual backup (on-demand)

```bash
# Requires pg_dump and the DATABASE_URL from Render env
pg_dump "$DATABASE_URL" \
  --format=custom \
  --no-owner \
  --no-acl \
  -f "preventli-backup-$(date +%Y%m%d-%H%M%S).dump"
```

Store dump files in S3 or a secure location — **never commit to git**.

### Restore from dump file

```bash
pg_restore \
  --dbname "$DATABASE_URL" \
  --no-owner \
  --no-acl \
  --clean \
  preventli-backup-YYYYMMDD-HHMMSS.dump
```

### Data retention obligations (from Privacy Policy)

| Data type | Retention |
|-----------|-----------|
| WorkCover case records | 7 years after case closure |
| Pre-employment assessments | 7 years |
| Contact form submissions | 24 months |
| Error / usage logs | 90 days |
| Active account data | Duration of subscription |

---

## 5. Sentry Triage

### Project URLs

- **Server**: `https://sentry.io/organizations/<org>/projects/preventli-node/`
- **Client**: `https://sentry.io/organizations/<org>/projects/preventli-react/`

### Alert thresholds

| Severity | Condition | Action |
|----------|-----------|--------|
| P1 — Critical | Auth or DB errors, >5 in 5 min | Page on-call immediately |
| P2 — High | New error type post-deploy | Investigate within 1 hour |
| P3 — Medium | Recurring known error | Schedule fix in next sprint |
| P4 — Low | Single occurrence, unknown user | Monitor; ignore if no recurrence |

### Triage steps

1. **New error alert** → Open in Sentry → check stack trace + breadcrumbs.
2. Identify affected endpoint: check the `transaction` tag.
3. Check Render logs for the same timeframe:
   ```
   Render → Web Service → Logs → filter by timestamp
   ```
4. Reproduce locally if possible.
5. Fix, PR, deploy. Link Sentry issue in commit message: `fixes SENTRY-XXXX`.

### Session replay

Client errors with `replaysOnErrorSampleRate: 1.0` capture full session replay.
Access via Sentry → Issue → Replays tab. Useful for UI regressions.

---

## 6. Rate Limiting & Security Headers

### Rate limit configuration

| Limiter | Window | Max requests | Applied to |
|---------|--------|-------------|------------|
| General | 15 min | 200 | All API routes |
| Auth | 15 min | 5 | `/api/auth/*` |
| AI | 1 hour | 3 | `/api/ai/*` |
| Webhook | 1 min | 60 | `/api/webhooks/*` |

Limits return HTTP 429. The `Retry-After` header is set.

### Security headers (Helmet)

All responses include: `Strict-Transport-Security`, `Content-Security-Policy`,
`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`.

To verify:
```bash
curl -I https://app.preventli.ai/api/health | grep -i "strict\|content-sec\|x-frame"
```

### CSRF protection

- Double-submit cookie pattern via `csrf-csrf`.
- Bearer token requests (API/mobile) bypass CSRF.
- Browser-originated mutations require `X-CSRF-Token` header.

---

## 7. Scheduled Jobs

Cron jobs run inside the Express process (node-cron). They require the feature
flag env vars to be `true` in production.

| Job | Schedule | Feature flag | Purpose |
|-----|----------|-------------|---------|
| Notification scheduler | `*/15 * * * *` | `ENABLE_NOTIFICATIONS=true` | Task reminders, cert expiry alerts |
| Daily Freshdesk sync | `DAILY_SYNC_TIME` (default 18:00) | `DAILY_SYNC_ENABLED=true` | Sync cases to Freshdesk |
| Compliance check | `COMPLIANCE_CHECK_TIME` (default 06:00) | `COMPLIANCE_CHECK_ENABLED=true` | Flag overdue WHS obligations |
| Agent coordinator | `AGENT_COORDINATOR_TIME` (default 09:00) | `AGENTS_ENABLED=true` | AI agent task runner |
| Cert expiry agent | `AGENT_CERT_EXPIRY_TIME` (default 08:00) | `AGENTS_ENABLED=true` | Certificate expiry detection |

---

## 8. Environment Variable Reference

### Required — application will not start without these

| Variable | Example | Notes |
|----------|---------|-------|
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db` | PostgreSQL connection string |
| `JWT_SECRET` | 64-char hex string | Min 32 chars. Rotate = all sessions invalidated |
| `SESSION_SECRET` | 64-char hex string | Must differ from `JWT_SECRET` |

### Required for production

| Variable | Example | Notes |
|----------|---------|-------|
| `NODE_ENV` | `production` | Enables security hardening, disables verbose errors |
| `CLIENT_URL` | `https://app.preventli.com.au` | CORS allowed origin |
| `APP_URL` | `https://app.preventli.com.au` | Used in email links |
| `VITE_API_URL` | `https://app.preventli.com.au` | Baked into browser bundle at build time |
| `SENTRY_DSN` | `https://xxxx@o0.ingest.sentry.io/0` | Server-side error tracking |
| `VITE_SENTRY_DSN` | `https://xxxx@o0.ingest.sentry.io/0` | Client-side error tracking (Vite build-time) |

### LLM / AI

| Variable | Example | Notes |
|----------|---------|-------|
| `LLM_PROVIDER` | `openrouter` | `openrouter` or `anthropic` |
| `OPENROUTER_API_KEY` | `sk-or-v1-xxx` | Required when `LLM_PROVIDER=openrouter` |
| `LLM_MODEL` | `anthropic/claude-sonnet-4-5` | Optional model override |

> **CRITICAL**: Never use `ANTHROPIC_API_KEY` for bot/automation workloads.
> Use OpenRouter only. `ANTHROPIC_API_KEY` is reserved for Claude Code dev sessions.

### File storage

| Variable | Example | Notes |
|----------|---------|-------|
| `STORAGE_PROVIDER` | `s3` | `local` (dev only) or `s3` |
| `AWS_S3_BUCKET` | `preventli-production-uploads` | |
| `AWS_S3_REGION` | `ap-southeast-2` | |
| `AWS_ACCESS_KEY_ID` | `AKIA...` | |
| `AWS_SECRET_ACCESS_KEY` | secret | |
| `AWS_S3_ENDPOINT` | `https://xxx.r2.cloudflarestorage.com` | Cloudflare R2 only |

### Email (SMTP)

| Variable | Example | Notes |
|----------|---------|-------|
| `SMTP_HOST` | `smtp.resend.com` | |
| `SMTP_PORT` | `587` | |
| `SMTP_USER` | `resend` | |
| `SMTP_PASS` | `re_xxxxx` | Resend API key |
| `SMTP_SECURE` | `false` | false = STARTTLS on port 587 |
| `SMTP_FROM` | `noreply@preventli.com.au` | Must be a verified Resend domain |

### Monitoring & alerting

| Variable | Example | Notes |
|----------|---------|-------|
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | 10% performance sampling |
| `LOG_LEVEL` | `info` | `debug\|info\|warn\|error` |
| `ALERT_SLACK_WEBHOOK` | `https://hooks.slack.com/...` | Operational failure alerts |
| `ALERT_TELEGRAM_WEBHOOK` | `https://api.telegram.org/...` | Alternative alert channel |

### Feature flags

| Variable | Default | Notes |
|----------|---------|-------|
| `ENABLE_NOTIFICATIONS` | `false` | Background notification scheduler |
| `DAILY_SYNC_ENABLED` | `false` | Freshdesk daily sync |
| `COMPLIANCE_CHECK_ENABLED` | `false` | Compliance obligation checker |
| `AGENTS_ENABLED` | `false` | AI agent coordinator |

### Optional / integrations

| Variable | Notes |
|----------|-------|
| `FRESHDESK_DOMAIN` | Freshdesk subdomain |
| `FRESHDESK_API_KEY` | Freshdesk API key |
| `INBOUND_EMAIL_WEBHOOK_SECRET` | Webhook HMAC secret |
| `DISCORD_WEBHOOK_URL` | Discord notification channel |
| `CSRF_SECRET` | CSRF token signing key (defaults to SESSION_SECRET) |
| `E2E_TEST_SECRET` | Playwright test auth bypass |
| `DB_POOL_MAX` | PG pool max connections (default 20) |
| `DATABASE_SSL` | `true` for managed databases |

### Generating secrets

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 9. DNS & Email Records

These records must be set at the domain registrar for `preventli.com.au`.

| Type | Name | Value | Notes |
|------|------|-------|-------|
| `A` | `app` | Render IP | Render Web Service → Settings → Custom Domain |
| `CNAME` | `www` | Vercel CNAME | preventli-site Vercel project |
| `TXT` | `@` | `v=spf1 include:spf.resend.com ~all` | Resend SPF |
| `TXT` | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@preventli.com.au` | DMARC policy |
| `MX` | `@` | Resend MX records (see resend.com/docs/send-with-smtp) | Inbound email |

> ⚠️ DNS changes are manual — they cannot be automated via git push.
> Verify propagation with: `dig TXT preventli.com.au` or `https://dnschecker.org`

---

## 10. On-Call Escalation

| Priority | Response time | Action |
|----------|--------------|--------|
| P1 — Production down | 15 min | Page Paul Hopcraft: paul.hopcraft@gmail.com |
| P2 — Data loss risk | 1 hour | Email + Slack alert |
| P3 — Feature broken | Next business day | Create GitHub issue |

### Incident response template

```
INCIDENT — [P1/P2/P3] — [Short description]
Time detected: YYYY-MM-DD HH:MM AEDT
Impact: [Users affected, features broken]
Current status: [Investigating / Mitigating / Resolved]
Actions taken:
  1.
  2.
Next step:
Resolved at: YYYY-MM-DD HH:MM AEDT
Root cause:
Prevention:
```

---

*Maintained by Preventli Pty Ltd. For questions: paul.hopcraft@gmail.com*
