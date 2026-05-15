import { Router, type Response } from "express";
import { db } from "../../db";
import { rtwDuties, rtwDutyDemands, rtwRoles, insertRTWDutySchema, insertRTWDutyDemandsSchema } from "@shared/schema";
import { eq, and, asc } from "drizzle-orm";
import { authorize, type AuthRequest } from "../../middleware/auth";
import { z } from "zod";
import { logger } from "../../lib/logger";

const router = Router();

// All routes require admin role
router.use(authorize(["admin"]));

// Demand frequency validation
const demandFrequency = z.enum(["never", "occasionally", "frequently", "constantly"]);

// Demands schema for create/update
const demandsSchema = z.object({
  // Physical demands
  bending: demandFrequency.optional().default("never"),
  squatting: demandFrequency.optional().default("never"),
  kneeling: demandFrequency.optional().default("never"),
  twisting: demandFrequency.optional().default("never"),
  reachingOverhead: demandFrequency.optional().default("never"),
  reachingForward: demandFrequency.optional().default("never"),
  lifting: demandFrequency.optional().default("never"),
  liftingMaxKg: z.number().int().positive().nullable().optional(),
  carrying: demandFrequency.optional().default("never"),
  carryingMaxKg: z.number().int().positive().nullable().optional(),
  standing: demandFrequency.optional().default("never"),
  sitting: demandFrequency.optional().default("never"),
  walking: demandFrequency.optional().default("never"),
  repetitiveMovements: demandFrequency.optional().default("never"),
  // Cognitive demands
  concentration: demandFrequency.optional().default("never"),
  stressTolerance: demandFrequency.optional().default("never"),
  workPace: demandFrequency.optional().default("never"),
});

// Create duty schema
const createDutySchema = z.object({
  roleId: z.string().min(1, "Role ID is required"),
  name: z.string().min(1, "Duty name is required"),
  description: z.string().optional(),
  isModifiable: z.boolean().optional().default(false),
  riskFlags: z.array(z.string()).optional().default([]),
  demands: demandsSchema.optional(),
});

// Update duty schema (partial)
const updateDutySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  isModifiable: z.boolean().optional(),
  riskFlags: z.array(z.string()).optional(),
  demands: demandsSchema.partial().optional(),
});

// Copy role schema
const copyRoleSchema = z.object({
  newName: z.string().optional(),
});

/**
 * GET /api/admin/duties/role/:roleId
 * List all duties for a specific role (ADMIN-05)
 */
router.get("/role/:roleId", async (req: AuthRequest, res: Response) => {
  try {
    const roleId = req.params.roleId as string;

    // First verify the role exists
    const role = await db
      .select()
      .from(rtwRoles)
      .where(eq(rtwRoles.id, roleId))
      .limit(1);

    if (role.length === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Role not found",
      });
    }

    // Get duties with demands via left join
    const results = await db
      .select({
        duty: rtwDuties,
        demands: rtwDutyDemands,
      })
      .from(rtwDuties)
      .leftJoin(rtwDutyDemands, eq(rtwDuties.id, rtwDutyDemands.dutyId))
      .where(
        and(
          eq(rtwDuties.roleId, roleId),
          eq(rtwDuties.isActive, true)
        )
      )
      .orderBy(asc(rtwDuties.name));

    // Transform results to include demands as nested object
    const duties = results.map(({ duty, demands }) => ({
      ...duty,
      demands: demands || null,
    }));

    res.json({
      success: true,
      data: duties,
      count: duties.length,
    });
  } catch (error) {
    logger.api.error("Error fetching duties for role", { roleId: req.params.roleId }, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to fetch duties",
    });
  }
});

/**
 * GET /api/admin/duties/:id
 * Get single duty with demands
 */
