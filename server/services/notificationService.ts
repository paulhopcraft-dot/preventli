/**
 * Notification Service v1
 *
 * Core service for generating and sending automated email notifications.
 * Handles certificate expiry alerts, overdue action reminders, and case attention alerts.
 */

import type { IStorage } from "../storage";
import type {
  NotificationDB,
  InsertNotification,
  NotificationType,
  NotificationPriority,
  CaseAction,
  MedicalCertificateDB,
  WorkerCase,
} from "@shared/schema";
import { sendEmail } from "./emailService";
import { getCaseCompliance } from "./certificateCompliance";
import { getCaseRTWCompliance } from "./rtwCompliance";
import { logger } from "../lib/logger";

// =====================================================
// Configuration
// =====================================================

/**
 * Check if an overdue action is now obsolete and should be auto-completed
 * @param storage - Storage interface
 * @param action - The action to validate
 * @returns true if the action should be auto-completed as obsolete
 */
async function isActionObsolete(storage: IStorage, action: CaseAction): Promise<boolean> {
  // Only validate certificate-related actions for now
  if (action.type !== "chase_certificate") {
    logger.notification.debug(`Skipping non-certificate action`, { actionId: action.id, type: action.type });
    return false;
  }

  logger.notification.info(`🔍 Checking if certificate action is obsolete`, {
    actionId: action.id,
    type: action.type,
    caseId: action.caseId,
    workerName: action.workerName,
    dueDate: action.dueDate
  });

  try {
    // Get current certificate compliance for the case
    const compliance = await getCaseCompliance(storage, action.caseId, action.organizationId);

    logger.notification.info(`📋 Compliance status`, {
      actionId: action.id,
      complianceStatus: compliance.status,
      activeCertificate: !!compliance.activeCertificate,
      newestCertificate: !!compliance.newestCertificate
    });

    // If compliance is good (has valid certificate), the action is obsolete
    if (compliance.status === "compliant" || compliance.activeCertificate) {
      logger.notification.info(`✅ Certificate action is obsolete - valid certificate exists`, {
        actionId: action.id,
        type: action.type,
        caseId: action.caseId,
        complianceStatus: compliance.status
      });
      return true;
    }

    // Additional check: if there are recent certificates (within 30 days of action due date)
    if (compliance.newestCertificate && compliance.newestCertificate.createdAt && action.dueDate) {
      const actionDueDate = new Date(action.dueDate);
      const certCreatedDate = new Date(compliance.newestCertificate.createdAt);
      const daysDiff = (certCreatedDate.getTime() - actionDueDate.getTime()) / (1000 * 60 * 60 * 24);

      logger.notification.info(`📅 Certificate timing analysis`, {
        actionId: action.id,
        actionDue: action.dueDate,
        certCreated: compliance.newestCertificate.createdAt,
        daysDiff: Math.round(daysDiff)
      });

      // If certificate was added within 30 days after the action was due, consider action resolved
      if (daysDiff >= 0 && daysDiff <= 30) {
        logger.notification.info(`✅ Certificate action resolved - recent certificate found`, {
          actionId: action.id,
          actionDue: action.dueDate,
          certCreated: compliance.newestCertificate.createdAt,
          daysDiff: Math.round(daysDiff)
        });
        return true;
      }
    }

    logger.notification.info(`❌ Certificate action still valid - no obsolescence detected`, {
      actionId: action.id
    });

  } catch (error) {
    logger.notification.error(`💥 Error checking action obsolescence for ${action.id}`, {}, error);
    // On error, don't auto-complete to be safe
    return false;
  }

  return false;
}

const APP_URL = process.env.APP_URL || "http://localhost:5173";

// Certificate expiry thresholds (days)
const CERT_EXPIRY_THRESHOLDS = [
  { days: 7, priority: "medium" as NotificationPriority },
  { days: 3, priority: "high" as NotificationPriority },
  { days: 1, priority: "critical" as NotificationPriority },
  { days: 0, priority: "critical" as NotificationPriority },
];

// Action overdue thresholds (days)
const ACTION_OVERDUE_THRESHOLDS = [
  { days: 1, priority: "medium" as NotificationPriority },
  { days: 3, priority: "high" as NotificationPriority },
  { days: 7, priority: "critical" as NotificationPriority },
];

