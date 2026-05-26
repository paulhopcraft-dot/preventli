# Dashboard Integration — Build Plan

**Captured:** 2026-05-26
**Status:** Locked. Build in flight on branch `claude/zen-lalande-74a59e` + corresponding branch in `D:\dev\preventli-dashboard`.

Companion to `agent-specs/dashboard-integration.md` (the captured spec). This doc is the EXECUTABLE plan — what to build, in which repo, how to verify.

## Two repos

| # | Repo | Path |
|---|---|---|
| 1 | Preventli (this) | `D:\dev\preventli` |
| 2 | Dashboard | `D:\dev\preventli-dashboard` |

## Locked decisions (from grilling)

| Decision | Lock |
|---|---|
| Alex wiring | Use the real Alex agent (`alex_turns` infra). `create_dashboard_card` + `update_dashboard_card_status` as tools. |
| Auth model | Shared `Domain=.preventli.ai` cookie across `app.preventli.ai` + `dashboard.preventli.ai`. Both apps verify JWT, gate on `role=admin`. |
| Schema shape | Match dashboard's existing `Node` table. Add it to Preventli's Postgres. Seed one root parent node. |
| Submit form | Keep on dashboard. Lisa can use chat OR form. Both write to same `Node` table. |
| Chat thread model | New thread per card (alex_turn binds to card). |
| Card permissions v1 | Anyone with admin can drag. |
| Page context | URL + screen label + user role/tenant (server-side, no screenshot/console capture in v1). |
| Mount scope | Admin pages only. |
| Notification | Telegram via existing `ALERT_TELEGRAM_WEBHOOK` env var. Fail-open. |
| GitHub mirror | Not in v1. |
| Polling | 5s for chat messages. No SSE. |
| Deploy | Render (same account as Preventli). One Postgres, two web services. |
| DNS | `dashboard.preventli.ai` — Paul adds CNAME after Render service is up. |

## Schema delta (Preventli's Postgres)

Add to `shared/schema.ts`:

```ts
// Build status board — mirrors preventli-dashboard's existing Node table.
// Shared between Preventli (writes via Alex chat + add-card script) and
// preventli-dashboard (reads/writes via its existing Drizzle layer).
export const node = pgTable("Node", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),                 // 'product' (root) | 'idea' | 'bug' | 'feature' | 'chore' | 'question' | 'stage'
  parentId: text("parent_id"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status"),                        // 'open' | 'active' | 'complete' | 'dev_request'
  ownerType: text("owner_type"),
  ownerId: text("owner_id"),
  priority: integer("priority").default(0),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});
```

Table name MUST be `"Node"` (capital N, quoted) to match the dashboard's existing Drizzle reads.

Seed on first migration: ONE root parent node:
```sql
INSERT INTO "Node" (id, type, title, status, priority, created_at, updated_at)
VALUES ('preventli-root', 'product', 'Preventli', 'open', 0, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
```

## Component list

### Preventli repo

1. **Schema** (`shared/schema.ts`) — add `node` table per above + Drizzle migration.
2. **Seed** — boot-time migration runs INSERT for root node, idempotent.
3. **Auth cookie domain** — in `server/controllers/auth.ts` (or wherever session cookie is set), add `Domain: ".preventli.ai"` in production. Dev unchanged.
4. **`POST /api/dashboard/chat`** route (new) — body `{message, pageContext}`. Calls Alex with tools registered. Persists turn. Returns Alex reply.
5. **`GET /api/dashboard/chat/messages?after=<ts>`** — poll endpoint for drawer.
6. **Alex tools:**
   - `create_dashboard_card(title, description, type, priority)` — INSERTs into `Node` with parentId=preventli-root, status='open'. ALSO fires Telegram webhook.
   - `update_dashboard_card_status(cardId, status)` — UPDATEs status.
7. **Chat drawer** (`client/src/components/ChatBubble.tsx` + `ChatDrawer.tsx`) — floating button, polls /messages, mounted in admin app shell, role-gated.
8. **"Build Status" nav link** — Sidebar entry, opens `dashboard.preventli.ai` (env var: `VITE_DASHBOARD_URL`) in new tab.
9. **`.claude/scripts/add-card.ps1`** — wraps curl to dashboard's `/api/cards` endpoint.
10. **`.claude/scripts/complete-card.ps1`** — wraps PATCH to dashboard's `/api/cards/:id`.

### Dashboard repo (`D:\dev\preventli-dashboard`)

1. **`drizzle.config.ts`** — strip "Journey Board" warning comment.
2. **`lib/schema.ts`** — strip "READ mirror / Do NOT migrate" comments. Same shape, just no longer read-only.
3. **`render.yaml`** — new file. Next.js web service, `DATABASE_URL` placeholder.
4. **`app/api/cards/route.ts`** — POST: creates card. PATCH (with `/:id`): updates status. Auth: Bearer `INTERNAL_API_KEY`.
5. **`middleware.ts`** — reads `*.preventli.ai` cookie, verifies JWT against same secret Preventli uses, gates non-admins.

## Env vars

| Var | Where set | Purpose |
|---|---|---|
| `DATABASE_URL` | Preventli + dashboard (Render) | Same Postgres, both apps |
| `INTERNAL_API_KEY` | Preventli `.env` + dashboard Render env | Server-to-server auth for add-card script + Preventli writes |
| `JWT_SECRET` | Both apps | Shared JWT verification |
| `ALERT_TELEGRAM_WEBHOOK` | Preventli Render | Telegram bot URL for card notifications |
| `VITE_DASHBOARD_URL` | Preventli client build | Build-time URL for "Build Status" nav link |
| `INTERNAL_DASHBOARD_URL` | Preventli server | URL the add-card script + telegram-builder targets |

## Verification

Single script at `~/.claude/verify/dashboard-integration.sh` returns 0 when all 7 success criteria pass:

1. Node table exists + root node seeded
2. Dashboard URL returns 200
3. Submit form → SELECT confirms card row
4. Chat endpoint → Alex tool fires → SELECT confirms new card
5. Telegram webhook recorded a 200 response in server logs (after step 4)
6. `add-card.ps1` writes a card to DB
7. PRs exist on both repos against `main` (not merged)

## Out of scope (v1)

- Screenshot capture in chat
- Console-error capture in chat
- Alex auto-moving cards
- Read-only mode for non-Paul admins
- GitHub Issues mirror
- Notification preferences UI
- Multi-product split (single root node only)
