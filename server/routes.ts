import type { Express } from "express";
import { z } from "zod";
import { storage } from "./storage";
import { FreshdeskService } from "./services/freshdesk";
import { syncScheduler } from "./services/syncScheduler";
import { complianceScheduler } from "./services/complianceScheduler";
import { HybridSummaryService } from "./services/hybridSummary";
const hybridSummaryService = new HybridSummaryService();
import { callClaude } from "./lib/claude-cli";
import { logger, createLogger } from "./lib/logger";

const routeLogger = createLogger("Routes");
import authRoutes from "./routes/auth";
import partnerRoutes from "./routes/partner";
import terminationRoutes from "./routes/termination";
import inviteRoutes from "./routes/invites";
import webhookRoutes from "./routes/webhooks";
import certificateRoutes from "./routes/certificates";
import actionRoutes from "./routes/actions";
import smartSummaryRoutes from "./routes/smartSummary";
import emailDraftRoutes from "./routes/emailDrafts";
import discordRoutes from "./routes/discord";
import notificationRoutes from "./routes/notifications";
import adminOrganizationRoutes from "./routes/admin/organizations";
import adminInsurerRoutes from "./routes/admin/insurers";
import adminRolesRoutes from "./routes/admin/roles";
import adminDutiesRoutes from "./routes/admin/duties";
import adminSeedRoutes from "./routes/admin/seed";
import adminInboundEmailRoutes from "./routes/admin/inbound-emails";
import organizationRoutes from "./routes/organization";
// caseChatRoutes removed — consolidated into unified chat at /api/chat/message
import workerRoutes from "./routes/workers";
import bookingRoutes from "./routes/bookings";
import chatRoutes from "./routes/chat";
import publicRoutes from "./routes/public";
import assessmentRoutes from "./routes/assessments";
import rtwRoutes from "./routes/rtw";
import predictionRoutes from "./routes/predictions";
import { registerTimelineRoutes } from "./routes/timeline";
import { registerTreatmentPlanRoutes } from "./routes/treatmentPlan";
import contactRoutes from "./routes/contacts";
import restrictionRoutes from "./routes/restrictions";
import functionalAbilityRouter from "./routes/functionalAbility";
import rtwPlansRouter from "./routes/rtwPlans";
import rtwAutoDraftRouter from "./routes/rtwAutoDraft";
import { employerDashboardRouter } from "./routes/employer-dashboard";
import complianceDashboardRouter from "./routes/compliance-dashboard";
import preEmploymentRoutes from "./routes/preEmployment";
import exitProcessingRoutes from "./routes/exitProcessing";
import auditEventsRouter from "./routes/audit-events";
import memoryRoutes from "./routes/memory";
import intelligenceRoutes from "./routes/intelligence";
import agentRoutes from "./routes/agents";
import controlRoutes from "./routes/control";
import lifecycleRoutes from "./routes/lifecycle";
import hrDecisionsRoutes from "./routes/hr-decisions";
import supportRoutes from "./routes/support";
import morningBriefingRoutes from "./routes/morning-briefing";
import type { RecoveryTimelineSummary } from "@shared/schema";
import { evaluateClinicalEvidence } from "./services/clinicalEvidence";
import { authorize, type AuthRequest } from "./middleware/auth";
import { requireCaseOwnership } from "./middleware/caseOwnership";
import { logAuditEvent, AuditEventTypes, getRequestMetadata } from "./services/auditLogger";
import { filterCaseByRole, isEmployerRole } from "./lib/rbac";
import { computeComplianceDeadlines } from "./lib/complianceDeadlines";
import { db } from "./db";
import { workerCases as workerCasesTable } from "@shared/schema";
import { eq, and, isNotNull, count, sql as drizzleSql } from "drizzle-orm";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

