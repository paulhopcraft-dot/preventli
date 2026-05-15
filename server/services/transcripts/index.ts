import fs from "node:fs";
import { promises as fsp } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { parseTranscriptFile, ParsedTranscriptNote } from "./parser";
import { storage } from "../../storage";
import { createLogger } from "../../lib/logger";
import type {
  CaseDiscussionNote,
  InsertCaseDiscussionNote,
  InsertCaseDiscussionInsight,
  TranscriptInsight,
} from "@shared/schema";
import type {
  TaskNotificationAgent,
  TranscriptIngestionEvent,
} from "./task-agent";

export interface TranscriptIngestionOptions {
  transcriptsDir?: string;
  pollIntervalMs?: number;
  taskAgent?: TaskNotificationAgent;
  maxFileSizeBytes?: number;
}

const DEFAULT_POLL_INTERVAL = 30_000;
const DEFAULT_MAX_FILE_SIZE = 750 * 1024; // ~750 KB transcripts
const FILE_STABILITY_DELAY_MS = 200;

const transcriptLogger = createLogger("Transcripts");

export class TranscriptIngestionModule {
  private watcher?: fs.FSWatcher;
  private pollTimer?: NodeJS.Timeout;
  private readonly transcriptsDir: string;
  private readonly supportedExtensions = new Set([".txt", ".md", ".vtt"]);
  private readonly processingFiles = new Set<string>();
  private readonly unresolvedWorkers = new Set<string>();
  private readonly processedFiles = new Map<string, number>();
  private readonly maxFileSizeBytes: number;
  private readonly taskAgent?: TaskNotificationAgent;

  constructor(private readonly options: TranscriptIngestionOptions = {}) {
    this.transcriptsDir =
      options.transcriptsDir ?? path.join(process.cwd(), "transcripts");
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? DEFAULT_MAX_FILE_SIZE;
    this.taskAgent = options.taskAgent;
  }

  async start(): Promise<void> {
    await this.ensureDirectory();
    await this.scanExistingFiles();
    this.startWatcher();
    this.startPolling();
    transcriptLogger.info("Transcript ingestion module active", { dir: this.transcriptsDir });
  }

