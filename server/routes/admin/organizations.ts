import { Router, type Response } from "express";
import { db } from "../../db";
import { organizations, insurers, insertOrganizationSchema } from "@shared/schema";
import { eq, ilike, or, desc } from "drizzle-orm";
import { authorize, type AuthRequest } from "../../middleware/auth";
import { z } from "zod";
import { logoUpload, saveLogoFile, deleteUploadedFile, getFilenameFromUrl } from "../../services/fileUpload";
import { logger } from "../../lib/logger";

const router = Router();

// All routes require admin role
router.use(authorize(["admin"]));

/**
 * GET /api/admin/organizations
 * List all organizations with optional search
 */
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const search = req.query.search as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = (page - 1) * limit;

    let query = db
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
      .orderBy(desc(organizations.createdAt))
      .limit(limit)
      .offset(offset);

    // Apply search filter if provided
    if (search) {
      query = query.where(
        or(
          ilike(organizations.name, `%${search}%`),
          ilike(organizations.slug, `%${search}%`),
          ilike(organizations.contactEmail, `%${search}%`)
        )
      ) as typeof query;
    }

    const results = await query;

    res.json({
      success: true,
      data: results,
      pagination: {
        page,
        limit,
        total: results.length, // For proper pagination, would need a separate count query
      },
    });
  } catch (error) {
    logger.api.error("Error fetching organizations", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to fetch organizations",
    });
  }
});

/**
 * GET /api/admin/organizations/:id
 * Get single organization by ID
 */
router.get("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

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
      .where(eq(organizations.id, id))
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
    logger.api.error("Error fetching organization", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to fetch organization",
    });
  }
});

/**
 * POST /api/admin/organizations
 * Create a new organization
 */
router.post("/", async (req: AuthRequest, res: Response) => {
  try {
    // Validate input
    const validation = insertOrganizationSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Invalid organization data",
        details: validation.error.errors,
      });
    }

    const data = validation.data;

    // Check for duplicate slug
    const existingSlug = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, (data as any).slug))
      .limit(1);

    if (existingSlug.length > 0) {
      return res.status(409).json({
        error: "Conflict",
        message: "An organization with this slug already exists",
      });
    }

    // If insurerId provided, verify it exists
    if ((data as any).insurerId) {
      const insurer = await db
        .select({ id: insurers.id })
        .from(insurers)
        .where(eq(insurers.id, (data as any).insurerId))
        .limit(1);

      if (insurer.length === 0) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Invalid insurer ID",
        });
      }
    }

    // Create organization
    const newOrg = await db
      .insert(organizations)
      .values(data as any)
      .returning();

    res.status(201).json({
      success: true,
      message: "Organization created successfully",
      data: newOrg[0],
    });
  } catch (error) {
    logger.api.error("Error creating organization", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to create organization",
    });
  }
});

/**
 * PUT /api/admin/organizations/:id
 * Update an existing organization
 */
router.put("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    // Check organization exists
    const existing = await db
      .select({ id: organizations.id, slug: organizations.slug })
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);

    if (existing.length === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Organization not found",
      });
    }

    // Validate input (partial update allowed)
    const updateSchema = insertOrganizationSchema.partial();
    const validation = updateSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Invalid organization data",
        details: validation.error.errors,
      });
    }

    const data = validation.data;

    // Check for slug conflict if changing slug
    if ((data as any).slug && (data as any).slug !== existing[0].slug) {
      const slugConflict = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, (data as any).slug))
        .limit(1);

      if (slugConflict.length > 0) {
        return res.status(409).json({
          error: "Conflict",
          message: "An organization with this slug already exists",
        });
      }
    }

    // If insurerId provided, verify it exists
    if ((data as any).insurerId) {
      const insurer = await db
        .select({ id: insurers.id })
        .from(insurers)
        .where(eq(insurers.id, (data as any).insurerId))
        .limit(1);

      if (insurer.length === 0) {
        return res.status(400).json({
          error: "Bad Request",
          message: "Invalid insurer ID",
        });
      }
    }

    // Update organization
    const updated = await db
      .update(organizations)
      .set({
        ...data,
        updatedAt: new Date(),
      } as any)
      .where(eq(organizations.id, id as string))
      .returning();

    res.json({
      success: true,
      message: "Organization updated successfully",
      data: updated[0],
    });
  } catch (error) {
    logger.api.error("Error updating organization", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to update organization",
    });
  }
});

/**
 * DELETE /api/admin/organizations/:id
 * Soft delete an organization (sets isActive = false)
 */
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    // Check organization exists
    const existing = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);

    if (existing.length === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Organization not found",
      });
    }

    // Soft delete by setting isActive = false
    await db
      .update(organizations)
      .set({
        isActive: false,
        updatedAt: new Date(),
      } as any)
      .where(eq(organizations.id, id));

    res.json({
      success: true,
      message: "Organization deleted successfully",
    });
  } catch (error) {
    logger.api.error("Error deleting organization", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to delete organization",
    });
  }
});

/**
 * POST /api/admin/organizations/:id/logo
 * Upload a logo for an organization
 */
router.post(
  "/:id/logo",
  logoUpload.single("logo"),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = req.params.id as string;
      const file = req.file;

      if (!file) {
        return res.status(400).json({
          error: "Bad Request",
          message: "No file uploaded",
        });
      }

      // Check organization exists
      const existing = await db
        .select({ id: organizations.id, logoUrl: organizations.logoUrl })
        .from(organizations)
        .where(eq(organizations.id, id))
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
        .where(eq(organizations.id, id))
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

/**
 * DELETE /api/admin/organizations/:id/logo
 * Remove logo from an organization
 */
router.delete("/:id/logo", async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    // Check organization exists
    const existing = await db
      .select({ id: organizations.id, logoUrl: organizations.logoUrl })
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);

    if (existing.length === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Organization not found",
      });
    }

    // Delete logo file if exists
    const logoKey = getFilenameFromUrl(existing[0].logoUrl || "");
    if (logoKey) {
      await deleteUploadedFile(logoKey);
    }

    // Update organization to remove logo URL
    await db
      .update(organizations)
      .set({
        logoUrl: null,
        updatedAt: new Date(),
      } as any)
      .where(eq(organizations.id, id));

    res.json({
      success: true,
      message: "Logo removed successfully",
    });
  } catch (error) {
    logger.api.error("Error removing logo", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to remove logo",
    });
  }
});

export default router;