// =====================================================
// Email Templates
// =====================================================

interface NotificationTemplate {
  subject: string;
  body: string;
}

const NOTIFICATION_TEMPLATES: Record<NotificationType, NotificationTemplate> = {
  certificate_expiring: {
    subject: "Action Required: Medical certificate expiring for {{workerName}}",
    body: `The medical certificate for {{workerName}} ({{company}}) will expire soon.

Days until expiry: {{daysUntil}}
Current capacity: {{capacity}}
Certificate end date: {{expiryDate}}

Please ensure an updated certificate is obtained before expiry to maintain compliance.

View case: {{caseUrl}}
`,
  },

  certificate_expired: {
    subject: "URGENT: Medical certificate expired for {{workerName}}",
    body: `The medical certificate for {{workerName}} ({{company}}) has expired.

Days since expiry: {{daysSince}}
Certificate end date: {{expiryDate}}

Immediate action required to obtain an updated certificate.

View case: {{caseUrl}}
`,
  },

  action_overdue: {
    subject: "Overdue action: {{actionType}} for {{workerName}}",
    body: `An action is overdue for {{workerName}} ({{company}}).

Action: {{actionLabel}}
Due date: {{dueDate}}
Days overdue: {{daysOverdue}}
Notes: {{actionNotes}}

Please complete this action as soon as possible.

View case: {{caseUrl}}
`,
  },

  case_attention_needed: {
    subject: "Case needs attention: {{workerName}}",
    body: `Multiple issues require attention for {{workerName}} ({{company}}):

{{issuesList}}

View case: {{caseUrl}}
`,
  },

  check_in_follow_up: {
    subject: "Check-in required: {{workerName}} - {{company}}",
    body: `A check-in is required for {{workerName}} ({{company}}).

The worker has been off work for more than 7 days without a recent follow-up.

Last follow-up: {{lastFollowUp}}
Days since follow-up: {{daysSinceFollowUp}}

Please contact the worker to check on their recovery progress.

View case: {{caseUrl}}
`,
  },

  weekly_digest: {
    subject: "Weekly Case Summary - {{weekOf}}",
    body: `Your weekly case management summary:

Cases requiring attention: {{attentionCount}}
Certificates expiring this week: {{expiringCerts}}
Overdue actions: {{overdueActions}}

View dashboard: {{dashboardUrl}}
`,
  },

  rtw_plan_expiring: {
    subject: "RTW plan review needed: {{workerName}} ({{company}})",
    body: `The RTW plan for {{workerName}} at {{company}} requires review.

Days until plan expires: {{daysUntil}}
Plan duration: {{planDuration}} weeks
Current RTW status: {{rtwStatus}}
Plan start date: {{planStartDate}}

Please review and extend the RTW plan if appropriate.

View case: {{caseUrl}}
`,
  },

  rtw_plan_expired: {
    subject: "URGENT: RTW plan expired for {{workerName}} ({{company}})",
    body: `The RTW plan for {{workerName}} at {{company}} has expired.

Days since expiry: {{daysSince}}
Plan duration: {{planDuration}} weeks
Current RTW status: {{rtwStatus}}
Plan end date: {{expiryDate}}

Immediate action required to review and update the RTW plan.

View case: {{caseUrl}}
`,
  },

  health_check_due: {
    subject: "Health check required: {{workerName}}",
    body: `A health check is required for {{workerName}}.

Status: {{urgencyLabel}}
Due date: {{dueDate}}
Last clearance: {{clearanceLevel}}

Schedule a new check: {{workerUrl}}
`,
  },
};

// =====================================================
// Template Rendering
// =====================================================

function renderTemplate(template: string, variables: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = variables[key];
    return value !== undefined ? String(value) : `{{${key}}}`;
  });
}

function buildNotificationContent(
  type: NotificationType,
  variables: Record<string, string | number>
): { subject: string; body: string } {
  const template = NOTIFICATION_TEMPLATES[type];
  return {
    subject: renderTemplate(template.subject, variables),
    body: renderTemplate(template.body, variables),
  };
}

// =====================================================
// Deduplication Keys
// =====================================================

