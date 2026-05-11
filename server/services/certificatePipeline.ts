/**
 * Certificate Ingestion Pipeline
 *
 * Processes certificate attachments from Freshdesk tickets:
 * 1. Fetches PDF/image attachments
 * 2. Runs Claude Vision OCR to extract data
 * 3. Creates/updates certificate records
 * 4. Flags low-confidence extractions for review
 */

import type { FreshdeskAttachment } from "./freshdesk";
import type { InsertMedicalCertificate, OcrExtractedData, RestrictionItem } from "@shared/schema";
import type { IStorage } from "../storage";
import { processCertificateAttachments, isCertificateAttachment } from "./pdfProcessor";
import { extractFromDocument, requiresReview } from "./certificateService";
import { extractFunctionalRestrictions } from "./restrictionExtractor";
import { logger } from "../lib/logger";

export interface CertificateProcessingResult {
  ticketId: string;
  caseId: string;
  certificateId?: string;
  success: boolean;
  error?: string;
  extractedData?: OcrExtractedData;
  requiresReview: boolean;
}

/**
 * Get Freshdesk auth header from environment
 */
function getFreshdeskAuthHeader(): string {
  const apiKey = process.env.FRESHDESK_API_KEY;
  if (!apiKey) {
    throw new Error("FRESHDESK_API_KEY is required");
  }
  return "Basic " + Buffer.from(`${apiKey}:X`).toString("base64");
}

/**
 * Process certificate attachments from a Freshdesk ticket
 */
export async function processCertificatesFromTicket(
  ticketId: string,
  caseId: string,
  organizationId: string,
  attachments: FreshdeskAttachment[],
  storage: IStorage
): Promise<CertificateProcessingResult[]> {
  const results: CertificateProcessingResult[] = [];

  // Filter for certificate attachments
  const certAttachments = attachments.filter(isCertificateAttachment);

  if (certAttachments.length === 0) {
    logger.certificate.debug("No certificate attachments found for ticket", { ticketId });
    return results;
  }

  logger.certificate.info("Processing certificate attachments", { count: certAttachments.length, ticketId });

  const authHeader = getFreshdeskAuthHeader();

  // Process each attachment
  const documents = await processCertificateAttachments(certAttachments, authHeader);

  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    const attachment = certAttachments[i];

    try {
      logger.certificate.info("Extracting data from certificate", { fileName: doc.fileName });

      // Run OCR extraction
      const extractedData = await extractFromDocument(doc);
      const needsReview = requiresReview(extractedData);

      // Parse extracted dates
      const issueDate = extractedData.extractedFields.issueDate
        ? new Date(extractedData.extractedFields.issueDate)
        : new Date();
      const startDate = extractedData.extractedFields.startDate
        ? new Date(extractedData.extractedFields.startDate)
        : issueDate;
      const endDate = extractedData.extractedFields.endDate
        ? new Date(extractedData.extractedFields.endDate)
        : new Date(startDate.getTime() + 14 * 24 * 60 * 60 * 1000); // Default 14 days

      // Create certificate record
      const certificateData: InsertMedicalCertificate = {
        caseId,
        organizationId,
        issueDate,
        startDate,
        endDate,
        capacity: (extractedData.extractedFields.capacity as any) || "unknown",
        treatingPractitioner: extractedData.extractedFields.practitionerName || null,
        notes: extractedData.rawText || null,
        source: "freshdesk",
        sourceReference: `ticket:${ticketId}`,
        documentUrl: attachment.attachment_url,
        fileName: doc.fileName,
        fileUrl: attachment.attachment_url,
        rawExtractedData: extractedData,
        extractionConfidence: String(extractedData.confidence.overall),
        requiresReview: needsReview,
      } as any;

      const certificate = await storage.createCertificate(certificateData);

      logger.certificate.info("Created certificate", {
        certificateId: certificate.id,
        confidence: extractedData.confidence.overall,
        requiresReview: needsReview,
      });

      // Extract structured functional restrictions for RTW Planner Engine
      // Run as fire-and-forget to not block the pipeline (extraction can be retried)
      extractFunctionalRestrictionsForCertificate(
        certificate.id,
        organizationId,
        {
          capacity: certificate.capacity || "unknown",
          notes: certificate.notes || extractedData.rawText,
          restrictions: certificate.restrictions as RestrictionItem[] | undefined,
          workCapacityPercentage: certificate.workCapacityPercentage ?? undefined,
        },
        storage
      ).catch((err) => {
        // Log but don't fail - extraction can be retried later
        logger.certificate.error("Failed to extract functional restrictions (non-blocking)", {
          certificateId: certificate.id,
        }, err);
      });

      results.push({
        ticketId,
        caseId,
        certificateId: certificate.id,
        success: true,
        extractedData,
        requiresReview: needsReview,
      });
    } catch (error) {
      logger.certificate.error("Failed to process certificate", { fileName: doc.fileName }, error);
      results.push({
        ticketId,
        caseId,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        requiresReview: true, // Flag for manual handling
      });
    }
  }

  return results;
}

/**
 * Process all certificate attachments from multiple tickets
 * Call this during Freshdesk sync
 */
export async function processCertificatesFromTickets(
  ticketsWithAttachments: Array<{
    ticketId: string;
    caseId: string;
    organizationId: string;
    attachments: FreshdeskAttachment[];
  }>,
  storage: IStorage
): Promise<{
  processed: number;
  successful: number;
  failed: number;
  requiresReview: number;
  results: CertificateProcessingResult[];
}> {
  const allResults: CertificateProcessingResult[] = [];

  for (const ticket of ticketsWithAttachments) {
    const results = await processCertificatesFromTicket(
      ticket.ticketId,
      ticket.caseId,
      ticket.organizationId,
      ticket.attachments,
      storage
    );
    allResults.push(...results);
  }

  const successful = allResults.filter((r) => r.success).length;
  const failed = allResults.filter((r) => !r.success).length;
  const requiresReviewCount = allResults.filter((r) => r.requiresReview).length;

  logger.certificate.info("Certificate batch complete", {
    successful,
    failed,
    requiresReview: requiresReviewCount,
  });

  return {
    processed: allResults.length,
    successful,
    failed,
    requiresReview: requiresReviewCount,
    results: allResults,
  };
}

/**
 * Extract and store functional restrictions for a certificate
 * Called asynchronously after certificate creation
 */
async function extractFunctionalRestrictionsForCertificate(
  certificateId: string,
  organizationId: string,
  input: {
    capacity: string;
    notes?: string | null;
    restrictions?: RestrictionItem[];
    workCapacityPercentage?: number;
  },
  storage: IStorage
): Promise<void> {
  try {
    const extractionResult = await extractFunctionalRestrictions({
      capacity: input.capacity,
      notes: input.notes || undefined,
      restrictions: input.restrictions,
      workCapacityPercentage: input.workCapacityPercentage,
    });

    // Update certificate with extracted restrictions
    await storage.updateCertificate(certificateId, organizationId, {
      functionalRestrictionsJson: extractionResult.restrictions,
    } as any); // Type assertion needed as functionalRestrictionsJson is new

    logger.certificate.info("Extracted functional restrictions", {
      certificateId,
      confidence: extractionResult.confidence,
      requiresReview: extractionResult.requiresReview,
    });
  } catch (error) {
    logger.certificate.error("Restriction extraction failed", {
      certificateId,
    }, error);
    throw error; // Re-throw for caller to handle
  }
}
