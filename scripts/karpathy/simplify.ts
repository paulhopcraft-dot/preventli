/**
 * Karpathy Loop — File Simplifier
 *
 * Reads scores.json, picks the worst-scoring file that hasn't been
 * processed recently, calls OpenRouter (Claude) to simplify it,
 * and writes the result. The GitHub Actions workflow runs the gate
 * (tsc + vitest) and reverts if it fails.
 *
 * History is tracked in scripts/karpathy/history.json to avoid
 * repeatedly targeting the same file.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SCORES_PATH = path.join(__dirname, "scores.json");
const HISTORY_PATH = path.join(__dirname, "history.json");

// Don't re-target a file for 30 days after it was processed
const COOLDOWN_DAYS = 30;

interface FileScore {
  file: string;
  lines: number;
  anyCount: number;
  maxFunctionLines: number;
  deepNestingLines: number;
  todoCount: number;
  score: number;
}

interface HistoryEntry {
  file: string;
  processedAt: string;
  scoreBefore: number;
  scoreAfter: number | null;
  gateResult: "passed" | "failed" | "pending";
}

interface History {
  entries: HistoryEntry[];
}

function loadHistory(): History {
  if (!fs.existsSync(HISTORY_PATH)) return { entries: [] };
  return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8")) as History;
}

function saveHistory(h: History): void {
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(h, null, 2));
}

function isOnCooldown(file: string, history: History): boolean {
  const cutoff = Date.now() - COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  return history.entries.some(
    (e) => e.file === file && new Date(e.processedAt).getTime() > cutoff
  );
}

async function callOpenRouter(fileContent: string, filePath: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://preventli.com",
      "X-Title": "Preventli Karpathy Loop",
    },
    body: JSON.stringify({
      model: "anthropic/claude-sonnet-4-6",
      messages: [
        {
          role: "system",
          content: `You are a senior TypeScript engineer performing a focused code simplification pass.

Rules (follow ALL of these):
1. Preserve ALL functionality exactly — no behavior changes, no removed features
2. Replace \`any\` types with the correct specific types where the type is obvious from context
3. Break functions longer than 40 lines into well-named private helpers
4. Reduce nesting depth by using early returns, guard clauses, or helper extraction
5. Remove dead code, redundant comments, and obvious noise
6. Match the existing code style exactly (indentation, quotes, semicolons)
7. Do NOT add new features, abstractions, or refactor working patterns
8. Do NOT change function signatures, exports, or API contracts
9. Return ONLY the raw file content — no markdown fences, no explanation, no preamble`,
        },
        {
          role: "user",
          content: `Simplify this TypeScript file.\n\nFile: ${filePath}\n\n${fileContent}`,
        },
      ],
      max_tokens: 8000,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenRouter error ${response.status}: ${body}`);
  }

  const json = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from OpenRouter");
  return content;
}

// Load scores
if (!fs.existsSync(SCORES_PATH)) {
  console.error("scores.json not found — run score.ts first");
  process.exit(1);
}

const scores: FileScore[] = JSON.parse(fs.readFileSync(SCORES_PATH, "utf8"));
const history = loadHistory();

// Pick the worst file not on cooldown and with score > 0
const target = scores.find(
  (s) => s.score > 0 && !isOnCooldown(s.file, history)
);

if (!target) {
  console.log("No eligible files to simplify today (all on cooldown or score=0).");
  process.exit(0);
}

console.log(`Target: ${target.file} (score=${target.score})`);

const absPath = path.join(ROOT, target.file);
const originalContent = fs.readFileSync(absPath, "utf8");

let simplified: string;
try {
  simplified = await callOpenRouter(originalContent, target.file);
} catch (err) {
  console.error("OpenRouter call failed:", err);
  process.exit(1);
}

// Basic sanity check: simplified output must be non-trivially long
if (simplified.length < originalContent.length * 0.5) {
  console.error(
    `Sanity check failed: simplified output is less than 50% of original length. Aborting.`
  );
  process.exit(1);
}

// Write simplified file
fs.writeFileSync(absPath, simplified, "utf8");
console.log(`Wrote simplified content to ${target.file}`);

// Record in history (gate result will be updated by the workflow)
const entry: HistoryEntry = {
  file: target.file,
  processedAt: new Date().toISOString(),
  scoreBefore: target.score,
  scoreAfter: null,
  gateResult: "pending",
};
history.entries.unshift(entry);
saveHistory(history);

// Write target info for the workflow to reference in the PR body
const runInfoPath = path.join(__dirname, "run-info.json");
fs.writeFileSync(
  runInfoPath,
  JSON.stringify(
    {
      file: target.file,
      scoreBefore: target.score,
      lines: target.lines,
      anyCount: target.anyCount,
      maxFunctionLines: target.maxFunctionLines,
    },
    null,
    2
  )
);

console.log("Simplification complete. Awaiting gate (tsc + vitest).");
