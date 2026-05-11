import { Router, type Response } from "express";
import { db } from "../../db";
import { insurers, insertInsurerSchema } from "@shared/schema";
import { eq, ilike, or, desc } from "drizzle-orm";
import { authorize, type AuthRequest } from "../../middleware/auth";
import { logger } from "../../lib/logger";

const router = Router();

// All routes require admin role
router.use(authorize(["admin"]));

/**
 * GET /api/admin/insurers
 * List all insurers
 */
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const search = req.query.search as string | undefined;
    const includeInactive = req.query.includeInactive === "true";

    let query = db
      .select()
      .from(insurers)
      .orderBy(desc(insurers.createdAt));

    // Filter by active status unless explicitly including inactive
    if (!includeInactive) {
      query = query.where(eq(insurers.isActive, true)) as typeof query;
    }

    // Apply search filter if provided
    if (search) {
      query = query.where(
        or(
          ilike(insurers.name, `%${search}%`),
          ilike(insurers.code, `%${search}%`)
        )
      ) as typeof query;
    }

    const results = await query;

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    logger.api.error("Error fetching insurers", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to fetch insurers",
    });
  }
});

/**
 * GET /api/admin/insurers/:id
 * Get single insurer by ID
 */
router.get("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const result = await db
      .select()
      .from(insurers)
      .where(eq(insurers.id, id))
      .limit(1);

    if (result.length === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Insurer not found",
      });
    }

    res.json({
      success: true,
      data: result[0],
    });
  } catch (error) {
    logger.api.error("Error fetching insurer", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to fetch insurer",
    });
  }
});

/**
 * POST /api/admin/insurers
 * Create a new insurer
 */
router.post("/", async (req: AuthRequest, res: Response) => {
  try {
    // Validate input
    const validation = insertInsurerSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Invalid insurer data",
        details: validation.error.errors,
      });
    }

    const data = validation.data as any;

    // Check for duplicate code if provided
    if (data.code) {
      const existingCode = await db
        .select({ id: insurers.id })
        .from(insurers)
        .where(eq(insurers.code, data.code))
        .limit(1);

      if (existingCode.length > 0) {
        return res.status(409).json({
          error: "Conflict",
          message: "An insurer with this code already exists",
        });
      }
    }

    // Create insurer
    const newInsurer = await db
      .insert(insurers)
      .values(data as any)
      .returning();

    res.status(201).json({
      success: true,
      message: "Insurer created successfully",
      data: newInsurer[0],
    });
  } catch (error) {
    logger.api.error("Error creating insurer", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to create insurer",
    });
  }
});

/**
 * PUT /api/admin/insurers/:id
 * Update an existing insurer
 */
router.put("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    // Check insurer exists
    const existing = await db
      .select({ id: insurers.id, code: insurers.code })
      .from(insurers)
      .where(eq(insurers.id, id))
      .limit(1);

    if (existing.length === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Insurer not found",
      });
    }

    // Validate input (partial update allowed)
    const updateSchema = insertInsurerSchema.partial();
    const validation = updateSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Invalid insurer data",
        details: validation.error.errors,
      });
    }

    const data = validation.data as any;

    // Check for code conflict if changing code
    if (data.code && data.code !== existing[0].code) {
      const codeConflict = await db
        .select({ id: insurers.id })
        .from(insurers)
        .where(eq(insurers.code, data.code))
        .limit(1);

      if (codeConflict.length > 0) {
        return res.status(409).json({
          error: "Conflict",
          message: "An insurer with this code already exists",
        });
      }
    }

    // Update insurer
    const updated = await db
      .update(insurers)
      .set({
        ...data,
        updatedAt: new Date(),
      } as any)
      .where(eq(insurers.id, id))
      .returning();

    res.json({
      success: true,
      message: "Insurer updated successfully",
      data: updated[0],
    });
  } catch (error) {
    logger.api.error("Error updating insurer", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to update insurer",
    });
  }
});

/**
 * DELETE /api/admin/insurers/:id
 * Soft delete an insurer (sets isActive = false)
 */
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    // Check insurer exists
    const existing = await db
      .select({ id: insurers.id })
      .from(insurers)
      .where(eq(insurers.id, id))
      .limit(1);

    if (existing.length === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Insurer not found",
      });
    }

    // Soft delete by setting isActive = false
    await db
      .update(insurers)
      .set({
        isActive: false,
        updatedAt: new Date(),
      } as any)
      .where(eq(insurers.id, id));

    res.json({
      success: true,
      message: "Insurer deleted successfully",
    });
  } catch (error) {
    logger.api.error("Error deleting insurer", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to delete insurer",
    });
  }
});

export default router;
