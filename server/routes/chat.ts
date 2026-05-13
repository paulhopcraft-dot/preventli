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

// Load Alex soul from config file — edit config/DR_ALEX_SOUL.md to change persona
function loadSoul(): string {
  try {
    const soulPath = join(process.cwd(), "config", "DR_ALEX_SOUL.md");
    return readFileSync(soulPath, "utf-8");
  } catch {
    logger.error("DR_ALEX_SOUL.md not found — using fallback persona");
    return "You are Alex, a warm and professional workplace health specialist at Preventli. Help users with health questions. Do not diagnose or prescribe. If they need a doctor, end with [SUGGEST_BOOKING].";
  }
}

// Loaded once at startup — restart server to pick up soul changes
const SOUL = loadSoul();

/**
 * @route POST /api/chat/message
 * @desc Send a message to Alex (Health Assistant)
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

          contextBlock = `\n\n---\n⚠ CONTEXT MODE: You are now assisting a Preventli CLINICIAN or ADMIN, NOT a patient. Override your "lead with a question" rule — instead, directly summarise the case status below and highlight any urgent issues. Do NOT ask who they are. Do NOT ask for more context. Jump straight to what matters.\n\nCase on screen:\n- Worker: ${workerCase.workerName}\n- Company: ${workerCase.company}\n- Work status: ${workerCase.workStatus}${certLine}${rtwLine}${actionLine}\n- Summary: ${workerCase.summary ?? "no summary on file"}\n\nIf the certificate is expired or expiring, flag it first. If actions are overdue, say so. If a telehealth consult would help resolve something, end with [SUGGEST_BOOKING].`;
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

export default router;