function getCertificateDedupeKey(caseId: string, daysUntilExpiry: number): string {
  // Bucket days: 7, 3, 1, 0, -1 (expired)
  let bucket: number;
  if (daysUntilExpiry < 0) {
    bucket = -1; // expired
  } else if (daysUntilExpiry <= 1) {
    bucket = 1;
  } else if (daysUntilExpiry <= 3) {
    bucket = 3;
  } else {
    bucket = 7;
  }
  return `cert:${caseId}:${bucket}`;
}

function getActionDedupeKey(actionId: string, daysOverdue: number): string {
  // Bucket days: 1, 3, 7+
  let bucket: number;
  if (daysOverdue >= 7) {
    bucket = 7;
  } else if (daysOverdue >= 3) {
    bucket = 3;
  } else {
    bucket = 1;
  }
  return `action:${actionId}:${bucket}`;
}

function getCheckInDedupeKey(caseId: string, daysSinceFollowUp: number): string {
  // Bucket days: 7-day intervals (7, 14, 21, etc.)
  const bucket = Math.floor(daysSinceFollowUp / 7) * 7;
  return `checkin:${caseId}:${bucket}`;
}

// =====================================================
// Priority Calculation
// =====================================================

function getCertificatePriority(daysUntilExpiry: number): NotificationPriority {
  if (daysUntilExpiry <= 0) return "critical";
  if (daysUntilExpiry <= 1) return "critical";
  if (daysUntilExpiry <= 3) return "high";
  return "medium";
}

/**
 * RTW Plan Notification Helper Functions
 */
function getRTWPlanDedupeKey(caseId: string, daysUntilExpiry: number): string {
  // Same bucketing logic as certificates: 7, 3, 1, 0, -1 (expired)
  let bucket: number;
  if (daysUntilExpiry < 0) {
    bucket = -1; // expired
  } else if (daysUntilExpiry <= 1) {
    bucket = 1;
  } else if (daysUntilExpiry <= 3) {
    bucket = 3;
  } else {
    bucket = 7;
  }
  return `rtw_plan:${caseId}:${bucket}`;
}

function getRTWPlanPriority(daysUntilExpiry: number): NotificationPriority {
  // Same priority logic as certificates
  if (daysUntilExpiry <= 0) return "critical";
  if (daysUntilExpiry <= 1) return "critical";
  if (daysUntilExpiry <= 3) return "high";
  return "medium";
}

function getActionPriority(daysOverdue: number): NotificationPriority {
  if (daysOverdue >= 7) return "critical";
  if (daysOverdue >= 3) return "high";
  return "medium";
}

// =====================================================
// Action Type Labels
// =====================================================

const ACTION_TYPE_LABELS: Record<string, string> = {
  chase_certificate: "Chase Medical Certificate",
  review_case: "Review Case",
  follow_up: "Follow Up",
};

// =====================================================
// Notification Generation
// =====================================================

/**
 * Generate certificate expiry notifications for cases in an organization
 */
async function generateCertificateNotifications(
  storage: IStorage,
  recipientEmail: string,
  organizationId: string
): Promise<number> {
  let created = 0;

  // Get all cases for the organization
  const cases = await storage.getCases(organizationId);

  for (const workerCase of cases) {
    try {
      const compliance = await getCaseCompliance(storage, workerCase.id, workerCase.organizationId);

      // Skip compliant or no-certificate cases (no-certificate has its own action flow)
      if (compliance.status === "compliant" || compliance.status === "no_certificate") {
        continue;
      }

      const isExpired = compliance.status === "certificate_expired";
      const daysValue = isExpired
        ? -(compliance.daysSinceExpiry || 0)
        : (compliance.daysUntilExpiry || 0);

      const dedupeKey = getCertificateDedupeKey(workerCase.id, daysValue);

      // Check if notification already exists
      const exists = await storage.notificationExistsByDedupeKey(dedupeKey);
      if (exists) {
        continue;
      }

      // Get certificate info
      const cert = compliance.activeCertificate || compliance.newestCertificate;
      const expiryDate = cert ? new Date(cert.endDate).toLocaleDateString("en-AU") : "Unknown";
      const capacity = cert?.capacity || "Unknown";

      // Build notification content
      const type: NotificationType = isExpired ? "certificate_expired" : "certificate_expiring";
      const { subject, body } = buildNotificationContent(type, {
        workerName: workerCase.workerName,
        company: workerCase.company,
        daysUntil: compliance.daysUntilExpiry || 0,
        daysSince: compliance.daysSinceExpiry || 0,
        expiryDate,
        capacity,
        caseUrl: `${APP_URL}/cases/${workerCase.id}`,
      });

      // Create notification
      const notification: any = {
        organizationId: workerCase.organizationId,
        type,
        priority: getCertificatePriority(daysValue),
        caseId: workerCase.id,
        recipientEmail,
        recipientName: null,
        subject,
        body,
        status: "pending",
        dedupeKey,
        metadata: {
          workerName: workerCase.workerName,
          company: workerCase.company,
          daysUntilExpiry: compliance.daysUntilExpiry,
          daysSinceExpiry: compliance.daysSinceExpiry,
        },
      };

      await storage.createNotification(notification);
      created++;
    } catch (error) {
      logger.notification.error(`Error processing case ${workerCase.id}`, {}, error);
    }
  }

  return created;
}

