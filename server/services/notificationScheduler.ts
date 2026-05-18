/**
 * Notification Scheduler v1
 *
 * Background scheduler for generating and sending email notifications.
 * Follows the TranscriptIngestionModule pattern with start/stop lifecycle.
 */

import type { IStorage } from "../storage";
import {
  generatePendingNotifications,
  processPendingNotifications,
} from "./notificationService";
import { logger } from "../lib/logger";
import { isOutreachAllowed } from "../lib/contactGuard";
import { db } from "../db";
import { organizations } from "@shared/schema";
import { eq } from "drizzle-orm";

// Configuration
const GENERATION_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const SENDING_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class NotificationScheduler {
  private storage: IStorage;
  private generateTimer?: NodeJS.Timeout;
  private sendTimer?: NodeJS.Timeout;
  private isRunning = false;

  constructor(storage: IStorage) {
    this.storage = storage;
  }

  /**
   * Start the notification scheduler
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.notification.info("Scheduler already running");
      return;
    }

    logger.notification.info("Scheduler starting...");
    this.isRunning = true;

    // Run immediately on startup
    try {
      await this.runGeneration();
      await this.runSending();
    } catch (error) {
      logger.notification.error("Error during initial run", {}, error);
    }

    // Schedule periodic generation (every hour)
    this.generateTimer = setInterval(async () => {
      try {
        await this.runGeneration();
      } catch (error) {
        logger.notification.error("Generation error", {}, error);
      }
    }, GENERATION_INTERVAL_MS);

    // Schedule periodic sending (every 5 minutes)
    this.sendTimer = setInterval(async () => {
      try {
        await this.runSending();
      } catch (error) {
        logger.notification.error("Sending error", {}, error);
      }
    }, SENDING_INTERVAL_MS);

    logger.notification.info("Scheduler started successfully", {
      generationIntervalMinutes: GENERATION_INTERVAL_MS / 1000 / 60,
      sendingIntervalMinutes: SENDING_INTERVAL_MS / 1000 / 60,
    });
  }

  /**
   * Stop the notification scheduler
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      logger.notification.info("Scheduler not running");
      return;
    }

    logger.notification.info("Scheduler stopping...");

    if (this.generateTimer) {
      clearInterval(this.generateTimer);
      this.generateTimer = undefined;
    }

    if (this.sendTimer) {
      clearInterval(this.sendTimer);
      this.sendTimer = undefined;
    }

    this.isRunning = false;
    logger.notification.info("Scheduler stopped");
  }

  /**
   * Get all active organizations from the database
   */
  private async getActiveOrganizations(): Promise<Array<{ id: string; name: string }>> {
    try {
      const orgs = await db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(eq(organizations.isActive, true));
      return orgs;
    } catch (error) {
      logger.notification.error("Error fetching active organizations", {}, error);
      return [];
    }
  }

  /**
   * Run notification generation for all active organizations
   */
  private async runGeneration(): Promise<void> {
    logger.notification.debug("Running notification generation...");
    const orgs = await this.getActiveOrganizations();

    if (orgs.length === 0) {
      logger.notification.warn("No active organizations found for notification generation");
      return;
    }

    let totalCount = 0;
    for (const org of orgs) {
      try {
        const count = await generatePendingNotifications(this.storage, org.id);
        totalCount += count;
        logger.notification.debug("Generated notifications for organization", {
          organizationId: org.id,
          organizationName: org.name,
          count
        });
      } catch (error) {
        logger.notification.error("Error generating notifications for organization", {
          organizationId: org.id,
          organizationName: org.name
        }, error);
      }
    }

    logger.notification.info("Generation complete", {
      totalCount,
      organizationsProcessed: orgs.length
    });
  }

  /**
   * Run notification sending for all active organizations.
   * Pre-filters pending notifications via the contact guard before delegating
   * to processPendingNotifications — any notification whose worker is suppressed
   * is marked "skipped" so the send loop never reaches it.
   *
   * Integration point: isOutreachAllowed() is called per-case here because
   * processPendingNotifications operates at org level with no per-worker loop
   * internally. Marking before the delegate call keeps the service contract stable.
   */
  private async runSending(): Promise<void> {
    logger.notification.debug("Running notification sending...");
    const orgs = await this.getActiveOrganizations();

    if (orgs.length === 0) {
      logger.notification.warn("No active organizations found for notification sending");
      return;
    }

    let totalSent = 0;
    let totalFailed = 0;
    for (const org of orgs) {
      try {
        // ── Contact-guard pre-filter ──────────────────────────────────────────
        // Fetch pending notifications and suppress any that belong to a worker
        // currently under a contact suppression. We build a caseId→workerId map
        // from getCases (already called downstream by processPendingNotifications)
        // so the extra fetch cost is one round-trip per org per cycle.
        await this.applyContactGuardForOrg(org.id);
        // ─────────────────────────────────────────────────────────────────────

        const result = await processPendingNotifications(this.storage, org.id);
        totalSent += result.sent;
        totalFailed += result.failed;
        logger.notification.debug("Sent notifications for organization", {
          organizationId: org.id,
          organizationName: org.name,
          sent: result.sent,
          failed: result.failed
        });
      } catch (error) {
        logger.notification.error("Error sending notifications for organization", {
          organizationId: org.id,
          organizationName: org.name
        }, error);
      }
    }

    logger.notification.info("Sending complete", {
      sent: totalSent,
      failed: totalFailed,
      organizationsProcessed: orgs.length
    });
  }

  /**
   * For each pending notification in the org, check whether the associated
   * worker is currently suppressed. If so, mark the notification "skipped"
   * before the send loop runs so it is never dispatched.
   */
  private async applyContactGuardForOrg(organizationId: string): Promise<void> {
    try {
      const pending = await this.storage.getPendingNotifications(organizationId, 50);
      if (pending.length === 0) return;

      // Build caseId → workerId map for this org (one query for all cases)
      const cases = await this.storage.getCases(organizationId);
      const caseWorkerMap = new Map<string, string | null>(
        cases.map((c) => [c.id, c.workerId ?? null])
      );

      for (const notification of pending) {
        if (!notification.caseId) continue;
        const workerId = caseWorkerMap.get(notification.caseId) ?? null;
        if (!workerId) continue;

        const guard = await isOutreachAllowed(workerId);
        if (!guard.allowed) {
          await this.storage.updateNotificationStatus(
            notification.id,
            "skipped",
            `contact_suppressed: ${guard.reason ?? "suppression active"}`
          );
          logger.notification.info("Skipped send: worker contact suppressed", {
            notificationId: notification.id,
            caseId: notification.caseId,
            workerId,
            suppressionId: guard.suppressionId,
            reason: guard.reason,
          });
        }
      }
    } catch (err) {
      // Fail open — guard errors must not block the send cycle
      logger.notification.error("applyContactGuardForOrg failed — proceeding without guard", {
        organizationId,
      }, err);
    }
  }

  /**
   * Manually trigger generation (for testing/admin)
   * @param organizationId - Optional organization ID. If not provided, runs for all active organizations.
   */
  async triggerGeneration(organizationId?: string): Promise<number> {
    logger.notification.info("Manual generation triggered", { organizationId });

    if (organizationId) {
      // Run for specific organization
      return await generatePendingNotifications(this.storage, organizationId);
    }

    // Run for all active organizations
    await this.runGeneration();
    return 0; // Return value not meaningful for multi-org
  }

  /**
   * Manually trigger sending (for testing/admin)
   * @param organizationId - Optional organization ID. If not provided, runs for all active organizations.
   */
  async triggerSending(organizationId?: string): Promise<{ sent: number; failed: number }> {
    logger.notification.info("Manual sending triggered", { organizationId });

    if (organizationId) {
      // Run for specific organization
      return await processPendingNotifications(this.storage, organizationId);
    }

    // Run for all active organizations
    await this.runSending();
    return { sent: 0, failed: 0 }; // Return value not meaningful for multi-org
  }

  /**
   * Check if scheduler is running
   */
  get running(): boolean {
    return this.isRunning;
  }
}
