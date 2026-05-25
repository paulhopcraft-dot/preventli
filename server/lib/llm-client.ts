/**
 * LLM Client — portable API-based replacement for Claude CLI subprocess
 *
 * Supports:
 *   - Groq        (recommended — Apache 2.0 models, fastest inference, set LLM_PROVIDER=groq)
 *   - OpenRouter  (fallback — set LLM_PROVIDER=openrouter)
 *   - Anthropic   (alternative — set LLM_PROVIDER=anthropic)
 *
 * Drop-in replacement for the previous claude-cli.ts subprocess pattern.
 * Same signature: callClaude(prompt, timeoutMs?) => Promise<string>
 *
 * Environment variables:
 *   LLM_PROVIDER          'groq' | 'openrouter' | 'anthropic'   (default: openrouter)
 *   GROQ_API_KEY          Required when LLM_PROVIDER=groq
 *   OPENROUTER_API_KEY    Required when LLM_PROVIDER=openrouter
 *   ANTHROPIC_API_KEY     Required when LLM_PROVIDER=anthropic
 *   LLM_MODEL             Override model (optional)
 *   OPENROUTER_BASE_URL   Override base URL (optional, default: https://openrouter.ai/api/v1)
 */

import { createLogger } from "./logger";

const logger = createLogger("LLMClient");

// ─── Provider configuration ───────────────────────────────────────────────────

type Provider = "groq" | "openrouter" | "anthropic" | "claude-cli";

function getProvider(): Provider {
  const p = (process.env.LLM_PROVIDER ?? "claude-cli").toLowerCase();
  if (p === "groq") return "groq";
  if (p === "anthropic") return "anthropic";
  if (p === "openrouter") return "openrouter";
  return "claude-cli";
}

// Default models per provider — override with LLM_MODEL env var
const DEFAULT_MODELS: Record<Provider, string> = {
  groq: "qwen/qwen3-32b",
  openrouter: "anthropic/claude-sonnet-4-5",
  anthropic: "claude-sonnet-4-5-20250929",
  "claude-cli": "",
};

function getModel(): string {
  return process.env.LLM_MODEL ?? DEFAULT_MODELS[getProvider()];
}

// ─── OpenRouter (OpenAI-compatible) ──────────────────────────────────────────

async function callOpenRouter(prompt: string, timeoutMs: number): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set. Add it to your .env file.");
  }

  const baseUrl = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const model = getModel();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.APP_URL ?? "https://preventli.com.au",
        "X-Title": "Preventli",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "(no body)");
      throw new Error(`OpenRouter API error ${response.status}: ${errorBody.slice(0, 300)}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (data.error) {
      throw new Error(`OpenRouter error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenRouter returned empty content");
    }

    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}

// ─── Groq (OpenAI-compatible) ─────────────────────────────────────────────────

