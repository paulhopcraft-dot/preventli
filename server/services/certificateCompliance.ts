/**
 * Certificate Compliance Engine v1
 *
 * Computes compliance status based on medical certificates:
 * - no_certificate: Case has no certificates
 * - certificate_expiring_soon: Active cert expires within 7 days
 * - certificate_expired: Latest cert has expired, no active cert
 * - compliant: Active cert exists and not expiring soon
 */

import type {
  MedicalCertificate,
  CertificateCompliance,
  CertificateComplianceFlag,
  MedicalCertificateDB
} from "@shared/schema";
import type { IStorage } from "../storage";
import { getCaseRTWCompliance, requiresRTWAction, getRTWCompliancePriority } from "./rtwCompliance";

// Configuration
const EXPIRING_SOON_DAYS = 7;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Convert MedicalCertificateDB to MedicalCertificate interface
 */
function mapDbCertificate(cert: MedicalCertificateDB): MedicalCertificate {
  return {
    id: cert.id,
    caseId: cert.caseId,
    issueDate: cert.issueDate?.toISOString() ?? cert.startDate.toISOString(),
    startDate: cert.startDate.toISOString(),
    endDate: cert.endDate.toISOString(),
    capacity: cert.capacity as MedicalCertificate["capacity"],
    notes: cert.notes ?? undefined,
    source: (cert.source as MedicalCertificate["source"]) ?? "freshdesk",
    documentUrl: cert.documentUrl ?? undefined,
    sourceReference: cert.sourceReference ?? undefined,
    createdAt: cert.createdAt?.toISOString(),
    updatedAt: cert.updatedAt?.toISOString(),
  };
}

/**
 * Calculate days between two dates (can be negative if date is in the past)
 */
function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * Check if a certificate is currently active (today is between start and end dates)
 */
function isCertificateActive(cert: MedicalCertificate, now: Date = new Date()): boolean {
  const startDate = new Date(cert.startDate);
  const endDate = new Date(cert.endDate);

  // Set time to start of day for comparison
  const nowStart = new Date(now);
  nowStart.setHours(0, 0, 0, 0);
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);

  return nowStart >= startDate && nowStart <= endDate;
}

/**
 * Get the newest certificate by start date
 */
function getNewestCertificate(certificates: MedicalCertificate[]): MedicalCertificate | undefined {
  if (certificates.length === 0) return undefined;

  return certificates.reduce((newest, cert) => {
    const newestDate = new Date(newest.startDate);
    const certDate = new Date(cert.startDate);
    return certDate > newestDate ? cert : newest;
  });
}

/**
 * Find the active certificate from a list of certificates
 */
function findActiveCertificate(certificates: MedicalCertificate[], now: Date = new Date()): MedicalCertificate | undefined {
  // Find all active certificates and return the newest one
  const activeCerts = certificates.filter(cert => isCertificateActive(cert, now));
  return getNewestCertificate(activeCerts);
}

/**
 * Compute certificate compliance status for a case
 */
export function computeCertificateCompliance(
  certificates: MedicalCertificate[],
  now: Date = new Date()
): CertificateCompliance {
  // No certificates
  if (certificates.length === 0) {
    return {
      status: "no_certificate",
      message: "No medical certificates on file",
    };
  }

  const newestCert = getNewestCertificate(certificates);
  const activeCert = findActiveCertificate(certificates, now);

  // Has an active certificate
  if (activeCert) {
    const endDate = new Date(activeCert.endDate);
    endDate.setHours(23, 59, 59, 999);
    const daysUntilExpiry = daysBetween(now, endDate);

    // Expiring soon (within EXPIRING_SOON_DAYS)
    if (daysUntilExpiry <= EXPIRING_SOON_DAYS) {
      return {
        status: "certificate_expiring_soon",
        activeCertificate: activeCert,
        newestCertificate: newestCert,
        daysUntilExpiry,
        message: daysUntilExpiry <= 0
          ? "Certificate expires today"
          : `Certificate expires in ${daysUntilExpiry} day${daysUntilExpiry === 1 ? "" : "s"}`,
      };
    }

    // Compliant - active certificate not expiring soon
    return {
      status: "compliant",
      activeCertificate: activeCert,
      newestCertificate: newestCert,
      daysUntilExpiry,
      message: "Active certificate on file",
    };
  }

  // No active certificate - check if expired
  if (newestCert) {
    const endDate = new Date(newestCert.endDate);
    endDate.setHours(23, 59, 59, 999);
    const daysSinceExpiry = Math.abs(daysBetween(endDate, now));

    return {
      status: "certificate_expired",
      newestCertificate: newestCert,
      daysSinceExpiry,
      message: `Certificate expired ${daysSinceExpiry} day${daysSinceExpiry === 1 ? "" : "s"} ago`,
    };
  }

  // Should not reach here, but fallback
  return {
    status: "no_certificate",
    message: "No medical certificates on file",
  };
}

