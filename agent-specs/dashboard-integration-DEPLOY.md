# Dashboard Integration — Deploy Guide & Handoff

**Branch (Preventli):** `claude/zen-lalande-74a59e` — [PR #101](https://github.com/paulhopcraft-dot/preventli/pull/101)
**Branch (Dashboard):** `feat/preventli-db-integration` — [PR #4](https://github.com/paulhopcraft-dot/preventli-dashboard/pull/4)

## What's done

| Area | Status |
|---|---|
| Schema (Preventli) — `Node` + migration 0014 | Committed (83d1395) + applied locally |
| Dashboard repo housekeeping (drizzle, schema, render.yaml) | Committed (aa0c442) |
| Preventli: `/api/dashboard/sign-in-token`, `/chat`, `/chat/messages` | Built, committed (0bf1e60) |
| Preventli: Alex tools `create_dashboard_card` + `update_dashboard_card_status` + Telegram fail-open | Built, committed (0bf1e60) |
| Preventli admin UI: `ChatBubble` + `ChatDrawer` mounted, "Build Status" sidebar link | Built, committed (0bf1e60) |
| `.claude/scripts/{add,complete}-card.ps1` | Built, committed (0bf1e60) |
| Dashboard: `app/api/cards/route.ts` (POST/PATCH, Bearer auth) | Built, committed (f5f4a58) |
| Dashboard: `middleware.ts` (JWT via `jose`, admin gate) | Built, committed (f5f4a58) |
| TypeScript clean on all new code | Verified (no new tsc errors introduced) |
| Migration applied to local Postgres | Verified (`Preventli` + `Preventli App` rows present) |
| PRs opened against main/master | Done |

## Local verify — partial pass

Ran `bash ~/.claude/verify/dashboard-integration.sh` against the local DB:

- ✓ Schema — Node table + seed rows present
- ! Dashboard `:3000` is occupied by another Next project (journey-board, pid 9511). The dashboard from this branch runs on :3100 in WSL but WSL networking was intermittently flaky during the verify run — see "Known local-env issue" below.
- ✓ Sign-in-token + chat endpoints registered (route file exists, server hooks them up in `server/routes.ts`)
- ! Card round-trip + auth-gate check + git -C check — verify script uses hard-coded Windows `D:/` paths that don't resolve in WSL bash (where psql lives). Cross-runtime fix: small patch to the global verify script.

The verify script's path handling needs a small fix:
1. Line 66–67: use `${WORKTREE_ROOT:-D:/dev/preventli/.claude/worktrees/zen-lalande-74a59e}/.claude/scripts/add-card.ps1` and resolve via runtime detection.
2. Line 79–82: `git -C` calls need WSL-style `/mnt/d/...` paths when running under WSL.

## PAUL: Render deploy steps (≈ 10 min)

These are the only items that require manual Render UI/CLI work.

### 1. preventli-dashboard service (new)

- Render → **New + → Blueprint** → connect the `preventli-dashboard` repo → pick branch `feat/preventli-db-integration` (will be `main` after merge).
- Render reads `render.yaml` and creates the service.
- Set secret env vars on the service:
  - `DATABASE_URL` — same value as the existing Preventli Render Postgres connection string.
  - `JWT_SECRET` — same value as Preventli backend's `JWT_SECRET`.
  - `INTERNAL_API_KEY` — generate a new random string (used by Preventli scripts; also set on Preventli backend).
  - (already in `render.yaml`) `PREVENTLI_BUSINESS_NODE_ID=cmn5cg9em000fd74nmfuxd953`, `PREVENTLI_PRODUCT_NODE_ID=preventli-app`.
- Deploy. Note the assigned `*.onrender.com` host.

### 2. preventli backend env updates

On the existing Preventli Render service, add / confirm:

- `INTERNAL_API_KEY` — same value as dashboard.
- `INTERNAL_DASHBOARD_URL` — the dashboard's `*.onrender.com` host (or `https://dashboard.preventli.ai` if DNS in place).
- `ALERT_TELEGRAM_WEBHOOK` — already set per memory; confirm.
- `VITE_DASHBOARD_URL` — `https://dashboard.preventli.ai` (or the `*.onrender.com` host until DNS lands). **This is build-time** — bump and redeploy when you change it.

### 3. Apply migration 0014 to Preventli Render Postgres

Migration is idempotent (`CREATE TABLE IF NOT EXISTS` + `INSERT … ON CONFLICT DO NOTHING`). Run once:

```
psql $PRODUCTION_DATABASE_URL -f migrations/0014_add_dashboard_node_table.sql
```

Confirm:
```
psql $PRODUCTION_DATABASE_URL -c 'SELECT id, type, title FROM "Node" ORDER BY priority DESC'
```
Expect: `cmn5cg9em000fd74nmfuxd953 | business | Preventli` and `preventli-app | product | Preventli App`.

### 4. (Optional) Custom domain `dashboard.preventli.ai`

- Render dashboard service → **Settings → Custom Domain → Add** `dashboard.preventli.ai`.
- Render shows a CNAME target (`<service>.onrender.com`). Add the CNAME to the `preventli.ai` DNS zone.
- Once DNS propagates, swap `INTERNAL_DASHBOARD_URL` + `VITE_DASHBOARD_URL` to the custom host and trigger a Preventli redeploy.

## Smoke test after deploy

```
# 1. Dashboard root requires auth
curl -i https://<dashboard-host>/                 # → 401

# 2. /api/cards rejects no-auth
curl -i -X POST https://<dashboard-host>/api/cards -d '{"title":"x"}'    # → 401

# 3. /api/cards accepts Bearer
curl -i -X POST https://<dashboard-host>/api/cards \
  -H "Authorization: Bearer $INTERNAL_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"title":"prod smoke test","type":"idea"}'  # → 201

# 4. Confirm card on board
curl -s https://<dashboard-host>/ | grep "prod smoke test"
```

Then in a browser:
- Sign in at https://app.preventli.ai as admin → click "Build Status" in sidebar → land on dashboard authed.
- Open the floating chat → "Add a card called 'deploy smoke test', it's a feature" → card appears + Telegram pings.

After PROD pass: `PROD=1 PROD_DASHBOARD_URL=https://dashboard.preventli.ai PROD_PREVENTLI_URL=https://app.preventli.ai bash ~/.claude/verify/dashboard-integration.sh` to lock the green.

## Known local-env issue

The local-dev path runs Postgres in WSL on a unix socket (`?host=/var/run/postgresql`), but Next.js + dashboard are developed from Windows. Running both servers in WSL works, but the WSL Service became intermittently unresponsive mid-session (Win11 `Wsl/Service/0x8007274c`). Restarting WSL would have killed Paul's PM2 bots (Uno, etc.), so I left WSL alone and stopped chasing full local-green. Migration is applied; production verify is the source of truth.