/**
 * Generate RTW plan expiry notifications following the certificate pattern
 */
async function generateRTWPlanNotifications(
  storage: IStorage,
  recipientEmail: string,
  organizationId: string
): Promise<number> {
  let created = 0;

  // Get all cases for the organization
  const cases = await storage.getCases(organizationId);

  for (const workerCase of cases) {
    try {
      const compliance = await getCaseRTWCompliance(storage, workerCase.id, workerCase.organizationId);

      // Skip compliant or no-plan cases
      if (compliance.status === "plan_compliant" || compliance.status === "no_plan") {
        continue;
      }

      const isExpired = compliance.status === "plan_expired";
      const daysValue = isExpired
        ? -(compliance.daysSinceExpiry || 0)
        : (compliance.daysUntilExpiry || 0);

      const dedupeKey = getRTWPlanDedupeKey(workerCase.id, daysValue);

      // Check if notification already exists
      const exists = await storage.notificationExistsByDedupeKey(dedupeKey);
      if (exists) {
        continue;
      }

      // Get RTW plan info
      const plan = compliance.activePlan;
      const planStartDate = plan?.rtwPlanStartDate ? new Date(plan.rtwPlanStartDate).toLocaleDateString("en-AU") : "Unknown";
      const expiryDate = plan?.rtwPlanTargetEndDate ? new Date(plan.rtwPlanTargetEndDate).toLocaleDateString("en-AU") : "Unknown";
      const planDuration = plan?.expectedDurationWeeks || 0;
      const rtwStatus = workerCase.rtwPlanStatus || "not_planned";

      // Build notification content
      const type: NotificationType = isExpired ? "rtw_plan_expired" : "rtw_plan_expiring";
      const { subject, body } = buildNotificationContent(type, {
        workerName: workerCase.workerName,
        company: workerCase.company,
        daysUntil: compliance.daysUntilExpiry || 0,
        daysSince: compliance.daysSinceExpiry || 0,
        expiryDate,
        planStartDate,
        planDuration: planDuration.toString(),
        rtwStatus,
        caseUrl: `${APP_URL}/cases/${workerCase.id}`,
      });

      // Create notification
      const notification: any = {
        organizationId: workerCase.organizationId,
        type,
        priority: getRTWPlanPriority(daysValue),
        caseId: workerCase.id,
        recipientEmail,
        recipientName: null,
        subject,
        body,
        status: "pending",
        dedupeKey,
        metadata: {
          workerName: workerCase.workerName,
          company: workerCase.company,
          daysUntilExpiry: compliance.daysUntilExpiry,
          daysSinceExpiry: compliance.daysSinceExpiry,
          planDuration: planDuration,
          rtwStatus: rtwStatus,
        },
      };

      await storage.createNotification(notification);
      created++;
    } catch (error) {
      logger.notification.error(`Error processing RTW plan for case ${workerCase.id}`, {}, error);
    }
  }

  return created;
}

/**
 * Generate overdue action notifications
 * Note: organizationId is required for tenant isolation. The notification
 * service should be called per-organization in production.
 */
