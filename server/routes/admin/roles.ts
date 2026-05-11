import { Router, type Response } from "express";
import { db } from "../../db";
import { rtwRoles, rtwDuties, rtwDutyDemands, rtwPlans, insertRTWRoleSchema } from "@shared/schema";
import { eq, and, ilike, asc, ne, sql, count } from "drizzle-orm";
import { authorize, type AuthRequest } from "../../middleware/auth";
import { logger } from "../../lib/logger";

const router = Router();

// All routes require admin role
router.use(authorize(["admin"]));

/**
 * GET /api/admin/roles
 * List all roles for the user's organization with optional search
 * ADMIN-01: List roles
 */
router.get("/", async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;
    const search = req.query.search as string | undefined;

    // Build query with duty count subquery
    let query = db
      .select({
        id: rtwRoles.id,
        organizationId: rtwRoles.organizationId,
        name: rtwRoles.name,
        description: rtwRoles.description,
        isActive: rtwRoles.isActive,
        createdAt: rtwRoles.createdAt,
        updatedAt: rtwRoles.updatedAt,
        dutyCount: sql<number>`(
          SELECT COUNT(*)::int
          FROM rtw_duties
          WHERE rtw_duties.role_id = ${rtwRoles.id}
          AND rtw_duties.is_active = true
        )`.as("duty_count"),
      })
      .from(rtwRoles)
      .where(
        and(
          eq(rtwRoles.organizationId, organizationId),
          eq(rtwRoles.isActive, true)
        )
      )
      .orderBy(asc(rtwRoles.name));

    // Apply search filter if provided
    if (search) {
      query = db
        .select({
          id: rtwRoles.id,
          organizationId: rtwRoles.organizationId,
          name: rtwRoles.name,
          description: rtwRoles.description,
          isActive: rtwRoles.isActive,
          createdAt: rtwRoles.createdAt,
          updatedAt: rtwRoles.updatedAt,
          dutyCount: sql<number>`(
            SELECT COUNT(*)::int
            FROM rtw_duties
            WHERE rtw_duties.role_id = ${rtwRoles.id}
            AND rtw_duties.is_active = true
          )`.as("duty_count"),
        })
        .from(rtwRoles)
        .where(
          and(
            eq(rtwRoles.organizationId, organizationId),
            eq(rtwRoles.isActive, true),
            ilike(rtwRoles.name, `%${search}%`)
          )
        )
        .orderBy(asc(rtwRoles.name));
    }

    const results = await query;

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    logger.api.error("Error fetching roles", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to fetch roles",
    });
  }
});

/**
 * GET /api/admin/roles/:id
 * Get single role by ID with duties and their demands
 */
router.get("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const organizationId = req.user!.organizationId;

    // Get the role
    const roleResult = await db
      .select({
        id: rtwRoles.id,
        organizationId: rtwRoles.organizationId,
        name: rtwRoles.name,
        description: rtwRoles.description,
        isActive: rtwRoles.isActive,
        createdAt: rtwRoles.createdAt,
        updatedAt: rtwRoles.updatedAt,
      })
      .from(rtwRoles)
      .where(
        and(
          eq(rtwRoles.id, id),
          eq(rtwRoles.organizationId, organizationId)
        )
      )
      .limit(1);

    if (roleResult.length === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Role not found",
      });
    }

    // Get duties with their demands for this role
    const dutiesWithDemands = await db
      .select({
        id: rtwDuties.id,
        roleId: rtwDuties.roleId,
        organizationId: rtwDuties.organizationId,
        name: rtwDuties.name,
        description: rtwDuties.description,
        isModifiable: rtwDuties.isModifiable,
        riskFlags: rtwDuties.riskFlags,
        isActive: rtwDuties.isActive,
        createdAt: rtwDuties.createdAt,
        updatedAt: rtwDuties.updatedAt,
        // Demands
        demands: {
          id: rtwDutyDemands.id,
          bending: rtwDutyDemands.bending,
          squatting: rtwDutyDemands.squatting,
          kneeling: rtwDutyDemands.kneeling,
          twisting: rtwDutyDemands.twisting,
          reachingOverhead: rtwDutyDemands.reachingOverhead,
          reachingForward: rtwDutyDemands.reachingForward,
          lifting: rtwDutyDemands.lifting,
          liftingMaxKg: rtwDutyDemands.liftingMaxKg,
          carrying: rtwDutyDemands.carrying,
          carryingMaxKg: rtwDutyDemands.carryingMaxKg,
          standing: rtwDutyDemands.standing,
          sitting: rtwDutyDemands.sitting,
          walking: rtwDutyDemands.walking,
          repetitiveMovements: rtwDutyDemands.repetitiveMovements,
          concentration: rtwDutyDemands.concentration,
          stressTolerance: rtwDutyDemands.stressTolerance,
          workPace: rtwDutyDemands.workPace,
        },
      })
      .from(rtwDuties)
      .leftJoin(rtwDutyDemands, eq(rtwDuties.id, rtwDutyDemands.dutyId))
      .where(
        and(
          eq(rtwDuties.roleId, id),
          eq(rtwDuties.isActive, true)
        )
      );

    // Restructure to nest demands properly
    const duties = dutiesWithDemands.map((row) => ({
      id: row.id,
      roleId: row.roleId,
      organizationId: row.organizationId,
      name: row.name,
      description: row.description,
      isModifiable: row.isModifiable,
      riskFlags: row.riskFlags,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      demands: row.demands?.id ? row.demands : null,
    }));

    res.json({
      success: true,
      data: {
        ...roleResult[0],
        duties,
      },
    });
  } catch (error) {
    logger.api.error("Error fetching role", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to fetch role",
    });
  }
});

