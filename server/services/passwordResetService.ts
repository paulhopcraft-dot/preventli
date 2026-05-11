/**
 * Password Reset Service
 *
 * Handles password reset token generation, validation, and password updates.
 * Security features:
 * - Tokens are SHA-256 hashed before storage
 * - 1-hour expiry window
 * - Single use (marked as used after successful reset)
 * - All sessions revoked on password change
 */

import crypto from "crypto";
import bcrypt from "bcrypt";
import { db } from "../db";
import { users, passwordResetTokens } from "@shared/schema";
import { eq, and, isNull, lt } from "drizzle-orm";
import { revokeAllUserTokens } from "./refreshTokenService";
import { sendPasswordResetEmail } from "./emailService";
import { validatePassword } from "../lib/passwordValidation";
import { logger } from "../lib/logger";

const TOKEN_EXPIRY_HOURS = 1;
const SALT_ROUNDS = 10;

/**
 * Generate a cryptographically secure random token
 */
function generateSecureToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Hash a token using SHA-256
 */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Request a password reset for an email address.
 * Always returns success to prevent email enumeration attacks.
 */
export async function requestPasswordReset(email: string): Promise<{ success: true }> {
  const normalizedEmail = email.toLowerCase().trim();

  // Find user by email
  const user = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, normalizedEmail))
    .limit(1);

  if (user.length === 0) {
    // Don't reveal that email doesn't exist
    logger.auth.info("Password reset requested for non-existent email", { email: normalizedEmail });
    return { success: true };
  }

  const userId = user[0].id;

  // Invalidate any existing reset tokens for this user
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() } as any)
    .where(and(
      eq(passwordResetTokens.userId, userId),
      isNull(passwordResetTokens.usedAt)
    ));

  // Generate new token
  const rawToken = generateSecureToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  // Store hashed token
  await db.insert(passwordResetTokens).values({
    userId,
    tokenHash,
    expiresAt,
  });

  // Send reset email
  const emailResult = await sendPasswordResetEmail(normalizedEmail, rawToken);
  
  if (!emailResult.success) {
    logger.auth.warn("Failed to send password reset email", { 
      email: normalizedEmail, 
      error: emailResult.error 
    });
  } else {
    logger.auth.info("Password reset email sent", { email: normalizedEmail });
  }

  return { success: true };
}

/**
 * Validate a password reset token.
 * Returns the user ID if valid, null otherwise.
 */
export async function validateResetToken(token: string): Promise<string | null> {
  const tokenHash = hashToken(token);

  const result = await db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      expiresAt: passwordResetTokens.expiresAt,
      usedAt: passwordResetTokens.usedAt,
    })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash))
    .limit(1);

  if (result.length === 0) {
    logger.auth.warn("Password reset token not found");
    return null;
  }

  const resetToken = result[0];

  // Check if already used
  if (resetToken.usedAt) {
    logger.auth.warn("Password reset token already used", { tokenId: resetToken.id });
    return null;
  }

  // Check if expired
  if (new Date() > resetToken.expiresAt) {
    logger.auth.warn("Password reset token expired", { tokenId: resetToken.id });
    return null;
  }

  return resetToken.userId;
}

/**
 * Reset a user's password using a valid token.
 * Also revokes all existing sessions.
 */
export async function resetPassword(
  token: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  // Validate password strength
  const passwordValidation = validatePassword(newPassword);
  if (!passwordValidation.valid) {
    return { 
      success: false, 
      error: passwordValidation.errors.join(", ") 
    };
  }

  // Validate token and get user ID
  const tokenHash = hashToken(token);

  const result = await db
    .select({
      id: passwordResetTokens.id,
      userId: passwordResetTokens.userId,
      expiresAt: passwordResetTokens.expiresAt,
      usedAt: passwordResetTokens.usedAt,
    })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, tokenHash))
    .limit(1);

  if (result.length === 0) {
    return { success: false, error: "Invalid or expired reset token" };
  }

  const resetToken = result[0];

  if (resetToken.usedAt) {
    return { success: false, error: "Reset token has already been used" };
  }

  if (new Date() > resetToken.expiresAt) {
    return { success: false, error: "Reset token has expired" };
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);

  // Update password
  await db
    .update(users)
    .set({ password: hashedPassword })
    .where(eq(users.id, resetToken.userId));

  // Mark token as used
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() } as any)
    .where(eq(passwordResetTokens.id, resetToken.id));

  // Revoke all refresh tokens (logout from all devices)
  await revokeAllUserTokens(resetToken.userId);

  logger.auth.info("Password reset successful", { userId: resetToken.userId });

  return { success: true };
}

/**
 * Clean up expired password reset tokens (maintenance task)
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const result = await db
    .delete(passwordResetTokens)
    .where(lt(passwordResetTokens.expiresAt, new Date()));

  return 0; // Drizzle doesn't return count easily
}
