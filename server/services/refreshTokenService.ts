/**
 * Refresh Token Service
 *
 * Implements secure refresh token management with:
 * - Token rotation (new token on each use)
 * - Token family tracking (detect reuse attacks)
 * - Secure hashing (SHA-256)
 * - Device tracking for session management
 */

import crypto from "crypto";
import { db } from "../db";
import { refreshTokens, users } from "@shared/schema";
import { eq, and, isNull, lt } from "drizzle-orm";
import type { Request } from "express";
import { logger } from "../lib/logger";

// Configuration
const REFRESH_TOKEN_EXPIRY_DAYS = 7;
const REFRESH_TOKEN_BYTES = 32; // 256 bits of entropy

export interface RefreshTokenResult {
  token: string; // Raw token to send to client
  expiresAt: Date;
}

export interface ValidatedToken {
  userId: string;
  tokenFamily: string;
  newToken: RefreshTokenResult; // Rotated token
}

/**
 * Generate a cryptographically secure random token
 */
function generateSecureToken(): string {
  return crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("base64url");
}

/**
 * Hash a token using SHA-256
 */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Look up the token family for a refresh token without rotating it.
 */
export async function getRefreshTokenFamily(token: string): Promise<string | undefined> {
  const tokenHash = hashToken(token);
  const tokenRecords = await db
    .select({
      tokenFamily: refreshTokens.tokenFamily,
      expiresAt: refreshTokens.expiresAt,
    })
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.tokenHash, tokenHash),
        isNull(refreshTokens.revokedAt)
      )
    )
    .limit(1);

  const tokenRecord = tokenRecords[0];
  if (!tokenRecord || new Date() > tokenRecord.expiresAt) {
    return undefined;
  }

  return tokenRecord.tokenFamily;
}

/**
 * Generate a new token family ID
 */
function generateTokenFamily(): string {
  return crypto.randomUUID();
}

/**
 * Extract device info from request
 */
function getDeviceInfo(req: Request): { ipAddress: string; userAgent: string; deviceName: string | null } {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || "unknown",
    userAgent: req.get("user-agent") || "unknown",
    deviceName: req.get("x-device-name") || null,
  };
}

/**
 * Generate a new refresh token for a user
 *
 * @param userId - The user ID to generate token for
 * @param req - Express request for device tracking
 * @param existingFamily - Optional existing token family (for rotation)
 * @returns The raw token and expiry date
 */
export async function generateRefreshToken(
  userId: string,
  req: Request,
  existingFamily?: string
): Promise<RefreshTokenResult> {
  const token = generateSecureToken();
  const tokenHash = hashToken(token);
  const tokenFamily = existingFamily || generateTokenFamily();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const deviceInfo = getDeviceInfo(req);

  await db.insert(refreshTokens).values({
    userId,
    tokenHash,
    tokenFamily,
    deviceName: deviceInfo.deviceName,
    ipAddress: deviceInfo.ipAddress,
    userAgent: deviceInfo.userAgent,
    expiresAt,
  } as any);

  logger.auth.info("Refresh token generated", {
    userId,
    tokenFamily,
    expiresAt: expiresAt.toISOString(),
  });

  return { token, expiresAt };
}

/**
 * Validate a refresh token and rotate it
 *
 * This implements token rotation:
 * 1. Find the token by hash
 * 2. Verify it's not expired or revoked
 * 3. Revoke the old token
 * 4. Issue a new token in the same family
 *
 * If a revoked token is reused, this indicates a potential token theft.
 * In that case, we revoke ALL tokens in the family.
 *
 * @param token - The raw refresh token from the client
 * @param req - Express request for device tracking
 * @returns The validated token info with a new rotated token, or null if invalid
 */
export async function validateAndRotateRefreshToken(
  token: string,
  req: Request
): Promise<ValidatedToken | null> {
  const tokenHash = hashToken(token);

  // Find the token
  const tokenRecords = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);

  if (tokenRecords.length === 0) {
    logger.auth.warn("Refresh token not found", { tokenHashPrefix: tokenHash.substring(0, 8) });
    return null;
  }

  const tokenRecord = tokenRecords[0];

  // Check if token was already revoked (potential reuse attack)
  if (tokenRecord.revokedAt !== null) {
    logger.auth.error("Refresh token reuse detected - revoking entire family", {
      userId: tokenRecord.userId,
      tokenFamily: tokenRecord.tokenFamily,
    });

    // Revoke ALL tokens in this family (security measure)
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() } as any)
      .where(
        and(
          eq(refreshTokens.tokenFamily, tokenRecord.tokenFamily),
          isNull(refreshTokens.revokedAt)
        )
      );

    return null;
  }

  // Check expiry
  if (new Date() > tokenRecord.expiresAt) {
    logger.auth.warn("Refresh token expired", {
      userId: tokenRecord.userId,
      expiredAt: tokenRecord.expiresAt.toISOString(),
    });
    return null;
  }

  // Revoke the current token (rotation)
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() } as any)
    .where(eq(refreshTokens.id, tokenRecord.id));

  // Generate new token in the same family
  const newToken = await generateRefreshToken(
    tokenRecord.userId,
    req,
    tokenRecord.tokenFamily
  );

  logger.auth.info("Refresh token rotated", {
    userId: tokenRecord.userId,
    tokenFamily: tokenRecord.tokenFamily,
  });

  return {
    userId: tokenRecord.userId,
    tokenFamily: tokenRecord.tokenFamily,
    newToken,
  };
}

