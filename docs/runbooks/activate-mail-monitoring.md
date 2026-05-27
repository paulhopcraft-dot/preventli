# Runbook: Activate Mail-Monitoring Telegram Pings

**Goal:** End-to-end mail monitoring for `support@gpnet.au` and `jacinta.bailey@gpnet.au` — inbound emails trigger a Telegram ping within 60 seconds showing sender, subject, body preview, and case-match status.

**Closure criterion:** Send a test email to `support@gpnet.au` from personal Gmail; within 60 s a Telegram message appears on your phone with sender, subject, body preview, and case-match status.

---

## Section 1 — Google Workspace: Set Forwarding on the Two GPNet Mailboxes

> **Paul-only — you must do this in your own Google Workspace admin session.**

**Postmark inbound address to forward to:**

The Postmark inbound address is the email address of your Postmark inbound stream (e.g. `<hash>@inbound.postmarkapp.com` or the custom domain `support.preventli.ai` if you have set up the MX record). Find it at:

https://account.postmarkapp.com → Servers → (your server) → Inbound → Stream → copy the email address shown

### 1a. Forward support@gpnet.au

1. Open https://admin.google.com → **Directory** → **Users** → search for `support@gpnet.au`
2. Click on the user → **User information** → **Email routing** (or look for **Forwarding** under the account settings — exact label varies by Google Workspace edition)
3. Alternatively, go directly: https://admin.google.com/ac/users → click `Support GPNet` → scroll to **Email routing** or use **Gmail settings** → **Forwarding**
4. Set **Forward to:** paste your Postmark inbound address (e.g. `<hash>@inbound.postmarkapp.com`)
5. ✅ Check **"Keep Gmail's copy in the Inbox"** so Support staff can still read the emails
6. Click **Save**

### 1b. Forward jacinta.bailey@gpnet.au

Repeat steps 1–6 above for `jacinta.bailey@gpnet.au` (user `Jacinta Bailey`). Use the **same** Postmark inbound address as the forward target.

⚠️ **Do NOT add forwarding for `lisah@preventli.ai`** — Lisa is manual-only, explicitly out of scope.

---

## Section 2 — Telegram Bot Webhook URL Format

The `ALERT_TELEGRAM_WEBHOOK` env var is a **full URL** that the server will `POST` to with the body `{ "text": "...", "parse_mode": "HTML" }`. The server does **not** add a `chat_id` to the body, so it must be encoded in the URL itself.

**Template (fill in the blanks — do not save your real token anywhere else):**

```
ALERT_TELEGRAM_WEBHOOK=https://api.telegram.org/bot<YOUR_BOT_TOKEN>/sendMessage?chat_id=<YOUR_CHAT_ID>
```

**How to fill in the placeholders:**