/**
 * POST /api/admin/roles
 * Create a new role
 * ADMIN-02: Create role
 */
router.post("/", async (req: AuthRequest, res: Response) => {
  try {
    const organizationId = req.user!.organizationId;

    // Validate input
    const validation = insertRTWRoleSchema.safeParse({
      ...req.body,
      organizationId,
    });

    if (!validation.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Invalid role data",
        details: validation.error.errors,
      });
    }

    const data = validation.data as any;

    // Create role
    const newRole = await db
      .insert(rtwRoles)
      .values({
        name: data.name,
        description: data.description,
        organizationId,
        isActive: true,
      } as any)
      .returning();

    res.status(201).json({
      success: true,
      message: "Role created successfully",
      data: newRole[0],
    });
  } catch (error) {
    logger.api.error("Error creating role", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to create role",
    });
  }
});

/**
 * PUT /api/admin/roles/:id
 * Update an existing role
 * ADMIN-03: Edit role
 */
router.put("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const organizationId = req.user!.organizationId;

    // Check role exists and belongs to user's organization
    const existing = await db
      .select({ id: rtwRoles.id })
      .from(rtwRoles)
      .where(
        and(
          eq(rtwRoles.id, id),
          eq(rtwRoles.organizationId, organizationId)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Role not found",
      });
    }

    // Validate input (partial update allowed)
    const updateSchema = insertRTWRoleSchema.partial();
    const validation = updateSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Invalid role data",
        details: validation.error.errors,
      });
    }

    const data = validation.data as any;

    // Update role
    const updated = await db
      .update(rtwRoles)
      .set({
        ...(data.name && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        updatedAt: new Date(),
      } as any)
      .where(eq(rtwRoles.id, id))
      .returning();

    res.json({
      success: true,
      message: "Role updated successfully",
      data: updated[0],
    });
  } catch (error) {
    logger.api.error("Error updating role", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to update role",
    });
  }
});

/**
 * DELETE /api/admin/roles/:id
 * Soft delete a role (sets isActive = false)
 * ADMIN-04: Delete role (blocked if active plans exist)
 */
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const organizationId = req.user!.organizationId;

    // Check role exists and belongs to user's organization
    const existing = await db
      .select({ id: rtwRoles.id })
      .from(rtwRoles)
      .where(
        and(
          eq(rtwRoles.id, id),
          eq(rtwRoles.organizationId, organizationId)
        )
      )
      .limit(1);

    if (existing.length === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Role not found",
      });
    }

    // Check for active RTW plans (status != 'draft') referencing this role
    const activePlans = await db
      .select({ id: rtwPlans.id })
      .from(rtwPlans)
      .where(
        and(
          eq(rtwPlans.roleId, id),
          ne(rtwPlans.status, "draft")
        )
      )
      .limit(1);

    if (activePlans.length > 0) {
      return res.status(409).json({
        error: "Conflict",
        message: "Cannot delete role - has active RTW plans",
      });
    }

    // Soft delete by setting isActive = false
    await db
      .update(rtwRoles)
      .set({
        isActive: false,
        updatedAt: new Date(),
      } as any)
      .where(eq(rtwRoles.id, id));

    res.json({
      success: true,
      message: "Role deleted successfully",
    });
  } catch (error) {
    logger.api.error("Error deleting role", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to delete role",
    });
  }
});

export default router;
