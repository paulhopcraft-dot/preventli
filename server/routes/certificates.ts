import express, { type Request, type Response } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authorize } from "../middleware/auth";
import { insertMedicalCertificateSchema, type FunctionalRestrictionsExtracted } from "@shared/schema";
import { extractCertificateData } from "../services/certificateService";
import { auditLog } from "../lib/auditLog";
import { recomputeEngagementFor } from "../services/engagementRecompute";

// Type guard to ensure functionalRestrictionsJson is properly typed
function validateFunctionalRestrictions(value: any): FunctionalRestrictionsExtracted | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return null; // Convert string to null
  if (typeof value === 'object' && value !== null) {
    // Assume it's a valid FunctionalRestrictionsExtracted object
    return value as FunctionalRestrictionsExtracted;
  }
  return null;
}

const router = express.Router();

// All routes require authentication
const requireAuth = authorize();
const requireAdminOrEmployer = authorize(["admin", "employer"]);
const requireAdminOrEmployerOrClinician = authorize(["admin", "employer", "clinician"]);

// POST /api/certificates - Create certificate
router.post("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const data = insertMedicalCertificateSchema.parse(req.body) as any;

    // Ensure organizationId matches user's organization
    if (req.user!.role !== "admin" && data.organizationId !== req.user!.companyId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // Ensure functionalRestrictionsJson is properly typed
    const { functionalRestrictionsJson, ...otherData } = data;
    const certificateData = {
      ...otherData,
      functionalRestrictionsJson: validateFunctionalRestrictions(functionalRestrictionsJson)
    };

    const certificate = await storage.createCertificate(certificateData as any);

    await auditLog({
      caseId: certificate.caseId ?? null,
      eventType: "certificate.added",
      actor: req.user!.id,
      payload: { certificateId: certificate.id, organizationId: certificate.organizationId },
    });

    // fire-and-forget — engagement recompute is best-effort
    if (certificate.workerId) {
      recomputeEngagementFor(certificate.workerId, "certificate.added").catch(() => {});
    }

    res.json({ success: true, data: certificate });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// GET /api/certificates/:id - Get certificate by ID
router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const organizationId = req.user!.role === "admin" ? (req.query.organizationId as string || req.user!.companyId) : req.user!.companyId;
    if (!organizationId) {
      return res.status(400).json({ success: false, message: "Organization ID required" });
    }
    const certificate = await storage.getCertificate(req.params.id as string, organizationId);

    if (!certificate) {
      return res.status(404).json({ success: false, message: "Certificate not found" });
    }

    res.json({ success: true, data: certificate });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/certificates/case/:caseId - Get certificates by case
router.get("/case/:caseId", requireAuth, async (req: Request, res: Response) => {
  try {
    const organizationId = req.user!.role === "admin" ? (req.query.organizationId as string || req.user!.companyId) : req.user!.companyId;
    if (!organizationId) {
      return res.status(400).json({ success: false, message: "Organization ID required" });
    }
    const certificates = await storage.getCertificatesByCase(req.params.caseId as string, organizationId);
    res.json({ success: true, data: certificates });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/certificates/worker/:workerId - Get certificates by worker
router.get("/worker/:workerId", requireAuth, async (req: Request, res: Response) => {
  try {
    const organizationId = req.user!.role === "admin" ? (req.query.organizationId as string || req.user!.companyId) : req.user!.companyId;
    if (!organizationId) {
      return res.status(400).json({ success: false, message: "Organization ID required" });
    }
    const certificates = await storage.getCertificatesByWorker(req.params.workerId as string, organizationId);
    res.json({ success: true, data: certificates });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/certificates/organization/:organizationId - Get certificates by organization
router.get("/organization/:organizationId", requireAdminOrEmployer, async (req: Request, res: Response) => {
  try {
    const organizationId = req.params.organizationId as string;

    // Check authorization
    if (req.user!.role !== "admin" && organizationId !== req.user!.companyId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const certificates = await storage.getCertificatesByOrganization(organizationId);
    res.json({ success: true, data: certificates });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PATCH /api/certificates/:id - Update certificate
router.patch("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const updates = insertMedicalCertificateSchema.partial().parse(req.body) as any;
    const organizationId = req.user!.role === "admin" ? (req.query.organizationId as string || req.user!.companyId) : req.user!.companyId;
    if (!organizationId) {
      return res.status(400).json({ success: false, message: "Organization ID required" });
    }

    // Check if certificate exists for this organization
    const existing = await storage.getCertificate(req.params.id as string, organizationId);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Certificate not found" });
    }

    // Ensure functionalRestrictionsJson is properly typed
    const { functionalRestrictionsJson, ...otherUpdates } = updates;
    const updateData = functionalRestrictionsJson !== undefined ? {
      ...otherUpdates,
      functionalRestrictionsJson: validateFunctionalRestrictions(functionalRestrictionsJson)
    } : updates;

    const certificate = await storage.updateCertificate(req.params.id as string, organizationId, updateData as any);
    res.json({ success: true, data: certificate });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// PUT /api/certificates/:id/image - Upload certificate image
router.put("/:id/image", requireAuth, async (req: Request, res: Response) => {
  try {
    const { imageData } = req.body;

    if (!imageData || typeof imageData !== "string") {
      return res.status(400).json({ success: false, message: "Image data required" });
    }

    // Validate that it's a data URL (base64)
    if (!imageData.startsWith("data:")) {
      return res.status(400).json({ success: false, message: "Invalid image format" });
    }

    // Check size (roughly 5MB in base64)
    if (imageData.length > 7 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: "Image too large (max 5MB)" });
    }

    // For now, we'll look up the certificate without organization check
    // since the recovery chart doesn't pass organization context
    const certificate = await storage.updateCertificateImage(req.params.id as string, imageData);

    if (!certificate) {
      return res.status(404).json({ success: false, message: "Certificate not found" });
    }

    res.json({ success: true, documentUrl: certificate.documentUrl });
  } catch (error: any) {
    console.error("Error uploading certificate image:", error);
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/certificates/:id - Delete certificate
router.delete("/:id", requireAdminOrEmployer, async (req: Request, res: Response) => {
  try {
    const organizationId = req.user!.role === "admin" ? (req.query.organizationId as string || req.user!.companyId) : req.user!.companyId;
    if (!organizationId) {
      return res.status(400).json({ success: false, message: "Organization ID required" });
    }

    // Check if certificate exists for this organization
    const existing = await storage.getCertificate(req.params.id as string, organizationId);
    if (!existing) {
      return res.status(404).json({ success: false, message: "Certificate not found" });
    }

    await storage.deleteCertificate(req.params.id as string, organizationId);
    res.json({ success: true, message: "Certificate deleted" });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/certificates/:id/extract - Extract data from certificate OCR
router.post("/:id/extract", requireAuth, async (req: Request, res: Response) => {
  try {
    const organizationId = req.user!.role === "admin" ? (req.query.organizationId as string || req.user!.companyId) : req.user!.companyId;
    if (!organizationId) {
      return res.status(400).json({ success: false, message: "Organization ID required" });
    }
    const certificate = await storage.getCertificate(req.params.id as string, organizationId);

    if (!certificate) {
      return res.status(404).json({ success: false, message: "Certificate not found" });
    }

    const extractedData = await extractCertificateData(certificate);

    const updated = await storage.updateCertificate(req.params.id as string, organizationId, {
      rawExtractedData: extractedData as any,
      extractionConfidence: extractedData.confidence.overall.toString(),
      requiresReview: extractedData.confidence.overall < 0.8,
    } as any);

    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/certificates/:id/review - Mark certificate as reviewed
router.post("/:id/review", requireAdminOrEmployerOrClinician, async (req: Request, res: Response) => {
  try {
    const organizationId = req.user!.role === "admin" ? (req.query.organizationId as string || req.user!.companyId) : req.user!.companyId;
    if (!organizationId) {
      return res.status(400).json({ success: false, message: "Organization ID required" });
    }
    const certificate = await storage.getCertificate(req.params.id as string, organizationId);

    if (!certificate) {
      return res.status(404).json({ success: false, message: "Certificate not found" });
    }

    const updated = await storage.markCertificateAsReviewed(req.params.id as string, organizationId, new Date());
    res.json({ success: true, data: updated });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/certificates/review-queue - Get certificates requiring manual review
router.get("/review-queue", requireAdminOrEmployerOrClinician, async (req: Request, res: Response) => {
  try {
    const organizationId = req.user!.role === "admin"
      ? (req.query.organizationId as string || req.user!.companyId)
      : req.user!.companyId;
    if (!organizationId) {
      return res.status(400).json({ success: false, message: "Organization ID required" });
    }

    const certificates = await storage.getCertificatesRequiringReview(organizationId);
    res.json({ success: true, data: certificates });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/certificates/alerts/unacknowledged - Get unacknowledged alerts
router.get("/alerts/unacknowledged", requireAdminOrEmployer, async (req: Request, res: Response) => {
  try {
    const organizationId = req.user!.companyId;
    if (!organizationId) {
      return res.status(400).json({ success: false, message: "User not associated with organization" });
    }

    const alerts = await storage.getUnacknowledgedAlerts(organizationId);
    res.json({ success: true, data: alerts });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/certificates/alerts/:alertId/acknowledge - Acknowledge alert
router.post("/alerts/:alertId/acknowledge", requireAdminOrEmployer, async (req: Request, res: Response) => {
  try {
    const alert = await storage.acknowledgeAlert(req.params.alertId as string, req.user!.id);
    res.json({ success: true, data: alert });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