async function generateActionNotifications(
  storage: IStorage,
  recipientEmail: string,
  organizationId: string
): Promise<number> {
  let created = 0;

  const overdueActions = await storage.getOverdueActions(organizationId, 100);
  const now = new Date();

  for (const action of overdueActions) {
    try {
      if (!action.dueDate) continue;

      const dueDate = new Date(action.dueDate);
      const daysOverdue = Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

      if (daysOverdue < 1) continue; // Not yet overdue

      // ✅ FIX: Check if certificate-related actions are still relevant
      if (await isActionObsolete(storage, action)) {
        // Auto-complete the obsolete action
        try {
          await storage.markActionDone(action.id);
          logger.notification.info(`Auto-completed obsolete action`, {
            actionId: action.id,
            type: action.type,
            workerName: action.workerName
          });
        } catch (error) {
          logger.notification.error(`Failed to auto-complete obsolete action ${action.id}`, {}, error);
        }
        continue; // Skip notification for this obsolete action
      }

      const dedupeKey = getActionDedupeKey(action.id, daysOverdue);

      // Check if notification already exists
      const exists = await storage.notificationExistsByDedupeKey(dedupeKey);
      if (exists) {
        continue;
      }

      // Build notification content
      const { subject, body } = buildNotificationContent("action_overdue", {
        workerName: action.workerName || "Unknown",
        company: action.company || "Unknown",
        actionType: action.type,
        actionLabel: ACTION_TYPE_LABELS[action.type] || action.type,
        dueDate: dueDate.toLocaleDateString("en-AU"),
        daysOverdue,
        actionNotes: action.notes || "No additional notes",
        caseUrl: `${APP_URL}/cases/${action.caseId}`,
      });

      // Create notification
      const notification: any = {
        organizationId: action.organizationId,
        type: "action_overdue",
        priority: getActionPriority(daysOverdue),
        caseId: action.caseId,
        recipientEmail,
        recipientName: null,
        subject,
        body,
        status: "pending",
        dedupeKey,
        metadata: {
          actionId: action.id,
          actionType: action.type,
          daysOverdue,
          workerName: action.workerName,
        },
      };

      await storage.createNotification(notification);
      created++;
    } catch (error) {
      logger.notification.error(`Error processing action ${action.id}`, {}, error);
    }
  }

  return created;
}

/**
 * Generate weekly check-in notifications for workers off work >7 days
 */
async function generateCheckInNotifications(
  storage: IStorage,
  recipientEmail: string,
  organizationId: string
): Promise<number> {
  let created = 0;
  const now = new Date();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  // Get all cases for the organization
  const cases = await storage.getCases(organizationId);

  for (const workerCase of cases) {
    try {
      // Filter: Only active employment, off work
      if (workerCase.employmentStatus !== "ACTIVE") {
        continue;
      }
      if (workerCase.workStatus !== "Off work") {
        continue;
      }

      // Determine reference date: clcLastFollowUp or dateOfInjury
      let referenceDate: Date | null = null;
      if (workerCase.clcLastFollowUp) {
        referenceDate = new Date(workerCase.clcLastFollowUp);
      } else if (workerCase.dateOfInjury) {
        referenceDate = new Date(workerCase.dateOfInjury);
      }

      // Skip if no reference date
      if (!referenceDate) {
        continue;
      }

      // Calculate days since follow-up
      const daysSinceFollowUp = Math.floor((now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24));

      // Only generate if >7 days
      if (daysSinceFollowUp < 7) {
        continue;
      }

      // Generate dedupe key
      const dedupeKey = getCheckInDedupeKey(workerCase.id, daysSinceFollowUp);

      // Check if notification already exists
      const exists = await storage.notificationExistsByDedupeKey(dedupeKey);
      if (exists) {
        continue;
      }

      // Build notification content
      const lastFollowUpStr = workerCase.clcLastFollowUp
        ? new Date(workerCase.clcLastFollowUp).toLocaleDateString("en-AU")
        : "Initial injury date";

      const { subject, body } = buildNotificationContent("check_in_follow_up", {
        workerName: workerCase.workerName,
        company: workerCase.company,
        lastFollowUp: lastFollowUpStr,
        daysSinceFollowUp,
        caseUrl: `${APP_URL}/cases/${workerCase.id}`,
      });

      // Create notification
      const notification: any = {
        organizationId: workerCase.organizationId,
        type: "check_in_follow_up",
        priority: "medium",
        caseId: workerCase.id,
        recipientEmail,
        recipientName: null,
        subject,
        body,
        status: "pending",
        dedupeKey,
        metadata: {
          workerName: workerCase.workerName,
          company: workerCase.company,
          daysSinceFollowUp,
        },
      };

      await storage.createNotification(notification);
      created++;
    } catch (error) {
      logger.notification.error(`Error processing case ${workerCase.id}`, {}, error);
    }
  }

  return created;
}

