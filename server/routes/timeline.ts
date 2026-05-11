import type { Express, Request, Response } from "express";
import { db } from "../db";
import { workerCases, medicalCertificates } from "../../shared/schema";
import { eq, desc } from "drizzle-orm";
import { authorize } from "../middleware/auth";
import {
  calculateRecoveryTimeline,
  generateRecoveryTimelineChartData,
  extractInjuryType,
  getInjuryModel,
  getAvailableInjuryTypes,
} from "../services/recoveryEstimator";
import { evaluateClinicalEvidence } from "../services/clinicalEvidence";
import { logger } from "../lib/logger";
import { logAuditEvent, AuditEventTypes } from "../services/auditLogger";
import type { MedicalCertificate, WorkCapacity } from "../../shared/schema";

/**
 * Timeline estimation routes
 * GET /api/cases/:id/timeline-estimate - Get dynamic recovery timeline for a case
 * GET /api/cases/:id/recovery-chart - Get chart-ready recovery timeline data
 * GET /api/injury-types - Get all available injury types
 */
export function registerTimelineRoutes(app: Express) {
  // Get timeline estimate for a case (legacy endpoint)
  app.get("/api/cases/:id/timeline-estimate", async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      // Fetch case with clinical evidence
      const cases = await db
        .select()
        .from(workerCases)
        .where(eq(workerCases.id, id))
        .limit(1);

      if (cases.length === 0) {
        return res.status(404).json({ error: "Case not found" });
      }

      const workerCase = cases[0] as any; // DB row type differs slightly from WorkerCase interface

      // Evaluate clinical evidence to get flags
      const clinicalEvidence = evaluateClinicalEvidence(workerCase);

      // Calculate timeline estimate
      const estimate = calculateRecoveryTimeline({
        dateOfInjury: workerCase.dateOfInjury.toISOString(),
        summary: workerCase.summary || "",
        riskLevel: workerCase.riskLevel as "High" | "Medium" | "Low",
        clinicalFlags: clinicalEvidence.flags || [],
      });

      return res.json(estimate);
    } catch (error) {
      logger.api.error("Error calculating timeline estimate", {}, error);
      return res.status(500).json({
        error: "Failed to calculate timeline estimate",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get comprehensive recovery chart data for a case
  app.get("/api/cases/:id/recovery-chart", async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;

      // Fetch case
      const cases = await db
        .select()
        .from(workerCases)
        .where(eq(workerCases.id, id))
        .limit(1);

      if (cases.length === 0) {
        return res.status(404).json({ error: "Case not found" });
      }

      const workerCase = cases[0] as any;

      // Fetch medical certificates for this case
      const certificateRows = await db
        .select()
        .from(medicalCertificates)
        .where(eq(medicalCertificates.caseId, id))
        .orderBy(desc(medicalCertificates.startDate));

      // Map to MedicalCertificate interface
      const certificates: MedicalCertificate[] = certificateRows.map((row) => {
        const hasDocUrl = !!row.documentUrl;
        logger.api.info("Certificate mapping", {
          id: row.id,
          hasDocUrl,
          docUrlLen: row.documentUrl?.length
        });
        return {
          id: row.id,
          caseId: row.caseId,
          issueDate: row.issueDate?.toISOString() ?? row.startDate.toISOString(),
          startDate: row.startDate.toISOString(),
          endDate: row.endDate.toISOString(),
          capacity: row.capacity as WorkCapacity,
          workCapacityPercentage: row.workCapacityPercentage ?? undefined,
          notes: row.notes ?? undefined,
          source: (row.source as "freshdesk" | "manual") ?? "freshdesk",
          documentUrl: row.documentUrl ?? undefined,
          sourceReference: row.sourceReference ?? undefined,
          createdAt: row.createdAt?.toISOString(),
          updatedAt: row.updatedAt?.toISOString(),
        };
      });

      // Evaluate clinical evidence to get flags
      const clinicalEvidence = evaluateClinicalEvidence(workerCase);

      // Use human-readable summary for injury type detection (not the XGBoost aiSummary which lacks diagnosis keywords).
      // aiSummary is reserved for XGBoost score extraction; summary contains the clinical description.
      const diagnosisText = workerCase.summary || workerCase.aiSummary || "";
      logger.api.info("Injury type detection input", {
        caseId: id,
        hasAiSummary: !!workerCase.aiSummary,
        aiSummaryLen: workerCase.aiSummary?.length || 0,
        summaryLen: workerCase.summary?.length || 0,
        diagnosisTextLen: diagnosisText.length,
      });

      // Derive effective risk level: XGBoost score in aiSummary overrides stored riskLevel (score ≥0.8 → High);
      // cases off work ≥36 weeks always escalate to High regardless of stored level.
      const weeksOffWork = workerCase.dateOfInjury
        ? Math.floor((Date.now() - new Date(workerCase.dateOfInjury).getTime()) / (7 * 24 * 60 * 60 * 1000))
        : 0;
      const xgboostSource = workerCase.aiSummary || workerCase.summary || "";
      const xgboostMatch = xgboostSource.match(
        /XGBoost\s+(?:risk(?:\s+index)?|probability|stability score|resilience score)\s+([\d.]+)/i
      );
      const xgboostScore = xgboostMatch ? parseFloat(xgboostMatch[1]) : null;
      let effectiveRiskLevel: "High" | "Medium" | "Low" =
        (workerCase.riskLevel as "High" | "Medium" | "Low") || "Medium";
      if (xgboostScore !== null && xgboostScore >= 0.8) {
        effectiveRiskLevel = "High";
      }
      if (weeksOffWork >= 36) {
        effectiveRiskLevel = "High";
      }

      // Generate comprehensive chart data
      const chartData = generateRecoveryTimelineChartData(
        id,
        workerCase.workerName,
        workerCase.dateOfInjury.toISOString(),
        diagnosisText,
        effectiveRiskLevel,
        clinicalEvidence.flags || [],
        certificates
      );

      // Attach override data if present
      const clinStatus = workerCase.clinical_status_json as any;
      const override = clinStatus?.recoveryOverride ?? null;
      const adjustedWeeks = override?.adjustedEstimateWeeks ?? null;
      const responseData: any = { ...chartData };
      if (override) {
        responseData.recoveryOverride = override;
        responseData.adjustedEstimateWeeks = adjustedWeeks;
      }

      return res.json(responseData);
    } catch (error) {
      logger.api.error("Error generating recovery chart data", {}, error);
      return res.status(500).json({
        error: "Failed to generate recovery chart data",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // POST /api/cases/:id/recovery-override — AHR clinical timeline adjustment (Phase 6.2)
  // Restricted to non-employer roles (coordinators, admins only)
  app.post("/api/cases/:id/recovery-override", authorize(["admin", "coordinator", "clinician"] as any), async (req: Request, res: Response) => {
    try {
      const id = req.params.id as string;
      const { adjustedEstimateWeeks, reason, factors } = req.body;

      if (!adjustedEstimateWeeks || typeof adjustedEstimateWeeks !== "number" || adjustedEstimateWeeks < 1) {
        return res.status(400).json({ error: "adjustedEstimateWeeks must be a positive number" });
      }
      if (!reason || typeof reason !== "string" || !reason.trim()) {
        return res.status(400).json({ error: "reason is required" });
      }

      const cases = await db.select().from(workerCases).where(eq(workerCases.id, id)).limit(1);
      if (cases.length === 0) return res.status(404).json({ error: "Case not found" });

      const workerCase = cases[0] as any;
      const clinStatus = (workerCase.clinical_status_json as any) ?? {};

      // Determine original estimate from estimator
      const clinicalEvidence = evaluateClinicalEvidence(workerCase);
      const diagnosisText = workerCase.aiSummary || workerCase.summary || "";
      const tempChart = generateRecoveryTimelineChartData(
        id, workerCase.workerName,
        workerCase.dateOfInjury.toISOString(),
        diagnosisText,
        workerCase.riskLevel as "High" | "Medium" | "Low",
        clinicalEvidence.flags || [], []
      );

      const override = {
        id: `ro-${Date.now()}`,
        caseId: id,
        originalEstimateWeeks: tempChart.estimatedWeeks,
        adjustedEstimateWeeks,
        reason: reason.trim(),
        factors: Array.isArray(factors) ? factors : [],
        overriddenBy: (req as any).user?.id ?? "unknown",
        overriddenAt: new Date().toISOString(),
      };

      await db.update(workerCases)
        .set({ clinicalStatusJson: { ...clinStatus, recoveryOverride: override } } as any)
        .where(eq(workerCases.id, id));

      logAuditEvent({ eventType: AuditEventTypes.CASE_UPDATE, userId: (req as any).user?.id ?? null, organizationId: (req as any).user?.organizationId ?? null, resourceType: 'case', resourceId: id, metadata: { action: 'recovery_override', adjustedEstimateWeeks, reason: reason.trim() } });

      return res.json({ ok: true, override });
    } catch (error) {
      logger.api.error("Error saving recovery override", {}, error);
      return res.status(500).json({ error: "Failed to save recovery override" });
    }
  });

  // Get injury model details for a specific injury type
  app.get("/api/injury-models/:type", async (req: Request, res: Response) => {
    try {
      const type = req.params.type as string;
      const model = getInjuryModel(type as any);

      if (!model) {
        return res.status(404).json({ error: "Injury type not found" });
      }

      return res.json({
        type,
        label: type.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase()),
        ...model,
      });
    } catch (error) {
      logger.api.error("Error fetching injury model", {}, error);
      return res.status(500).json({
        error: "Failed to fetch injury model",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Get all available injury types
  app.get("/api/injury-types", async (_req: Request, res: Response) => {
    try {
      const types = getAvailableInjuryTypes();
      return res.json(types);
    } catch (error) {
      logger.api.error("Error fetching injury types", {}, error);
      return res.status(500).json({
        error: "Failed to fetch injury types",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });
}
