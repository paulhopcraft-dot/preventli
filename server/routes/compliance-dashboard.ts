import { Router } from "express";
import { authorize } from "../middleware/auth";
import { logAuditEvent, AuditEventTypes, getRequestMetadata } from "../services/auditLogger";
import { db } from "../db";
import { workerCases } from "@shared/schema";
import { sql } from "drizzle-orm";

const router = Router();

interface ComplianceSummary {
  totalCases: number;
  evaluatedCases: number;
  overallComplianceRate: number;
  statusDistribution: {
    compliant: number;
    minor_issues: number;
    major_issues: number;
    critical: number;
  };
  riskDistribution: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  trendData: {
    previousRate: number;
    isImproving: boolean;
    changePercentage: number;
  };
  topIssues: Array<{
    ruleName: string;
    violationCount: number;
    severity: "low" | "medium" | "high" | "critical";
  }>;
  lastUpdated: string;
}

router.get("/summary", authorize(), async (req, res) => {
  try {
    const { organizationId } = req.user!;

    logAuditEvent({
      organizationId,
      userId: req.user!.id,
      eventType: AuditEventTypes.COMPLIANCE_DASHBOARD_VIEW,
      resourceType: "compliance_dashboard",
      resourceId: "summary",
      metadata: getRequestMetadata(req),
    });

    // Get all cases for the organization (include createdAt for trend calculation)
    const allCases = await db
      .select({
        id: workerCases.id,
        complianceIndicator: workerCases.complianceIndicator,
        workStatus: workerCases.workStatus,
        riskLevel: workerCases.riskLevel,
        caseStatus: workerCases.caseStatus,
        createdAt: workerCases.createdAt,
      })
      .from(workerCases)
      .where(sql`${workerCases.organizationId} = ${organizationId}`);

    // Filter out closed cases
    const activeCases = allCases.filter(c => c.caseStatus !== "closed");

    const totalCases = activeCases.length;
    const evaluatedCases = activeCases.filter(c => c.complianceIndicator).length;

    // Calculate status distribution based on compliance indicators
    const statusDistribution = {
      compliant: activeCases.filter(c =>
        c.complianceIndicator === "Very High" || c.complianceIndicator === "High"
      ).length,
      minor_issues: activeCases.filter(c =>
        c.complianceIndicator === "Medium"
      ).length,
      major_issues: activeCases.filter(c =>
        c.complianceIndicator === "Low"
      ).length,
      critical: activeCases.filter(c =>
        c.complianceIndicator === "Very Low"
      ).length,
    };

    // Calculate overall compliance rate
    const overallComplianceRate = evaluatedCases > 0
      ? (statusDistribution.compliant / evaluatedCases) * 100
      : 0;

    // Calculate risk distribution
    const riskDistribution = {
      low: activeCases.filter(c => c.riskLevel === "Low").length,
      medium: activeCases.filter(c => c.riskLevel === "Medium").length,
      high: activeCases.filter(c => c.riskLevel === "High").length,
      critical: activeCases.filter(c => c.riskLevel === "Critical").length,
    };

    // Derive trend data deterministically from month-over-month compliance rates.
    // "Current month" = cases created in the current calendar month.
    // "Previous month" = cases created in the previous calendar month.
    // A compliance rate is computable only when ≥1 evaluated case exists in that window.
    const now = new Date();
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const isCompliant = (indicator: string | null): boolean =>
      indicator === "Very High" || indicator === "High";

    const rateForWindow = (
      cases: typeof activeCases,
      from: Date,
      to: Date
    ): number | null => {
      const windowCases = cases.filter(
        (c) => c.createdAt && c.createdAt >= from && c.createdAt < to
      );
      const evaluated = windowCases.filter((c) => c.complianceIndicator).length;
      if (evaluated === 0) return null;
      const compliant = windowCases.filter((c) => isCompliant(c.complianceIndicator)).length;
      return (compliant / evaluated) * 100;
    };

    const currentMonthRate = rateForWindow(activeCases, thisMonthStart, now);
    const prevMonthRate = rateForWindow(activeCases, prevMonthStart, thisMonthStart);

    let trendData: { previousRate: number; isImproving: boolean; changePercentage: number };
    if (currentMonthRate !== null && prevMonthRate !== null) {
      const changePercentage = currentMonthRate - prevMonthRate;
      trendData = {
        previousRate: Math.round(prevMonthRate * 10) / 10,
        isImproving: changePercentage > 0,
        changePercentage: Math.round(changePercentage * 10) / 10,
      };
    } else {
      // Insufficient monthly data — report no change
      trendData = {
        previousRate: Math.round(overallComplianceRate * 10) / 10,
        isImproving: false,
        changePercentage: 0,
      };
    }

    // Get top compliance issues (mock data based on common WorkSafe issues)
    const topIssues = [
      {
        ruleName: "Medical Certificate Currency",
        violationCount: statusDistribution.critical + statusDistribution.major_issues,
        severity: "critical" as const,
      },
      {
        ruleName: "RTW Plan Compliance",
        violationCount: Math.floor((statusDistribution.major_issues + statusDistribution.minor_issues) * 0.7),
        severity: "high" as const,
      },
      {
        ruleName: "Suitable Duties Assessment",
        violationCount: Math.floor(statusDistribution.minor_issues * 0.5),
        severity: "medium" as const,
      },
    ].filter(issue => issue.violationCount > 0);

    const summary: ComplianceSummary = {
      totalCases,
      evaluatedCases,
      overallComplianceRate: Math.round(overallComplianceRate * 10) / 10,
      statusDistribution,
      riskDistribution,
      trendData,
      topIssues,
      lastUpdated: new Date().toISOString(),
    };

    res.json(summary);

  } catch (error) {
    console.error("[Compliance Dashboard] Error:", error);
    logAuditEvent({
      organizationId: req.user?.organizationId || "unknown",
      userId: req.user?.id || "unknown",
      eventType: AuditEventTypes.COMPLIANCE_DASHBOARD_ERROR,
      resourceType: "compliance_dashboard",
      resourceId: "summary",
      metadata: {
        ...getRequestMetadata(req),
        error: error instanceof Error ? error.message : "Unknown error"
      },
    });

    res.status(500).json({
      error: "Failed to load compliance dashboard",
      message: "Unable to calculate compliance statistics",
    });
  }
});

export default router;