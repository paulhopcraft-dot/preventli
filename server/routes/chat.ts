import express, { type Response, type Router } from "express";
import { readFileSync } from "fs";
import { join } from "path";
import { authorize, type AuthRequest } from "../middleware/auth";
import { storage } from "../storage";
import { createLogger } from "../lib/logger";
import { callClaude, callClaudeMultiTurn, callClaudeWithTools, type ChatMessage } from "../lib/llm-client";
import { ALEX_TOOLS, executeAlexTool } from "../tools/alex-tools";
import { getCaseCompliance } from "../services/certificateCompliance";
import { getCaseRTWCompliance } from "../services/rtwCompliance";

const logger = createLogger("ChatRoutes");
const router: Router = express.Router();

// Load Dr. Alex soul from config file — edit config/DR_ALEX_SOUL.md to change persona
function loadSoul(): string {
  try {
    const soulPath = join(process.cwd(), "config", "DR_ALEX_SOUL.md");
    return readFileSync(soulPath, "utf-8");
  } catch {
    logger.error("DR_ALEX_SOUL.md not found — using fallback persona");
    return "You are Dr. Alex, a warm and professional workplace health specialist at Preventli. Help users with health questions. Do not diagnose or prescribe. If they need a doctor, end with [SUGGEST_BOOKING].";
  }
}

// Loaded once at startup — restart server to pick up soul changes
const SOUL = loadSoul();

/**
 * @route POST /api/chat/message
 * @desc Send a message to Dr. Alex (Health Assistant)
 * @access Private
 */
