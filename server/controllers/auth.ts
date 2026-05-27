import { Request, Response } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db } from "../db";
import { users } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { AuthRequest } from "../middleware/auth";
import { validateInvite, useInvite } from "../inviteService";
import { logger } from "../lib/logger";
import { validatePassword } from "../lib/passwordValidation";
import { logAuditEvent, AuditEventTypes, getRequestMetadata } from "../services/auditLogger";
import {
  generateRefreshToken,
  validateAndRotateRefreshToken,
  getRefreshTokenFamily,
  revokeRefreshToken,
  revokeAllUserTokens,
  getUserById,
  getUserSessions,
  revokeSession,
} from "../services/refreshTokenService";
import { sendWelcomeEmail } from "../services/emailService";

const SALT_ROUNDS = 10;
const JWT_EXPIRES_IN = "8h"; // 8 hours for development (was 15m)
const COOKIE_NAME = "preventli_auth";
const LEGACY_COOKIE_NAME = "gpnet_auth"; // Pre-rebrand; read-only fallback, cleared on logout
const COOKIE_MAX_AGE = 8 * 60 * 60 * 1000; // 8 hours in milliseconds (was 15 min)
const REFRESH_COOKIE_NAME = "preventli_refresh";
const LEGACY_REFRESH_COOKIE_NAME = "gpnet_refresh"; // Pre-rebrand; read-only fallback, cleared on logout
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

// Read refresh cookie with backward-compat fallback to the pre-rebrand name.
// Existing in-flight sessions keep working until JWT expiry; new logins get the new name.
function readRefreshCookie(req: { cookies?: Record<string, string> }): string | undefined {
  return req.cookies?.[REFRESH_COOKIE_NAME] ?? req.cookies?.[LEGACY_REFRESH_COOKIE_NAME];
}

// Helper to set auth cookie
function setAuthCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true, // Not accessible via JavaScript (XSS protection)
    secure: process.env.NODE_ENV === "production", // HTTPS only in production
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax", // CSRF protection (lax in dev for Vite proxy)
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

// Helper to clear auth cookie (both current + legacy name to drop pre-rebrand sessions cleanly)
function clearAuthCookie(res: Response): void {
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
  };
  res.clearCookie(COOKIE_NAME, opts);
  res.clearCookie(LEGACY_COOKIE_NAME, opts);
}

// Helper to set refresh token cookie
function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "strict" : "lax", // lax in dev for Vite proxy
    maxAge: REFRESH_COOKIE_MAX_AGE,
    path: "/api/auth", // Only sent to auth endpoints
  });
}

// Helper to clear refresh token cookie (both current + legacy name)
function clearRefreshCookie(res: Response): void {
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/api/auth",
  };
  res.clearCookie(REFRESH_COOKIE_NAME, opts);
  res.clearCookie(LEGACY_REFRESH_COOKIE_NAME, opts);
}