async function callGroq(prompt: string, timeoutMs: number): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set. Add it to your .env file or Render env vars.");
  }

  const model = getModel();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.6,
        reasoning_format: "hidden", // suppress thinking tokens — direct answer only
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "(no body)");
      throw new Error(`Groq API error ${response.status}: ${errorBody.slice(0, 300)}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    };

    if (data.error) {
      throw new Error(`Groq error: ${data.error.message}`);
    }

    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Groq returned empty content");
    }

    return content.trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Return the LLM connection config for the streaming SSE endpoint.
 * Centralises provider selection so chat.ts doesn't read env vars directly.
 */
export function getLLMStreamConfig(): {
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
  extraBody: Record<string, unknown>;
} {
  const provider = getProvider();
  if (provider === "groq") {
    return {
      apiKey: process.env.GROQ_API_KEY,
      baseUrl: "https://api.groq.com/openai/v1",
      model: process.env.LLM_MODEL ?? "qwen/qwen3-32b",
      extraBody: { reasoning_format: "hidden" },
    };
  }
  // openrouter and others
  return {
    apiKey: process.env.OPENROUTER_API_KEY,
    baseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
    model: process.env.LLM_MODEL ?? "anthropic/claude-sonnet-4-5",
    extraBody: {
      "HTTP-Referer": process.env.APP_URL ?? "https://preventli.com.au",
      "X-Title": "Preventli",
    },
  };
}

// ─── Anthropic SDK ────────────────────────────────────────────────────────────

async function callAnthropic(prompt: string, timeoutMs: number): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to your .env file.");
  }

  // Dynamic import — only load the SDK when this provider is selected
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });

  const model = getModel();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const message = await client.messages.create(
      {
        model,
        max_tokens: 4096,
        messages: [{ role: "user", content: prompt }],
      },
      { signal: controller.signal }
    );

    const content = message.content[0];
    if (!content || content.type !== "text") {
      throw new Error("Anthropic returned unexpected content type");
    }

    return content.text.trim();
  } finally {
    clearTimeout(timer);
  }
}

// ─── Claude CLI subprocess ────────────────────────────────────────────────────

async function callClaudeCLI(prompt: string, timeoutMs: number): Promise<string> {
  const { spawn } = await import("child_process");

  return new Promise<string>((resolve, reject) => {
    const child = spawn("claude", ["-p", prompt, "--output-format", "text"], {
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Claude CLI timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`Claude CLI exited ${code}: ${stderr.slice(0, 300)}`));
      } else {
        resolve(stdout.trim());
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ─── Anthropic tool-use loop ──────────────────────────────────────────────────

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

/**
 * Run an agentic tool-use loop via OpenRouter (OpenAI-compatible format).
 * Uses OPENROUTER_API_KEY — no Anthropic API key required.
 *
 * @param systemPrompt  System prompt (Alex soul + context)
 * @param userMessage   The user's message
 * @param tools         Tool definitions (Anthropic format — converted internally)
 * @param toolExecutor  Called for each tool call — receives (name, input), returns result
 * @param maxIterations Safety limit on tool call rounds (default: 10)
 */
export async function callClaudeWithTools(
  systemPrompt: string,
  userMessage: string,
  tools: AnthropicTool[],
  toolExecutor: (name: string, input: Record<string, unknown>) => Promise<unknown>,
  maxIterations = 10,
  historyMessages?: ChatMessage[],
): Promise<string> {
  const provider = getProvider();
  const apiKey = provider === "groq"
    ? process.env.GROQ_API_KEY
    : process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(provider === "groq"
      ? "GROQ_API_KEY is required for tool use"
      : "OPENROUTER_API_KEY is required for tool use");
  }

  const baseUrl = provider === "groq"
    ? "https://api.groq.com/openai/v1"
    : (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1");
  const model = process.env.LLM_MODEL ?? (provider === "groq" ? "qwen/qwen3-32b" : "anthropic/claude-sonnet-4-5");

  // Convert Anthropic tool format → OpenAI function format
  const openAiTools = tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));

  type OAIMessage = { role: string; content: string | null; tool_calls?: unknown[]; tool_call_id?: string; name?: string };
  const messages: OAIMessage[] = [
    { role: "system", content: systemPrompt },
    ...(historyMessages ?? []).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  const toolHeaders: Record<string, string> = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...(provider !== "groq" ? {
      "HTTP-Referer": process.env.APP_URL ?? "https://preventli.com.au",
      "X-Title": "Preventli",
    } : {}),
  };
  const toolExtraBody = provider === "groq" ? { reasoning_format: "hidden" } : {};

  for (let i = 0; i < maxIterations; i++) {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: toolHeaders,
      body: JSON.stringify({ model, messages, tools: openAiTools, tool_choice: "auto", temperature: 0.6, ...toolExtraBody }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "(no body)");
      throw new Error(`OpenRouter tool-use error ${response.status}: ${body.slice(0, 300)}`);
    }

    const data = await response.json() as {
      choices?: Array<{
        finish_reason: string;
        message: { role: string; content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
      }>;
    };

    const choice = data.choices?.[0];
    if (!choice) throw new Error("OpenRouter returned empty choices");

    const assistantMsg = choice.message;

    if (choice.finish_reason === "stop" || !assistantMsg.tool_calls?.length) {
      return (assistantMsg.content ?? "").trim();
    }

    // Add assistant message with tool_calls
    messages.push({ role: "assistant", content: assistantMsg.content, tool_calls: assistantMsg.tool_calls });

    // Execute each tool call and add results
    for (const toolCall of assistantMsg.tool_calls ?? []) {
      let result: unknown;
      try {
        const input = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
        result = await toolExecutor(toolCall.function.name, input);
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: toolCall.function.name,
        content: typeof result === "string" ? result : JSON.stringify(result),
      });
    }
  }

  return "I reached the tool call limit for this request. Please try a simpler query.";
}

// ─── Public interface ─────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Multi-turn chat — send a system prompt + full conversation history to the LLM.
 * The last message in `messages` should be the current user message.
 */
export async function callClaudeMultiTurn(
  systemPrompt: string,
  messages: ChatMessage[],
  timeoutMs = 60_000,
): Promise<string> {
  const provider = getProvider();

  if (provider === "groq" || provider === "openrouter") {
    const apiKey = provider === "groq" ? process.env.GROQ_API_KEY : process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error(provider === "groq" ? "GROQ_API_KEY is not set" : "OPENROUTER_API_KEY is not set");

    const baseUrl = provider === "groq"
      ? "https://api.groq.com/openai/v1"
      : (process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1");
    const model = getModel();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(provider !== "groq" ? {
        "HTTP-Referer": process.env.APP_URL ?? "https://preventli.com.au",
        "X-Title": "Preventli",
      } : {}),
    };

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          temperature: 0.6,
          ...(provider === "groq" ? { reasoning_format: "hidden" } : {}),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.text().catch(() => "(no body)");
        throw new Error(`${provider === "groq" ? "Groq" : "OpenRouter"} error ${response.status}: ${err.slice(0, 300)}`);
      }

      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      return (data.choices?.[0]?.message?.content ?? "").trim();
    } finally {
      clearTimeout(timer);
    }
  }

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set");

    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const message = await client.messages.create(
        { model: getModel(), max_tokens: 4096, system: systemPrompt, messages },
        { signal: controller.signal }
      );
      const content = message.content[0];
      if (!content || content.type !== "text") throw new Error("Unexpected Anthropic content type");
      return content.text.trim();
    } finally {
      clearTimeout(timer);
    }
  }

  // claude-cli fallback — collapse to single prompt
  const collapsed = messages.map((m) => `${m.role === "user" ? "User" : "Alex"}: ${m.content}`).join("\n");
  return callClaudeCLI(`${systemPrompt}\n\n${collapsed}`, timeoutMs);
}

/**
 * Send a prompt to the configured LLM provider and return the response text.
 *
 * Matches the signature of the previous callClaude() CLI function so all
 * existing callers work without changes.
 *
 * @param prompt    Complete prompt (combine system + user context into one string)
 * @param timeoutMs Request timeout in milliseconds (default: 60s)
 */
export async function callClaude(prompt: string, timeoutMs = 60_000): Promise<string> {
  const provider = getProvider();

  logger.debug("LLM request", {
    provider,
    model: getModel(),
    promptLength: prompt.length,
    timeoutMs,
  });

  const t0 = Date.now();
  try {
    const result = provider === "groq"
      ? await callGroq(prompt, timeoutMs)
      : provider === "anthropic"
      ? await callAnthropic(prompt, timeoutMs)
      : provider === "openrouter"
      ? await callOpenRouter(prompt, timeoutMs)
      : await callClaudeCLI(prompt, timeoutMs);

    const durationMs = Date.now() - t0;
    logger.debug("LLM response received", { provider, responseLength: result.length, durationMs });

    // Record latency for /api/control/performance — lazy import avoids circular deps
    import("../services/metricsService").then(({ recordAiCall }) => {
      recordAiCall(durationMs);
    }).catch(() => {});

    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("LLM call failed", { provider, model: getModel(), error: msg.slice(0, 300) });
    throw err;
  }
}

/**
 * Check if LLM provider is configured and reachable.
 * Returns a status object for health checks.
 */
export async function checkLLMHealth(): Promise<{ ok: boolean; provider: string; model: string; error?: string }> {
  const provider = getProvider();
  const model = getModel();

  try {
    // Validate API key is set — don't make a real API call for health checks
    if (provider === "groq" && !process.env.GROQ_API_KEY) {
      return { ok: false, provider, model, error: "GROQ_API_KEY not set" };
    }
    if (provider === "openrouter" && !process.env.OPENROUTER_API_KEY) {
      return { ok: false, provider, model, error: "OPENROUTER_API_KEY not set" };
    }
    if (provider === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
      return { ok: false, provider, model, error: "ANTHROPIC_API_KEY not set" };
    }
    return { ok: true, provider, model };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, provider, model, error: msg };
  }
}