// Months between health checks per clearance outcome (mirrors workers.ts)
const HEALTH_RECHECK_MONTHS: Record<string, number> = {
  cleared_unconditional: 12,
  cleared_conditional: 12,
  cleared_with_restrictions: 6,
};

/**
 * Generate health check due/overdue notifications for workers in an organization.
 * Fires when recheckUrgency is "overdue" or "due_soon" (within 60 days).
 */
async function generateHealthCheckNotifications(
  storage: IStorage,
  recipientEmail: string,
  organizationId: string,
): Promise<number> {
  let created = 0;
  const now = new Date();

  const workerRows = await storage.listWorkers(organizationId);

  for (const worker of workerRows) {
    try {
      const profile = await storage.getWorkerProfile(worker.id);
      if (!profile) continue;

      const completed = profile.assessments.filter(
        (a) => a.status === "completed" && a.clearanceLevel,
      );
      if (completed.length === 0) continue;

      const latest = completed[0];
      const clearance = latest.clearanceLevel!;
      const months = HEALTH_RECHECK_MONTHS[clearance];
      if (!months) continue; // not_cleared / requires_review — no time-based recheck

      const rawDate = latest.updatedAt ?? latest.createdAt;
      if (!rawDate) continue;
      const due = new Date(rawDate);
      due.setMonth(due.getMonth() + months);

      const daysUntil = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      let urgency: "overdue" | "due_soon";
      if (daysUntil <= 0) urgency = "overdue";
      else if (daysUntil <= 60) urgency = "due_soon";
      else continue; // upcoming — no notification yet

      // Dedupe: one notification per worker per check-cycle (identified by YYYY-MM of due date) per urgency
      const dueDateBucket = due.toISOString().slice(0, 7); // YYYY-MM
      const dedupeKey = `health_check:${worker.id}:${dueDateBucket}:${urgency}`;

      const exists = await storage.notificationExistsByDedupeKey(dedupeKey);
      if (exists) continue;

      const dueStr = due.toLocaleDateString("en-AU");
      const urgencyLabel = urgency === "overdue"
        ? `Overdue by ${Math.abs(daysUntil)} day${Math.abs(daysUntil) !== 1 ? "s" : ""}`
        : `Due in ${daysUntil} day${daysUntil !== 1 ? "s" : ""} (within 60-day window)`;

      const { subject, body } = buildNotificationContent("health_check_due", {
        workerName: worker.name,
        urgencyLabel,
        dueDate: dueStr,
        clearanceLevel: clearance.replace(/_/g, " "),
        workerUrl: `${APP_URL}/workers/${worker.id}`,
      });

      const notification: any = {
        organizationId,
        type: "health_check_due",
        priority: urgency === "overdue" ? "high" : "medium",
        caseId: undefined, // health checks are not linked to a case
        recipientEmail,
        recipientName: null,
        subject,
        body,
        status: "pending",
        dedupeKey,
        metadata: {
          workerName: worker.name,
          workerId: worker.id,
          daysUntil,
          clearanceLevel: clearance,
          urgency,
        },
      };

      await storage.createNotification(notification);
      created++;
    } catch (error) {
      logger.notification.error(`Error processing health check for worker ${worker.id}`, {}, error);
    }
  }

  return created;
}

/**
 * Generate all pending notifications for a specific organization
 * @param storage - Storage interface
 * @param organizationId - Organization to generate notifications for
 */