// Exported so other controllers (e.g. partner.ts) can mint tokens after the
// active organisation changes (client picker / switch client).
export function generateAccessToken(
  userId: string,
  email: string,
  role: string,
  organizationId: string,
  activeOrganizationId: string | null = null,
): string {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET not configured");
  }

  return jwt.sign(
    {
      id: userId,
      email,
      role,
      organizationId,
      activeOrganizationId,
      companyId: organizationId, // Backwards compatibility - keep companyId field
    },
    process.env.JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

// Exported so the partner-tier router can re-set the auth cookie after
// switching active organisation (POST/DELETE /api/partner/active-org).
export function setAuthCookieExternal(res: Response, token: string): void {
  setAuthCookie(res, token);
}

export async function register(req: Request, res: Response) {
  try {
    const { email, password, inviteToken } = req.body;

    // Validate required fields
    if (!email || !password || !inviteToken) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Email, password, and invite token are required",
      });
    }

    // Validate password strength
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Password does not meet security requirements",
        details: passwordValidation.errors,
      });
    }

    // Validate invite token
    const inviteValidation = await validateInvite(inviteToken);

    if (!inviteValidation.valid || !inviteValidation.invite) {
      return res.status(403).json({
        error: "Forbidden",
        message: inviteValidation.error || "Invalid invite token",
      });
    }

    const invite = inviteValidation.invite;

    // Verify email matches invite
    if (email.toLowerCase().trim() !== invite.email.toLowerCase().trim()) {
      return res.status(403).json({
        error: "Forbidden",
        message: "Email does not match the invited email address",
      });
    }

    // Check if user already exists with this email
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()))
      .limit(1);

    if (existingUser.length > 0) {
      return res.status(409).json({
        error: "Conflict",
        message: "User with this email already exists",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    // Create user with organizationId and role FROM THE INVITE
    // User cannot choose these - they come from the invite only
    const newUser = await db
      .insert(users)
      .values({
        email: invite.email,
        password: hashedPassword,
        role: invite.role, // ✅ From invite, not user input
        subrole: invite.subrole || null, // ✅ From invite, not user input
        organizationId: invite.organizationId, // ✅ From invite - tenant isolation
        companyId: invite.organizationId, // Keep for backwards compat (deprecated)
        insurerId: null,
        emailVerified: true,
        emailVerifiedAt: new Date(),
      } as any)
      .returning({
        id: users.id,
        email: users.email,
        role: users.role,
        subrole: users.subrole,
        organizationId: users.organizationId,
        companyId: users.companyId,
        insurerId: users.insurerId,
        createdAt: users.createdAt,
      });

    const user = newUser[0];

    // Mark invite as used
    await useInvite(inviteToken);

    // Send welcome email (fire-and-forget — must not block or fail registration)
    sendWelcomeEmail(user.email, user.role).catch((err) => {
      logger.email.error("Failed to send welcome email", {}, err);
    });

    // Log successful registration
    await logAuditEvent({
      userId: user.id,
      organizationId: user.organizationId,
      eventType: AuditEventTypes.USER_REGISTER,
      resourceType: "user",
      resourceId: user.id,
      metadata: {
        email: user.email,
        role: user.role,
        inviteToken: inviteToken.substring(0, 8) + "...", // Partial token for audit trail
      },
      ...getRequestMetadata(req),
    });

    // Generate access token with organizationId. New users via invite are
    // not partner-role in the MVP (partner-admin UI is deferred), but route
    // through the same activeOrganizationId logic for consistency.
    const initialActiveOrg = user.role === "partner" ? null : user.organizationId;
    const accessToken = generateAccessToken(
      user.id, user.email, user.role, user.organizationId, initialActiveOrg
    );

    // Generate refresh token
    const refreshResult = await generateRefreshToken(user.id, req);

    // Set httpOnly cookies (primary auth method)
    setAuthCookie(res, accessToken);
    setRefreshCookie(res, refreshResult.token);

    res.status(201).json({
      success: true,
      message: "User registered successfully",
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          subrole: user.subrole,
          organizationId: invite.organizationId,
          createdAt: user.createdAt,
        },
        // Token still returned for backwards compatibility during migration
        // Client should NOT store this in localStorage
        accessToken,
        // Refresh token expiry for client to know when to refresh
        refreshExpiresAt: refreshResult.expiresAt,
      },
    });
  } catch (error) {
    logger.auth.error("Registration error", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to register user",
    });
  }
}