/**
 * Compute compliance for a case using the storage layer
 */
export async function getCaseCompliance(
  storage: IStorage,
  caseId: string,
  organizationId: string
): Promise<CertificateCompliance> {
  const dbCertificates = await storage.getCertificatesByCase(caseId, organizationId);
  const certificates = dbCertificates.map(mapDbCertificate);
  return computeCertificateCompliance(certificates);
}

/**
 * Sync compliance-driven actions for a case
 * Creates/updates chase_certificate actions based on compliance status
 */
export async function syncComplianceActions(
  storage: IStorage,
  caseId: string,
  compliance: CertificateCompliance
): Promise<void> {
  switch (compliance.status) {
    case "certificate_expiring_soon": {
      // Create chase action due 3 days before expiry (or now if less than 3 days)
      const activeCert = compliance.activeCertificate;
      if (activeCert) {
        const endDate = new Date(activeCert.endDate);
        const dueDateMs = endDate.getTime() - (3 * MS_PER_DAY);
        const dueDate = new Date(Math.max(dueDateMs, Date.now()));

        await storage.upsertAction(
          caseId,
          "chase_certificate",
          dueDate,
          `Certificate expiring on ${endDate.toLocaleDateString("en-AU")}`
        );
      }
      break;
    }

    case "certificate_expired": {
      // Create urgent chase action due now
      const newestCert = compliance.newestCertificate;
      const expiredDate = newestCert ? new Date(newestCert.endDate).toLocaleDateString("en-AU") : "unknown";

      await storage.upsertAction(
        caseId,
        "chase_certificate",
        new Date(), // Due immediately
        `Certificate expired on ${expiredDate} - URGENT`
      );
      break;
    }

    case "no_certificate": {
      // Create action to obtain certificate
      await storage.upsertAction(
        caseId,
        "chase_certificate",
        new Date(), // Due immediately
        "No certificate on file - request from worker/GP"
      );
      break;
    }

    case "compliant": {
      // Mark any existing chase_certificate actions as done
      const existingAction = await storage.findPendingActionByTypeAndCase(caseId, "chase_certificate");
      if (existingAction) {
        await storage.markActionDone(existingAction.id);
      }
      break;
    }
  }
}

/**
 * Process compliance for a single case and sync actions
 */
export async function processComplianceForCase(
  storage: IStorage,
  caseId: string,
  organizationId: string
): Promise<CertificateCompliance> {
  const compliance = await getCaseCompliance(storage, caseId, organizationId);
  await syncComplianceActions(storage, caseId, compliance);

  // Also check RTW plan compliance and create review_case action if needed
  const rtwCompliance = await getCaseRTWCompliance(storage, caseId, organizationId);
  if (requiresRTWAction(rtwCompliance)) {
    const priority = getRTWCompliancePriority(rtwCompliance);
    await storage.upsertAction(
      caseId,
      "review_case",
      new Date(),
      rtwCompliance.message,
      priority
    );
  }

  // Sync has_certificate flag: true only if there's a currently active certificate
  const hasActiveCert = compliance.status === "compliant" || compliance.status === "certificate_expiring_soon";
  const { db } = await import("../db");
  const { workerCases } = await import("@shared/schema");
  const { eq, and } = await import("drizzle-orm");
  await db.update(workerCases)
    .set({ hasCertificate: hasActiveCert, updatedAt: new Date() } as any)
    .where(and(eq(workerCases.id, caseId), eq(workerCases.organizationId, organizationId)));

  // Auto-advance lifecycle stage if case is stuck at "intake"
  await storage.autoAdvanceLifecycleStage(caseId, organizationId);

  return compliance;
}

/**
 * Get certificates with compliance status for display
 */
export interface CertificateWithStatus extends MedicalCertificate {
  displayStatus: "active" | "expiring_soon" | "expired";
  daysUntilExpiry?: number;
}

export function getCertificatesWithStatus(
  certificates: MedicalCertificate[],
  now: Date = new Date()
): CertificateWithStatus[] {
  return certificates.map(cert => {
    const endDate = new Date(cert.endDate);
    endDate.setHours(23, 59, 59, 999);
    const daysUntilExpiry = daysBetween(now, endDate);
    const isActive = isCertificateActive(cert, now);

    let displayStatus: CertificateWithStatus["displayStatus"];

    if (daysUntilExpiry < 0) {
      displayStatus = "expired";
    } else if (isActive && daysUntilExpiry <= EXPIRING_SOON_DAYS) {
      displayStatus = "expiring_soon";
    } else if (isActive) {
      displayStatus = "active";
    } else {
      displayStatus = "expired"; // Future certs not started yet treated as not active
    }

    return {
      ...cert,
      displayStatus,
      daysUntilExpiry: daysUntilExpiry >= 0 ? daysUntilExpiry : undefined,
    };
  });
}
