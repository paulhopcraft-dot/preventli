/**
 * Karpathy Loop — File Complexity Scorer
 *
 * Scans server/ and client/src/ for TypeScript files, scores each by:
 *   - `any` usage count (type safety debt)
 *   - Max function length in lines (cognitive load)
 *   - Deep nesting line count (structural complexity)
 *   - TODO/FIXME count (explicit debt markers)
 *
 * Outputs scripts/karpathy/scores.json sorted worst-first.
 * Files between 50–500 lines only (smaller are trivial, larger are too risky).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");

const INCLUDE_DIRS = ["server", "client/src", "shared"];
const EXCLUDE_PATTERNS = [
  /\.test\.[tj]sx?$/,
  /\.spec\.[tj]sx?$/,
  /\.d\.ts$/,
  /node_modules/,
  /dist\//,
  /\.claude\//,
  /karpathy\//,
];
const MIN_LINES = 50;
const MAX_LINES = 500;

interface FileScore {
  file: string;
  lines: number;
  anyCount: number;
  maxFunctionLines: number;
  deepNestingLines: number;
  todoCount: number;
  score: number;
}

function collectFiles(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];

  const results: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDE_PATTERNS.some((p) => p.test(full))) walk(full);
      } else if (/\.[tj]sx?$/.test(entry.name)) {
        const rel = path.relative(ROOT, full).replace(/\\/g, "/");
        if (!EXCLUDE_PATTERNS.some((p) => p.test(rel))) results.push(rel);
      }
    }
  };
  walk(abs);
  return results;
}

function estimateMaxFunctionLength(lines: string[]): number {
  // Heuristic: find the longest run of lines between function/arrow opens
  let maxRun = 0;
  let inFunction = false;
  let depth = 0;
  let startDepth = 0;
  let runStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;

    const isFunctionLine =
      /^\s*(async\s+)?function\s+\w+/.test(line) ||
      /\)\s*(?::\s*\S+\s*)?\{/.test(line) ||
      /=>\s*\{/.test(line);

    if (!inFunction && isFunctionLine) {
      inFunction = true;
      startDepth = depth;
      runStart = i;
    }

    depth += opens - closes;

    if (inFunction && depth <= startDepth) {
      maxRun = Math.max(maxRun, i - runStart + 1);
      inFunction = false;
    }
  }

  return maxRun;
}

function scoreFile(relPath: string): FileScore | null {
  const abs = path.join(ROOT, relPath);
  const content = fs.readFileSync(abs, "utf8");
  const lines = content.split("\n");

  if (lines.length < MIN_LINES || lines.length > MAX_LINES) return null;

  const anyCount = (content.match(/:\s*any\b/g) || []).length +
    (content.match(/as\s+any\b/g) || []).length;

  const maxFunctionLines = estimateMaxFunctionLength(lines);

  const deepNestingLines = lines.filter((line) => {
    const indent = (line.match(/^(\s*)/)?.[1] ?? "").length;
    return indent >= 20; // 5 levels × 4 spaces
  }).length;

  const todoCount = (content.match(/\/\/\s*(TODO|FIXME|HACK|XXX)\b/gi) || []).length;

  const score =
    anyCount * 8 +
    Math.max(0, maxFunctionLines - 40) * 2 +
    deepNestingLines * 3 +
    todoCount * 5;

  return {
    file: relPath,
    lines: lines.length,
    anyCount,
    maxFunctionLines,
    deepNestingLines,
    todoCount,
    score,
  };
}

const allFiles: string[] = [];
for (const dir of INCLUDE_DIRS) {
  allFiles.push(...collectFiles(dir));
}

const scores: FileScore[] = [];
for (const f of allFiles) {
  const result = scoreFile(f);
  if (result) scores.push(result);
}

scores.sort((a, b) => b.score - a.score);

const outPath = path.join(__dirname, "scores.json");
fs.writeFileSync(outPath, JSON.stringify(scores, null, 2));

console.log(`Scored ${scores.length} files.`);
if (scores.length > 0) {
  const top = scores[0];
  console.log(
    `Worst file: ${top.file} (score=${top.score}, lines=${top.lines}, any=${top.anyCount}, maxFn=${top.maxFunctionLines})`
  );
}
