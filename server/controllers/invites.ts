import { Request, Response } from "express";
import type { AuthRequest } from "../middleware/auth";
import {
  createInvite,
  getOrganizationInvites,
  cancelInvite,
  resendInvite,
  hasPendingInvite,
} from "../inviteService";
import type { UserRole } from "@shared/schema";
import { logger } from "../lib/logger";
import { logAuditEvent, AuditEventTypes, getRequestMetadata } from "../services/auditLogger";
import { sendInviteEmail } from "../services/emailService";

/**
 * Create a new user invite (admin only)
 * POST /api/admin/invites
 */
export async function createUserInvite(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required",
      });
    }

    // Only admins can create invites
    if (req.user.role !== "admin") {
      return res.status(403).json({
        error: "Forbidden",
        message: "Only administrators can create user invites",
      });
    }

    const { email, organizationId, role, subrole } = req.body;

    // Validate required fields
    if (!email || !organizationId || !role) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Email, organizationId, and role are required",
      });
    }

    // Validate role
    const validRoles: UserRole[] = ["admin", "employer", "clinician", "insurer"];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        error: "Bad Request",
        message: `Role must be one of: ${validRoles.join(", ")}`,
      });
    }

    // Check if email already has a pending invite
    const existingInvite = await hasPendingInvite(email, organizationId);
    if (existingInvite) {
      return res.status(409).json({
        error: "Conflict",
        message: "A pending invite already exists for this email in this organization",
      });
    }

    // Create invite
    const invite = await createInvite({
      email: email.toLowerCase().trim(),
      organizationId,
      role,
      subrole: subrole || undefined,
      createdBy: req.user.id,
    });

    // Log invite creation
    await logAuditEvent({
      userId: req.user.id,
      organizationId,
      eventType: AuditEventTypes.INVITE_CREATED,
      resourceType: "invite",
      resourceId: invite.id,
      metadata: {
        invitedEmail: invite.email,
        invitedRole: invite.role,
        invitedSubrole: invite.subrole,
        expiresAt: invite.expiresAt,
      },
      ...getRequestMetadata(req),
    });

    // Send invite email
    const emailResult = await sendInviteEmail(invite.email, invite.token, req.user.email, invite.role);
    if (!emailResult.success) {
      logger.email.warn("Failed to send invite email", { email: invite.email, error: emailResult.error });
    }

    // Build response - only include token/URL in development for testing
    const isDev = process.env.NODE_ENV !== "production";
    const inviteResponse: Record<string, unknown> = {
      id: invite.id,
      email: invite.email,
      organizationId: invite.organizationId,
      role: invite.role,
      subrole: invite.subrole,
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
    };

    // In development, include token for testing (in production, send via email only)
    if (isDev) {
      inviteResponse.token = invite.token;
      inviteResponse.inviteUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/register?token=${invite.token}`;
    }

    res.status(201).json({
      success: true,
      message: "User invite created successfully",
      data: {
        invite: inviteResponse,
      },
    });
  } catch (error) {
    logger.auth.error("Create invite error", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to create user invite",
    });
  }
}

/**
 * Get all invites for an organization (admin only)
 * GET /api/admin/invites?organizationId=xxx
 */
export async function listOrganizationInvites(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required",
      });
    }

    // Only admins can list invites
    if (req.user.role !== "admin") {
      return res.status(403).json({
        error: "Forbidden",
        message: "Only administrators can view user invites",
      });
    }

    const { organizationId } = req.query;

    if (!organizationId || typeof organizationId !== "string") {
      return res.status(400).json({
        error: "Bad Request",
        message: "organizationId query parameter is required",
      });
    }

    const invites = await getOrganizationInvites(organizationId);

    res.json({
      success: true,
      data: {
        invites: invites.map((invite) => ({
          id: invite.id,
          email: invite.email,
          organizationId: invite.organizationId,
          role: invite.role,
          subrole: invite.subrole,
          status: invite.status,
          expiresAt: invite.expiresAt,
          usedAt: invite.usedAt,
          createdAt: invite.createdAt,
          // Don't expose token in list view
        })),
        total: invites.length,
      },
    });
  } catch (error) {
    logger.auth.error("List invites error", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to fetch user invites",
    });
  }
}

/**
 * Cancel a pending invite (admin only)
 * DELETE /api/admin/invites/:inviteId
 */
export async function cancelUserInvite(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required",
      });
    }

    // Only admins can cancel invites
    if (req.user.role !== "admin") {
      return res.status(403).json({
        error: "Forbidden",
        message: "Only administrators can cancel user invites",
      });
    }

    const inviteId = req.params.inviteId as string;

    if (!inviteId) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Invite ID is required",
      });
    }

    const updatedInvite = await cancelInvite(inviteId);

    res.json({
      success: true,
      message: "Invite cancelled successfully",
      data: {
        invite: {
          id: updatedInvite.id,
          email: updatedInvite.email,
          status: updatedInvite.status,
        },
      },
    });
  } catch (error) {
    logger.auth.error("Cancel invite error", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to cancel user invite",
    });
  }
}

/**
 * Resend an invite with a new token (admin only)
 * POST /api/admin/invites/:inviteId/resend
 */
export async function resendUserInvite(req: AuthRequest, res: Response) {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Authentication required",
      });
    }

    // Only admins can resend invites
    if (req.user.role !== "admin") {
      return res.status(403).json({
        error: "Forbidden",
        message: "Only administrators can resend user invites",
      });
    }

    const inviteId = req.params.inviteId as string;

    if (!inviteId) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Invite ID is required",
      });
    }

    const updatedInvite = await resendInvite(inviteId);

    // Send invite email
    const emailResult = await sendInviteEmail(updatedInvite.email, updatedInvite.token, req.user.email, updatedInvite.role);
    if (!emailResult.success) {
      logger.email.warn("Failed to send invite email", { email: updatedInvite.email, error: emailResult.error });
    }

    // Build response - only include token/URL in development for testing
    const isDev = process.env.NODE_ENV !== "production";
    const resendResponse: Record<string, unknown> = {
      id: updatedInvite.id,
      email: updatedInvite.email,
      expiresAt: updatedInvite.expiresAt,
    };

    // In development, include token for testing (in production, send via email only)
    if (isDev) {
      resendResponse.token = updatedInvite.token;
      resendResponse.inviteUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/register?token=${updatedInvite.token}`;
    }

    res.json({
      success: true,
      message: "Invite resent successfully",
      data: {
        invite: resendResponse,
      },
    });
  } catch (error) {
    logger.auth.error("Resend invite error", {}, error);

    if (error instanceof Error) {
      if (error.message.includes("not found")) {
        return res.status(404).json({
          error: "Not Found",
          message: "Invite not found",
        });
      }
      if (error.message.includes("already been used")) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Cannot resend an invite that has already been used",
        });
      }
    }

    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to resend user invite",
    });
  }
}
