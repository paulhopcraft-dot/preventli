import { Router, type Response } from "express";
import { db } from "../db";
import { organizations, insurers } from "@shared/schema";
import { eq } from "drizzle-orm";
import { authorize, type AuthRequest } from "../middleware/auth";
import { z } from "zod";
import { logoUpload, saveLogoFile, deleteUploadedFile, getFilenameFromUrl } from "../services/fileUpload";
import { logger } from "../lib/logger";

const router = Router();

// All routes require authentication (any role)
router.use(authorize());

/**
 * GET /api/organization/profile
 * Get the authenticated user's organization profile
 */
router.get("/profile", async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        error: "Bad Request",
        message: "No organization associated with this user",
      });
    }

    const result = await db
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: organizations.slug,
        logoUrl: organizations.logoUrl,
        contactName: organizations.contactName,
        contactPhone: organizations.contactPhone,
        contactEmail: organizations.contactEmail,
        insurerId: organizations.insurerId,
        isActive: organizations.isActive,
        createdAt: organizations.createdAt,
        updatedAt: organizations.updatedAt,
        insurerName: insurers.name,
      })
      .from(organizations)
      .leftJoin(insurers, eq(organizations.insurerId, insurers.id))
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (result.length === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Organization not found",
      });
    }

    res.json({
      success: true,
      data: result[0],
    });
  } catch (error) {
    logger.api.error("Error fetching organization profile", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to fetch organization profile",
    });
  }
});

/**
 * PUT /api/organization/profile
 * Update the authenticated user's organization profile (limited fields)
 * Only contact name and phone can be updated by non-admin users
 */
router.put("/profile", async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;

    if (!organizationId) {
      return res.status(400).json({
        error: "Bad Request",
        message: "No organization associated with this user",
      });
    }

    // Only allow updating contact name and phone for self-service
    const updateSchema = z.object({
      contactName: z.string().optional(),
      contactPhone: z.string().optional(),
    });

    const validation = updateSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Invalid data",
        details: validation.error.errors,
      });
    }

    const data = validation.data;

    // Check organization exists and belongs to user
    const existing = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (existing.length === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Organization not found",
      });
    }

    // Update only allowed fields
    const updated = await db
      .update(organizations)
      .set({
        contactName: data.contactName,
        contactPhone: data.contactPhone,
        updatedAt: new Date(),
      } as any)
      .where(eq(organizations.id, organizationId))
      .returning();

    res.json({
      success: true,
      message: "Profile updated successfully",
      data: updated[0],
    });
  } catch (error) {
    logger.api.error("Error updating organization profile", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to update organization profile",
    });
  }
});

/**
 * POST /api/organization/logo
 * Upload a logo for the authenticated user's organization
 */
router.post(
  "/logo",
  logoUpload.single("logo"),
  async (req: AuthRequest, res: Response) => {
    try {
      const organizationId = req.user?.organizationId;
      const file = req.file;

      if (!organizationId) {
        return res.status(400).json({
          error: "Bad Request",
          message: "No organization associated with this user",
        });
      }

      if (!file) {
        return res.status(400).json({
          error: "Bad Request",
          message: "No file uploaded",
        });
      }

      // Get current logo URL to delete old logo
      const existing = await db
        .select({ id: organizations.id, logoUrl: organizations.logoUrl })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (existing.length === 0) {
        return res.status(404).json({
          error: "Not Found",
          message: "Organization not found",
        });
      }

      // Delete old logo if exists
      const oldLogoKey = getFilenameFromUrl(existing[0].logoUrl || "");
      if (oldLogoKey) {
        await deleteUploadedFile(oldLogoKey);
      }

      // Upload new logo and get URL
      const { url: logoUrl } = await saveLogoFile(file);
      const updated = await db
        .update(organizations)
        .set({
          logoUrl,
          updatedAt: new Date(),
        } as any)
        .where(eq(organizations.id, organizationId))
        .returning();

      res.json({
        success: true,
        message: "Logo uploaded successfully",
        data: {
          logoUrl: updated[0].logoUrl,
        },
      });
    } catch (error) {
      logger.api.error("Error uploading logo", {}, error);
      res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to upload logo",
      });
    }
  }
);

export default router;