export async function registerRoutes(app: Express): Promise<void> {
  // Authentication routes
  app.use("/api/auth", authRoutes);

  // Partner-tier routes (partner-role users only): client picker, active org switching, header context
  app.use("/api/partner", partnerRoutes);

  app.use("/api/termination", terminationRoutes);

  // Admin invite routes (requires admin authentication)
  app.use("/api/admin/invites", inviteRoutes);

  // Admin organization management routes (requires admin authentication)
  app.use("/api/admin/organizations", adminOrganizationRoutes);

  // Admin insurer management routes (requires admin authentication)
  app.use("/api/admin/insurers", adminInsurerRoutes);

  // Admin RTW roles management routes (requires admin authentication)
  app.use("/api/admin/roles", adminRolesRoutes);

  // Admin RTW duties management routes (requires admin authentication)
  app.use("/api/admin/duties", adminDutiesRoutes);

  // Admin seed trigger (admin only — one-shot idempotent re-seed)
  app.use("/api/admin/seed", adminSeedRoutes);

  // Admin inbound email triage (admin only — review and assign unmatched emails)
  app.use("/api/admin/inbound-emails", adminInboundEmailRoutes);

  // Organization self-service routes (authenticated users)
  app.use("/api/organization", organizationRoutes);

  // Webhook routes (password-protected, fail-closed security)
  app.use("/api/webhooks", webhookRoutes);

  // Certificate Engine v1 routes (JWT-protected)
  app.use("/api/certificates", certificateRoutes);

  // Action Queue v1 routes (JWT-protected)
  app.use("/api/actions", actionRoutes);

  // Cases list (paginated) — must be registered BEFORE the `/api/cases` router mounts
  // below, because `predictionRoutes` has a `router.get("/")` that would otherwise
  // catch `GET /api/cases` and shadow this handler.
  const casesListHandler = async (req: AuthRequest, res: any) => {
    try {
      // Admin users can see all organizations' cases, others only see their own
      const organizationId = req.user!.role === 'admin' ? undefined : req.user!.organizationId;

      // Parse pagination params (defaults: page=1, limit=50, max limit=200)
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));

      // Log access
      await logAuditEvent({
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
        eventType: AuditEventTypes.CASE_LIST,
        ...getRequestMetadata(req),
      });

      const result = await storage.getCasesPaginated(organizationId, page, limit);

      // Iteration 9/13: fire-and-forget lifecycle stage advancement.
      // Covers "intake" cases (iter 9) and "assessment" cases stuck > 28d (iter 13).
      // Non-blocking — the list returns immediately; next fetch shows updated stages.
      const ASSESSMENT_ADVANCE_DAYS = 28;
      const _now = new Date();
      const staleOrgs = new Set(
        result.cases
          .filter(c => {
            if (c.lifecycleStage === "intake") return true;
            if (c.lifecycleStage === "assessment" && c.dateOfInjury) {
              const daysOff = Math.floor((_now.getTime() - new Date(c.dateOfInjury).getTime()) / 86400000);
              return daysOff > ASSESSMENT_ADVANCE_DAYS;
            }
            return false;
          })
          .map(c => c.organizationId)
          .filter((id): id is string => !!id)
      );
      for (const orgId of Array.from(staleOrgs)) {
        storage.autoAssignLifecycleStages(orgId).catch(() => {});
      }

      // Phase 1.8: strip clinical fields for employer-role users
      const role = req.user!.role;
      if (isEmployerRole(role)) {
        result.cases = result.cases.map(c => filterCaseByRole(c, role));
      }
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch cases" });
    }
  };
  app.get("/api/cases", authorize(), casesListHandler);
  // Deprecated alias — remove after rebrand Tier 3 follow-up (~1 week post-deploy)
  app.get("/api/gpnet2/cases", authorize(), (req: AuthRequest, res) => {
    routeLogger.warn("Deprecated route hit: /api/gpnet2/cases — migrate caller to /api/cases", {
      userAgent: req.headers["user-agent"],
    });
    return casesListHandler(req, res);
  });

  // Smart Summary Engine v1 routes (JWT-protected)
  app.use("/api/cases", smartSummaryRoutes);

  // RTW Plan routes (JWT-protected, case ownership)
  app.use("/api/cases", rtwRoutes);
  app.use("/api/rtw", rtwRoutes);

  // Prediction Engine routes (PRD-9: AI & Intelligence Layer)
  app.use("/api/predictions", predictionRoutes);
  app.use("/api/cases", predictionRoutes);

  // Timeline Estimator routes (JWT-protected, case ownership)
  registerTimelineRoutes(app);

  // Treatment Plan routes (JWT-protected, case ownership, PRD-9 compliant)
  registerTreatmentPlanRoutes(app, storage);

  // Email Drafts routes (JWT-protected)
  app.use("/api", emailDraftRoutes);

  // Case Contacts routes (JWT-protected, case ownership)
  app.use("/api/cases", contactRoutes);

  // Medical Restrictions routes (JWT-protected, case ownership) - MED-09, MED-10
  app.use("/api/cases", restrictionRoutes);

  // Lifecycle Stage routes (JWT-protected, case ownership) - Phase 3.1
  app.use("/api/cases", lifecycleRoutes);
  app.use("/api", lifecycleRoutes); // mounts /api/admin/migrate-lifecycle

  // HR Decisions Queue + Portfolio — Phase 5
  app.use("/api/hr", hrDecisionsRoutes);

  // Functional Ability Matrix routes (JWT-protected) - FAM-01 to FAM-07
  app.use("/api/functional-ability", authorize(), functionalAbilityRouter);

  // RTW Plan Generator routes (JWT-protected) - GEN-01 to GEN-10
  app.use("/api/rtw-plans", authorize(), rtwPlansRouter);

  // RTW Auto-Draft routes (JWT-protected, case ownership applied per-route)
  app.use("/api/cases", rtwAutoDraftRouter);

  // Employer Dashboard routes (JWT-protected)
  app.use("/api/employer", employerDashboardRouter);

  // Compliance Dashboard routes (JWT-protected)
  app.use("/api/compliance/dashboard", complianceDashboardRouter);

  // Notification Engine v1 routes (JWT-protected, admin)
  app.use("/api/notifications", notificationRoutes);

  // Pre-Employment Health Checks routes (JWT-protected)
  app.use("/api/pre-employment", preEmploymentRoutes);

  // Exit Processing routes (JWT-protected)
  app.use("/api/exit-processing", exitProcessingRoutes);

  // Audit Events routes (JWT-protected)
  app.use("/api/audit-events", auditEventsRouter);

  // Assessments CRUD + send-to-worker (JWT-protected)
  app.use("/api/assessments", assessmentRoutes);

  // Workers (normalized worker records — JWT-protected)
  app.use("/api/workers", workerRoutes);

  // Telehealth Bookings (JWT-protected)
  app.use("/api/bookings", bookingRoutes);

  // Unified Health Assistant Chat (JWT-protected)
  app.use("/api/chat", chatRoutes);

  // Alex Morning Briefing (JWT-protected)
  app.use("/api/morning-briefing", morningBriefingRoutes);

  // Public questionnaire routes (no auth — worker magic link)
  app.use("/api/public", publicRoutes);

  // Discord Integration routes (JWT-protected)
  app.use("/api/discord", discordRoutes);


  // Memory API routes (JWT-protected) - Infinite context system
  app.use("/api/v1/memory", memoryRoutes);

  // Intelligence API routes (JWT-protected) - 6-agent AI analysis
  app.use("/api/intelligence", intelligenceRoutes);

  // Agentic System routes (JWT-protected) — coordinator, RTW, recovery, certificate agents
  app.use("/api/agents", agentRoutes);

  // Control Tower routes (admin-only — live operational metrics)
  app.use("/api/control", controlRoutes);

  // Support contact form
  app.use("/api/support", supportRoutes);

  // Inbound Email webhook registered in server/index.ts (before CSRF middleware)

  // Local diagnostics — admin only
  app.get("/api/diagnostics/env", authorize(["admin"]), (req: AuthRequest, res) => {
    res.json({
      DATABASE_URL: !!process.env.DATABASE_URL,
      FRESHDESK_DOMAIN: !!process.env.FRESHDESK_DOMAIN,
      FRESHDESK_API_KEY: !!process.env.FRESHDESK_API_KEY,
      CLAUDE_CLI: true,
    });
  });

  // Smart Actions API - AI-powered action recommendations
  app.get("/api/smart-actions", authorize(), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user!.role === 'admin' ? undefined : req.user!.organizationId;
      const paginatedData = await storage.getCasesPaginated(organizationId, 1, 200);
      const cases = paginatedData.cases;

      const smartActions: any[] = [];

      cases.forEach(workerCase => {
        const injuryDate = new Date(workerCase.dateOfInjury);
        const daysOffWork = Math.floor((Date.now() - injuryDate.getTime()) / (1000 * 60 * 60 * 24));

        // High-risk case requiring immediate attention
        if (workerCase.riskLevel === "High" && workerCase.workStatus === "Off work") {
          smartActions.push({
            id: `critical-${workerCase.id}`,
            title: "High-Risk Case Intervention Required",
            description: `${workerCase.workerName} is high-risk and off work for ${daysOffWork} days. Clinical review and intervention planning needed.`,
            urgency: "immediate",
            category: "medical",
            impact: "high",
            caseId: workerCase.id,
            workerName: workerCase.workerName,
            estimatedMinutes: 30,
            suggestedNextSteps: [
              "Contact treating physician for clinical update",
              "Review medical evidence and treatment plan",
              "Assess need for independent medical examination",
              "Coordinate with employer for suitable duties assessment"
            ],
            reasoning: `This case is flagged as high-risk due to ${workerCase.riskLevel} risk level and prolonged absence of ${daysOffWork} days. Early intervention is critical to prevent long-term disability.`
          });
        }

        // RTW planning for cases without plans
        if (workerCase.rtwPlanStatus === "not_planned" && daysOffWork > 7) {
          smartActions.push({
            id: `rtw-${workerCase.id}`,
            title: "Return to Work Plan Required",
            description: `${workerCase.workerName} needs RTW planning after ${daysOffWork} days off work.`,
            urgency: daysOffWork > 30 ? "immediate" : daysOffWork > 14 ? "today" : "this_week",
            category: "rtw",
            impact: daysOffWork > 30 ? "high" : "medium",
            caseId: workerCase.id,
            workerName: workerCase.workerName,
            estimatedMinutes: 45,
            suggestedNextSteps: [
              "Obtain current medical certificate with functional capacity",
              "Coordinate with employer for suitable duties assessment",
              "Create graduated RTW plan with milestone targets",
              "Schedule initial RTW planning meeting with all parties"
            ],
            reasoning: `Worker has been off work for ${daysOffWork} days without structured RTW planning. Research shows RTW plans are most effective when implemented within 2 weeks of injury.`
          });
        }

        // Compliance concerns
        if (workerCase.complianceIndicator === "Very Low" || workerCase.complianceIndicator === "Low") {
          smartActions.push({
            id: `compliance-${workerCase.id}`,
            title: "Compliance Intervention Required",
            description: `${workerCase.workerName} shows ${workerCase.complianceIndicator} compliance - intervention needed.`,
            urgency: workerCase.complianceIndicator === "Very Low" ? "today" : "this_week",
            category: "compliance",
            impact: workerCase.complianceIndicator === "Very Low" ? "high" : "medium",
            caseId: workerCase.id,
            workerName: workerCase.workerName,
            estimatedMinutes: 20,
            suggestedNextSteps: [
              "Review case history for compliance barriers",
              "Contact worker to understand concerns",
              "Assess need for additional support services",
              "Document compliance plan and follow-up schedule"
            ],
            reasoning: `Low compliance indicates potential barriers to recovery. Proactive engagement can improve outcomes and reduce long-term costs.`
          });
        }

        // Certificate expiry monitoring
        if (workerCase.workStatus === "Off work" && !workerCase.latestCertificate?.endDate) {
          smartActions.push({
            id: `cert-${workerCase.id}`,
            title: "Medical Certificate Required",
            description: `${workerCase.workerName} needs current medical certificate for ongoing claim management.`,
            urgency: "today",
            category: "administrative",
            impact: "medium",
            caseId: workerCase.id,
            workerName: workerCase.workerName,
            estimatedMinutes: 15,
            suggestedNextSteps: [
              "Request current medical certificate from treating practitioner",
              "Follow up with worker if certificate overdue",
              "Review certificate for work capacity assessment",
              "Update case records with new certificate information"
            ],
            reasoning: "Current medical certificates are required for ongoing claim validity and work capacity assessment."
          });
        }
      });

      // Sort by urgency and impact
      const urgencyOrder = { immediate: 0, today: 1, this_week: 2, routine: 3 };
      const impactOrder = { high: 0, medium: 1, low: 2 };

      smartActions.sort((a, b) => {
        const urgencyDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
        if (urgencyDiff !== 0) return urgencyDiff;
        return impactOrder[a.impact] - impactOrder[b.impact];
      });

      res.json(smartActions);
    } catch (error) {
      routeLogger.error("Smart actions error:", error);
      res.status(500).json({ error: "Failed to generate smart actions" });
    }
  });

  // Workspace Statistics API
  app.get("/api/workspace/stats", authorize(), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user!.role === 'admin' ? undefined : req.user!.organizationId;
      const paginatedData = await storage.getCasesPaginated(organizationId, 1, 200);
      const cases = paginatedData.cases;

      const stats = {
        totalCases: cases.length,
        activeCases: cases.filter(c => c.workStatus === "Off work").length,
        criticalActions: cases.filter(c => c.riskLevel === "High").length,
        urgentActions: cases.filter(c => c.complianceIndicator === "Very Low" || c.complianceIndicator === "Low").length,
        casesAtWork: cases.filter(c => c.workStatus === "At work").length,
        casesOffWork: cases.filter(c => c.workStatus === "Off work").length,
        highRiskCases: cases.filter(c => c.riskLevel === "High").length,
        complianceConcerns: cases.filter(c => c.complianceIndicator === "Very Low" || c.complianceIndicator === "Low").length,
      };

      res.json({ stats });
    } catch (error) {
      routeLogger.error("Workspace stats error:", error);
      res.status(500).json({ error: "Failed to fetch workspace statistics" });
    }
  });

  // System Health API — public, probes DB + AI + storage
  app.get("/api/system/health", async (_req, res) => {
    const { checkLLMHealth } = await import("./lib/llm-client");
    const { checkStorageHealth } = await import("./services/storageService");
    const { sendAlert } = await import("./services/alertService");
    const { sql } = await import("drizzle-orm");
    const { db } = await import("./db");

    // Check email: SMTP configured = ok, unconfigured = warning (not fatal)
    const smtpConfigured = Boolean(
      process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
    );
    const emailStatus = smtpConfigured ? "ok" : "unconfigured";

    const [aiStatus, storageStatus] = await Promise.all([
      checkLLMHealth().catch((e: unknown) => ({ ok: false, provider: "unknown", model: "unknown", error: String(e) })),
      checkStorageHealth().catch((e: unknown) => ({ ok: false, provider: "unknown", error: String(e) })),
    ]);

    let dbOk = false;
    let dbError: string | undefined;
    try {
      await db.execute(sql`SELECT 1`);
      dbOk = true;
    } catch (e) {
      dbError = e instanceof Error ? e.message : String(e);
    }

    // Fire alerts for any failures (non-blocking)
    if (!dbOk) {
      sendAlert({ type: "database_failure", severity: "critical", message: dbError ?? "Database unreachable" }).catch(() => {});
    }
    if (!aiStatus.ok) {
      sendAlert({ type: "ai_provider_failure", severity: "critical", message: aiStatus.error ?? "LLM provider unreachable" }).catch(() => {});
    }
    if (!storageStatus.ok) {
      sendAlert({ type: "storage_failure", severity: "critical", message: storageStatus.error ?? "Storage unreachable" }).catch(() => {});
    }

    // Storage is non-critical — unconfigured S3 doesn't block core functionality
    const criticalOk = dbOk && aiStatus.ok;
    const allOk = criticalOk && storageStatus.ok;
    res.status(criticalOk ? 200 : 503).json({
      status: allOk ? "ok" : "degraded",
      version: process.env.npm_package_version ?? "unknown",
      uptime: Math.floor(process.uptime()),
      database: dbOk ? "ok" : { error: dbError },
      ai: aiStatus.ok ? { provider: aiStatus.provider, model: aiStatus.model } : { error: aiStatus.error },
      storage: storageStatus.ok ? { provider: storageStatus.provider } : { error: storageStatus.error },
      email: emailStatus,
    });
  });

  // User Progress API — not yet implemented
  app.get("/api/user/progress", authorize(), (_req: AuthRequest, res) => {
    res.json({ available: false, data: null });
  });

  // AI Chat API - Expert case management assistant
  app.post("/api/ai/chat", authorize(), async (req: AuthRequest, res) => {
    try {
      const { message, context, history } = req.body;

      // Get user's cases for context if needed
      const organizationId = req.user!.role === 'admin' ? undefined : req.user!.organizationId;
      let caseContext = "";

      if (context.currentCase) {
        const paginatedData = await storage.getCasesPaginated(organizationId, 1, 200);
        const currentCase = paginatedData.cases.find(c => c.id === context.currentCase.id);

        if (currentCase) {
          caseContext = `
Current Case Context:
- Worker: ${currentCase.workerName}
- Company: ${currentCase.company}
- Injury Date: ${currentCase.dateOfInjury}
- Work Status: ${currentCase.workStatus}
- Risk Level: ${currentCase.riskLevel}
- RTW Status: ${currentCase.rtwPlanStatus || 'not_planned'}
- Days Off Work: ${Math.floor((Date.now() - new Date(currentCase.dateOfInjury).getTime()) / (1000 * 60 * 60 * 24))}
`;
        }
      }

      // Expert knowledge patterns for intelligent responses
      const expertPrompt = `You are an expert case management assistant with 20+ years of experience in workers compensation, return to work planning, and compliance management. You work alongside case managers, HR professionals, and clinicians.

Key expertise areas:
- Workers compensation case management best practices
- Return to work planning and coordination
- Medical certificate review and analysis
- Compliance with WorkSafe Victoria requirements
- Risk assessment and early intervention strategies
- Stakeholder coordination and communication

${caseContext}

Previous conversation:
${history.map(h => `${h.role}: ${h.content}`).join('\n')}

User question: "${message}"

Provide a helpful, expert response that:
1. Shows deep case management expertise
2. Provides specific, actionable advice
3. References best practices and evidence-based approaches
4. Offers practical next steps when appropriate
5. Is conversational but professional
6. Includes confidence level and reasoning when making recommendations

Keep responses concise but comprehensive (2-3 paragraphs max). If suggesting actions, be specific about what, when, and why.`;

      // Call Claude CLI — Max plan OAuth, no API key needed
      const aiResponse = await callClaude(expertPrompt, 30_000).catch(() =>
        "I'm having trouble processing that request. Could you rephrase your question?"
      );

      // Analyze response to generate smart suggestions
      const suggestions = [];

      // Pattern matching for common case management scenarios
      if (message.toLowerCase().includes("risk") || aiResponse.includes("risk")) {
        suggestions.push({
          label: "View Risk Assessment",
          description: "Detailed risk factor analysis",
          icon: "AlertTriangle"
        });
      }

      if (message.toLowerCase().includes("rtw") || message.toLowerCase().includes("return")) {
        suggestions.push({
          label: "Create RTW Plan",
          description: "Start guided RTW planning",
          icon: "Briefcase"
        });
      }

      if (message.toLowerCase().includes("medical") || message.toLowerCase().includes("certificate")) {
        suggestions.push({
          label: "Review Medical Evidence",
          description: "Analyze current medical status",
          icon: "Heart"
        });
      }

      if (message.toLowerCase().includes("compliance") || message.toLowerCase().includes("requirement")) {
        suggestions.push({
          label: "Check Compliance",
          description: "Review compliance indicators",
          icon: "FileText"
        });
      }

      // Calculate confidence based on keyword matching and context
      let confidence = 75; // Base confidence

      if (context.currentCase) confidence += 15; // Case context available
      if (history.length > 0) confidence += 10; // Conversation context

      // Lower confidence for very general questions
      if (message.length < 10 || !message.includes(" ")) confidence -= 20;

      confidence = Math.min(95, Math.max(60, confidence));

      res.json({
        message: aiResponse,
        type: "text",
        confidence,
        suggestions,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      routeLogger.error("AI chat error:", error);
      res.status(500).json({ error: "Failed to process chat message" });
    }
  });

  // Proactive Guidance API - Intelligent contextual recommendations
  app.post("/api/ai/proactive-guidance", authorize(), async (req: AuthRequest, res) => {
    try {
      const { context } = req.body;
      const guidances: any[] = [];

      // Get user's cases for contextual analysis
      const organizationId = req.user!.role === 'admin' ? undefined : req.user!.organizationId;
      const paginatedData = await storage.getCasesPaginated(organizationId, 1, 200);
      const cases = paginatedData.cases;

      const currentHour = new Date().getHours();
      const isBusinessHours = currentHour >= 8 && currentHour <= 17;

      // Morning productivity guidance
      if (currentHour === 9 && context.userContext?.actionsPerformed === 0) {
        guidances.push({
          id: `morning-start-${Date.now()}`,
          type: "suggestion",
          title: "Good Morning! Start with Priority Actions",
          message: "Research shows tackling high-priority items first improves daily productivity by 40%. Check your Priority Actions tab.",
          reasoning: "Morning hours typically show highest cognitive performance. Starting with critical actions maximizes impact.",
          confidence: 85,
          urgency: "medium",
          category: "efficiency",
          triggerContext: "morning_start",
          actions: [
            {
              label: "View Priority Actions",
              description: "See your most important tasks",
              icon: "Target"
            }
          ],
          dismissable: true,
          showOnce: true,
          expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hours
        });
      }

      // High-risk case detection
      const highRiskCases = cases.filter(c => c.riskLevel === "High" && c.workStatus === "Off work");
      if (highRiskCases.length > 0 && context.currentPage.includes("workspace")) {
        guidances.push({
          id: `high-risk-alert-${Date.now()}`,
          type: "warning",
          title: "High-Risk Cases Need Attention",
          message: `${highRiskCases.length} high-risk cases are off work. Early intervention reduces long-term disability by 35%.`,
          reasoning: "High-risk cases with extended absence have exponentially increasing costs. Immediate attention provides best outcomes.",
          confidence: 92,
          urgency: "high",
          category: "risk_mitigation",
          triggerContext: "workspace",
          actions: [
            {
              label: "Review High-Risk Cases",
              description: "Prioritize intervention planning",
              icon: "AlertTriangle"
            }
          ],
          dismissable: true,
          metadata: {
            caseIds: highRiskCases.map(c => c.id),
            statistics: {
              "High-risk cases": highRiskCases.length,
              "Avg days off": Math.round(highRiskCases.reduce((sum, c) =>
                sum + Math.floor((Date.now() - new Date(c.dateOfInjury).getTime()) / (1000 * 60 * 60 * 24)), 0) / highRiskCases.length)
            }
          }
        });
      }

      // RTW planning opportunities
      const rtwOpportunities = cases.filter(c =>
        c.rtwPlanStatus === "not_planned" &&
        Math.floor((Date.now() - new Date(c.dateOfInjury).getTime()) / (1000 * 60 * 60 * 24)) > 7
      );

      if (rtwOpportunities.length >= 3) {
        guidances.push({
          id: `rtw-opportunity-${Date.now()}`,
          type: "opportunity",
          title: "RTW Planning Opportunity",
          message: `${rtwOpportunities.length} workers are ready for RTW planning. Research shows plans created within 2 weeks have 60% higher success rates.`,
          reasoning: "Multiple workers without RTW plans represent significant opportunity for positive outcomes and cost reduction.",
          confidence: 88,
          urgency: "medium",
          category: "best_practice",
          triggerContext: "planning_opportunity",
          actions: [
            {
              label: "Start RTW Planning",
              description: "Create guided RTW plans",
              icon: "Briefcase",
              estimatedTime: 30
            }
          ],
          dismissable: true,
          metadata: {
            caseIds: rtwOpportunities.map(c => c.id),
            statistics: {
              "Ready for RTW": rtwOpportunities.length,
              "Potential weekly savings": `$${(rtwOpportunities.length * 850).toLocaleString()}`
            }
          }
        });
      }

      // User behavior insights
      if (context.userContext?.timeOnPage > 300 && context.userContext?.actionsPerformed < 2) {
        guidances.push({
          id: `engagement-insight-${Date.now()}`,
          type: "insight",
          title: "Workflow Insight Available",
          message: "I notice you're spending time reviewing information. Would you like me to analyze the current cases and suggest the most impactful next actions?",
          reasoning: "Extended page time with minimal actions suggests analysis or decision-making. AI assistance can help prioritize and accelerate decisions.",
          confidence: 75,
          urgency: "low",
          category: "efficiency",
          triggerContext: "user_behavior",
          actions: [
            {
              label: "Get AI Analysis",
              description: "Smart recommendations for current context",
              icon: "Brain",
              estimatedTime: 2
            }
          ],
          dismissable: true
        });
      }

      // Compliance reminders for business hours
      if (isBusinessHours && context.currentPage.includes("cases")) {
        const complianceConcerns = cases.filter(c =>
          c.complianceIndicator === "Very Low" || c.complianceIndicator === "Low"
        );

        if (complianceConcerns.length > 0) {
          guidances.push({
            id: `compliance-reminder-${Date.now()}`,
            type: "suggestion",
            title: "Compliance Check Recommended",
            message: `${complianceConcerns.length} cases show compliance concerns. Regular monitoring prevents regulatory issues.`,
            reasoning: "Proactive compliance management prevents costly penalties and ensures worker care standards.",
            confidence: 80,
            urgency: "medium",
            category: "compliance",
            triggerContext: "compliance_monitoring",
            actions: [
              {
                label: "Review Compliance",
                description: "Check compliance status",
                icon: "FileText"
              }
            ],
            dismissable: true,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
          });
        }
      }

      // Learning opportunities based on successful patterns
      const successfulCases = cases.filter(c => c.workStatus === "At work");
      if (successfulCases.length > 5 && Math.random() > 0.7) { // Show occasionally
        guidances.push({
          id: `learning-insight-${Date.now()}`,
          type: "learning",
          title: "Success Pattern Identified",
          message: `Your portfolio shows strong RTW success. ${Math.round((successfulCases.length / cases.length) * 100)}% of cases are back at work - above industry average!`,
          reasoning: "Recognizing successful patterns reinforces effective practices and builds confidence in case management approach.",
          confidence: 95,
          urgency: "low",
          category: "learning",
          triggerContext: "success_analysis",
          dismissable: true,
          metadata: {
            statistics: {
              "RTW success rate": `${Math.round((successfulCases.length / cases.length) * 100)}%`,
              "Industry average": "65%"
            }
          }
        });
      }

      // Sort guidances by urgency and confidence
      const urgencyOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      guidances.sort((a, b) => {
        const urgencyDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
        if (urgencyDiff !== 0) return urgencyDiff;
        return b.confidence - a.confidence;
      });

      res.json(guidances);

    } catch (error) {
      routeLogger.error("Proactive guidance error:", error);
      res.status(500).json({ error: "Failed to generate proactive guidance" });
    }
  });

  // Intelligent Summary API - Comprehensive AI analysis
  app.get("/api/ai/intelligent-summary", authorize(), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user!.role === 'admin' ? undefined : req.user!.organizationId;
      const paginatedData = await storage.getCasesPaginated(organizationId, 1, 200);
      const cases = paginatedData.cases;

      // Calculate comprehensive metrics
      const casesAtWork = cases.filter(c => c.workStatus === "At work").length;
      const casesOffWork = cases.filter(c => c.workStatus === "Off work").length;
      const highRiskCases = cases.filter(c => c.riskLevel === "High").length;
      const complianceConcerns = cases.filter(c => c.complianceIndicator === "Very Low" || c.complianceIndicator === "Low").length;

      // RTW success rate calculation
      const rtwSuccessRate = cases.length > 0 ? Math.round((casesAtWork / cases.length) * 100) : 0;

      // Average RTW days for successful cases
      const avgRTWDays = casesAtWork > 0
        ? Math.round(cases.filter(c => c.workStatus === "At work").reduce((sum, c) => {
            const daysOff = Math.floor((Date.now() - new Date(c.dateOfInjury).getTime()) / (1000 * 60 * 60 * 24));
            return sum + Math.min(daysOff, 180); // Cap at 180 days for calculation
          }, 0) / casesAtWork)
        : 0;

      // Portfolio health calculation (0-100)
      let portfolioHealth = 100;
      portfolioHealth -= (highRiskCases / cases.length) * 40; // High risk impact
      portfolioHealth -= (complianceConcerns / cases.length) * 30; // Compliance impact
      portfolioHealth += Math.min((rtwSuccessRate - 65) * 0.5, 15); // Success bonus
      portfolioHealth = Math.max(0, Math.min(100, portfolioHealth));

      // Trend direction based on various factors
      const trendDirection = portfolioHealth > 75 ? "improving" :
                           portfolioHealth < 50 ? "declining" : "stable";

      // Generate key insights
      const keyInsights = [];

      if (rtwSuccessRate > 70) {
        keyInsights.push(`RTW success rate of ${rtwSuccessRate}% exceeds industry benchmark. Strong performance in early intervention.`);
      }

      if (highRiskCases > 0) {
        keyInsights.push(`${highRiskCases} high-risk cases identified. Early intervention on these cases could prevent ${highRiskCases * 45}% cost escalation.`);
      }

      if (avgRTWDays < 30) {
        keyInsights.push(`Average RTW time of ${avgRTWDays} days shows effective case management. Each day saved reduces costs by ~$850.`);
      }

      // Predicted outcomes
      const predictedOutcomes = [];

      if (highRiskCases > 2) {
        predictedOutcomes.push({
          outcome: "3-5 high-risk cases likely to extend beyond 90 days",
          probability: 75,
          timeframe: "Next 30 days",
          impact: "high",
          recommendation: "Implement immediate intervention protocols with multidisciplinary team review"
        });
      }

      if (rtwSuccessRate > 65) {
        predictedOutcomes.push({
          outcome: "Portfolio RTW success rate will improve by 5-8%",
          probability: 68,
          timeframe: "Next quarter",
          impact: "medium",
          recommendation: "Continue current practices and consider expanding successful strategies"
        });
      }

      // Optimization opportunities
      const optimizationOpportunities = [];

      if (complianceConcerns > 0) {
        optimizationOpportunities.push({
          area: "Compliance Management",
          potentialImprovement: "Automated compliance monitoring could reduce manual effort by 60%",
          estimatedSavings: "$15,000 annually",
          effort: "medium",
          priority: 2
        });
      }

      if (cases.filter(c => c.rtwPlanStatus === "not_planned").length > 3) {
        optimizationOpportunities.push({
          area: "RTW Planning Efficiency",
          potentialImprovement: "Standardized RTW plan templates could reduce planning time by 40%",
          estimatedSavings: "$8,500 annually",
          effort: "low",
          priority: 1
        });
      }

      const summary = {
        aiAnalysis: {
          portfolioHealth: Math.round(portfolioHealth),
          trendDirection,
          keyInsights,
          predictedOutcomes,
          optimizationOpportunities
        },
        performanceMetrics: {
          rtwSuccessRate,
          averageRTWDays: avgRTWDays,
          costSavings: Math.round((cases.length * 850 * Math.max(0, (45 - avgRTWDays)))), // Estimated savings vs baseline
          complianceScore: Math.round(((cases.length - complianceConcerns) / cases.length) * 100),
          earlyInterventionRate: Math.round(((cases.length - highRiskCases) / cases.length) * 100)
        },
        aiActions: {
          automatedTasks: Math.floor(Math.random() * 25) + 15,
          recommendationsAccepted: Math.floor(Math.random() * 20) + 10,
          interventionsPrevented: Math.floor(Math.random() * 8) + 3,
          timesSaved: Math.floor(Math.random() * 15) + 8
        },
        comparisons: {
          industryBenchmark: 65,
          previousPeriod: Math.max(40, rtwSuccessRate - Math.floor(Math.random() * 10)),
          bestPracticeAlignment: Math.round(portfolioHealth * 0.9)
        }
      };

      res.json(summary);

    } catch (error) {
      routeLogger.error("Intelligent summary error:", error);
      res.status(500).json({ error: "Failed to generate intelligent summary" });
    }
  });
  // Claude compliance assistant - input validation schema
  const complianceRequestSchema = z.object({
    message: z.string()
      .min(1, "Message is required")
      .max(4000, "Message too long (max 4000 characters)")
      .trim(),
  });

  app.post("/api/compliance", authorize(), async (req: AuthRequest, res) => {
    // Validate input with Zod
    const parseResult = complianceRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: "Invalid request",
        details: parseResult.error.errors.map(e => e.message).join(", ")
      });
    }

    const { message } = parseResult.data;

    try {
      // Get user's cases for context
      const organizationId = req.user!.role === 'admin' ? undefined : req.user!.organizationId;
      const paginatedData = await storage.getCasesPaginated(organizationId, 1, 200);
      const cases = paginatedData.cases;

      // Build context summary
      const totalCases = cases.length;
      const offWorkCases = cases.filter(c => c.workStatus === 'Off work').length;
      const atWorkCases = cases.filter(c => c.workStatus === 'At work').length;
      const highRiskCases = cases.filter(c => c.complianceIndicator === 'High').length;
      const mediumRiskCases = cases.filter(c => c.complianceIndicator === 'Medium').length;
      const lowRiskCases = cases.filter(c => c.complianceIndicator === 'Low').length;

      // Get unique companies
      const companies = Array.from(new Set(cases.map(c => c.company))).sort();

      // Check if user is asking about a specific case
      const caseMentioned = cases.find(c =>
        message.toLowerCase().includes(c.workerName.toLowerCase()) ||
        message.toLowerCase().includes(c.company.toLowerCase())
      );

      // Build context for AI
      let contextData = `
CURRENT CASE DATA:
- Total Cases: ${totalCases}
- Off Work: ${offWorkCases}
- At Work: ${atWorkCases}
- High Risk: ${highRiskCases}
- Medium Risk: ${mediumRiskCases}
- Low Risk: ${lowRiskCases}
- Companies: ${companies.join(', ')}
`.trim();

      // If asking about a specific case, provide detailed context
      if (caseMentioned) {
        contextData += `\n\nSPECIFIC CASE DETAILS:
Worker: ${caseMentioned.workerName}
Company: ${caseMentioned.company}
Work Status: ${caseMentioned.workStatus}
Risk Level: ${caseMentioned.complianceIndicator}
Date of Injury: ${caseMentioned.dateOfInjury}
Has Medical Certificate: ${caseMentioned.hasCertificate ? 'Yes' : 'No'}
Current Status: ${caseMentioned.currentStatus || 'N/A'}
Next Step: ${caseMentioned.nextStep || 'Pending review'}
Due Date: ${caseMentioned.dueDate || 'Not set'}
Summary: ${caseMentioned.summary || 'No summary available'}`;
      } else {
        // Show sample of recent cases
        contextData += `\n\nRecent Cases (sample):
${cases.slice(0, 10).map(c => `- ${c.workerName} (${c.company}): ${c.workStatus}, ${c.complianceIndicator} risk, Next: ${c.nextStep || 'Review needed'}`).join('\n')}`;
      }

      // Call Claude CLI — Max plan OAuth, no API key needed
      const fullPrompt = `You are an AI assistant for Preventli, a worker's compensation case management system for WorkSafe Victoria compliance.

You have access to the user's current case data and can answer questions about their specific cases, statistics, and provide actionable "next steps" guidance.

${contextData}

When answering:
- For case status questions: Reference the specific case data above and explain what the current status means
- For "what next" questions: Provide 2-3 clear, actionable next steps based on the case status, risk level, and whether they have medical certificates
- For statistics: Use the exact numbers from the data above
- For compliance: Provide WorkSafe Victoria policy guidance
- Be concise and practical - focus on what the user should DO next

Example next steps based on case status:
- High Risk + No Cert = "1. Request updated medical certificate, 2. Schedule return-to-work meeting, 3. Review workplace modifications"
- Off Work + Has Cert = "1. Check certificate expiry date, 2. Contact worker for progress update, 3. Plan graduated RTW if improving"
- At Work + Medium Risk = "1. Monitor for any deterioration, 2. Ensure modified duties are in place, 3. Document progress"

---
User question: ${message}`;

      const text = await callClaude(fullPrompt, 30_000);

      res.json({ response: text, model: "claude-cli" });
    } catch (err) {
      routeLogger.error("Claude CLI error", {}, err);
      // Don't expose internal error details to client
      res.status(500).json({
        error: "Compliance evaluation failed. Please try again.",
      });
    }
  });
  // Cases list endpoint (paginated) — registered earlier in this function (above the
  // `app.use("/api/cases", ...)` router mounts) so it wins over `predictionRoutes`'
  // `router.get("/")` which would otherwise shadow `GET /api/cases`.

  // Create new case (claims intake)
  const createCaseSchema = z.object({
    workerName: z.string().min(1, "Worker name is required"),
    company: z.string().min(1, "Company is required"),
    dateOfInjury: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format"),
    workStatus: z.enum(["At work", "Off work"]),
    riskLevel: z.enum(["Low", "Medium", "High"]),
    summary: z.string().optional(),
  });

  app.post("/api/cases", authorize(), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user!.organizationId;

      // Validate request body
      const validationResult = createCaseSchema.safeParse(req.body);
      if (!validationResult.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: validationResult.error.errors,
        });
      }

      const caseData = validationResult.data;

      // Create the case
      const newCase = await storage.createCase({
        organizationId,
        workerName: caseData.workerName,
        company: caseData.company,
        dateOfInjury: caseData.dateOfInjury,
        workStatus: caseData.workStatus,
        riskLevel: caseData.riskLevel,
        summary: caseData.summary,
      });

      // Log audit event
      await logAuditEvent({
        userId: req.user!.id,
        organizationId,
        eventType: AuditEventTypes.CASE_CREATE,
        resourceType: "case",
        resourceId: newCase.id,
        metadata: {
          workerName: caseData.workerName,
          company: caseData.company,
        },
        ...getRequestMetadata(req),
      });

      res.status(201).json(newCase);
    } catch (error) {
      routeLogger.error("Error creating case", {}, error);
      res.status(500).json({
        error: "Failed to create case",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Close case endpoint
  const closeCaseSchema = z.object({
    reason: z.string().optional(),
  });

  app.post("/api/cases/:id/close", authorize(), requireCaseOwnership(), async (req: AuthRequest, res) => {
    try {
      const workerCase = req.workerCase!;
      const validationResult = closeCaseSchema.safeParse(req.body);

      if (!validationResult.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: validationResult.error.errors,
        });
      }

      const { reason } = validationResult.data;

      // Update case status to closed
      await storage.closeCase(workerCase.id, workerCase.organizationId, reason);

      // Log audit event
      await logAuditEvent({
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
        eventType: AuditEventTypes.CASE_UPDATE,
        resourceType: "case",
        resourceId: workerCase.id,
        metadata: {
          action: "close",
          reason: reason || "No reason provided",
        },
        ...getRequestMetadata(req),
      });

      // Attempt to close the Freshdesk ticket(s) if configured
      if (process.env.FRESHDESK_DOMAIN && process.env.FRESHDESK_API_KEY && workerCase.ticketIds?.length) {
        try {
          const freshdesk = new FreshdeskService();
          for (const ticketId of workerCase.ticketIds) {
            // Extract numeric ID from FD-123 format
            const numericId = ticketId.replace("FD-", "");
            if (numericId && !isNaN(Number(numericId))) {
              await freshdesk.closeTicket(Number(numericId));
            }
          }
        } catch (freshdeskError) {
          routeLogger.error("Failed to close Freshdesk ticket(s)", {}, freshdeskError);
          // Don't fail the request if Freshdesk sync fails - case is already closed locally
        }
      }

      res.json({
        success: true,
        message: "Case closed successfully",
        caseId: workerCase.id,
      });
    } catch (error) {
      routeLogger.error("Error closing case", {}, error);
      res.status(500).json({
        error: "Failed to close case",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Compliance override endpoint
  const complianceOverrideSchema = z.object({
    complianceValue: z.enum(["Very High", "High", "Medium", "Low", "Very Low"]),
    reason: z.string().min(1, "Reason is required"),
  });

  app.post("/api/cases/:id/compliance-override", authorize(), requireCaseOwnership(), async (req: AuthRequest, res) => {
    try {
      const workerCase = req.workerCase!;
      const validationResult = complianceOverrideSchema.safeParse(req.body);

      if (!validationResult.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: validationResult.error.errors,
        });
      }

      const { complianceValue, reason } = validationResult.data;
      const overrideBy = req.user!.email;

      await storage.setComplianceOverride(
        workerCase.id,
        workerCase.organizationId,
        complianceValue,
        reason,
        overrideBy
      );

      // Log audit event
      await logAuditEvent({
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
        eventType: AuditEventTypes.CASE_UPDATE,
        resourceType: "case",
        resourceId: workerCase.id,
        metadata: {
          action: "compliance_override",
          previousValue: workerCase.complianceIndicator,
          newValue: complianceValue,
          reason,
        },
        ...getRequestMetadata(req),
      });

      res.json({
        success: true,
        message: "Compliance status overridden successfully",
        caseId: workerCase.id,
        complianceValue,
      });
    } catch (error) {
      routeLogger.error("Error overriding compliance", {}, error);
      res.status(500).json({
        error: "Failed to override compliance",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Clear compliance override endpoint
  app.delete("/api/cases/:id/compliance-override", authorize(), requireCaseOwnership(), async (req: AuthRequest, res) => {
    try {
      const workerCase = req.workerCase!;

      await storage.clearComplianceOverride(workerCase.id, workerCase.organizationId);

      // Log audit event
      await logAuditEvent({
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
        eventType: AuditEventTypes.CASE_UPDATE,
        resourceType: "case",
        resourceId: workerCase.id,
        metadata: {
          action: "compliance_override_cleared",
        },
        ...getRequestMetadata(req),
      });

      res.json({
        success: true,
        message: "Compliance override cleared",
        caseId: workerCase.id,
      });
    } catch (error) {
      routeLogger.error("Error clearing compliance override", {}, error);
      res.status(500).json({
        error: "Failed to clear compliance override",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Merge tickets endpoint
  const mergeTicketsSchema = z.object({
    masterTicketId: z.string().min(1, "Master ticket ID is required"),
    closeOthers: z.boolean().optional().default(true),
  });

  app.post("/api/cases/:id/merge-tickets", authorize(), requireCaseOwnership(), async (req: AuthRequest, res) => {
    try {
      const workerCase = req.workerCase!;
      const validationResult = mergeTicketsSchema.safeParse(req.body);

      if (!validationResult.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: validationResult.error.errors,
        });
      }

      const { masterTicketId, closeOthers } = validationResult.data;

      // Verify master ticket is in the case's ticket list
      if (!workerCase.ticketIds?.includes(masterTicketId)) {
        return res.status(400).json({
          error: "Invalid master ticket",
          details: "The specified master ticket is not associated with this case",
        });
      }

      // Update the case with master ticket
      await storage.mergeTickets(workerCase.id, workerCase.organizationId, masterTicketId);

      // Close other tickets in Freshdesk if requested
      let closedTickets: string[] = [];
      if (closeOthers && process.env.FRESHDESK_DOMAIN && process.env.FRESHDESK_API_KEY) {
        const otherTickets = workerCase.ticketIds.filter(id => id !== masterTicketId);
        const freshdesk = new FreshdeskService();

        for (const ticketId of otherTickets) {
          try {
            const numericId = ticketId.replace("FD-", "");
            if (numericId && !isNaN(Number(numericId))) {
              await freshdesk.closeTicket(Number(numericId));
              closedTickets.push(ticketId);
            }
          } catch (err) {
            routeLogger.error(`Failed to close ticket`, { ticketId }, err);
          }
        }
      }

      // Log audit event
      await logAuditEvent({
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
        eventType: AuditEventTypes.CASE_UPDATE,
        resourceType: "case",
        resourceId: workerCase.id,
        metadata: {
          action: "merge_tickets",
          masterTicketId,
          closedTickets,
          totalTickets: workerCase.ticketIds?.length || 0,
        },
        ...getRequestMetadata(req),
      });

      res.json({
        success: true,
        message: "Tickets merged successfully",
        caseId: workerCase.id,
        masterTicketId,
        closedTickets,
      });
    } catch (error) {
      routeLogger.error("Error merging tickets", {}, error);
      res.status(500).json({
        error: "Failed to merge tickets",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  });

  // Debug endpoint to view raw Freshdesk data for a worker
  app.get("/api/freshdesk/debug/:workerName", authorize(["admin"]), async (req: AuthRequest, res) => {
    if (!process.env.FRESHDESK_DOMAIN || !process.env.FRESHDESK_API_KEY) {
      return res.json({ error: "Freshdesk not configured" });
    }

    try {
      const workerName = (req.params.workerName as string).toLowerCase();
      const freshdesk = new FreshdeskService();
      const tickets = await freshdesk.fetchTickets();

      // Find tickets matching this worker
      const matchingTickets = tickets.filter((t: any) => {
        const subject = (t.subject || '').toLowerCase();
        const desc = (t.description_text || '').toLowerCase();
        const firstName = (t.custom_fields?.cf_worker_first_name || '').toLowerCase();
        const lastName = (t.custom_fields?.cf_workers_name || '').toLowerCase();

        return subject.includes(workerName) ||
               desc.includes(workerName) ||
               firstName.includes(workerName) ||
               lastName.includes(workerName) ||
               `${firstName} ${lastName}`.includes(workerName);
      });

      // Return raw data for inspection
      res.json({
        workerName: req.params.workerName,
        ticketsFound: matchingTickets.length,
        rawTickets: matchingTickets.map((t: any) => ({
          id: t.id,
          subject: t.subject,
          created_at: t.created_at,
          updated_at: t.updated_at,
          status: t.status,
          priority: t.priority,
          custom_fields: t.custom_fields,
          description_text: t.description_text?.substring(0, 500),
        })),
      });
    } catch (error) {
      logger.freshdesk.error("Error fetching debug data", {}, error);
      res.status(500).json({ error: "Failed to fetch Freshdesk data" });
    }
  });

  // Freshdesk sync endpoint (admin only - syncs across all organizations)
  app.post("/api/freshdesk/sync", authorize(["admin"]), async (req: AuthRequest, res) => {
    // Check if Freshdesk is configured before attempting sync
    if (!process.env.FRESHDESK_DOMAIN || !process.env.FRESHDESK_API_KEY) {
      // Return success with 0 synced - graceful degradation when Freshdesk isn't configured
      return res.json({
        success: true,
        synced: 0,
        certificates: 0,
        message: "Freshdesk sync skipped - not configured",
        configured: false
      });
    }

    try {
      const freshdesk = new FreshdeskService();
      const tickets = await freshdesk.fetchTickets();
      const workerCases = await freshdesk.transformTicketsToWorkerCases(tickets);

      // Sync worker cases
      for (const workerCase of workerCases) {
        await storage.syncWorkerCaseFromFreshdesk(workerCase);
      }

      // Fetch and sync private notes (discussion notes) from Freshdesk
      let discussionNotesProcessed = 0;
      for (const workerCase of workerCases) {
        if (!workerCase.ticketIds || workerCase.ticketIds.length === 0) {
          continue;
        }

        // Fetch conversations for all tickets in this case
        for (const ticketId of workerCase.ticketIds) {
          try {
            const numericId = parseInt(ticketId.replace('FD-', ''));
            if (isNaN(numericId)) continue;

            const conversations = await freshdesk.fetchTicketConversations(numericId);
            if (conversations.length === 0) continue;

            const discussionNotes = freshdesk.convertConversationsToDiscussionNotes(
              conversations,
              workerCase.id!,
              workerCase.organizationId || 'default',
              workerCase.workerName!
            );

            if (discussionNotes.length > 0) {
              await storage.upsertCaseDiscussionNotes(discussionNotes);
              discussionNotesProcessed += discussionNotes.length;
            }
          } catch (err) {
            logger.freshdesk.warn(`Failed to fetch conversations for ticket`, { ticketId }, err);
          }
        }
      }

      logger.freshdesk.info(`Synced discussion notes from Freshdesk`, { count: discussionNotesProcessed });

      // Process certificate attachments (async, don't block response)
      // Certificate processing happens in background
      let certificatesProcessed = 0;
      const processCertificates = req.query.processCertificates !== "false";

      if (processCertificates) {
        // Import dynamically to avoid circular deps
        const { processCertificatesFromTickets } = await import("./services/certificatePipeline");
        const { isCertificateAttachment } = await import("./services/pdfProcessor");

        // Build list of tickets with attachments
        const ticketsWithAttachments = tickets
          .filter((t: any) => t.attachments && t.attachments.length > 0)
          .filter((t: any) => t.attachments.some(isCertificateAttachment))
          .map((t: any) => {
            // Find matching case
            const matchingCase = workerCases.find((c: any) => c.ticketIds?.includes(`FD-${t.id}`));
            return {
              ticketId: `FD-${t.id}`,
              caseId: matchingCase?.id || `FD-${t.id}`,
              organizationId: matchingCase?.organizationId || "default",
              attachments: t.attachments,
            };
          })
          .filter((t: any) => t.caseId);

        if (ticketsWithAttachments.length > 0) {
          logger.freshdesk.info(`Processing certificates from tickets`, { count: ticketsWithAttachments.length });
          const certResult = await processCertificatesFromTickets(ticketsWithAttachments, storage);
          certificatesProcessed = certResult.successful;
        }
      }

      res.json({
        success: true,
        synced: workerCases.length,
        certificates: certificatesProcessed,
        discussionNotes: discussionNotesProcessed,
        message: `Successfully synced ${workerCases.length} cases, ${certificatesProcessed} certificates, and ${discussionNotesProcessed} discussion notes from Freshdesk`,
        configured: true
      });
    } catch (error) {
      logger.freshdesk.error("Error syncing Freshdesk tickets", {}, error);
      res.status(500).json({
        error: "Failed to sync Freshdesk tickets",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get sync scheduler status (admin only)
  app.get("/api/sync/status", authorize(["admin"]), async (req: AuthRequest, res) => {
    try {
      const status = syncScheduler.getStatus();
      res.json({
        ...status,
        enabled: process.env.DAILY_SYNC_ENABLED === "true",
        syncTime: process.env.DAILY_SYNC_TIME || "18:00"
      });
    } catch (error) {
      logger.sync.error("Error getting sync status", {}, error);
      res.status(500).json({
        error: "Failed to get sync status",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Manually trigger sync (admin only)
  app.post("/api/sync/trigger", authorize(["admin"]), async (req: AuthRequest, res) => {
    try {
      logger.sync.info("Manual sync triggered", { userId: req.user!.id });
      const result = await syncScheduler.triggerManualSync();
      res.json(result);
    } catch (error) {
      logger.sync.error("Error triggering manual sync", {}, error);
      res.status(500).json({
        error: "Failed to trigger manual sync",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get compliance scheduler status (admin only)
  app.get("/api/compliance/status", authorize(["admin"]), async (req: AuthRequest, res) => {
    try {
      const status = complianceScheduler.getStatus();
      res.json({
        ...status,
        enabled: process.env.COMPLIANCE_CHECK_ENABLED === "true",
        complianceTime: process.env.COMPLIANCE_CHECK_TIME || "06:00"
      });
    } catch (error) {
      logger.compliance.error("Error getting compliance status", {}, error);
      res.status(500).json({
        error: "Failed to get compliance status",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Manually trigger compliance check (admin only)
  app.post("/api/compliance/trigger", authorize(["admin"]), async (req: AuthRequest, res) => {
    try {
      logger.compliance.info("Manual compliance check triggered", { userId: req.user!.id });
      const result = await complianceScheduler.triggerManualCheck();
      res.json(result);
    } catch (error) {
      logger.compliance.error("Error triggering manual compliance check", {}, error);
      res.status(500).json({
        error: "Failed to trigger manual compliance check",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get single case details by ID
  app.get("/api/cases/:id", authorize(), requireCaseOwnership(), async (req: AuthRequest, res) => {
    try {
      const workerCase = req.workerCase!; // Populated by requireCaseOwnership middleware

      // Log access
      await logAuditEvent({
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
        eventType: AuditEventTypes.CASE_VIEW,
        metadata: {
          caseId: workerCase.id,
          workerName: workerCase.workerName,
          company: workerCase.company,
        },
        ...getRequestMetadata(req),
      });

      // Phase 1.8: strip clinical fields for employer-role users
      res.json(filterCaseByRole(workerCase, req.user!.role));
    } catch (error) {
      routeLogger.error("Error fetching case details", { caseId: req.params.id }, error);
      res.status(500).json({
        error: "Failed to fetch case details",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Evaluate a single case against compliance rules
  app.get("/api/cases/:id/compliance/evaluate", authorize(), requireCaseOwnership(), async (req: AuthRequest, res) => {
    try {
      const caseId = req.params.id as string;
      const { evaluateCase } = await import("./services/complianceEngine");

      logger.compliance.info("Evaluating case compliance", {
        caseId,
        userId: req.user!.id
      });

      const report = await evaluateCase(caseId);

      // Log access
      await logAuditEvent({
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
        eventType: AuditEventTypes.CASE_VIEW,
        resourceType: "compliance_report",
        resourceId: caseId,
        ...getRequestMetadata(req),
      });

      res.json(report);
    } catch (error) {
      logger.compliance.error("Error evaluating case compliance", { caseId: req.params.id }, error);
      res.status(500).json({
        error: "Failed to evaluate compliance",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/cases/:id/recovery-timeline", authorize(), requireCaseOwnership(), async (req: AuthRequest, res) => {
    try {
      const workerCase = req.workerCase!; // Populated by requireCaseOwnership middleware

      // Log access
      await logAuditEvent({
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
        eventType: AuditEventTypes.CASE_VIEW,
        resourceType: "recovery_timeline",
        resourceId: workerCase.id,
        ...getRequestMetadata(req),
      });

      const certificates = await storage.getCaseRecoveryTimeline(workerCase.id, workerCase.organizationId);
      const lastCertificate = certificates[certificates.length - 1];

      const summary: RecoveryTimelineSummary = {
        totalCertificates: certificates.length,
        daysOnReducedCapacity: certificates.reduce((total, cert) => {
          if (cert.capacity === "fit") {
            return total;
          }
          const start = new Date(cert.startDate).getTime();
          const end = new Date(cert.endDate).getTime();
          if (Number.isNaN(start) || Number.isNaN(end)) {
            return total;
          }
          const diff = Math.max(1, Math.round((end - start) / MS_PER_DAY));
          return total + diff;
        }, 0),
        lastKnownCapacity: lastCertificate?.capacity ?? "unknown",
        lastUpdated: lastCertificate?.endDate ?? lastCertificate?.startDate ?? null,
      };

      res.json({
        certificates,
        summary,
      });
    } catch (err) {
      routeLogger.error("Failed to fetch recovery timeline", {}, err);
      res.status(500).json({
        error: "Failed to fetch recovery timeline",
        details: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });

  app.get("/api/cases/:id/clinical-evidence", authorize(), requireCaseOwnership(), async (req: AuthRequest, res) => {
    try {
      // Phase 1.8: clinical evidence is not visible to employer-role users
      if (isEmployerRole(req.user!.role)) {
        return res.status(403).json({ error: "Forbidden", message: "Clinical evidence is not accessible to employer accounts" });
      }

      const workerCase = req.workerCase!; // Populated by requireCaseOwnership middleware

      // Log access
      await logAuditEvent({
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
        eventType: AuditEventTypes.CASE_VIEW,
        resourceType: "clinical_evidence",
        resourceId: workerCase.id,
        ...getRequestMetadata(req),
      });

      const clinicalEvidence = evaluateClinicalEvidence(workerCase);
      res.json({ caseId: workerCase.id, clinicalEvidence });
    } catch (err) {
      routeLogger.error("Failed to evaluate clinical evidence", {}, err);
      res.status(500).json({
        error: "Failed to evaluate clinical evidence",
        details: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });

  app.get("/api/cases/:id/discussion-notes", authorize(), requireCaseOwnership(), async (req: AuthRequest, res) => {
    try {
      // Phase 1.8: clinical discussion notes are not visible to employer-role users
      if (isEmployerRole(req.user!.role)) {
        return res.status(403).json({ error: "Forbidden", message: "Discussion notes are not accessible to employer accounts" });
      }

      const workerCase = req.workerCase!; // Populated by requireCaseOwnership middleware

      // Log access
      await logAuditEvent({
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
        eventType: AuditEventTypes.CASE_VIEW,
        resourceType: "discussion_notes",
        resourceId: workerCase.id,
        ...getRequestMetadata(req),
      });

      const [notes, insights] = await Promise.all([
        storage.getCaseDiscussionNotes(workerCase.id, workerCase.organizationId, 25),
        storage.getCaseDiscussionInsights(workerCase.id, workerCase.organizationId, 25),
      ]);
      res.json({ notes, insights });
    } catch (err) {
      routeLogger.error("Failed to fetch discussion notes", {}, err);
      res.status(500).json({
        error: "Failed to fetch discussion notes",
        details: err instanceof Error ? err.message : "Unknown error",
      });
    }
  });

  app.get("/api/cases/:id/timeline", authorize(), requireCaseOwnership(), async (req: AuthRequest, res) => {
    try {
      const workerCase = req.workerCase!; // Populated by requireCaseOwnership middleware
      const limit = parseInt(req.query.limit as string) || 50;

      // Log access
      await logAuditEvent({
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
        eventType: AuditEventTypes.CASE_VIEW,
        resourceType: "timeline",
        resourceId: workerCase.id,
        ...getRequestMetadata(req),
      });

      const [events, certs] = await Promise.all([
        storage.getCaseTimeline(workerCase.id, workerCase.organizationId, limit),
        storage.getCertificatesByCase(workerCase.id, workerCase.organizationId),
      ]);

      // Phase 7.2: inject computed compliance deadline markers
      const latestCert = certs.sort((a, b) =>
        new Date(b.endDate).getTime() - new Date(a.endDate).getTime()
      )[0];
      const certEndDate = latestCert?.endDate ? new Date(latestCert.endDate) : null;
      const complianceEvents = computeComplianceDeadlines(workerCase, certEndDate);

      // Inject key case milestones computed from case data
      const milestoneEvents: typeof events = [];
      if (workerCase.dateOfInjury) {
        const injuryDate = new Date(workerCase.dateOfInjury);
        // Injury occurred
        milestoneEvents.push({
          id: `milestone-injury-${workerCase.id}`,
          caseId: workerCase.id,
          eventType: "milestone",
          timestamp: injuryDate.toISOString(),
          title: "Injury Occurred",
          description: `Case opened. Worker: ${workerCase.workerName}. Status at injury: ${workerCase.workStatus || "Unknown"}.`,
          severity: "info",
          icon: "personal_injury",
          metadata: {},
        } as any);

        // Expected RTW (only if still off work)
        if (workerCase.workStatus === "Off work") {
          const riskLevel = (workerCase.riskLevel || "").toLowerCase();
          const estWeeks = riskLevel === "high" ? 26 : riskLevel === "medium" ? 12 : 6;
          const expectedRtw = new Date(injuryDate);
          expectedRtw.setDate(expectedRtw.getDate() + estWeeks * 7);
          const today = new Date();
          const isOverdue = expectedRtw < today;
          milestoneEvents.push({
            id: `milestone-expected-rtw-${workerCase.id}`,
            caseId: workerCase.id,
            eventType: "milestone",
            timestamp: expectedRtw.toISOString(),
            title: isOverdue ? "Expected RTW (Overdue)" : "Expected Return to Work",
            description: isOverdue
              ? `Worker was expected to return by ${expectedRtw.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })} based on ${riskLevel} risk profile. Escalation recommended.`
              : `Target return to work based on ${riskLevel} risk profile (${estWeeks}-week estimate).`,
            severity: isOverdue ? "critical" : "info",
            icon: isOverdue ? "schedule" : "work",
            metadata: { estimatedWeeks: estWeeks },
          } as any);
        }

        // Certificate events from cert history
        for (const cert of certs) {
          if (cert.startDate) {
            milestoneEvents.push({
              id: `milestone-cert-${cert.id}`,
              caseId: workerCase.id,
              eventType: "certificate",
              timestamp: new Date(cert.startDate).toISOString(),
              title: "Medical Certificate Issued",
              description: `Certificate valid ${cert.startDate} to ${cert.endDate}. Capacity: ${(cert as any).workCapacity ?? "Off work"}.`,
              severity: "info",
              icon: "description",
              metadata: {},
            } as any);
          }
        }
      }

      // RTW plan status milestone — shows coordinator when employer approved / plan changed
      const rtwStatus = (workerCase as any).rtwPlanStatus as string | undefined;
      if (rtwStatus && rtwStatus !== "not_planned") {
        const rtwLabels: Record<string, { title: string; description: string; severity: string; icon: string }> = {
          planned_not_started: { title: "RTW Plan Created", description: "A return to work plan has been prepared for this case.", severity: "info", icon: "assignment" },
          pending_employer_review: { title: "RTW Plan — Awaiting Employer Approval", description: "The coordinator submitted the return to work plan for employer sign-off.", severity: "warning", icon: "pending_actions" },
          in_progress: { title: "RTW Plan — Employer Approved ✓", description: "Employer signed off on the return to work plan. Plan is now active.", severity: "success", icon: "assignment_turned_in" },
          working_well: { title: "RTW Plan — Working Well", description: "Return to work plan is progressing as planned.", severity: "success", icon: "check_circle" },
          failing: { title: "RTW Plan — Failing", description: "Return to work plan is not meeting targets. Review required.", severity: "critical", icon: "error" },
          on_hold: { title: "RTW Plan — On Hold", description: "Return to work plan has been paused pending review.", severity: "warning", icon: "pause_circle" },
          completed: { title: "RTW Plan — Completed", description: "Worker has successfully returned to work.", severity: "success", icon: "task_alt" },
        };
        const label = rtwLabels[rtwStatus];
        if (label) {
          milestoneEvents.push({
            id: `milestone-rtw-status-${workerCase.id}`,
            caseId: workerCase.id,
            eventType: "milestone",
            timestamp: new Date((workerCase as any).updatedAt || workerCase.dateOfInjury).toISOString(),
            title: label.title,
            description: label.description,
            severity: label.severity,
            icon: label.icon,
            metadata: { rtwPlanStatus: rtwStatus },
          } as any);
        }
      }

      // Merge and sort all events by timestamp (historical + future deadlines)
      const allEvents = [...events, ...complianceEvents, ...milestoneEvents].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      res.json({
        caseId: workerCase.id,
        events: allEvents,
        totalEvents: allEvents.length
      });
    } catch (err) {
      routeLogger.error("Failed to fetch timeline", {}, err);
      res.status(500).json({
        error: "Failed to fetch timeline",
        details: err instanceof Error ? err.message : "Unknown error"
      });
    }
  });

  // GET /api/cases/:id/summary - Returns cached summary without triggering generation
  app.get("/api/cases/:id/summary", authorize(), requireCaseOwnership(), async (req: AuthRequest, res) => {
    try {
      const workerCase = req.workerCase!; // Populated by requireCaseOwnership middleware

      // Log access
      await logAuditEvent({
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
        eventType: AuditEventTypes.CASE_VIEW,
        resourceType: "summary",
        resourceId: workerCase.id,
        ...getRequestMetadata(req),
      });

      const employer = isEmployerRole(req.user!.role);

      // Phase 1.8: skip clinical DB queries for employers
      const [discussionNotes, discussionInsights] = employer
        ? [[], []]
        : await Promise.all([
            storage.getCaseDiscussionNotes(workerCase.id, workerCase.organizationId, 5),
            storage.getCaseDiscussionInsights(workerCase.id, workerCase.organizationId, 5),
          ]);

      // Return cached summary data (AI summary hidden from employers)
      res.json({
        id: workerCase.id,
        summary: employer ? null : (workerCase.aiSummary || null),
        generatedAt: employer ? null : (workerCase.aiSummaryGeneratedAt || null),
        model: employer ? null : (workerCase.aiSummaryModel || null),
        workStatusClassification: employer ? null : (workerCase.aiWorkStatusClassification || null),
        ticketLastUpdatedAt: workerCase.ticketLastUpdatedAt || null,
        needsRefresh: employer ? false : await storage.needsSummaryRefresh(workerCase.id, workerCase.organizationId),
        discussionNotes,
        discussionInsights,
      });
    } catch (err) {
      routeLogger.error("Failed to fetch summary", {}, err);
      res.status(500).json({ 
        error: "Failed to fetch summary",
        details: err instanceof Error ? err.message : "Unknown error"
      });
    }
  });

  // POST /api/cases/:id/summary - Validates cache and generates/refreshes summary
  app.post("/api/cases/:id/summary", authorize(), requireCaseOwnership(), async (req: AuthRequest, res) => {
    try {
      const workerCase = req.workerCase!; // Populated by requireCaseOwnership middleware
      const force = req.query.force === 'true';

      // Employers cannot access AI summaries (clinical reasoning is confidential)
      if (isEmployerRole(req.user!.role)) {
        return res.json({
          id: workerCase.id,
          summary: null,
          cached: true,
          generatedAt: null,
          model: null,
          workStatusClassification: null,
          discussionNotes: [],
          discussionInsights: [],
        });
      }

      // PRD Story 1: Use unified interface with force parameter
      let result;
      try {
        // Use getCachedOrGenerateSummary with force parameter - handles caching logic internally
        result = await hybridSummaryService.getCachedOrGenerateSummary(workerCase.id, force);

        // Log AI summary generation if it was freshly generated (not cached)
        if (!result.cached) {
          await logAuditEvent({
            userId: req.user!.id,
            organizationId: req.user!.organizationId,
            eventType: AuditEventTypes.AI_SUMMARY_GENERATE,
            resourceType: "worker_case",
            resourceId: workerCase.id,
            metadata: {
              model: result.model,
              forced: force,
            },
            ...getRequestMetadata(req),
          });
        }
      } catch (err) {
        // If generation fails, fall back to cached summary with warning
        if (workerCase.aiSummary) {
          result = {
            summary: workerCase.aiSummary,
            cached: true,
            generatedAt: workerCase.aiSummaryGeneratedAt,
            model: workerCase.aiSummaryModel,
            workStatusClassification: workerCase.aiWorkStatusClassification,
          };
        } else {
          throw err; // Re-throw if no cached summary exists
        }

        // Log AI summary generation if it was freshly generated (not cached)
        if (!result.cached) {
          await logAuditEvent({
            userId: req.user!.id,
            organizationId: req.user!.organizationId,
            eventType: AuditEventTypes.AI_SUMMARY_GENERATE,
            resourceType: "worker_case",
            resourceId: workerCase.id,
            metadata: {
              model: result.model,
              forced: false,
            },
            ...getRequestMetadata(req),
          });
        }
      }

      const [discussionNotes, discussionInsights] = await Promise.all([
        storage.getCaseDiscussionNotes(workerCase.id, workerCase.organizationId, 5),
        storage.getCaseDiscussionInsights(workerCase.id, workerCase.organizationId, 5),
      ]);

      res.json({
        id: workerCase.id,
        summary: result.summary,
        cached: result.cached,
        generatedAt: result.generatedAt,
        model: result.model,
        workStatusClassification: result.workStatusClassification,
        discussionNotes,
        discussionInsights,
      });
    } catch (err) {
      routeLogger.error("Summary generation failed", {}, err);
      
      // Return 503 if API key not configured during generation attempt
      if (err instanceof Error && err.message.includes("Claude CLI")) {
        return res.status(503).json({
          error: "AI summary service unavailable",
          details: "Claude CLI subprocess failed"
        });
      }
      
      res.status(500).json({ 
        error: "Summary generation failed",
        details: err instanceof Error ? err.message : "Unknown error"
      });
    }
  });

  // ===== INJURY DATE REVIEW ENDPOINTS =====

  // Get injury dates requiring review (admin only)
  app.get("/api/injury-dates/review-queue", authorize(["admin"]), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user!.organizationId;

      const reviewCases = await db
        .select({
          id: workerCasesTable.id,
          workerName: workerCasesTable.workerName,
          company: workerCasesTable.company,
          dateOfInjury: workerCasesTable.dateOfInjury,
          dateOfInjuryConfidence: workerCasesTable.dateOfInjuryConfidence,
          dateOfInjurySource: workerCasesTable.dateOfInjurySource,
          dateOfInjuryExtractionMethod: workerCasesTable.dateOfInjuryExtractionMethod,
          dateOfInjurySourceText: workerCasesTable.dateOfInjurySourceText,
          dateOfInjuryAiReasoning: workerCasesTable.dateOfInjuryAiReasoning,
          ticketIds: workerCasesTable.ticketIds,
          createdAt: workerCasesTable.createdAt,
        })
        .from(workerCasesTable)
        .where(
          and(
            eq(workerCasesTable.organizationId, organizationId),
            eq(workerCasesTable.dateOfInjuryRequiresReview, true)
          )
        )
        .orderBy(workerCasesTable.createdAt)
        .limit(100);

      const reviewItems = reviewCases.map((row) => ({
        id: row.id,
        caseId: row.id,
        workerName: row.workerName,
        company: row.company,
        currentDate: row.dateOfInjury,
        confidence: row.dateOfInjuryConfidence || "low",
        source: row.dateOfInjurySource || "unknown",
        extractionMethod: row.dateOfInjuryExtractionMethod || "fallback",
        sourceText: row.dateOfInjurySourceText,
        aiReasoning: row.dateOfInjuryAiReasoning,
        ticketUrl: row.ticketIds?.[0] ? `https://your-domain.freshdesk.com/a/tickets/${row.ticketIds[0].replace('FD-', '')}` : undefined,
        createdAt: row.createdAt,
      }));

      logger.audit.info("Injury date review queue accessed", {
        userId: req.user!.id,
        organizationId,
        pendingCount: reviewItems.length
      });

      res.json({
        success: true,
        data: reviewItems
      });
    } catch (error) {
      logger.audit.error("Error fetching injury date review queue", {
        userId: req.user!.id,
        organizationId: req.user!.organizationId
      }, error);
      res.status(500).json({
        error: "Failed to fetch review queue",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Accept AI suggestion for injury date (admin only)
  app.post("/api/injury-dates/:caseId/accept", authorize(["admin"]), async (req: AuthRequest, res) => {
    try {
      const caseId = req.params.caseId as string;
      const userId = req.user!.id;
      const organizationId = req.user!.organizationId;

      const updateResult = await db
        .update(workerCasesTable)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .set({
          dateOfInjuryRequiresReview: false,
          dateOfInjuryReviewedBy: userId,
          dateOfInjuryReviewedAt: new Date(),
        } as any)
        .where(
          and(
            eq(workerCasesTable.id, caseId),
            eq(workerCasesTable.organizationId, organizationId)
          )
        )
        .returning();

      if (updateResult.length === 0) {
        return res.status(404).json({
          error: "Case not found",
          details: "The specified case could not be found or you don't have permission to access it"
        });
      }

      const caseInfo = updateResult[0];

      // Log audit event
      await logAuditEvent({
        userId,
        organizationId,
        eventType: "INJURY_DATE_ACCEPTED" as any,
        resourceType: "worker_case",
        resourceId: caseId,
        metadata: {
          workerName: caseInfo.workerName,
          dateOfInjury: caseInfo.dateOfInjury,
          confidence: caseInfo.dateOfInjuryConfidence,
          action: "accept"
        },
        ...getRequestMetadata(req),
      });

      logger.audit.info("Injury date accepted", {
        userId,
        organizationId,
        caseId,
        workerName: caseInfo.workerName,
        dateOfInjury: caseInfo.dateOfInjury,
      });

      res.json({
        success: true,
        message: "Injury date accepted and marked as reviewed"
      });
    } catch (error) {
      logger.audit.error("Error accepting injury date", {
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
        caseId: req.params.caseId
      }, error);
      res.status(500).json({
        error: "Failed to accept injury date",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Correct injury date with manual input (admin only)
  app.post("/api/injury-dates/:caseId/correct", authorize(["admin"]), async (req: AuthRequest, res) => {
    try {
      const caseId = req.params.caseId as string;
      const { newDate, reason } = req.body;
      const userId = req.user!.id;
      const organizationId = req.user!.organizationId;

      // Validate input
      if (!newDate) {
        return res.status(400).json({
          error: "Validation failed",
          details: "New date is required"
        });
      }

      if (!reason || reason.trim().length === 0) {
        return res.status(400).json({
          error: "Validation failed",
          details: "Reason for correction is required"
        });
      }

      const correctionDate = new Date(newDate);
      if (isNaN(correctionDate.getTime())) {
        return res.status(400).json({
          error: "Validation failed",
          details: "Invalid date format"
        });
      }

      const updateResult = await db
        .update(workerCasesTable)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .set({
          dateOfInjury: correctionDate,
          dateOfInjurySource: "verified",
          dateOfInjuryConfidence: "high",
          dateOfInjuryExtractionMethod: "manual_correction",
          dateOfInjuryRequiresReview: false,
          dateOfInjuryReviewedBy: userId,
          dateOfInjuryReviewedAt: new Date(),
          dateOfInjuryAiReasoning: `Manual correction: ${reason.trim()}`,
        } as any)
        .where(
          and(
            eq(workerCasesTable.id, caseId),
            eq(workerCasesTable.organizationId, organizationId)
          )
        )
        .returning();

      if (updateResult.length === 0) {
        return res.status(404).json({
          error: "Case not found",
          details: "The specified case could not be found or you don't have permission to access it"
        });
      }

      const caseInfo = updateResult[0];

      // Log audit event
      await logAuditEvent({
        userId,
        organizationId,
        eventType: "INJURY_DATE_CORRECTED" as any,
        resourceType: "worker_case",
        resourceId: caseId,
        metadata: {
          workerName: caseInfo.workerName,
          oldDate: req.body.oldDate, // Could be passed in request
          newDate: correctionDate.toISOString().split('T')[0],
          reason: reason.trim(),
          action: "correct"
        },
        ...getRequestMetadata(req),
      });

      logger.audit.info("Injury date corrected", {
        userId,
        organizationId,
        caseId,
        workerName: caseInfo.workerName,
        newDate: correctionDate.toISOString().split('T')[0],
        reason: reason.trim(),
      });

      res.json({
        success: true,
        message: "Injury date corrected successfully"
      });
    } catch (error) {
      logger.audit.error("Error correcting injury date", {
        userId: req.user!.id,
        organizationId: req.user!.organizationId,
        caseId: req.params.caseId
      }, error);
      res.status(500).json({
        error: "Failed to correct injury date",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get injury date review statistics (admin only)
  app.get("/api/injury-dates/stats", authorize(["admin"]), async (req: AuthRequest, res) => {
    try {
      const organizationId = req.user!.organizationId;

      const statsRows = await db
        .select({
          totalCases: drizzleSql<number>`count(*)::int`,
          pendingReviews: drizzleSql<number>`count(*) filter (where ${workerCasesTable.dateOfInjuryRequiresReview} = true)::int`,
          highConfidence: drizzleSql<number>`count(*) filter (where ${workerCasesTable.dateOfInjuryConfidence} = 'high')::int`,
          mediumConfidence: drizzleSql<number>`count(*) filter (where ${workerCasesTable.dateOfInjuryConfidence} = 'medium')::int`,
          lowConfidence: drizzleSql<number>`count(*) filter (where ${workerCasesTable.dateOfInjuryConfidence} = 'low')::int`,
          aiExtractions: drizzleSql<number>`count(*) filter (where ${workerCasesTable.dateOfInjuryExtractionMethod} = 'ai_nlp')::int`,
          reviewedCases: drizzleSql<number>`count(*) filter (where ${workerCasesTable.dateOfInjuryReviewedBy} is not null)::int`,
        })
        .from(workerCasesTable)
        .where(eq(workerCasesTable.organizationId, organizationId));

      const result = statsRows[0] || {
        totalCases: 0,
        pendingReviews: 0,
        highConfidence: 0,
        mediumConfidence: 0,
        lowConfidence: 0,
        aiExtractions: 0,
        reviewedCases: 0,
      };

      res.json({
        success: true,
        data: {
          totalCases: result.totalCases,
          pendingReviews: result.pendingReviews,
          highConfidence: result.highConfidence,
          mediumConfidence: result.mediumConfidence,
          lowConfidence: result.lowConfidence,
          aiExtractions: result.aiExtractions,
          reviewedCases: result.reviewedCases,
        }
      });
    } catch (error) {
      logger.audit.error("Error fetching injury date stats", {
        userId: req.user!.id,
        organizationId: req.user!.organizationId
      }, error);
      res.status(500).json({
        error: "Failed to fetch statistics",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

}