export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Email and password are required",
      });
    }

    // Find user
    const userResult = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (userResult.length === 0) {
      // Log failed login attempt - user not found
      await logAuditEvent({
        userId: null,
        organizationId: null,
        eventType: AuditEventTypes.LOGIN_FAILED,
        metadata: {
          email,
          reason: "user_not_found",
        },
        ...getRequestMetadata(req),
      });

      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid email or password",
      });
    }

    const user = userResult[0];

    // DEV BYPASS — remove before production
    const devBypass = process.env.NODE_ENV === "development" && password === "devpass123";

    // Verify password
    const isPasswordValid = devBypass || await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
      // Log failed login attempt - wrong password
      await logAuditEvent({
        userId: user.id,
        organizationId: user.organizationId,
        eventType: AuditEventTypes.LOGIN_FAILED,
        resourceType: "user",
        resourceId: user.id,
        metadata: {
          email,
          reason: "invalid_password",
        },
        ...getRequestMetadata(req),
      });

      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid email or password",
      });
    }

    // Log successful login
    await logAuditEvent({
      userId: user.id,
      organizationId: user.organizationId,
      eventType: AuditEventTypes.USER_LOGIN,
      resourceType: "user",
      resourceId: user.id,
      metadata: {
        email: user.email,
        role: user.role,
      },
      ...getRequestMetadata(req),
    });

    // Generate access token with organizationId. Partner users start with
    // no active client (they're redirected to the picker by the frontend);
    // non-partner users implicitly have their home org as active.
    const initialActiveOrg = user.role === "partner" ? null : user.organizationId;
    const accessToken = generateAccessToken(
      user.id, user.email, user.role, user.organizationId, initialActiveOrg
    );

    // Generate refresh token
    const refreshResult = await generateRefreshToken(user.id, req);

    // Set httpOnly cookies (primary auth method)
    setAuthCookie(res, accessToken);
    setRefreshCookie(res, refreshResult.token);

    res.json({
      success: true,
      message: "Login successful",
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
          subrole: user.subrole,
          organizationId: user.organizationId,
          companyId: user.companyId, // Deprecated - backwards compat
          insurerId: user.insurerId,
        },
        // Token still returned for backwards compatibility during migration
        // Client should NOT store this in localStorage
        accessToken,
        // Refresh token expiry for client to know when to refresh
        refreshExpiresAt: refreshResult.expiresAt,
      },
    });
  } catch (error) {
    logger.auth.error("Login error", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to log in",
    });
  }
}

export async function me(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "User not authenticated",
      });
    }

    // Fetch full user details from database
    const userResult = await db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        subrole: users.subrole,
        companyId: users.companyId,
        insurerId: users.insurerId,
        preferredName: users.preferredName,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);

    if (userResult.length === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "User not found",
      });
    }

    // Include the resolved organisation IDs from the request (set by the
    // auth middleware). For partner users this surfaces whether they've
    // picked a client (activeOrganizationId !== null) so the frontend can
    // route to the picker vs. the case dashboard.
    res.json({
      success: true,
      data: {
        user: {
          ...userResult[0],
          organizationId: req.user.organizationId,
          activeOrganizationId: req.activeOrganizationId ?? null,
          // Surface gpnetOnly home-org status so the frontend can show or hide
          // the gpnetOnly toggle. Backend is the real gate (see
          // server/routes/admin/organizations.ts privilege-escalation check).
          homeOrgIsGpnetOnly: req.user.homeOrgIsGpnetOnly ?? false,
        },
      },
    });
  } catch (error) {
    logger.auth.error("Get user error", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to fetch user details",
    });
  }
}

export async function logout(req: AuthRequest, res: Response) {
  // Revoke refresh token from cookie if present (supports legacy gpnet_refresh)
  const refreshToken = readRefreshCookie(req);
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }

  // Log logout event
  if (req.user) {
    await logAuditEvent({
      userId: req.user.id,
      organizationId: req.user.organizationId,
      eventType: AuditEventTypes.USER_LOGOUT,
      resourceType: "user",
      resourceId: req.user.id,
      metadata: {
        email: req.user.email,
      },
      ...getRequestMetadata(req),
    });
  }

  // Clear the httpOnly auth cookies
  clearAuthCookie(res);
  clearRefreshCookie(res);

  res.json({
    success: true,
    message: "Logout successful",
  });
}

/**
 * Refresh access token using refresh token
 * POST /api/auth/refresh
 */