/**
 * Revoke a specific refresh token
 *
 * @param token - The raw refresh token to revoke
 * @returns True if token was found and revoked
 */
export async function revokeRefreshToken(token: string): Promise<boolean> {
  const tokenHash = hashToken(token);

  const result = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() } as any)
    .where(
      and(
        eq(refreshTokens.tokenHash, tokenHash),
        isNull(refreshTokens.revokedAt)
      )
    )
    .returning({ id: refreshTokens.id });

  if (result.length > 0) {
    logger.auth.info("Refresh token revoked", { tokenId: result[0].id });
    return true;
  }

  return false;
}

/**
 * Revoke all refresh tokens for a user (logout from all devices)
 *
 * @param userId - The user ID to revoke all tokens for
 * @returns Number of tokens revoked
 */
export async function revokeAllUserTokens(userId: string): Promise<number> {
  const result = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() } as any)
    .where(
      and(
        eq(refreshTokens.userId, userId),
        isNull(refreshTokens.revokedAt)
      )
    )
    .returning({ id: refreshTokens.id });

  if (result.length > 0) {
    logger.auth.info("All user refresh tokens revoked", {
      userId,
      count: result.length,
    });
  }

  return result.length;
}

/**
 * Get user by ID (for token refresh)
 */
export async function getUserById(userId: string) {
  const result = await db
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      organizationId: users.organizationId,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return result[0] || null;
}

/**
 * Session info for display to user
 */
export interface UserSession {
  id: string; // Token family ID (used to revoke)
  deviceName: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}

/**
 * Get all active sessions for a user
 * Groups tokens by family and returns the most recent token info for each
 *
 * @param userId - The user ID
 * @param currentTokenFamily - The current session's token family (to mark as "current")
 * @returns List of active sessions
 */
export async function getUserSessions(
  userId: string,
  currentTokenFamily?: string
): Promise<UserSession[]> {
  // Get all active (non-revoked, non-expired) tokens for the user
  const tokens = await db
    .select({
      id: refreshTokens.id,
      tokenFamily: refreshTokens.tokenFamily,
      deviceName: refreshTokens.deviceName,
      ipAddress: refreshTokens.ipAddress,
      userAgent: refreshTokens.userAgent,
      expiresAt: refreshTokens.expiresAt,
      createdAt: refreshTokens.createdAt,
    })
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.userId, userId),
        isNull(refreshTokens.revokedAt)
      )
    )
    .orderBy(refreshTokens.createdAt);

  // Group by token family and get the most recent token for each
  const sessionMap = new Map<string, UserSession>();

  for (const token of tokens) {
    // Skip expired tokens
    if (new Date() > token.expiresAt) continue;

    const existing = sessionMap.get(token.tokenFamily);

    if (!existing || token.createdAt > existing.lastUsedAt) {
      sessionMap.set(token.tokenFamily, {
        id: token.tokenFamily,
        deviceName: token.deviceName,
        ipAddress: token.ipAddress,
        userAgent: token.userAgent,
        createdAt: existing?.createdAt || token.createdAt,
        lastUsedAt: token.createdAt,
        expiresAt: token.expiresAt,
        isCurrent: token.tokenFamily === currentTokenFamily,
      });
    }
  }

  // Convert to array and sort by last used (most recent first)
  return Array.from(sessionMap.values()).sort(
    (a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime()
  );
}

/**
 * Revoke a specific session by token family
 *
 * @param userId - The user ID (for verification)
 * @param tokenFamily - The token family to revoke
 * @returns True if session was found and revoked
 */
export async function revokeSession(
  userId: string,
  tokenFamily: string
): Promise<boolean> {
  const result = await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() } as any)
    .where(
      and(
        eq(refreshTokens.userId, userId),
        eq(refreshTokens.tokenFamily, tokenFamily),
        isNull(refreshTokens.revokedAt)
      )
    )
    .returning({ id: refreshTokens.id });

  if (result.length > 0) {
    logger.auth.info("Session revoked", { userId, tokenFamily, tokensRevoked: result.length });
    return true;
  }

  return false;
}

/**
 * Cleanup expired tokens (maintenance task)
 * Should be run periodically (e.g., daily cron job)
 *
 * @returns Number of tokens cleaned up
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const result = await db
    .delete(refreshTokens)
    .where(lt(refreshTokens.expiresAt, new Date()))
    .returning({ id: refreshTokens.id });

  if (result.length > 0) {
    logger.auth.info("Expired refresh tokens cleaned up", { count: result.length });
  }

  return result.length;
}
