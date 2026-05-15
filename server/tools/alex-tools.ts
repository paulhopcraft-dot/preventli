/**
 * Alex AI Tools — gives Alex agentic capabilities over Preventli data and codebase.
 *
 * Data tools:  search_cases, get_case, update_case, create_case, create_action, trigger_freshdesk_sync
 * Code tools:  read_file, write_file, run_bash
 *
 * Tool use requires LLM_PROVIDER=anthropic.
 */

import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";
import { storage } from "../storage";
import { type AnthropicTool } from "../lib/llm-client";
import type { CaseActionType, WorkStatus } from "../../shared/schema";

const PROJECT_ROOT = process.cwd();

// ─── Tool definitions ─────────────────────────────────────────────────────────

export const ALEX_TOOLS: AnthropicTool[] = [
  {
    name: "search_cases",
    description: "Search worker cases by name, company, or work status. Returns matching cases with key details.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term — matches worker name or company" },
        status: { type: "string", description: "Filter by work status (e.g. 'off_work', 'modified_duties', 'full_duties')" },
      },
    },
  },
  {
    name: "get_case",
    description: "Get full details for a specific worker case including certificates, actions, RTW plan, and the stored compliance indicator. When asked about a worker's compliance status, report the `compliance.indicator` and `compliance.reason` from this payload verbatim — it is the source of truth. Do NOT re-derive compliance from certs or RTW plan.",
    input_schema: {
      type: "object",
      properties: {
        case_id: { type: "string", description: "The worker case ID" },
      },
      required: ["case_id"],
    },
  },
  {
    name: "update_case",
    description: "Update a worker case field (work_status, summary, or close the case).",
    input_schema: {
      type: "object",
      properties: {
        case_id: { type: "string", description: "The worker case ID to update" },
        field: {
          type: "string",
          description: "Field to update",
          enum: ["work_status", "summary", "close"],
        },
        value: { type: "string", description: "New value (not needed for 'close')" },
        reason: { type: "string", description: "Reason for the change (used for close)" },
      },
      required: ["case_id", "field"],
    },
  },
  {
    name: "create_case",
    description: "Create a new worker case (claim) in the system.",
    input_schema: {
      type: "object",
      properties: {
        worker_name: { type: "string", description: "Full name of the injured worker" },
        company: { type: "string", description: "Employer company name" },
        injury_description: { type: "string", description: "Brief description of the injury or incident" },
        work_status: {
          type: "string",
          description: "Initial work status",
          enum: ["off_work", "modified_duties", "full_duties"],
        },
      },
      required: ["worker_name", "company", "injury_description"],
    },
  },
  {
    name: "create_action",
    description: "Create an action item or check for a worker case (e.g. chase certificate, review case, follow up).",
    input_schema: {
      type: "object",
      properties: {
        case_id: { type: "string", description: "The worker case ID" },
        type: {
          type: "string",
          description: "Action type",
          enum: ["chase_certificate", "review_case", "follow_up"],
        },
        notes: { type: "string", description: "Additional notes for the action" },
        due_days: { type: "string", description: "Number of days from now until due (default: 7)" },
      },
      required: ["case_id", "type"],
    },
  },
  {
    name: "complete_action",
    description: "Mark a case action as completed (done). Use when the user confirms an action has been carried out.",
    input_schema: {
      type: "object",
      properties: {
        action_id: { type: "string", description: "The action ID to mark as done" },
      },
      required: ["action_id"],
    },
  },
  {
    name: "update_action",
    description: "Update a case action's due date or notes.",
    input_schema: {
      type: "object",
      properties: {
        action_id: { type: "string", description: "The action ID to update" },
        due_days: { type: "string", description: "New due date as number of days from today" },
        notes: { type: "string", description: "Updated notes for the action" },
      },
      required: ["action_id"],
    },
  },
  {
    name: "add_case_note",
    description: "Add a discussion note to a worker case (e.g. from a phone call, meeting, or clinical observation).",
    input_schema: {
      type: "object",
      properties: {
        case_id: { type: "string", description: "The worker case ID" },
        note: { type: "string", description: "The note content — what was discussed or observed" },
        next_steps: { type: "array", items: { type: "string" }, description: "Optional list of next steps arising from this note" } as any,
      },
      required: ["case_id", "note"],
    },
  },
  {
    name: "trigger_freshdesk_sync",
    description: "Trigger a Freshdesk ticket sync to pull in the latest tickets and update worker cases.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "read_file",
    description: "Read the contents of a file in the Preventli codebase.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to project root (e.g. 'server/routes/chat.ts')" },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "Write or overwrite a file in the Preventli codebase. Use for code fixes.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to project root" },
        content: { type: "string", description: "Full file content to write" },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "run_bash",
    description: "Run a bash command in the Preventli project directory. Use for builds, tests, installs, git ops.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run (e.g. 'npm run build', 'git status')" },
        timeout_ms: { type: "string", description: "Timeout in milliseconds (default: 30000)" },
      },
      required: ["command"],
    },
  },
];