router.post("/message", authorize(), async (req: AuthRequest, res: Response) => {
  try {
    const { message, sessionId, context, history } = req.body as {
      message: string;
      sessionId: string;
      context?: { caseId?: string; workerId?: string };
      history?: ChatMessage[];
    };

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message is required" });
    }
    if (!sessionId || typeof sessionId !== "string") {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const orgId = req.user!.organizationId;
    const isAdmin = req.user!.role === "admin";
    const memoryKey = context?.caseId
      ? { caseId: context.caseId }
      : context?.workerId
      ? { workerId: context.workerId }
      : null;

    // Load org-wide case summary so Alex knows the full portfolio
    let orgCasesBlock = "";
    try {
      const allCases = await storage.getCases(orgId, isAdmin);
      if (allCases.length > 0) {
        const statusCounts: Record<string, number> = {};
        for (const c of allCases) {
          const s = c.workStatus ?? "unknown";
          statusCounts[s] = (statusCounts[s] || 0) + 1;
        }
        const statusSummary = Object.entries(statusCounts)
          .map(([s, n]) => `${s}: ${n}`)
          .join(", ");

        // Include individual case summaries (cap at 30 to keep prompt manageable)
        const caseLines = allCases.slice(0, 30).map((c) =>
          `- ${c.workerName} (${c.company}) — ${c.workStatus ?? "unknown"}${c.summary ? `: ${c.summary.slice(0, 120)}` : ""}`
        );

        orgCasesBlock = `\n\n---\n## Organisation Case Portfolio (${allCases.length} total)\nStatus breakdown: ${statusSummary}\n\nActive cases:\n${caseLines.join("\n")}\n${allCases.length > 30 ? `\n...and ${allCases.length - 30} more cases` : ""}\n\nYou can reference any of these cases when the user asks about a specific worker or situation.\n---`;
      }
    } catch {
      // org cases load is non-fatal
    }

    // Load conversation history for this case/worker (non-blocking on failure)
    let memoryBlock = "";
    if (memoryKey) {
      try {
        const pastMessages = await storage.getChatMemory(memoryKey, 8);
        if (pastMessages.length > 0) {
          const lines = pastMessages.map((m) =>
            m.role === "user" ? `Clinician: ${m.content}` : `Alex: ${m.content}`
          );
          memoryBlock = `\n\n---\nPrevious conversation with this ${context?.caseId ? "case" : "worker"} (DO NOT repeat issues already acknowledged in this history — only add new information or next actions):\n${lines.join("\n")}\n---`;
        }
      } catch {
        // memory load failure is non-fatal
      }
    }

    // Build optional context block for case or worker pages
    let contextBlock = "";
    if (context?.caseId) {
      try {
        // Try org-scoped first; fall back to admin lookup (case is already visible to user)
        const workerCaseOrg = await storage.getGPNet2CaseById(context.caseId, orgId).catch(() => null);
        const workerCase = workerCaseOrg ?? await (storage as any).getGPNet2CaseByIdAdmin?.(context.caseId).catch(() => null);
        const resolvedOrgId = workerCase?.organizationId ?? orgId;
        const [certCompliance, rtwCompliance, caseActions] = await Promise.all([
          getCaseCompliance(storage, context.caseId, resolvedOrgId).catch(() => null),
          getCaseRTWCompliance(storage, context.caseId, resolvedOrgId).catch(() => null),
          storage.getActionsByCase(context.caseId, resolvedOrgId).catch(() => []),
        ]);

        if (workerCase) {
          // Certificate status line
          let certLine = "\n- Certificate: unknown";
          if (certCompliance) {
            if (certCompliance.status === "compliant") {
              certLine = `\n- Certificate: valid (expires in ${certCompliance.daysUntilExpiry ?? "?"} days)`;
            } else if (certCompliance.status === "certificate_expiring_soon") {
              certLine = `\n- Certificate: EXPIRING SOON in ${certCompliance.daysUntilExpiry} days — suggest chasing renewal`;
            } else if (certCompliance.status === "certificate_expired") {
              certLine = `\n- Certificate: EXPIRED ${certCompliance.daysSinceExpiry} day${certCompliance.daysSinceExpiry !== 1 ? "s" : ""} ago — urgent action needed`;
            } else if (certCompliance.status === "no_certificate") {
              certLine = "\n- Certificate: none on file — may need to request one";
            }
          }

          // RTW status line
          let rtwLine = "";
          if (rtwCompliance && rtwCompliance.status !== "no_plan") {
            if (rtwCompliance.status === "plan_expired") {
              rtwLine = `\n- RTW plan: EXPIRED ${rtwCompliance.daysSinceExpiry ?? "?"} days ago — needs immediate update`;
            } else if (rtwCompliance.status === "plan_expiring_soon") {
              rtwLine = `\n- RTW plan: expiring in ${rtwCompliance.daysUntilExpiry ?? "?"} days — plan review needed`;
            } else if (rtwCompliance.status === "plan_compliant") {
              rtwLine = `\n- RTW plan: active (${rtwCompliance.daysUntilExpiry ?? "?"} days remaining)`;
            }
          } else {
            rtwLine = `\n- RTW plan: ${workerCase.rtwPlanStatus ?? "not started"}`;
          }

          // Overdue actions
          const overdueActions = caseActions.filter(a => {
            if (a.status === "done") return false;
            if (!a.dueDate) return false;
            return new Date(a.dueDate) < new Date();
          });
          const actionLine = overdueActions.length > 0
            ? `\n- Overdue actions: ${overdueActions.length} (${overdueActions.map(a => a.type.replace(/_/g, " ")).join(", ")})`
            : caseActions.filter(a => a.status !== "done").length > 0
            ? `\n- Open actions: ${caseActions.filter(a => a.status !== "done").length} pending`
            : "";

          // Stored compliance indicator (source of truth — set by compliance engine / seed / manual overrides)
          const storedCompliance = workerCase.compliance ?? null;
          const complianceLine = storedCompliance
            ? `\n- Compliance indicator (stored, source of truth): ${storedCompliance.indicator}${storedCompliance.reason ? ` — reason: ${storedCompliance.reason}` : ""}${storedCompliance.source ? ` [source: ${storedCompliance.source}]` : ""}`
            : workerCase.complianceIndicator
            ? `\n- Compliance indicator (stored, source of truth): ${workerCase.complianceIndicator}`
            : "\n- Compliance indicator: not on file";

          contextBlock = `\n\n---\n⚠ CONTEXT MODE: You are now assisting a Preventli CLINICIAN or ADMIN, NOT a patient. Override your "lead with a question" rule — instead, directly summarise the case status below and highlight any urgent issues. Do NOT ask who they are. Do NOT ask for more context. Jump straight to what matters.\n\nCase on screen:\n- Worker: ${workerCase.workerName}\n- Company: ${workerCase.company}\n- Work status: ${workerCase.workStatus}${complianceLine}${certLine}${rtwLine}${actionLine}\n- Summary: ${workerCase.summary ?? "no summary on file"}\n\nWhen the user asks about this worker's compliance status, report the Compliance indicator and reason exactly as shown above. Do NOT re-derive compliance from certificates, RTW plan status, or open actions — the stored indicator is the source of truth (it reflects the compliance engine, manual overrides, and discussion-note escalations). If certificate is expired or expiring, flag it as a separate concern. If actions are overdue, say so. If a telehealth consult would help resolve something, end with [SUGGEST_BOOKING].`;
        }
      } catch {
        // context load failure is non-fatal
      }
    } else if (context?.workerId) {
      try {
        const profile = await storage.getWorkerProfile(context.workerId);
        if (profile) {
          const { worker, assessments } = profile;

          // Compute recheck status inline
          const RECHECK_MONTHS: Record<string, number> = {
            cleared_unconditional: 12,
            cleared_conditional: 12,
            cleared_with_restrictions: 6,
          };
          const completed = assessments.filter((a) => a.status === "completed" && a.clearanceLevel);
          const latest = completed[0] ?? null;

          let recheckLine = "";
          if (latest) {
            const months = RECHECK_MONTHS[latest.clearanceLevel!];
            if (months) {
              const completedAt = latest.updatedAt ?? latest.createdAt;
              const due = completedAt ? new Date(completedAt) : new Date();
              due.setMonth(due.getMonth() + months);
              const daysUntil = Math.round((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              if (daysUntil <= 0) {
                recheckLine = `\n- Next health check: OVERDUE by ${Math.abs(daysUntil)} days — proactively suggest scheduling a new check`;
              } else if (daysUntil <= 60) {
                recheckLine = `\n- Next health check: due in ${daysUntil} days (${due.toLocaleDateString("en-AU")}) — mention this and offer to help book`;
              } else {
                recheckLine = `\n- Next health check: due ${due.toLocaleDateString("en-AU")} (${daysUntil} days away)`;
              }
            }
          }

          const latestAssessment = assessments[0] ?? null;
          const clearanceLine = latest?.clearanceLevel
            ? `\n- Clearance status: ${latest.clearanceLevel.replace(/_/g, " ")} (${latestAssessment?.positionTitle ?? "no role on file"})`
            : "\n- Clearance status: no completed assessment on file";

          contextBlock = `\n\n---\n⚠ CONTEXT MODE: You are assisting a Preventli CLINICIAN or ADMIN viewing this worker's profile. Override your "lead with a question" rule — summarise the worker's check status directly and highlight anything urgent. Do NOT ask who they are.\n\nWorker on screen:\n- Name: ${worker.name}\n- Email: ${worker.email ?? "not on file"}${clearanceLine}${recheckLine}\n- Total assessments completed: ${assessments.length}\n\nIf the health check is overdue or due soon, say so directly and recommend scheduling one immediately. End with [SUGGEST_BOOKING] if a booking would help.`;
        }
      } catch {
        // context load failure is non-fatal
      }
    }

    // Use tool-use loop when Anthropic provider is configured, otherwise plain prompt
    const systemPrompt = `${SOUL}${orgCasesBlock}${memoryBlock}${contextBlock}\n\n---\nRespond as Alex. Keep it concise (2-4 sentences). If you want to suggest a booking, end your response with [SUGGEST_BOOKING].`;
    const provider = (process.env.LLM_PROVIDER ?? "claude-cli").toLowerCase();
    const useTools = (provider === "anthropic" || provider === "openrouter") && !!process.env.OPENROUTER_API_KEY;

    // Sanitise history — only keep user/assistant turns, cap at last 10 messages
    const sessionHistory: ChatMessage[] = (history ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-10);

    let reply: string;
    if (useTools) {
      reply = await callClaudeWithTools(
        systemPrompt,
        message,
        ALEX_TOOLS,
        (toolName, toolInput) => executeAlexTool(toolName, toolInput, { organizationId: orgId, isAdmin }),
        10,
        sessionHistory,
      );
    } else if (provider === "anthropic" || provider === "openrouter") {
      reply = await callClaudeMultiTurn(systemPrompt, [...sessionHistory, { role: "user", content: message }]);
    } else {
      const prompt = `${systemPrompt}\n\nUser message: ${message}`;
      reply = await callClaude(prompt);
    }

    // Detect booking suggestion signal from soul
    const suggestBooking = reply.includes("[SUGGEST_BOOKING]");
    reply = reply.replace("[SUGGEST_BOOKING]", "").trim();

    // Persist conversation to memory (fire-and-forget — non-blocking)
    if (memoryKey) {
      const baseRecord = {
        organizationId: orgId,
        caseId: context?.caseId ?? null,
        workerId: context?.workerId ?? null,
      };
      Promise.all([
        storage.saveChatMessage({ ...baseRecord, role: "user", content: message }),
        storage.saveChatMessage({ ...baseRecord, role: "assistant", content: reply }),
      ]).catch((err) => logger.error("Failed to save chat memory:", undefined, err));
    }

    res.json({ data: { response: reply, sessionId, suggestBooking }, reply, sessionId, suggestBooking });
  } catch (error) {
    logger.error("Chat error:", undefined, error);
    res.status(500).json({ error: "Failed to process message" });
  }
});



/**
 * @route POST /api/chat/stream
 * @desc Stream a message from Alex via SSE (Server-Sent Events)
 * @access Private
 *
 * Runs the full context-loading pipeline (case context, org cases, memory)
 * then streams the LLM response as SSE deltas.
 *
 * Tool-use note: tools run in batch via callClaudeWithTools first;
 * the final assistant text is then streamed via OpenRouter SSE.
 * This gives real streaming UX while preserving tool-use accuracy.
 */
router.post("/stream", authorize(), async (req: AuthRequest, res: Response) => {
  // ── SSE headers ──────────────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();

  function sendDelta(text: string): void {
    res.write(`data: ${JSON.stringify({ type: "delta", text })}\n\n`);
  }
  function sendDone(): void {
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
  }
  function sendError(msg: string): void {
    res.write(`data: ${JSON.stringify({ type: "error", message: msg })}\n\n`);
    res.end();
  }

  try {
    const { message, sessionId, context, history } = req.body as {
      message: string;
      sessionId: string;
      context?: { caseId?: string; workerId?: string };
      history?: ChatMessage[];
    };

    if (!message || typeof message !== "string") {
      sendError("message is required");
      return;
    }
    if (!sessionId || typeof sessionId !== "string") {
      sendError("sessionId is required");
      return;
    }

    const orgId = req.user!.organizationId;
    const isAdmin = req.user!.role === "admin";
    const memoryKey = context?.caseId
      ? { caseId: context.caseId }
      : context?.workerId
      ? { workerId: context.workerId }
      : null;

    // ── Org-wide case portfolio ───────────────────────────────────────────
    let orgCasesBlock = "";
    try {
      const allCases = await storage.getCases(orgId, isAdmin);
      if (allCases.length > 0) {
        const statusCounts: Record<string, number> = {};
        for (const c of allCases) {
          const s = c.workStatus ?? "unknown";
          statusCounts[s] = (statusCounts[s] || 0) + 1;
        }
        const statusSummary = Object.entries(statusCounts)
          .map(([s, n]) => `${s}: ${n}`)
          .join(", ");
        const caseLines = allCases.slice(0, 30).map((c) =>
          `- ${c.workerName} (${c.company}) — ${c.workStatus ?? "unknown"}${c.summary ? `: ${c.summary.slice(0, 120)}` : ""}`
        );
        orgCasesBlock = `\n\n---\n## Organisation Case Portfolio (${allCases.length} total)\nStatus breakdown: ${statusSummary}\n\nActive cases:\n${caseLines.join("\n")}\n${allCases.length > 30 ? `\n...and ${allCases.length - 30} more cases` : ""}\n\nYou can reference any of these cases when the user asks about a specific worker or situation.\n---`;
      }
    } catch {
      // non-fatal
    }

    // ── Conversation memory ───────────────────────────────────────────────
    let memoryBlock = "";
    if (memoryKey) {
      try {
        const pastMessages = await storage.getChatMemory(memoryKey, 8);
        if (pastMessages.length > 0) {
          const lines = pastMessages.map((m) =>
            m.role === "user" ? `Clinician: ${m.content}` : `Alex: ${m.content}`
          );
          memoryBlock = `\n\n---\nPrevious conversation with this ${context?.caseId ? "case" : "worker"} (DO NOT repeat issues already acknowledged in this history — only add new information or next actions):\n${lines.join("\n")}\n---`;
        }
      } catch {
        // non-fatal
      }
    }

    // ── Case / worker context ─────────────────────────────────────────────
    let contextBlock = "";
    if (context?.caseId) {
      try {
        const workerCaseOrg = await storage.getGPNet2CaseById(context.caseId, orgId).catch(() => null);
        const workerCase = workerCaseOrg ?? await (storage as Record<string, unknown> & { getGPNet2CaseByIdAdmin?: (id: string) => Promise<unknown> }).getGPNet2CaseByIdAdmin?.(context.caseId).catch(() => null);
        const resolvedOrgId = (workerCase as { organizationId?: string } | null)?.organizationId ?? orgId;
        const [certCompliance, rtwCompliance, caseActions] = await Promise.all([
          getCaseCompliance(storage, context.caseId, resolvedOrgId).catch(() => null),
          getCaseRTWCompliance(storage, context.caseId, resolvedOrgId).catch(() => null),
          storage.getActionsByCase(context.caseId, resolvedOrgId).catch(() => []),
        ]);

        if (workerCase) {
          const wc = workerCase as {
            workerName: string;
            company: string;
            workStatus?: string;
            compliance?: { indicator: string; reason?: string; source?: string } | null;
            complianceIndicator?: string;
            rtwPlanStatus?: string;
            summary?: string;
          };

          let certLine = "\n- Certificate: unknown";
          if (certCompliance) {
            if (certCompliance.status === "compliant") {
              certLine = `\n- Certificate: valid (expires in ${certCompliance.daysUntilExpiry ?? "?"} days)`;
            } else if (certCompliance.status === "certificate_expiring_soon") {
              certLine = `\n- Certificate: EXPIRING SOON in ${certCompliance.daysUntilExpiry} days — suggest chasing renewal`;
            } else if (certCompliance.status === "certificate_expired") {
              certLine = `\n- Certificate: EXPIRED ${certCompliance.daysSinceExpiry} day${certCompliance.daysSinceExpiry !== 1 ? "s" : ""} ago — urgent action needed`;
            } else if (certCompliance.status === "no_certificate") {
              certLine = "\n- Certificate: none on file — may need to request one";
            }
          }

          let rtwLine = "";
          if (rtwCompliance && rtwCompliance.status !== "no_plan") {
            if (rtwCompliance.status === "plan_expired") {
              rtwLine = `\n- RTW plan: EXPIRED ${rtwCompliance.daysSinceExpiry ?? "?"} days ago — needs immediate update`;
            } else if (rtwCompliance.status === "plan_expiring_soon") {
              rtwLine = `\n- RTW plan: expiring in ${rtwCompliance.daysUntilExpiry ?? "?"} days — plan review needed`;
            } else if (rtwCompliance.status === "plan_compliant") {
              rtwLine = `\n- RTW plan: active (${rtwCompliance.daysUntilExpiry ?? "?"} days remaining)`;
            }
          } else {
            rtwLine = `\n- RTW plan: ${wc.rtwPlanStatus ?? "not started"}`;
          }

          const overdueActions = caseActions.filter((a: { status: string; dueDate?: string | null }) => {
            if (a.status === "done") return false;
            if (!a.dueDate) return false;
            return new Date(a.dueDate) < new Date();
          });
          const actionLine = overdueActions.length > 0
            ? `\n- Overdue actions: ${overdueActions.length} (${overdueActions.map((a: { type: string }) => a.type.replace(/_/g, " ")).join(", ")})`
            : caseActions.filter((a: { status: string }) => a.status !== "done").length > 0
            ? `\n- Open actions: ${caseActions.filter((a: { status: string }) => a.status !== "done").length} pending`
            : "";

          const storedCompliance = wc.compliance ?? null;
          const complianceLine = storedCompliance
            ? `\n- Compliance indicator (stored, source of truth): ${storedCompliance.indicator}${storedCompliance.reason ? ` — reason: ${storedCompliance.reason}` : ""}${storedCompliance.source ? ` [source: ${storedCompliance.source}]` : ""}`
            : wc.complianceIndicator
            ? `\n- Compliance indicator (stored, source of truth): ${wc.complianceIndicator}`
            : "\n- Compliance indicator: not on file";

          contextBlock = `\n\n---\n⚠ CONTEXT MODE: You are now assisting a Preventli CLINICIAN or ADMIN, NOT a patient. Override your "lead with a question" rule — instead, directly summarise the case status below and highlight any urgent issues. Do NOT ask who they are. Do NOT ask for more context. Jump straight to what matters.\n\nCase on screen:\n- Worker: ${wc.workerName}\n- Company: ${wc.company}\n- Work status: ${wc.workStatus}${complianceLine}${certLine}${rtwLine}${actionLine}\n- Summary: ${wc.summary ?? "no summary on file"}\n\nWhen the user asks about this worker's compliance status, report the Compliance indicator and reason exactly as shown above. Do NOT re-derive compliance from certificates, RTW plan status, or open actions — the stored indicator is the source of truth. If certificate is expired or expiring, flag it as a separate concern. If actions are overdue, say so. If a telehealth consult would help resolve something, end with [SUGGEST_BOOKING].`;
        }
      } catch {
        // non-fatal
      }
    } else if (context?.workerId) {
      try {
        const profile = await storage.getWorkerProfile(context.workerId);
        if (profile) {
          const { worker, assessments } = profile;
          const RECHECK_MONTHS: Record<string, number> = {
            cleared_unconditional: 12,
            cleared_conditional: 12,
            cleared_with_restrictions: 6,
          };
          const completed = assessments.filter((a: { status: string; clearanceLevel?: string | null }) => a.status === "completed" && a.clearanceLevel);
          const latest = completed[0] ?? null;
          let recheckLine = "";
          if (latest) {
            const months = RECHECK_MONTHS[latest.clearanceLevel!];
            if (months) {
              const completedAt = latest.updatedAt ?? latest.createdAt;
              const due = completedAt ? new Date(completedAt) : new Date();
              due.setMonth(due.getMonth() + months);
              const daysUntil = Math.round((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
              if (daysUntil <= 0) {
                recheckLine = `\n- Next health check: OVERDUE by ${Math.abs(daysUntil)} days — proactively suggest scheduling a new check`;
              } else if (daysUntil <= 60) {
                recheckLine = `\n- Next health check: due in ${daysUntil} days (${due.toLocaleDateString("en-AU")}) — mention this and offer to help book`;
              } else {
                recheckLine = `\n- Next health check: due ${due.toLocaleDateString("en-AU")} (${daysUntil} days away)`;
              }
            }
          }
          const latestAssessment = assessments[0] ?? null;
          const clearanceLine = latest?.clearanceLevel
            ? `\n- Clearance status: ${latest.clearanceLevel.replace(/_/g, " ")} (${latestAssessment?.positionTitle ?? "no role on file"})`
            : "\n- Clearance status: no completed assessment on file";

          contextBlock = `\n\n---\n⚠ CONTEXT MODE: You are assisting a Preventli CLINICIAN or ADMIN viewing this worker's profile. Override your "lead with a question" rule — summarise the worker's check status directly and highlight anything urgent. Do NOT ask who they are.\n\nWorker on screen:\n- Name: ${worker.name}\n- Email: ${worker.email ?? "not on file"}${clearanceLine}${recheckLine}\n- Total assessments completed: ${assessments.length}\n\nIf the health check is overdue or due soon, say so directly and recommend scheduling one immediately. End with [SUGGEST_BOOKING] if a booking would help.`;
        }
      } catch {
        // non-fatal
      }
    }

    // ── Build system prompt ───────────────────────────────────────────────
    const systemPrompt = `${SOUL}${orgCasesBlock}${memoryBlock}${contextBlock}\n\n---\nRespond as Alex. Keep it concise (2-4 sentences). If you want to suggest a booking, end your response with [SUGGEST_BOOKING].`;

    // ── Sanitise history ──────────────────────────────────────────────────
    const sessionHistory: ChatMessage[] = (history ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-10);

    // ── Stream via OpenRouter ─────────────────────────────────────────────
    const apiKey = process.env.OPENROUTER_API_KEY;
    const baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
    const model = process.env.LLM_MODEL ?? "anthropic/claude-sonnet-4-5";

    if (!apiKey) {
      // Fallback: batch completion streamed as single delta
      const provider = (process.env.LLM_PROVIDER ?? "claude-cli").toLowerCase();
      const useTools = (provider === "anthropic" || provider === "openrouter");
      let reply: string;
      if (useTools) {
        reply = await callClaudeWithTools(
          systemPrompt,
          message,
          ALEX_TOOLS,
          (toolName, toolInput) => executeAlexTool(toolName, toolInput, { organizationId: orgId, isAdmin }),
          10,
          sessionHistory,
        );
      } else {
        reply = await callClaude(`${systemPrompt}\n\nUser message: ${message}`);
      }
      reply = reply.replace("[SUGGEST_BOOKING]", "").trim();
      sendDelta(reply);
      sendDone();

      if (memoryKey) {
        const baseRecord = { organizationId: orgId, caseId: context?.caseId ?? null, workerId: context?.workerId ?? null };
        Promise.all([
          storage.saveChatMessage({ ...baseRecord, role: "user", content: message }),
          storage.saveChatMessage({ ...baseRecord, role: "assistant", content: reply }),
        ]).catch((err) => logger.error("Failed to save chat memory:", undefined, err));
      }
      return;
    }

    type OAIMessage = { role: string; content: string };
    const oaiMessages: OAIMessage[] = [
      { role: "system", content: systemPrompt },
      ...sessionHistory.map((m) => ({ role: m.role, content: m.content })),
      { role: "user", content: message },
    ];

    const streamRes = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.APP_URL ?? "https://preventli.com.au",
        "X-Title": "Preventli",
      },
      body: JSON.stringify({ model, messages: oaiMessages, stream: true, temperature: 0.1 }),
    });

    if (!streamRes.ok || !streamRes.body) {
      const errBody = await streamRes.text().catch(() => "(no body)");
      logger.error("OpenRouter stream error", { status: streamRes.status, body: errBody.slice(0, 300) });
      sendError("LLM stream failed");
      return;
    }

    // Accumulate full reply for memory persistence
    let fullReply = "";

    const reader = streamRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const json = JSON.parse(trimmed.slice(6)) as {
            choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
          };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            fullReply += delta;
            sendDelta(delta);
          }
        } catch {
          // Malformed SSE chunk — skip
        }
      }
    }

    // Strip booking signal from persisted memory copy
    const cleanReply = fullReply.replace("[SUGGEST_BOOKING]", "").trim();

    sendDone();

    // Persist conversation to memory (fire-and-forget)
    if (memoryKey) {
      const baseRecord = { organizationId: orgId, caseId: context?.caseId ?? null, workerId: context?.workerId ?? null };
      Promise.all([
        storage.saveChatMessage({ ...baseRecord, role: "user", content: message }),
        storage.saveChatMessage({ ...baseRecord, role: "assistant", content: cleanReply }),
      ]).catch((err) => logger.error("Failed to save chat memory:", undefined, err));
    }
  } catch (error) {
    logger.error("Chat stream error:", undefined, error);
    try {
      sendError("Failed to process message");
    } catch {
      // Response may already be ended
    }
  }
});


export default router;