export async function generatePendingNotifications(storage: IStorage, organizationId: string): Promise<number> {
  logger.notification.info(`Generating pending notifications`, { organizationId });

  // Default recipient for now (in production, would query users/admins)
  const recipientEmail = process.env.NOTIFICATION_DEFAULT_EMAIL || "admin@gpnet.local";

  let total = 0;

  try {
    // Generate certificate notifications
    const certCount = await generateCertificateNotifications(storage, recipientEmail, organizationId);
    logger.notification.info(`Generated certificate notifications`, { count: certCount });
    total += certCount;

    // Generate RTW plan notifications
    const rtwCount = await generateRTWPlanNotifications(storage, recipientEmail, organizationId);
    logger.notification.info(`Generated RTW plan notifications`, { count: rtwCount });
    total += rtwCount;

    // Generate action notifications
    const actionCount = await generateActionNotifications(storage, recipientEmail, organizationId);
    logger.notification.info(`Generated action notifications`, { count: actionCount });
    total += actionCount;

    // Generate check-in notifications
    const checkInCount = await generateCheckInNotifications(storage, recipientEmail, organizationId);
    logger.notification.info(`Generated check-in notifications`, { count: checkInCount });
    total += checkInCount;

    // Generate health check due/overdue notifications
    const healthCheckCount = await generateHealthCheckNotifications(storage, recipientEmail, organizationId);
    logger.notification.info(`Generated health check notifications`, { count: healthCheckCount });
    total += healthCheckCount;

    logger.notification.info(`Total notifications generated`, { total });
  } catch (error) {
    logger.notification.error("Error generating notifications", {}, error);
    throw error;
  }

  return total;
}

// =====================================================
// Notification Sending
// =====================================================

/**
 * Send a single notification
 */
