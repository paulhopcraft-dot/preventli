/**
 * Agent Triggers — Cron schedules for agent jobs
 *
 * Uses node-cron (already in use by complianceScheduler and syncScheduler).
 */

import * as cron from "node-cron";
import { db } from "../db";
import { agentJobs, organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { createLogger } from "../lib/logger";
import { runSpecialistAgent } from "../agents/agent-runner";
import { storage } from "../storage";

const logger = createLogger("AgentTriggers");

export class AgentScheduler {
  private coordinatorTask: cron.ScheduledTask | null = null;
  private certExpiryTask: cron.ScheduledTask | null = null;
  private running = false;

  start(
    coordinatorCron = "0 9 * * *",
    certExpiryCron = "0 8 * * *",
    enabled = true
  ): void {
    if (!enabled) {
      logger.info("Agent scheduler disabled — skipping");
      return;
    }

    this.coordinatorTask = cron.schedule(coordinatorCron, async () => {
      await this.runMorningBriefing();
    });

    this.certExpiryTask = cron.schedule(certExpiryCron, async () => {
      await this.runCertExpiryCheck();
    });

    this.running = true;
    logger.info("Agent scheduler started", { coordinatorCron, certExpiryCron });
  }

  stop(): void {
    this.coordinatorTask?.stop();
    this.certExpiryTask?.stop();
    this.running = false;
    logger.info("Agent scheduler stopped");
  }

  getStatus(): Record<string, unknown> {
    return {
      running: this.running,
      coordinatorActive: this.coordinatorTask !== null,
      certExpiryActive: this.certExpiryTask !== null,
    };
  }

  async triggerMorningBriefing(): Promise<{ jobsCreated: number }> {
    return this.runMorningBriefing();
  }

  async triggerCertExpiryCheck(): Promise<{ jobsCreated: number }> {
    return this.runCertExpiryCheck();
  }

  private async runMorningBriefing(): Promise<{ jobsCreated: number }> {
    logger.info("Running morning briefing — coordinator agent");
    const jobQueue: Array<{ id: string; orgId: string }> = [];

    try {
      const allOrgs = await db
        .select()
        .from(organizations)
        .where(eq(organizations.isActive, true));

      for (const org of allOrgs) {
        try {
          const [job] = await db
            .insert(agentJobs)
            .values({
              organizationId: org.id,
              agentType: "coordinator",
              status: "queued",
              triggeredBy: "cron",
              context: { runDate: new Date().toISOString() },
            } as any)
            .returning();

          jobQueue.push({ id: job.id, orgId: org.id });
        } catch (err) {
          logger.error("Failed to create coordinator job for org", { orgId: org.id }, err);
        }
      }

      logger.info("Morning briefing scheduled", { jobsCreated: jobQueue.length });
    } catch (err) {
      logger.error("Morning briefing trigger failed", {}, err);
    }

    // Run sequentially in background — avoids parallel claude CLI subprocess contention
    setImmediate(async () => {
      for (const { id: jobId, orgId } of jobQueue) {
        await runSpecialistAgent(jobId).catch((err) => {
          logger.error("Morning briefing failed for org", { orgId, jobId }, err);
        });
      }
    });

    return { jobsCreated: jobQueue.length };
  }

  private async runCertExpiryCheck(): Promise<{ jobsCreated: number }> {
    logger.info("Running certificate expiry check");
    let jobsCreated = 0;
    const certJobs: Array<{ id: string; caseId: string }> = [];

    try {
      // Get all active orgs, check expiry per org
      const allOrgs = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.isActive, true));

      const seen = new Set<string>();

      for (const org of allOrgs) {
        try {
          // Certs expiring in 5 days
          const expiring5 = await storage.getExpiringCertificates(org.id, 5);
          // Certs already expired (0 days ahead = today or before)
          const expiring0 = await storage.getExpiringCertificates(org.id, 0);

          const toCheck = [...expiring5, ...expiring0];

          for (const cert of toCheck) {
            const key = `${cert.caseId}`;
            if (seen.has(key)) continue;
            seen.add(key);

            const now = new Date();
            const endDate = new Date(cert.endDate);
            const daysUntilExpiry = Math.ceil(
              (endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
            );

            const [job] = await db
              .insert(agentJobs)
              .values({
                organizationId: org.id,
                caseId: cert.caseId,
                agentType: "certificate",
                status: "queued",
                triggeredBy: "cron",
                context: {
                  mode: "expiry",
                  daysUntilExpiry,
                  runDate: new Date().toISOString(),
                },
              } as any)
              .returning();

            certJobs.push({ id: job.id, caseId: cert.caseId });
            jobsCreated++;
          }
        } catch (err) {
          logger.error("Cert expiry check failed for org", { orgId: org.id }, err);
        }
      }

      logger.info("Certificate expiry check complete", { jobsCreated });
    } catch (err) {
      logger.error("Certificate expiry trigger failed", {}, err);
    }

    // Run sequentially in background — avoids parallel claude CLI subprocess contention
    setImmediate(async () => {
      for (const { id: jobId, caseId } of certJobs) {
        await runSpecialistAgent(jobId).catch((err) => {
          logger.error("Cert expiry agent failed", { caseId, jobId }, err);
        });
      }
    });

    return { jobsCreated };
  }
}

export const agentScheduler = new AgentScheduler();