router.get("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    const result = await db
      .select({
        duty: rtwDuties,
        demands: rtwDutyDemands,
      })
      .from(rtwDuties)
      .leftJoin(rtwDutyDemands, eq(rtwDuties.id, rtwDutyDemands.dutyId))
      .where(eq(rtwDuties.id, id))
      .limit(1);

    if (result.length === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Duty not found",
      });
    }

    const { duty, demands } = result[0];

    res.json({
      success: true,
      data: {
        ...duty,
        demands: demands || null,
      },
    });
  } catch (error) {
    logger.api.error("Error fetching duty", { dutyId: req.params.id }, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to fetch duty",
    });
  }
});

/**
 * POST /api/admin/duties
 * Create new duty with demands (ADMIN-06, 07, 08, 09)
 */
router.post("/", async (req: AuthRequest, res: Response) => {
  try {
    // Validate input
    const validation = createDutySchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Invalid duty data",
        details: validation.error.errors,
      });
    }

    const { roleId, name, description, isModifiable, riskFlags, demands } = validation.data;

    // Verify role exists and get organizationId
    const role = await db
      .select()
      .from(rtwRoles)
      .where(eq(rtwRoles.id, roleId))
      .limit(1);

    if (role.length === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Role not found",
      });
    }

    const organizationId = role[0].organizationId;

    // Use transaction to ensure both duty and demands are created atomically
    const result = await db.transaction(async (tx) => {
      // Create duty
      const [newDuty] = await tx
        .insert(rtwDuties)
        .values({
          roleId,
          organizationId,
          name,
          description: description || null,
          isModifiable: isModifiable ?? false,
          riskFlags: riskFlags || [],
        } as any)
        .returning();

      // Create demands record (always create, with defaults if not provided)
      const demandValues = {
        dutyId: newDuty.id,
        bending: demands?.bending || "never",
        squatting: demands?.squatting || "never",
        kneeling: demands?.kneeling || "never",
        twisting: demands?.twisting || "never",
        reachingOverhead: demands?.reachingOverhead || "never",
        reachingForward: demands?.reachingForward || "never",
        lifting: demands?.lifting || "never",
        liftingMaxKg: demands?.liftingMaxKg ?? null,
        carrying: demands?.carrying || "never",
        carryingMaxKg: demands?.carryingMaxKg ?? null,
        standing: demands?.standing || "never",
        sitting: demands?.sitting || "never",
        walking: demands?.walking || "never",
        repetitiveMovements: demands?.repetitiveMovements || "never",
        concentration: demands?.concentration || "never",
        stressTolerance: demands?.stressTolerance || "never",
        workPace: demands?.workPace || "never",
      };

      const [newDemands] = await tx
        .insert(rtwDutyDemands)
        .values(demandValues as any)
        .returning();

      return { duty: newDuty, demands: newDemands };
    });

    res.status(201).json({
      success: true,
      message: "Duty created successfully",
      data: {
        ...result.duty,
        demands: result.demands,
      },
    });
  } catch (error) {
    logger.api.error("Error creating duty", {}, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to create duty",
    });
  }
});

/**
 * PUT /api/admin/duties/:id
 * Update duty and demands (ADMIN-10)
 */
