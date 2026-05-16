import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "../db";
import { partnerUserOrganizations, users } from "@shared/schema";
import type { UserRole } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: UserRole;
        organizationId: string;
        companyId?: string | null; // Deprecated - use organizationId
      };
      // Partner-tier: the org the user is currently acting on. For non-partner
      // roles this equals user.organizationId. For partner-role users it is
      // the picked client org id when set, or null when no client is picked
      // yet (only the picker route is allowed in that state).
      activeOrganizationId?: string | null;
    }
  }
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: UserRole;
    organizationId: string;
    companyId?: string | null; // Deprecated - use organizationId
  };
  activeOrganizationId?: string | null;
}

export interface JWTPayload {
  id: string;
  email: string;
  role: UserRole;
  organizationId?: string; // For partner-role: the active client's org id when picked, else home org
  activeOrganizationId?: string | null; // Partner-tier: explicit "client picked" marker; null = not picked
  companyId?: string | null; // Deprecated - fallback for old tokens
}

const COOKIE_NAME = "preventli_auth";

export function authorize(allowedRoles?: UserRole[]) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // Try to get token from httpOnly cookie first (primary method)
      // Fall back to Authorization header for backwards compatibility
      let token: string | undefined;

      const cookieToken = req.cookies?.[COOKIE_NAME];
      if (cookieToken) {
        token = cookieToken;
      } else {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith("Bearer ")) {
          token = authHeader.substring(7);
        }
      }

      if (!token) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "No token provided"
        });
      }

      if (!process.env.JWT_SECRET) {
        logger.auth.error("JWT_SECRET is not set in environment variables");
        return res.status(500).json({
          error: "Server configuration error"
        });
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET) as JWTPayload;

      // Attach user info to request
      // Support both organizationId (new) and companyId (legacy) for backwards compatibility
      const organizationId = decoded.organizationId || decoded.companyId || "";

      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        organizationId,
        companyId: decoded.companyId, // Keep for backwards compat
      };

      // Partner-tier: resolve active organisation. For partner users, when
      // organizationId differs from users.organizationId (home org) it means
      // they've picked a client — verify the access link is still in place
      // (revocation safety). For non-partner users, active == home.
      if (decoded.role === "partner") {
        const activeOrgId = decoded.activeOrganizationId ?? null;
        if (activeOrgId) {
          // Verify the partner user still has access to this org
          const access = await db
            .select({ orgId: partnerUserOrganizations.organizationId })
            .from(partnerUserOrganizations)
            .where(
              and(
                eq(partnerUserOrganizations.userId, decoded.id),
                eq(partnerUserOrganizations.organizationId, activeOrgId)
              )
            )
            .limit(1);
          if (access.length === 0) {
            return res.status(401).json({
              error: "Unauthorized",
              message: "Access to this organisation has been revoked. Please pick a client again.",
            });
          }
          // organizationId in JWT should already equal activeOrgId, but ensure invariant
          req.user.organizationId = activeOrgId;
          req.activeOrganizationId = activeOrgId;
        } else {
          // Partner without picked client — only picker-allowlisted routes work
          req.activeOrganizationId = null;
        }
      } else {
        // Non-partner: active org always equals home org
        req.activeOrganizationId = organizationId;
      }

      // Check if user role is allowed
      if (allowedRoles && allowedRoles.length > 0) {
        if (!allowedRoles.includes(decoded.role)) {
          return res.status(403).json({
            error: "Forbidden",
            message: `Access restricted to: ${allowedRoles.join(", ")}`,
          });
        }
      }

      next();
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "Token expired",
        });
      }

      if (error instanceof jwt.JsonWebTokenError) {
        return res.status(401).json({
          error: "Unauthorized",
          message: "Invalid token",
        });
      }

      return res.status(500).json({
        error: "Server error",
        message: "Failed to authenticate token",
      });
    }
  };
}

/**
 * Guard for routes that require an active organisation (i.e. partner users
 * must have picked a client). Apply after `authorize`. 403 if no active org.
 * Non-partner users always have an active org (= their home org), so this
 * only blocks partner users who haven't gone through the picker.
 */
export function requireActiveOrganization(req: AuthRequest, res: Response, next: NextFunction) {
  if (!req.activeOrganizationId) {
    return res.status(403).json({
      error: "Forbidden",
      message: "No active organisation. Partner users must pick a client first.",
    });
  }
  next();
}
