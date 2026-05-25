/**
 * RTW Agent — Autonomous Return-to-Work Manager
 *
 * Pre-gathers all case context, then uses Claude CLI to decide
 * what RTW actions to take (plan generation, emails, follow-ups).
 */

import { runAgent, type AgentTool } from "./base-agent";
import { caseTools } from "./agent-tools/case-tools";
import { rtwTools } from "./agent-tools/rtw-tools";
import { emailTools } from "./agent-tools/email-tools";
import { timelineTools } from "./agent-tools/timeline-tools";
import { db } from "../db";
import { agentJobs } from "@shared/schema";
import { eq } from "drizzle-orm";
import { createLogger } from "../lib/logger";

const logger = createLogger("RTWAgent");

function findTool(arr: AgentTool[], name: string): AgentTool {
  const t = arr.find((x) => x.name === name);
  if (!t) throw new Error(`Tool not found: ${name}`);
  return t;
}

// ─── Task builders ────────────────────────────────────────────────────────────

function buildStandardRTWTask(): string {
  return `
You are the RTW Agent for Preventli. Manage the Return-to-Work process for this worker.

Workflow:
1. Review the case, medical constraints, suitable duties, and current RTW plan status
2. If no RTW plan exists and suitable duties are confirmed, call generate_rtw_plan
3. Draft and send emails to treating parties (GP, employer, worker) using draft_email then send_email
4. Update the RTW plan status to "pending" (sent for comment)
5. Schedule follow-ups: 3 days (GP chase if no response), 5 days (deemed acceptance check)
6. Create a timeline event recording the RTW plan was sent
7. Call update_job_summary with what you did

AUTO-EXECUTE (no human approval needed):
- Generate RTW plan, send emails, update status, schedule follow-ups, log timeline events

ESCALATE TO HUMAN (use notify_case_manager, set autoExecute: false):
- Worker doesn't attend Day 1
- Doctor or employer objects to the plan
- Worker requests significant modifications
  `.trim();
}

function buildPreventionCheckReviewTask(context: Record<string, unknown>): string {
  const responses = context.questionnaireResponses
    ? JSON.stringify(context.questionnaireResponses, null, 2)
    : "(responses not available)";

  return `
You are the RTW Agent for Preventli. A worker has just completed a Prevention Check.

TRIGGER: This check was automatically sent because the worker's latest medical certificate
showed a capacity downgrade (e.g. from "partial" to "unfit"). They have now submitted
their responses, giving you fresh insight into how they are feeling and what barriers
they face in returning to work.

WORKER'S PREVENTION CHECK RESPONSES:
${responses}

YOUR JOB — in this order:
1. Review the Prevention Check responses alongside the existing RTW plan and medical constraints.
2. Identify what has changed: Is the worker struggling more than expected? Are there new
   barriers (pain, mental health, transport, family)? Has motivation improved or declined?
3. Determine whether the current RTW plan needs to change:
   - If the plan is broadly still appropriate, note why and escalate for human review.
   - If the plan needs updating (new duties, different hours, changed milestones), call
     generate_rtw_plan to produce a revised recommendation.
4. ALWAYS call notify_case_manager (autoExecute: false) with a concise summary:
   - What the worker said
   - What changed since the last plan
   - Specific recommended action (update plan / call worker / refer to GP / no change)
5. Create a timeline event: "Prevention Check completed — RTW review triggered"
6. Call update_job_summary with what you did.

DO NOT auto-send any emails to the worker or treating parties — this requires case manager
review first. Use notify_case_manager for all recommendations.

TONE: clinical, specific, action-oriented. The case manager needs to act on your output.
  `.trim();
}

// ─────────────────────────────────────────────────────────────────────────────

/** Action tools Claude can request — write actions only */
const ACTION_TOOLS: AgentTool[] = [
  findTool(rtwTools, "generate_rtw_plan"),
  findTool(rtwTools, "update_rtw_plan_status"),
  findTool(emailTools, "draft_email"),
  findTool(emailTools, "send_email"),
  findTool(timelineTools, "create_timeline_event"),
  findTool(timelineTools, "schedule_followup"),
  findTool(timelineTools, "notify_case_manager"),
  findTool(timelineTools, "update_job_summary"),
];

export async function runRTWAgent(
  jobId: string,
  caseId: string,
  context: Record<string, unknown> = {}
): Promise<void> {
  logger.info("Starting RTW agent", { jobId, caseId });

  await db
    .update(agentJobs)
    .set({ status: "running", startedAt: new Date() } as any)
    .where(eq(agentJobs.id, jobId));

  try {
    // Pre-gather all case context upfront
    const [workerCase, medicalConstraints, suitableDuties, rtwPlan, treatingParties] =
      await Promise.all([
        findTool(caseTools, "get_case").execute({ caseId }),
        findTool(caseTools, "get_medical_constraints").execute({ caseId }),
        findTool(rtwTools, "get_suitable_duties").execute({ caseId }),
        findTool(rtwTools, "get_rtw_plan").execute({ caseId }),
        findTool(caseTools, "get_treating_parties").execute({ caseId }),
      ]);

    const agentContext = {
      caseId,
      jobId,
      today: new Date().toDateString(),
      triggerContext: context,
      workerCase,
      medicalConstraints,
      suitableDuties,
      rtwPlan,
      treatingParties,
    };

    const isPreventionCheckReview = context.mode === "prevention_check_review";

    const task = isPreventionCheckReview
      ? buildPreventionCheckReviewTask(context)
      : buildStandardRTWTask();

    const result = await runAgent(task, agentContext, ACTION_TOOLS, jobId, caseId);

    await db
      .update(agentJobs)
      .set({ status: "completed", completedAt: new Date(), summary: result.result } as any)
      .where(eq(agentJobs.id, jobId));

    logger.info("RTW agent completed", { jobId, caseId, actionsCount: result.actionsCount });
  } catch (err) {
    logger.error("RTW agent failed", { jobId, caseId }, err);
    await db
      .update(agentJobs)
      .set({
        status: "failed",
        completedAt: new Date(),
        error: err instanceof Error ? err.message : String(err),
      } as any)
      .where(eq(agentJobs.id, jobId));
    throw err;
  }
}