router.put("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    // Check duty exists
    const existing = await db
      .select()
      .from(rtwDuties)
      .where(eq(rtwDuties.id, id))
      .limit(1);

    if (existing.length === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Duty not found",
      });
    }

    // Validate input
    const validation = updateDutySchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Invalid duty data",
        details: validation.error.errors,
      });
    }

    const { name, description, isModifiable, riskFlags, demands } = validation.data;

    // Use transaction to update both duty and demands
    const result = await db.transaction(async (tx) => {
      // Build duty update object (only include provided fields)
      const dutyUpdate: Record<string, any> = {
        updatedAt: new Date(),
      };
      if (name !== undefined) dutyUpdate.name = name;
      if (description !== undefined) dutyUpdate.description = description;
      if (isModifiable !== undefined) dutyUpdate.isModifiable = isModifiable;
      if (riskFlags !== undefined) dutyUpdate.riskFlags = riskFlags;

      // Update duty
      const [updatedDuty] = await tx
        .update(rtwDuties)
        .set(dutyUpdate as any)
        .where(eq(rtwDuties.id, id))
        .returning();

      // Update or insert demands if provided
      let updatedDemands = null;
      if (demands && Object.keys(demands).length > 0) {
        // Check if demands record exists
        const existingDemands = await tx
          .select()
          .from(rtwDutyDemands)
          .where(eq(rtwDutyDemands.dutyId, id))
          .limit(1);

        const demandUpdate: Record<string, any> = {
          updatedAt: new Date(),
        };

        // Add provided demand fields
        if (demands.bending !== undefined) demandUpdate.bending = demands.bending;
        if (demands.squatting !== undefined) demandUpdate.squatting = demands.squatting;
        if (demands.kneeling !== undefined) demandUpdate.kneeling = demands.kneeling;
        if (demands.twisting !== undefined) demandUpdate.twisting = demands.twisting;
        if (demands.reachingOverhead !== undefined) demandUpdate.reachingOverhead = demands.reachingOverhead;
        if (demands.reachingForward !== undefined) demandUpdate.reachingForward = demands.reachingForward;
        if (demands.lifting !== undefined) demandUpdate.lifting = demands.lifting;
        if (demands.liftingMaxKg !== undefined) demandUpdate.liftingMaxKg = demands.liftingMaxKg;
        if (demands.carrying !== undefined) demandUpdate.carrying = demands.carrying;
        if (demands.carryingMaxKg !== undefined) demandUpdate.carryingMaxKg = demands.carryingMaxKg;
        if (demands.standing !== undefined) demandUpdate.standing = demands.standing;
        if (demands.sitting !== undefined) demandUpdate.sitting = demands.sitting;
        if (demands.walking !== undefined) demandUpdate.walking = demands.walking;
        if (demands.repetitiveMovements !== undefined) demandUpdate.repetitiveMovements = demands.repetitiveMovements;
        if (demands.concentration !== undefined) demandUpdate.concentration = demands.concentration;
        if (demands.stressTolerance !== undefined) demandUpdate.stressTolerance = demands.stressTolerance;
        if (demands.workPace !== undefined) demandUpdate.workPace = demands.workPace;

        if (existingDemands.length > 0) {
          // Update existing demands
          [updatedDemands] = await tx
            .update(rtwDutyDemands)
            .set(demandUpdate as any)
            .where(eq(rtwDutyDemands.dutyId, id))
            .returning();
        } else {
          // Insert new demands record
          [updatedDemands] = await tx
            .insert(rtwDutyDemands)
            .values({
              dutyId: id,
              ...demandUpdate,
            } as any)
            .returning();
        }
      } else {
        // Fetch existing demands for response
        const existingDemands = await tx
          .select()
          .from(rtwDutyDemands)
          .where(eq(rtwDutyDemands.dutyId, id))
          .limit(1);
        updatedDemands = existingDemands[0] || null;
      }

      return { duty: updatedDuty, demands: updatedDemands };
    });

    res.json({
      success: true,
      message: "Duty updated successfully",
      data: {
        ...result.duty,
        demands: result.demands,
      },
    });
  } catch (error) {
    logger.api.error("Error updating duty", { dutyId: req.params.id }, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to update duty",
    });
  }
});

/**
 * DELETE /api/admin/duties/:id
 * Soft delete duty (ADMIN-11)
 */
