/**
 * Dashboard integration routes — power the floating Alex chat in the Preventli
 * admin shell + the cross-domain hand-off to dashboard.preventli.ai.
 *
 *   POST /api/dashboard/sign-in-token       — mint short-lived JWT for dashboard
 *   POST /api/dashboard/chat                — Alex chat with build-board tools
 *   GET  /api/dashboard/chat/messages       — poll endpoint for the drawer
 */

import express, { type Response, type Router } from "express";
import jwt from "jsonwebtoken";
import { and, eq, gt } from "drizzle-orm";
import { authorize, type AuthRequest } from "../middleware/auth";
import { db } from "../db";
import { storage } from "../storage";
import { chatMemory } from "@shared/schema";
import { createLogger } from "../lib/logger";
import {
  callClaude,
  callClaudeMultiTurn,
  callClaudeWithTools,
  type ChatMessage,
} from "../lib/llm-client";
import { DASHBOARD_TOOLS, executeDashboardTool } from "../tools/dashboard-tools";

const log = createLogger("DashboardRoutes");
const router: Router = express.Router();

const SIGN_IN_TOKEN_EXPIRES = "5m";
const CHAT_HISTORY_LIMIT = 30;
const POLL_DEFAULT_LIMIT = 50;

function dashboardKey(userId: string): string {
  return `dashboard:${userId}`;
}

// ── POST /sign-in-token ──────────────────────────────────────────────────────
// Issues a short-lived JWT the dashboard's middleware will verify. The dashboard
// strips the token from the URL and sets its own `dashboard_auth` cookie.
router.post("/sign-in-token", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: "JWT_SECRET not configured" });
    }
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden — admin only" });
    }

    const token = jwt.sign(
      {
        sub: req.user.id,
        email: req.user.email,
        role: req.user.role,
        organizationId: req.user.organizationId,
      },
      process.env.JWT_SECRET,
      { expiresIn: SIGN_IN_TOKEN_EXPIRES, audience: "preventli-dashboard" },
    );

    res.json({ token, expiresIn: 300 });
  } catch (err) {
    log.error("sign-in-token failed", undefined, err as Error);
    res.status(500).json({ error: "Failed to mint sign-in token" });
  }
});

// ── POST /chat ───────────────────────────────────────────────────────────────
// User sends a message → Alex replies with build-board tools available.
router.post("/chat", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden — admin only" });
    }

    const { message, pageContext } = req.body as {
      message?: string;
      pageContext?: { url?: string; screenLabel?: string };
    };

    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    const userKey = dashboardKey(req.user.id);

    // Page-context block — server-side facts only (URL + screen label + user).
    const contextBlock = `\n\n---\n## Page context\n- URL: ${pageContext?.url ?? "(unknown)"}\n- Screen: ${pageContext?.screenLabel ?? "(unknown)"}\n- User: ${req.user.email} (role=${req.user.role}, org=${req.user.organizationId})\n`;

    const systemPrompt = `You are Alex, the build-board concierge for Preventli's internal team.

# Your one job
Capture ideas, bugs, features, chores, and questions as cards on the **build-status board**, and move existing cards between columns when asked.

# Rules — non-negotiable
1. **ALWAYS call the create_dashboard_card tool** when the user asks to capture/add/log/track/note ANYTHING about Preventli, regardless of how brief their message is. Never claim a card was created without calling the tool. The tool returns a card_id — include it in your confirmation.
2. **NEVER guess defaults silently.** If the user doesn't specify type, default to "idea" (or "bug" if they mention "broken/error/fails/500"). If priority is unspecified, default to 50.
3. **Keep replies to 1-2 sentences.** Confirm with format: "Created **{type}** '{title}' (priority {priority}, id: {card_id})."
4. **When the user asks where the board is**, the answer is:
   - **"Click 'Build Status' in the left sidebar of /admin"** (one-click, signed in)
   - OR direct link: \`https://preventli-dashboard.onrender.com\`
   - **NEVER tell users to go to /admin/control-tower** — that's the system-health page, NOT the kanban board.
5. **When the user asks to move/update/complete a card**, call update_dashboard_card_status with the card_id (ask for it if not provided) and the new status (open | active | complete | dev_request).
6. **No clinical, medical, or case-management answers.** That's the other Alex (the blue "Chat with Alex" pill). If the user asks about cases, certificates, workers, or compliance, say: "That's the case-Alex chat (blue pill below). I only handle build-board capture."
7. If the user is just chatting (no actionable verb), answer in one sentence and offer: "Want me to capture this as a card?"

${contextBlock}`;

    // Load short history for this user's drawer thread
    const recent = await db
      .select()
      .from(chatMemory)
      .where(eq(chatMemory.caseId, userKey))
      .orderBy(chatMemory.createdAt);
    const history: ChatMessage[] = recent
      .slice(-CHAT_HISTORY_LIMIT)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    const provider = (process.env.LLM_PROVIDER ?? "claude-cli").toLowerCase();
    const useTools =
      (provider === "anthropic" || provider === "openrouter" || provider === "groq") &&
      !!(provider === "groq" ? process.env.GROQ_API_KEY : process.env.OPENROUTER_API_KEY);

    let reply: string;
    if (useTools) {
      reply = await callClaudeWithTools(
        systemPrompt,
        message,
        DASHBOARD_TOOLS,
        (name, input) => executeDashboardTool(name, input),
        6,
        history,
      );
    } else if (provider === "anthropic" || provider === "openrouter") {
      reply = await callClaudeMultiTurn(systemPrompt, [...history, { role: "user", content: message }]);
    } else {
      reply = await callClaude(`${systemPrompt}\n\nUser: ${message}`);
    }

    // Persist both turns. Fire-and-forget — never block the response on memory writes.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const turn = (role: "user" | "assistant", content: string) => storage.saveChatMessage({
      organizationId: req.user!.organizationId ?? null,
      caseId: userKey,
      role,
      content,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    Promise.all([turn("user", message), turn("assistant", reply)]).catch((err) =>
      log.error("Failed to persist dashboard chat", undefined, err as Error),
    );

    res.json({ reply });
  } catch (err) {
    log.error("dashboard chat failed", undefined, err as Error);
    res.status(500).json({ error: "Chat failed" });
  }
});

// ── GET /chat/messages?after=<iso> ───────────────────────────────────────────
// Poll endpoint for the floating drawer. Returns messages strictly newer than
// `after` (defaults to 24h ago). Same user-scoped key as POST /chat.
router.get("/chat/messages", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Forbidden — admin only" });
    }

    const userKey = dashboardKey(req.user.id);
    const afterRaw = (req.query.after as string | undefined) ?? "";
    const after = afterRaw ? new Date(afterRaw) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    if (Number.isNaN(after.getTime())) {
      return res.status(400).json({ error: "after must be ISO-8601" });
    }

    const rows = await db
      .select()
      .from(chatMemory)
      .where(and(eq(chatMemory.caseId, userKey), gt(chatMemory.createdAt, after)))
      .orderBy(chatMemory.createdAt)
      .limit(POLL_DEFAULT_LIMIT);

    res.json({
      messages: rows.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    log.error("dashboard chat poll failed", undefined, err as Error);
    res.status(500).json({ error: "Poll failed" });
  }
});

export default router;