  async stop(): Promise<void> {
    this.watcher?.close();
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private async ensureDirectory(): Promise<void> {
    await fsp.mkdir(this.transcriptsDir, { recursive: true });
  }

  private startWatcher(): void {
    this.watcher = fs.watch(
      this.transcriptsDir,
      { persistent: true },
      (eventType, filename) => {
        if (!filename) {
          void this.scanExistingFiles();
          return;
        }
        const target = path.join(this.transcriptsDir, filename.toString());
        if (eventType === "rename" || eventType === "change") {
          void this.processFile(target);
        }
      },
    );

    this.watcher.on("error", (err) => {
      transcriptLogger.error("File watcher error", {}, err);
    });
  }

  private startPolling(): void {
    const interval = this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
    this.pollTimer = setInterval(() => {
      void this.scanExistingFiles();
    }, interval);
  }
 
  private async delay(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async scanExistingFiles(): Promise<void> {
    try {
      const files = await this.listTranscriptFiles();
      for (const file of files) {
        await this.processFile(file);
      }
    } catch (error) {
      transcriptLogger.error("Failed to scan transcript directory", {}, error);
    }
  }

  private async listTranscriptFiles(): Promise<string[]> {
    const entries = await fsp.readdir(this.transcriptsDir, {
      withFileTypes: true,
    });
    return entries
      .filter(
        (entry) =>
          entry.isFile() &&
          this.supportedExtensions.has(
            path.extname(entry.name).toLowerCase(),
          ),
      )
      .map((entry) => path.join(this.transcriptsDir, entry.name));
  }

  private async processFile(filePath: string): Promise<void> {
    const ext = path.extname(filePath).toLowerCase();
    if (!this.supportedExtensions.has(ext)) {
      return;
    }

    if (this.processingFiles.has(filePath)) {
      return;
    }

    this.processingFiles.add(filePath);
    try {
      let stats = await fsp.stat(filePath);
      if (!stats.isFile()) {
        return;
      }

      if (stats.size === 0) {
        transcriptLogger.warn("Skipping empty transcript", { file: filePath });
        return;
      }

      if (stats.size > this.maxFileSizeBytes) {
        transcriptLogger.warn("Skipping oversized transcript", { file: filePath, size: stats.size });
        return;
      }

      const previouslyProcessed = this.processedFiles.get(filePath);
      if (previouslyProcessed && stats.mtimeMs <= previouslyProcessed) {
        return;
      }

      await this.delay(FILE_STABILITY_DELAY_MS);
      const restat = await fsp.stat(filePath);
      if (restat.mtimeMs !== stats.mtimeMs || restat.size !== stats.size) {
        stats = restat;
      }

      const contents = await fsp.readFile(filePath, "utf-8");
      const parsedNotes = parseTranscriptFile(filePath, contents, stats.mtime);
      if (!parsedNotes.length) {
        return;
      }

      const didPersist = await this.persistNotes(filePath, parsedNotes);
      if (didPersist) {
        this.processedFiles.set(filePath, stats.mtimeMs);
      }
    } catch (error: any) {
      if (error?.code === "ENOENT") {
        return; // File removed before processing
      }
      transcriptLogger.error("Failed to process transcript", { file: filePath }, error);
    } finally {
      this.processingFiles.delete(filePath);
    }
  }

  private async persistNotes(
    filePath: string,
    parsed: ParsedTranscriptNote[],
  ): Promise<boolean> {
    const insertRows: InsertCaseDiscussionNote[] = [];
    const insightRows: InsertCaseDiscussionInsight[] = [];
    const notificationEvents = new Map<string, TranscriptIngestionEvent>();

    for (const note of parsed) {
      const resolution = await storage.findCaseByWorkerName(note.workerName);
      if (!resolution) {
        if (!this.unresolvedWorkers.has(note.workerName)) {
          transcriptLogger.warn("Unable to resolve case for worker", {
            workerName: note.workerName,
            file: path.basename(filePath),
          });
          this.unresolvedWorkers.add(note.workerName);
        }
        continue;
      }

      this.unresolvedWorkers.delete(note.workerName);
      if (resolution.confidence < 0.75) {
        transcriptLogger.info("Low confidence worker match", {
          inputName: note.workerName,
          matchedName: resolution.workerName,
          confidence: resolution.confidence.toFixed(2),
        });
      }

      const noteId = this.createNoteId(filePath, note);
      const row: InsertCaseDiscussionNote = {
        id: noteId,
        organizationId: resolution.organizationId,
        caseId: resolution.caseId,
        workerName: resolution.workerName,
        timestamp: note.timestamp,
        rawText: note.rawText,
        summary: note.summary,
        nextSteps: note.nextSteps.length ? note.nextSteps : null,
        riskFlags: note.riskFlags.length ? note.riskFlags : null,
        updatesCompliance: note.updatesCompliance,
        updatesRecoveryTimeline: note.updatesRecoveryTimeline,
      } as any;

      const insightPayload = this.buildInsightsForNote(row, noteId, resolution.caseId);
      insightRows.push(...insightPayload.inserts);

      const eventEntry =
        notificationEvents.get(resolution.caseId) ?? {
          caseId: resolution.caseId,
          workerName: resolution.workerName,
          notes: [],
          insights: [],
        };
      eventEntry.notes.push(this.toCaseDiscussionNote(row));
      eventEntry.insights.push(...insightPayload.materialized);
      notificationEvents.set(resolution.caseId, eventEntry);

      insertRows.push(row);
    }

    if (!insertRows.length) {
      return false;
    }

    await storage.upsertCaseDiscussionNotes(insertRows);
    if (insightRows.length) {
      await storage.upsertCaseDiscussionInsights(insightRows);
    }

    if (this.taskAgent && notificationEvents.size > 0) {
      for (const event of Array.from(notificationEvents.values())) {
        await this.taskAgent.notifyNewDiscussionNotes(event);
      }
    }

    transcriptLogger.info("Ingested transcript notes", {
      count: insertRows.length,
      file: path.basename(filePath),
    });

    return true;
  }

  private createNoteId(filePath: string, note: ParsedTranscriptNote): string {
    const hash = crypto.createHash("sha1");
    hash.update(filePath);
    hash.update(note.workerName);
    hash.update(note.summary);
    hash.update(note.timestamp.toISOString());
    return hash.digest("hex");
  }

  private toCaseDiscussionNote(row: any): CaseDiscussionNote {
    const timestamp =
      row.timestamp instanceof Date ? row.timestamp : new Date(row.timestamp ?? new Date());
    return {
      id: row.id ?? crypto.randomUUID(),
      caseId: row.caseId!,
      workerName: row.workerName!,
      timestamp: timestamp.toISOString(),
      rawText: row.rawText!,
      summary: row.summary!,
      nextSteps: row.nextSteps ?? undefined,
      riskFlags: row.riskFlags ?? undefined,
      updatesCompliance: Boolean(row.updatesCompliance),
      updatesRecoveryTimeline: Boolean(row.updatesRecoveryTimeline),
    };
  }

  private buildInsightsForNote(
    row: any,
    noteId: string,
    caseId: string,
  ): {
    inserts: InsertCaseDiscussionInsight[];
    materialized: TranscriptInsight[];
  } {
    const inserts: InsertCaseDiscussionInsight[] = [];
    const materialized: TranscriptInsight[] = [];

    const addInsight = (
      area: TranscriptInsight["area"],
      severity: TranscriptInsight["severity"],
      summary: string,
      detail?: string,
    ) => {
      const createdAt = new Date();
      const id = this.createInsightId(noteId, area, summary);
      const insertRow: any = {
        id,
        caseId,
        noteId,
        area,
        severity,
        summary,
        detail: detail ?? row.summary ?? null,
        createdAt,
      } as any;
      inserts.push(insertRow);
      materialized.push({
        id,
        caseId,
        noteId,
        area,
        severity,
        summary,
        detail: insertRow.detail ?? undefined,
        createdAt: createdAt.toISOString(),
      });
    };

    const riskFlags = row.riskFlags ?? [];
    for (const flag of riskFlags) {
      const lower = flag.toLowerCase();
      const area: TranscriptInsight["area"] = lower.includes("compliance")
        ? "compliance"
        : "risk";
      const severity: TranscriptInsight["severity"] = /critical|high/.test(lower)
        ? "critical"
        : "warning";
      addInsight(area, severity, flag);
    }

    if (row.updatesRecoveryTimeline) {
      addInsight(
        "recovery",
        "info",
        "Transcript indicates a recovery timeline change",
      );
    }

    if (row.updatesCompliance && !riskFlags.some((flag) => /compliance/i.test(flag))) {
      addInsight("compliance", "warning", "Compliance follow-up required");
    }

    const nextSteps = row.nextSteps ?? [];
    for (const step of nextSteps.slice(0, 3)) {
      addInsight("returnToWork", "info", `Next step: ${step}`);
    }

    const raw = row.rawText ?? "";
    if (/no\s+contact|unresponsive|no show|did not attend/i.test(raw)) {
      addInsight(
        "engagement",
        "warning",
        "Worker engagement risk detected",
        raw.slice(0, 280),
      );
    }

    return { inserts, materialized };
  }

  private createInsightId(noteId: string, area: string, summary: string): string {
    const hash = crypto.createHash("sha1");
    hash.update(noteId);
    hash.update(area);
    hash.update(summary);
    return hash.digest("hex");
  }
}