router.delete("/:id", async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;

    // Check duty exists
    const existing = await db
      .select({ id: rtwDuties.id })
      .from(rtwDuties)
      .where(eq(rtwDuties.id, id))
      .limit(1);

    if (existing.length === 0) {
      return res.status(404).json({
        error: "Not Found",
        message: "Duty not found",
      });
    }

    // Soft delete by setting isActive = false
    await db
      .update(rtwDuties)
      .set({
        isActive: false,
        updatedAt: new Date(),
      } as any)
      .where(eq(rtwDuties.id, id));

    res.json({
      success: true,
      message: "Duty deleted successfully",
    });
  } catch (error) {
    logger.api.error("Error deleting duty", { dutyId: req.params.id }, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to delete duty",
    });
  }
});

/**
 * POST /api/admin/duties/role/:roleId/copy
 * Copy role with all duties (ADMIN-12)
 */
router.post("/role/:roleId/copy", async (req: AuthRequest, res: Response) => {
  try {
    const roleId = req.params.roleId as string;

    // Validate input
    const validation = copyRoleSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: "Bad Request",
        message: "Invalid copy parameters",
        details: validation.error.errors,
      });
    }

    const { newName } = validation.data;

    // Get source role
    const [sourceRole] = await db
      .select()
      .from(rtwRoles)
      .where(eq(rtwRoles.id, roleId))
      .limit(1);

    if (!sourceRole) {
      return res.status(404).json({
        error: "Not Found",
        message: "Role not found",
      });
    }

    // Get all active duties with demands for the source role
    const sourceDuties = await db
      .select({
        duty: rtwDuties,
        demands: rtwDutyDemands,
      })
      .from(rtwDuties)
      .leftJoin(rtwDutyDemands, eq(rtwDuties.id, rtwDutyDemands.dutyId))
      .where(
        and(
          eq(rtwDuties.roleId, roleId),
          eq(rtwDuties.isActive, true)
        )
      );

    // Use transaction to copy everything atomically
    const result = await db.transaction(async (tx) => {
      // Create new role
      const [newRole] = await tx
        .insert(rtwRoles)
        .values({
          organizationId: sourceRole.organizationId,
          name: newName || `${sourceRole.name} (Copy)`,
          description: sourceRole.description,
        } as any)
        .returning();

      // Copy each duty with its demands
      const copiedDuties = [];
      for (const { duty, demands } of sourceDuties) {
        // Create new duty
        const [newDuty] = await tx
          .insert(rtwDuties)
          .values({
            roleId: newRole.id,
            organizationId: sourceRole.organizationId,
            name: duty.name,
            description: duty.description,
            isModifiable: duty.isModifiable,
            riskFlags: duty.riskFlags || [],
          } as any)
          .returning();

        // Copy demands if they exist
        let newDemands = null;
        if (demands) {
          [newDemands] = await tx
            .insert(rtwDutyDemands)
            .values({
              dutyId: newDuty.id,
              bending: demands.bending,
              squatting: demands.squatting,
              kneeling: demands.kneeling,
              twisting: demands.twisting,
              reachingOverhead: demands.reachingOverhead,
              reachingForward: demands.reachingForward,
              lifting: demands.lifting,
              liftingMaxKg: demands.liftingMaxKg,
              carrying: demands.carrying,
              carryingMaxKg: demands.carryingMaxKg,
              standing: demands.standing,
              sitting: demands.sitting,
              walking: demands.walking,
              repetitiveMovements: demands.repetitiveMovements,
              concentration: demands.concentration,
              stressTolerance: demands.stressTolerance,
              workPace: demands.workPace,
            } as any)
            .returning();
        }

        copiedDuties.push({
          ...newDuty,
          demands: newDemands,
        });
      }

      return { role: newRole, duties: copiedDuties };
    });

    res.status(201).json({
      success: true,
      message: `Role copied successfully with ${result.duties.length} duties`,
      data: {
        role: result.role,
        duties: result.duties,
        copiedFrom: {
          roleId: sourceRole.id,
          roleName: sourceRole.name,
        },
      },
    });
  } catch (error) {
    logger.api.error("Error copying role", { roleId: req.params.roleId }, error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "Failed to copy role",
    });
  }
});

export default router;