- `<YOUR_BOT_TOKEN>` — the token BotFather gave you when you created `@paulsunobot` (looks like `1234567890:ABCDefGHIjklMNOpqrsTUVwxyz`)
- `<YOUR_CHAT_ID>` — the numeric chat/user ID that should receive alerts. To find it:
  1. Open Telegram and send any message to `@paulsunobot` (or start a chat with it)
    2. Open `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates` in your browser
      3. Find `"chat":{"id": <number>}` in the JSON — that number is your `<YOUR_CHAT_ID>`

      **Why the URL format:** `alertService.ts → sendTelegram()` does a raw `POST` with `{ text, parse_mode: "HTML" }` to whatever URL is in the env var. By putting `chat_id` as a query parameter, the Telegram Bot API accepts it alongside the JSON body. The server never reads your token — it only ever stores the complete URL in Render's env vault.

      ---

      ## Section 3 — Render: Set Environment Variables and Redeploy

      **Service:** `preventli` (Docker/Starter, `srv-d6oe74paae7s73a77kpg`, `app.preventli.ai`)

      ### 3a. Navigate to the Environment page

      Direct link: https://dashboard.render.com/web/srv-d6oe74paae7s73a77kpg/env

      Click **Edit**, then add the following **4 new key=value pairs** (click "+ Add env var" for each):

      | KEY | VALUE |
      |-----|-------|
      | `POSTMARK_WEBHOOK_USER` | `c32998032d670961ad8dcc9a` |
      | `POSTMARK_WEBHOOK_PASSWORD` | `50ac9058602026844388f113cde403085a679e2cbecff16c` |
      | `ALERT_TELEGRAM_WEBHOOK` | `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/sendMessage?chat_id=<YOUR_CHAT_ID>` |
      | `INBOUND_EMAIL_MONITOR_ADDRESSES` | `support@gpnet.au,jacinta.bailey@gpnet.au` |

      > ⚠️ The `POSTMARK_WEBHOOK_USER` and `POSTMARK_WEBHOOK_PASSWORD` values above are the credentials generated in Session 148 (from `claude-progress.txt`). They are not secrets you need to invent — paste them exactly as shown.

      ### 3b. Save and trigger a redeploy

      1. After adding all 4 vars, click **Save changes** in the Render UI
      2. Then navigate to: https://dashboard.render.com/web/srv-d6oe74paae7s73a77kpg
      3. Click **Manual Deploy** → **Deploy latest commit**
      4. Wait for the deploy to show ✅ **Live** (Starter plan = ~3-5 minutes, no cold-start delays)

      ---

      ## Section 4 — Smoke Test

      Only run this **after** Sections 1, 2, and 3 are all complete and the Render deploy shows Live.

      1. Open your personal Gmail account
      2. Compose a new email to: `support@gpnet.au`
      3. Subject: `monitor smoke test`
      4. Body: any single line, e.g. `This is the smoke test.`
      5. Send it
      6. Wait up to 60 seconds
      7. ✅ **Pass:** A Telegram message arrives on your phone from `@paulsunobot` showing:
         - Sender email address
            - Subject: `monitor smoke test`
               - Body preview
                  - Case-match status (likely `unmatched` for a fresh test)
                  8. Then tell Claude: **"tracks A+B done, ready to smoke test"** to begin Track C log-watching

                  ---

                  ## Reference: Postmark Webhook URL

                  When configuring Postmark to deliver to your webhook, use this URL (credentials are the same ones you set in Render):

                  ```
                  https://c32998032d670961ad8dcc9a:50ac9058602026844388f113cde403085a679e2cbecff16c@app.preventli.ai/api/webhooks/postmark/inbound
                  ```

                  To set this in Postmark: https://account.postmarkapp.com → Servers → (your server) → Inbound → Webhook URL → paste the URL above → Save

                  ---

                  ## Reference: Render Logs URL

                  Tail logs during smoke test at:

                  https://dashboard.render.com/web/srv-d6oe74paae7s73a77kpg/logs

                  Look for these four log lines (in order) after sending the test email:
                  1. `POST /api/webhooks/postmark/inbound 200` — webhook hit
                  2. `Email stored` — email written to DB
                  3. `ALERT inbound_email` — monitor ping fired
                  4. `Telegram alert delivery` (success or warn) — Telegram send attempted

                  ---

                  ## Troubleshooting

                  | Symptom | Likely cause | Fix |
                  |---------|-------------|-----|
                  | Webhook returns 401 | `POSTMARK_WEBHOOK_USER`/`POSTMARK_WEBHOOK_PASSWORD` not set or wrong | Re-check Section 3 env vars, redeploy |
                  | Webhook returns 404 | Route not mounted in deployed build | Ensure the feature branch with `postmark-inbound.ts` is deployed on `main` |
                  | Webhook returns 422 | Schema mismatch — Postmark payload doesn't match `postmarkInboundSchema` | Check Postmark is sending `From`, `Subject`, `MessageID` fields |
                  | All 4 log lines show but Telegram silent | `ALERT_TELEGRAM_WEBHOOK` wrong | Re-check bot token + chat_id; test manually with `curl` |
                  | Log line 1 never appears | Forwarding rule didn't fire | Check Google Workspace forwarding rule — confirm "Verify" step completed |
                  | Telegram message arrives but no body | `parse_mode: HTML` issue | Check message body for unescaped HTML characters |

                  ---

                  _Generated by Claude (Session 149, 27 May 2026) — ops wiring runbook for mail-monitoring activation._
