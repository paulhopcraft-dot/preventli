import { Response, NextFunction } from "express";
import { AuthRequest } from "./auth";
import { storage } from "../storage";
import { WorkerCase } from "@shared/schema";
import { logAuditEvent, AuditEventTypes } from "../services/auditLogger";
import { logger } from "../lib/logger";

/**
 * Middleware to verify that the authenticated user has access to the requested case.
 *
 * AUTHORIZATION RULES:
 * - Admins can access ANY case across ALL organizations (cross-tenant access)
 * - Non-admin users can ONLY access cases within their own organization
 *
 * SECURITY:
 * - Returns 404 (not 403) when case doesn't exist OR user doesn't have access
 *   This prevents information disclosure about case existence in other orgs
 * - Logs all access denials to audit_events table for security monitoring
 *
 * USAGE:
 * Must be applied AFTER authorize() middleware:
 *
 * ```typescript
 * app.get("/api/cases/:id/...",
 *   authorize(),              // ← FIRST: Verify JWT and attach user
 *   requireCaseOwnership(),   // ← SECOND: Verify case ownership
 *   handler                   // ← THIRD: Execute route handler
 * );
 * ```
 *
 * The middleware attaches `req.workerCase` for downstream handlers to use,
 * avoiding redundant database queries.
 */
export function requireCaseOwnership() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Extract case ID from route params (supports :id or :caseId)
      const caseId = (req.params.id || req.params.caseId) as string;

      if (!caseId) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Case ID required",
        });
      }

      // Verify user is authenticated (should be guaranteed by authorize() middleware)
      const user = req.user;
      if (!user) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "Authentication required",
        });
      }

      // ADMIN BYPASS: Admins can access all cases (cross-organization)
      if (user.role === "admin") {
        // For admins, fetch case without organization filter
        const workerCase = await storage.getGPNet2CaseByIdAdmin(caseId);

        if (!workerCase) {
          return res.status(404).json({
            error: "Not Found",
            message: "Case not found",
          });
        }

        // Attach case to request for downstream handlers
        req.workerCase = workerCase;
        return next();
      }

      // NON-ADMIN USERS: Must have organizationId
      const organizationId = user.organizationId;
      if (!organizationId) {
        return res.status(403).json({
          error: "Forbidden",
          message: "No organization associated with user",
        });
      }

      // Fetch case with organization filter
      // SECURITY: Returns null if case doesn't exist OR belongs to different org
      const workerCase = await storage.getGPNet2CaseById(caseId, organizationId);

      if (!workerCase) {
        // Log access denial for security monitoring and forensics
        await logAuditEvent({
          userId: user.id,
          organizationId: organizationId,
          eventType: AuditEventTypes.ACCESS_DENIED,
          resourceType: "worker_case",
          resourceId: caseId,
          metadata: {
            reason: "case_not_found_or_wrong_org",
            attemptedCaseId: caseId,
            userOrganizationId: organizationId,
          },
        });

        // SECURITY: Return 404 (NOT 403) to prevent information disclosure
        // User shouldn't know if case exists in another org
        return res.status(404).json({
          error: "Not Found",
          message: "Case not found",
        });
      }

      // SUCCESS: Case exists and user has access
      // Attach case to request for downstream handlers to use
      req.workerCase = workerCase;
      next();

    } catch (error) {
      logger.api.error("Case ownership authorization check failed", {}, error);
      return res.status(500).json({
        error: "Internal Server Error",
        message: "Authorization check failed",
      });
    }
  };
}

/**
 * Extend AuthRequest interface to include workerCase
 * This allows downstream handlers to access the validated case without re-querying
 */
declare module "./auth" {
  interface AuthRequest {
    workerCase?: WorkerCase;
  }
}
