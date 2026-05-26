/**
 * Alex tools for the build-status board (preventli-dashboard).
 *
 * Two tools:
 *   create_dashboard_card        — inserts a Node row under the Preventli product
 *   update_dashboard_card_status — moves a card between columns
 *
 * Both fire Telegram (fail-open) on success. Direct INSERT/UPDATE against the
 * shared `Node` table — same Postgres both apps point at.
 */

import { db } from "../db";
import { node } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { AnthropicTool } from "../lib/llm-client";
import { createLogger } from "../lib/logger";

const log = createLogger("DashboardTools");

const PRODUCT_NODE_ID = process.env.PREVENTLI_PRODUCT_NODE_ID ?? "preventli-app";

const CARD_TYPES = ["idea", "bug", "feature", "chore", "question"] as const;
const CARD_STATUSES = ["open", "active", "complete", "dev_request"] as const;
type CardType = (typeof CARD_TYPES)[number];
type CardStatus = (typeof CARD_STATUSES)[number];

export const DASHBOARD_TOOLS: AnthropicTool[] = [
  {
    name: "create_dashboard_card",
    description:
      "Create a new card on the build-status board. Use when the user asks for a feature, reports a bug, captures an idea, or assigns a chore. Title is required and should be short (3-10 words). Description is the full body of the ask. Returns the new card id.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short imperative title (e.g. 'Fix login redirect on iPad')" },
        description: { type: "string", description: "Full body — context, acceptance criteria, links" },
        type: {
          type: "string",
          enum: [...CARD_TYPES],
          description: "Card type. Default 'idea'.",
        },
        priority: {
          type: "string",
          description: "Numeric priority 0-100. 90+ = urgent. Default 50.",
        },
      },
      required: ["title", "description"],
    },
  },
  {
    name: "update_dashboard_card_status",
    description:
      "Move a card between columns by updating its status. Use when the user says 'mark X done' or 'start working on Y'.",
    input_schema: {
      type: "object",
      properties: {
        card_id: { type: "string", description: "The card id (cuid2)" },
        status: {
          type: "string",
          enum: [...CARD_STATUSES],
          description: "open = up-next, active = in-progress, complete = done, dev_request = dev queue",
        },
      },
      required: ["card_id", "status"],
    },
  },
];

async function fireTelegram(message: string): Promise<void> {
  const url = process.env.ALERT_TELEGRAM_WEBHOOK;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message, parse_mode: "HTML" }),
    });
  } catch (err) {
    log.warn("Telegram delivery failed (fail-open)", {}, err as Error);
  }
}

export async function executeDashboardTool(
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "create_dashboard_card": {
      const title = (input.title as string | undefined)?.trim();
      const description = (input.description as string | undefined)?.trim() ?? "";
      const type = ((input.type as string | undefined) ?? "idea") as CardType;
      const priorityRaw = input.priority;
      const priority = typeof priorityRaw === "number"
        ? priorityRaw
        : parseInt((priorityRaw as string | undefined) ?? "50", 10);

      if (!title) return { error: "title is required" };
      if (!CARD_TYPES.includes(type)) return { error: `type must be one of ${CARD_TYPES.join(", ")}` };

      const id = crypto.randomUUID();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await db.insert(node).values({
        id,
        type,
        parentId: PRODUCT_NODE_ID,
        title,
        description,
        status: "open",
        priority: Number.isFinite(priority) ? priority : 50,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const emoji = type === "bug" ? "🐞" : type === "feature" ? "✨" : type === "chore" ? "🧹" : "💡";
      await fireTelegram(`${emoji} <b>[Build Board] New ${type}</b>\n${title}\n\n<i>via Alex chat</i>`);

      return { success: true, card_id: id, message: `Card created: ${title}` };
    }

    case "update_dashboard_card_status": {
      const cardId = (input.card_id as string | undefined)?.trim();
      const status = (input.status as string | undefined)?.trim() as CardStatus | undefined;

      if (!cardId) return { error: "card_id is required" };
      if (!status || !CARD_STATUSES.includes(status)) {
        return { error: `status must be one of ${CARD_STATUSES.join(", ")}` };
      }

      const result = await db
        .update(node)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .set({ status, updatedAt: new Date() } as any)
        .where(eq(node.id, cardId))
        .returning({ id: node.id, title: node.title });

      if (result.length === 0) return { error: `Card ${cardId} not found` };

      await fireTelegram(`📋 <b>[Build Board] ${result[0].title}</b> → <b>${status}</b>`);

      return { success: true, message: `Card ${cardId} → ${status}` };
    }

    default:
      return { error: `Unknown dashboard tool: ${name}` };
  }
}