export async function refresh(req: Request, res: Response) {
  try {
    // Get refresh token from cookie (supports legacy gpnet_refresh)
    const refreshToken = readRefreshCookie(req);

    if (!refreshToken) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "No refresh token provided",
      });
    }

    // Validate and rotate the refresh token
    const result = await validateAndRotateRefreshToken(refreshToken, req);

    if (!result) {
      // Clear cookies on invalid token
      clearAuthCookie(res);
      clearRefreshCookie(res);

      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid or expired refresh token",
      });
    }

    // Get user details for new access token
    const user = await getUserById(result.userId);

    if (!user) {
      clearAuthCookie(res);
      clearRefreshCookie(res);

      return res.status(401).json({
        error: "Unauthorized",
        message: "User not found",
      });
    }

    // Generate new access token. For partner users the activeOrganizationId
    // is reset to null on refresh — they'll be sent back to the picker. This
    // is an MVP limitation; preserving active-org across refresh is a future
    // enhancement (would require storing it on the refresh token row).
    const initialActiveOrg = user.role === "partner" ? null : user.organizationId;
    const accessToken = generateAccessToken(
      user.id, user.email, user.role, user.organizationId, initialActiveOrg
    );

    // Set new cookies
    setAuthCookie(res, accessToken);
    setRefreshCookie(res, result.newToken.token);

    res.json({
      success: true,
      message: "Token refreshed successfully",
      data: {
        accessToken,
        refreshExpiresAt: result.newToken.expiresAt,
      },
    });
  } catch (error) {
    logger.auth.error("Token refresh error", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to refresh token",
    });
  }
}

/**
 * Logout from all devices (revoke all refresh tokens)
 * POST /api/auth/logout-all
 */
export async function logoutAll(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "User not authenticated",
      });
    }

    // Revoke all user's refresh tokens
    const revokedCount = await revokeAllUserTokens(req.user.id);

    // Log logout all event
    await logAuditEvent({
      userId: req.user.id,
      organizationId: req.user.organizationId,
      eventType: AuditEventTypes.USER_LOGOUT,
      resourceType: "user",
      resourceId: req.user.id,
      metadata: {
        email: req.user.email,
        action: "logout_all_devices",
        revokedTokens: revokedCount,
      },
      ...getRequestMetadata(req),
    });

    // Clear current session cookies
    clearAuthCookie(res);
    clearRefreshCookie(res);

    res.json({
      success: true,
      message: `Logged out from all devices (${revokedCount} sessions revoked)`,
    });
  } catch (error) {
    logger.auth.error("Logout all error", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to logout from all devices",
    });
  }
}

/**
 * Request password reset
 * POST /api/auth/forgot-password
 */
export async function forgotPassword(req: Request, res: Response) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Email is required",
      });
    }

    // Import here to avoid circular dependency
    const { requestPasswordReset } = await import("../services/passwordResetService");
    
    await requestPasswordReset(email);

    // Always return success to prevent email enumeration
    res.json({
      success: true,
      message: "If an account exists with this email, a password reset link has been sent",
    });
  } catch (error) {
    logger.auth.error("Forgot password error", {}, error);
    // Still return success to prevent information leakage
    res.json({
      success: true,
      message: "If an account exists with this email, a password reset link has been sent",
    });
  }
}

/**
 * Reset password with token
 * POST /api/auth/reset-password
 */
export async function resetPasswordHandler(req: Request, res: Response) {
  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Token and new password are required",
      });
    }

    // Import here to avoid circular dependency
    const { resetPassword } = await import("../services/passwordResetService");

    const result = await resetPassword(token, newPassword);

    if (!result.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: result.error || "Failed to reset password",
      });
    }

    res.json({
      success: true,
      message: "Password has been reset successfully. Please log in with your new password.",
    });
  } catch (error) {
    logger.auth.error("Reset password error", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to reset password",
    });
  }
}

/**
 * Get user's active sessions
 * GET /api/auth/sessions
 */
export async function getSessions(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "User not authenticated",
      });
    }

    // Get current token family from the refresh token cookie (supports legacy gpnet_refresh)
    const refreshToken = readRefreshCookie(req);
    let currentTokenFamily: string | undefined;

    if (refreshToken) {
      currentTokenFamily = await getRefreshTokenFamily(refreshToken);
    }

    const sessions = await getUserSessions(req.user.id, currentTokenFamily);

    res.json({
      success: true,
      data: {
        sessions: sessions.map(session => ({
          id: session.id,
          deviceName: session.deviceName,
          ipAddress: session.ipAddress,
          browser: parseUserAgent(session.userAgent),
          createdAt: session.createdAt.toISOString(),
          lastUsedAt: session.lastUsedAt.toISOString(),
          expiresAt: session.expiresAt.toISOString(),
          isCurrent: session.isCurrent,
        })),
      },
    });
  } catch (error) {
    logger.auth.error("Get sessions error", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to get sessions",
    });
  }
}