// ─── Tool executor ────────────────────────────────────────────────────────────

export async function executeAlexTool(
  name: string,
  input: Record<string, unknown>,
  context: { organizationId: string; isAdmin?: boolean },
): Promise<unknown> {
  const orgId = context.organizationId;
  const isAdmin = context.isAdmin ?? false;

  switch (name) {
    case "search_cases": {
      const query = (input.query as string | undefined)?.toLowerCase() ?? "";
      const statusFilter = input.status as string | undefined;
      const cases = await storage.getCases(orgId, isAdmin);
      const filtered = cases.filter((c) => {
        const matchesQuery = !query
          || c.workerName.toLowerCase().includes(query)
          || c.company.toLowerCase().includes(query);
        const matchesStatus = !statusFilter || c.workStatus === statusFilter;
        return matchesQuery && matchesStatus;
      });
      return filtered.slice(0, 20).map((c) => ({
        id: c.id,
        worker_name: c.workerName,
        company: c.company,
        work_status: c.workStatus,
        summary: c.summary?.slice(0, 200),
      }));
    }

    case "get_case": {
      const caseId = input.case_id as string;
      const [workerCase, actions, certs] = await Promise.all([
        storage.getGPNet2CaseById(caseId, orgId),
        storage.getActionsByCase(caseId, orgId).catch(() => []),
        storage.getCertificatesByCase(caseId, orgId).catch(() => []),
      ]);
      if (!workerCase) return { error: `Case ${caseId} not found` };
      return {
        id: workerCase.id,
        worker_name: workerCase.workerName,
        company: workerCase.company,
        work_status: workerCase.workStatus,
        summary: workerCase.summary,
        days_off_work: null,
        // Stored compliance indicator — source of truth. Report verbatim when asked
        // about compliance; do NOT re-derive from certs or RTW plan.
        compliance: workerCase.compliance
          ? {
              indicator: workerCase.compliance.indicator,
              reason: workerCase.compliance.reason,
              source: workerCase.compliance.source,
              last_checked: workerCase.compliance.lastChecked,
            }
          : workerCase.complianceIndicator
          ? { indicator: workerCase.complianceIndicator, reason: null, source: null, last_checked: null }
          : null,
        open_actions: actions.filter((a) => a.status !== "done").map((a) => ({
          type: a.type,
          status: a.status,
          due_date: a.dueDate,
          notes: a.notes,
        })),
        certificates: certs.map((c) => ({
          start_date: c.startDate,
          end_date: c.endDate,
          capacity: c.workCapacity,
        })),
      };
    }

    case "update_case": {
      const caseId = input.case_id as string;
      const field = input.field as string;
      const value = input.value as string | undefined;

      if (field === "close") {
        await storage.closeCase(caseId, orgId, input.reason as string | undefined);
        return { success: true, message: `Case ${caseId} closed` };
      }

      if (field === "summary") {
        await storage.updateAISummary(caseId, orgId, value ?? "", "alex-tool");
        return { success: true, message: `Summary updated` };
      }

      // For work_status and other fields, use direct db update via syncWorkerCaseFromFreshdesk pattern
      const workerCase = await storage.getGPNet2CaseById(caseId, orgId);
      if (!workerCase) return { error: `Case ${caseId} not found` };

      if (field === "work_status") {
        await storage.syncWorkerCaseFromFreshdesk({ id: caseId, organizationId: orgId, workStatus: value as WorkStatus });
        return { success: true, message: `Work status updated to ${value}` };
      }

      return { error: `Unknown field: ${field}` };
    }

    case "create_case": {
      const caseData = {
        id: crypto.randomUUID(),
        organizationId: orgId,
        workerName: input.worker_name as string,
        company: input.company as string,
        workStatus: ((input.work_status as string) ?? "Off work") as WorkStatus,
        summary: input.injury_description as string,
        ticketIds: [],
      };
      await storage.syncWorkerCaseFromFreshdesk(caseData);
      return { success: true, case_id: caseData.id, message: `Case created for ${caseData.workerName}` };
    }

    case "create_action": {
      const caseId = input.case_id as string;
      const dueDays = parseInt((input.due_days as string) ?? "7", 10);
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + dueDays);

      const action = await storage.createAction({
        caseId,
        organizationId: orgId,
        type: input.type as CaseActionType,
        dueDate,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      return { success: true, action_id: action.id, message: `Action "${input.type}" created, due ${dueDate.toLocaleDateString("en-AU")}` };
    }

    case "complete_action": {
      const actionId = input.action_id as string;
      await storage.completeAction(actionId, "alex-ai", "Dr. Alex");
      return { success: true, message: `Action ${actionId} marked as completed` };
    }

    case "update_action": {
      const actionId = input.action_id as string;
      const updates: Record<string, unknown> = {};
      if (input.notes) updates.notes = input.notes;
      if (input.due_days) {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + parseInt(input.due_days as string, 10));
        updates.dueDate = dueDate;
      }
      await storage.updateAction(actionId, updates as Parameters<typeof storage.updateAction>[1]);
      return { success: true, message: `Action ${actionId} updated` };
    }

    case "add_case_note": {
      const caseId = input.case_id as string;
      const workerCase = await storage.getGPNet2CaseById(caseId, orgId);
      if (!workerCase) return { error: `Case ${caseId} not found` };
      const noteId = crypto.randomUUID();
      await storage.upsertCaseDiscussionNotes([{
        id: noteId,
        organizationId: orgId,
        caseId,
        workerName: workerCase.workerName,
        rawText: input.note as string,
        summary: input.note as string,
        nextSteps: (input.next_steps as string[] | undefined) ?? [],
        riskFlags: [],
        updatesCompliance: false,
        updatesRecoveryTimeline: false,
      } as any]);
      return { success: true, note_id: noteId, message: `Note added to case for ${workerCase.workerName}` };
    }

    case "trigger_freshdesk_sync": {
      if (!process.env.FRESHDESK_DOMAIN || !process.env.FRESHDESK_API_KEY) {
        return { error: "Freshdesk not configured — FRESHDESK_DOMAIN and FRESHDESK_API_KEY must be set" };
      }
      // Dynamically import to avoid circular deps
      const { FreshdeskService } = await import("../services/freshdesk");
      const freshdesk = new FreshdeskService();
      const tickets = await freshdesk.fetchTickets();
      return { success: true, message: `Freshdesk sync triggered — ${tickets.length} tickets fetched` };
    }

    case "read_file": {
      const filePath = join(PROJECT_ROOT, input.path as string);
      try {
        const content = readFileSync(filePath, "utf-8");
        return { path: input.path, content: content.slice(0, 8000) }; // cap at 8k chars
      } catch (err) {
        return { error: `Cannot read ${input.path}: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    case "write_file": {
      const filePath = join(PROJECT_ROOT, input.path as string);
      writeFileSync(filePath, input.content as string, "utf-8");
      return { success: true, message: `Written ${input.path}` };
    }

    case "run_bash": {
      const timeoutMs = parseInt((input.timeout_ms as string) ?? "30000", 10);
      try {
        const output = execSync(input.command as string, {
          cwd: PROJECT_ROOT,
          timeout: timeoutMs,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        return { success: true, output: output.slice(0, 4000) };
      } catch (err: unknown) {
        const execErr = err as { message?: string; stdout?: string; stderr?: string };
        return {
          error: execErr.message ?? String(err),
          stdout: execErr.stdout?.slice(0, 2000),
          stderr: execErr.stderr?.slice(0, 2000),
        };
      }
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