async function sendNotification(
  storage: IStorage,
  notification: NotificationDB
): Promise<boolean> {
  try {
    const result = await sendEmail({
      to: notification.recipientEmail,
      subject: notification.subject,
      body: notification.body,
    });

    if (result.success) {
      await storage.markNotificationSent(notification.id);
      return true;
    } else {
      await storage.updateNotificationStatus(notification.id, "failed", result.error);
      return false;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await storage.updateNotificationStatus(notification.id, "failed", errorMessage);
    return false;
  }
}

/**
 * Process all pending notifications for a specific organization
 */
export async function processPendingNotifications(
  storage: IStorage,
  organizationId: string
): Promise<{ sent: number; failed: number }> {
  logger.notification.info(`Processing pending notifications`, { organizationId });

  const pending = await storage.getPendingNotifications(organizationId, 50);
  logger.notification.info(`Found pending notifications`, { count: pending.length });

  let sent = 0;
  let failed = 0;

  for (const notification of pending) {
    const success = await sendNotification(storage, notification);
    if (success) {
      sent++;
    } else {
      failed++;
    }
  }

  logger.notification.info(`Notification processing complete`, { sent, failed });
  return { sent, failed };
}

// =====================================================
// Utility Functions
// =====================================================

/**
 * Get notification statistics
 */
export async function getNotificationStats(
  storage: IStorage,
  organizationId: string
): Promise<{ pending: number; sent: number; failed: number }> {
  return storage.getNotificationStats(organizationId);
}

/**
 * Get recent notifications
 */
export async function getRecentNotifications(
  storage: IStorage,
  organizationId: string,
  hours: number = 24
): Promise<NotificationDB[]> {
  return storage.getRecentNotifications(organizationId, hours);
}

/**
 * Get notifications for a specific case
 */
export async function getNotificationsByCase(
  storage: IStorage,
  caseId: string,
  organizationId: string
): Promise<NotificationDB[]> {
  return storage.getNotificationsByCase(caseId, organizationId);
}

// =====================================================
// Worker Certificate Alert Functions
// =====================================================

/**
 * Get worker email address for a specific case
 */
async function getWorkerEmail(storage: IStorage, caseId: string, organizationId: string): Promise<string | null> {
  try {
    const contacts = await storage.getCaseContactsByRole(caseId, organizationId, 'worker');

    if (contacts.length === 0) {
      return null;
    }

    // Prefer the primary contact, otherwise take the most recently created
    const primary = contacts.find(c => c.isPrimary) ?? contacts[0];
    const email = primary.email?.trim();

    // Basic email validation
    if (email && email.includes('@') && email.includes('.')) {
      return email;
    }

    return null;
  } catch (error) {
    logger.notification.error(`Failed to get worker email for case ${caseId}`, {}, error);
    return null;
  }
}

/**
 * Send certificate expiry alerts directly to workers (3-day threshold)
 */
export async function sendWorkerCertificateAlerts(
  storage: IStorage,
  organizationId: string
): Promise<{ sent: number; failed: number; errors: string[] }> {
  logger.notification.info(`Sending worker certificate alerts`, { organizationId });

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  try {
    // Get all cases for the organization
    const cases = await storage.getCases(organizationId);

    for (const workerCase of cases) {
      try {
        const compliance = await getCaseCompliance(storage, workerCase.id, workerCase.organizationId);

        // Only process cases with certificates expiring in 3-7 days
        if (compliance.status !== "certificate_expiring_soon" || !compliance.daysUntilExpiry) {
          continue;
        }

        // Focus on 3-day threshold for worker alerts (vs 7-day for admin alerts)
        const daysUntilExpiry = compliance.daysUntilExpiry;
        if (daysUntilExpiry > 7 || daysUntilExpiry < 1) {
          continue; // Outside worker alert window
        }

        // Get worker email
        const workerEmail = await getWorkerEmail(storage, workerCase.id, workerCase.organizationId);
        if (!workerEmail) {
          logger.notification.warn(`No worker email found for case`, {
            caseId: workerCase.id,
            workerName: workerCase.workerName
          });
          continue;
        }

        // Check for recent duplicate notifications to this worker
        const dedupeKey = `worker_cert:${workerCase.id}:${Math.floor(daysUntilExpiry / 3) * 3}`;
        const exists = await storage.notificationExistsByDedupeKey(dedupeKey);
        if (exists) {
          logger.notification.debug(`Worker alert already sent recently`, {
            caseId: workerCase.id,
            workerEmail,
            dedupeKey
          });
          continue;
        }

        // Get certificate info
        const cert = compliance.activeCertificate;
        const expiryDate = cert ? new Date(cert.endDate).toLocaleDateString("en-AU") : "Unknown";
        const capacity = cert?.capacity || "Unknown";

        // Build worker-friendly notification content
        const { subject, body } = buildNotificationContent("certificate_expiring", {
          workerName: workerCase.workerName,
          company: workerCase.company,
          daysUntil: daysUntilExpiry,
          expiryDate,
          capacity,
          caseUrl: `${APP_URL}/cases/${workerCase.id}`,
        });

        // Create notification record
        const notification: any = {
          organizationId: workerCase.organizationId,
          type: "certificate_expiring",
          priority: getCertificatePriority(daysUntilExpiry),
          caseId: workerCase.id,
          recipientEmail: workerEmail,
          recipientName: workerCase.workerName,
          subject,
          body,
          status: "pending",
          dedupeKey,
          metadata: {
            workerName: workerCase.workerName,
            company: workerCase.company,
            daysUntilExpiry,
            targetType: "worker", // Mark as worker-targeted alert
          },
        };

        await storage.createNotification(notification);

        // Send email directly
        const result = await sendEmail({
          to: workerEmail,
          subject,
          body,
        });

        if (result.success) {
          await storage.markNotificationSent(notification.id!);
          sent++;
          logger.notification.info(`Worker certificate alert sent`, {
            caseId: workerCase.id,
            workerName: workerCase.workerName,
            workerEmail,
            daysUntilExpiry
          });
        } else {
          await storage.updateNotificationStatus(notification.id!, "failed", result.error);
          failed++;
          errors.push(`Failed to send to ${workerEmail}: ${result.error}`);
        }
      } catch (error) {
        failed++;
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        errors.push(`Case ${workerCase.id} (${workerCase.workerName}): ${errorMessage}`);
        logger.notification.error(`Error processing worker alert for case ${workerCase.id}`, {}, error);
      }
    }

    logger.notification.info(`Worker certificate alerts complete`, {
      organizationId,
      sent,
      failed,
      totalErrors: errors.length
    });

    return { sent, failed, errors };
  } catch (error) {
    logger.notification.error("Error in sendWorkerCertificateAlerts", {}, error);
    throw error;
  }
}