/**
 * Revoke a specific session
 * DELETE /api/auth/sessions/:sessionId
 */
export async function deleteSession(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "User not authenticated",
      });
    }

    const sessionId = req.params.sessionId as string;

    if (!sessionId) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Session ID is required",
      });
    }

    const revoked = await revokeSession(req.user.id, sessionId);

    if (!revoked) {
      return res.status(404).json({
        error: "Not Found",
        message: "Session not found or already revoked",
      });
    }

    // Log session revocation
    await logAuditEvent({
      userId: req.user.id,
      organizationId: req.user.organizationId,
      eventType: AuditEventTypes.USER_LOGOUT,
      resourceType: "session",
      resourceId: sessionId,
      metadata: {
        email: req.user.email,
        action: "revoke_session",
      },
      ...getRequestMetadata(req),
    });

    res.json({
      success: true,
      message: "Session revoked successfully",
    });
  } catch (error) {
    logger.auth.error("Delete session error", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to revoke session",
    });
  }
}

/**
 * Change password (authenticated user)
 * POST /api/auth/change-password
 * Body: { currentPassword, newPassword }
 *
 * Verifies the current password, hashes and stores the new one, then
 * revokes all refresh tokens for the user (force re-login on other devices).
 * Available to all roles — partner-role users access it from the header.
 */
export async function changePassword(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "User not authenticated",
      });
    }

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        error: "Bad Request",
        message: "currentPassword and newPassword are required",
      });
    }

    // Validate new password strength
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        error: "Bad Request",
        message: "New password does not meet security requirements",
        details: passwordValidation.errors,
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        error: "Bad Request",
        message: "New password must be different from current password",
      });
    }

    // Look up user to verify current password
    const userResult = await db
      .select()
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);
    if (userResult.length === 0) {
      return res.status(401).json({ error: "Unauthorized", message: "User not found" });
    }
    const user = userResult[0];

    const isValid = await bcrypt.compare(currentPassword, user.password);
    if (!isValid) {
      await logAuditEvent({
        userId: user.id,
        organizationId: user.organizationId,
        eventType: AuditEventTypes.USER_PASSWORD_CHANGE_FAILED,
        resourceType: "user",
        resourceId: user.id,
        metadata: { reason: "invalid_current_password" },
        ...getRequestMetadata(req),
      });
      return res.status(401).json({
        error: "Unauthorized",
        message: "Current password is incorrect",
      });
    }

    // Hash + store new password
    const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await db.update(users).set({ password: newHash }).where(eq(users.id, user.id));

    // Revoke all refresh tokens — other sessions on other devices must re-login
    await revokeAllUserTokens(user.id);

    await logAuditEvent({
      userId: user.id,
      organizationId: user.organizationId,
      eventType: AuditEventTypes.USER_PASSWORD_CHANGE,
      resourceType: "user",
      resourceId: user.id,
      metadata: { method: "self_service_change_password" },
      ...getRequestMetadata(req),
    });

    res.json({
      success: true,
      message: "Password changed successfully. Other sessions have been signed out.",
    });
  } catch (error) {
    logger.auth.error("Change password error", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to change password",
    });
  }
}

/**
 * Parse user agent string to get browser/device info
 */
function parseUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Unknown";

  // Simple parsing - could use a library for more accuracy
  if (userAgent.includes("Firefox")) return "Firefox";
  if (userAgent.includes("Edg/")) return "Edge";
  if (userAgent.includes("Chrome")) return "Chrome";
  if (userAgent.includes("Safari")) return "Safari";
  if (userAgent.includes("Opera") || userAgent.includes("OPR")) return "Opera";
  if (userAgent.includes("MSIE") || userAgent.includes("Trident")) return "Internet Explorer";

  return "Unknown Browser";
}
