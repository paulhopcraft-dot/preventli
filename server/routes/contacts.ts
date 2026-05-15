/**
 * Case Contacts Routes - API endpoints for managing case contacts
 *
 * Features:
 * - CRUD operations for case contacts
 * - Organization-scoped access control
 * - Validation with Zod schemas
 */

import express, { type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { storage } from "../storage";
import { authorize, type AuthRequest } from "../middleware/auth";
import { requireCaseOwnership } from "../middleware/caseOwnership";
import { logger } from "../lib/logger";
import type { CaseContactRole, CaseContactDB, InsertCaseContact } from "@shared/schema";
import { logAuditEvent, AuditEventTypes } from "../services/auditLogger";

const router = express.Router();

// Authentication middleware
const requireAuth = authorize();

// =====================================================
// Validation Schemas
// =====================================================

const contactRoles: CaseContactRole[] = [
  "worker",
  "employer_primary",
  "employer_secondary",
  "host_employer",
  "case_manager",
  "treating_gp",
  "physiotherapist",
  "specialist",
  "orp",
  "insurer",
  "gpnet",
  "other",
];

const createContactSchema = z.object({
  role: z.enum(contactRoles as [CaseContactRole, ...CaseContactRole[]]),
  name: z.string().min(1, "Name is required"),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().optional().nullable(),
  company: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  isPrimary: z.boolean().optional().default(false),
});

const updateContactSchema = z.object({
  role: z.enum(contactRoles as [CaseContactRole, ...CaseContactRole[]]).optional(),
  name: z.string().min(1, "Name is required").optional(),
  phone: z.string().max(50).optional().nullable(),
  email: z.string().email().optional().nullable(),
  company: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// =====================================================
// Routes - Mounted under /api/cases/:caseId/contacts
// =====================================================

/**
 * GET /api/cases/:caseId/contacts
 * Get all contacts for a case
 */
router.get(
  "/:caseId/contacts",
  requireAuth,
  requireCaseOwnership(),
  async (req: AuthRequest, res: Response) => {
    try {
      const caseId = req.params.caseId as string;
      const organizationId = req.user!.organizationId;
      const includeInactive = req.query.includeInactive === "true";

      const contacts = await storage.getCaseContacts(caseId, organizationId, { includeInactive });

      // Inject synthetic key contacts from case data when no real contacts exist
      let allContacts = contacts;
      if (contacts.length === 0 && req.workerCase) {
        const wc = req.workerCase;
        const syntheticContacts: any[] = [];
        if (wc.workerName) {
          syntheticContacts.push({
            id: `synthetic-worker-${caseId}`,
            caseId,
            organizationId,
            role: "worker",
            name: wc.workerName,
            phone: null,
            email: null,
            company: wc.company || null,
            isPrimary: true,
            isActive: true,
            notes: "Auto-generated from case data",
            createdAt: wc.dateOfInjury || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
        if (wc.owner && wc.owner !== "Unassigned") {
          syntheticContacts.push({
            id: `synthetic-coordinator-${caseId}`,
            caseId,
            organizationId,
            role: "case_manager",
            name: wc.owner,
            phone: null,
            email: null,
            company: "Preventli Case Management",
            isPrimary: false,
            isActive: true,
            notes: "Auto-generated from case data",
            createdAt: wc.dateOfInjury || new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
        allContacts = syntheticContacts;
      }

      res.json({
        success: true,
        data: allContacts,
        total: allContacts.length,
      });
    } catch (error: any) {
      logger.api.error("Error fetching case contacts", { caseId: req.params.caseId }, error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

/**
 * POST /api/cases/:caseId/contacts
 * Create a new contact for a case
 */
router.post(
  "/:caseId/contacts",
  requireAuth,
  requireCaseOwnership(),
  async (req: AuthRequest, res: Response) => {
    try {
      const caseId = req.params.caseId as string;
      const organizationId = req.user!.organizationId;

      // Validate request body
      const parseResult = createContactSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          success: false,
          message: "Validation error",
          errors: parseResult.error.errors,
        });
      }

      const contactData: InsertCaseContact = {
        caseId,
        organizationId,
        role: parseResult.data.role,
        name: parseResult.data.name,
        phone: parseResult.data.phone || null,
        email: parseResult.data.email || null,
        company: parseResult.data.company || null,
        notes: parseResult.data.notes || null,
        isPrimary: parseResult.data.isPrimary || false,
        isActive: true,
      };

      const contact = await storage.createCaseContact(contactData);

      // Log audit event
      await logAuditEvent({
        userId: req.user!.id,
        organizationId,
        eventType: AuditEventTypes.CONTACT_CREATED,
        resourceType: "case_contact",
        resourceId: contact.id,
        metadata: {
          caseId,
          contactName: contact.name,
          contactRole: contact.role,
        },
      });

      res.status(201).json({
        success: true,
        data: contact,
      });
    } catch (error: any) {
      logger.api.error("Error creating case contact", { caseId: req.params.caseId }, error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

/**
 * GET /api/cases/:caseId/contacts/:contactId
 * Get a specific contact
 */
router.get(
  "/:caseId/contacts/:contactId",
  requireAuth,
  requireCaseOwnership(),
  async (req: AuthRequest, res: Response) => {
    try {
      const caseId = req.params.caseId as string;
      const contactId = req.params.contactId as string;
      const organizationId = req.user!.organizationId;

      const contact = await storage.getCaseContactById(contactId, organizationId);

      if (!contact || contact.caseId !== caseId) {
        return res.status(404).json({ success: false, message: "Contact not found" });
      }

      res.json({
        success: true,
        data: contact,
      });
    } catch (error: any) {
      logger.api.error("Error fetching case contact", { contactId: req.params.contactId }, error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

/**
 * PATCH /api/cases/:caseId/contacts/:contactId
 * Update a contact
 */
router.patch(
  "/:caseId/contacts/:contactId",
  requireAuth,
  requireCaseOwnership(),
  async (req: AuthRequest, res: Response) => {
    try {
      const caseId = req.params.caseId as string;
      const contactId = req.params.contactId as string;
      const organizationId = req.user!.organizationId;

      // Validate request body
      const parseResult = updateContactSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          success: false,
          message: "Validation error",
          errors: parseResult.error.errors,
        });
      }

      // Verify contact exists and belongs to this case
      const existingContact = await storage.getCaseContactById(contactId, organizationId);
      if (!existingContact || existingContact.caseId !== caseId) {
        return res.status(404).json({ success: false, message: "Contact not found" });
      }

      const updatedContact = await storage.updateCaseContact(contactId, organizationId, parseResult.data);

      // Log audit event
      await logAuditEvent({
        userId: req.user!.id,
        organizationId,
        eventType: AuditEventTypes.CONTACT_UPDATED,
        resourceType: "case_contact",
        resourceId: contactId,
        metadata: {
          caseId,
          updatedFields: Object.keys(parseResult.data),
        },
      });

      res.json({
        success: true,
        data: updatedContact,
      });
    } catch (error: any) {
      logger.api.error("Error updating case contact", { contactId: req.params.contactId }, error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

/**
 * DELETE /api/cases/:caseId/contacts/:contactId
 * Soft delete a contact (sets isActive = false)
 */
router.delete(
  "/:caseId/contacts/:contactId",
  requireAuth,
  requireCaseOwnership(),
  async (req: AuthRequest, res: Response) => {
    try {
      const caseId = req.params.caseId as string;
      const contactId = req.params.contactId as string;
      const organizationId = req.user!.organizationId;

      // Verify contact exists and belongs to this case
      const existingContact = await storage.getCaseContactById(contactId, organizationId);
      if (!existingContact || existingContact.caseId !== caseId) {
        return res.status(404).json({ success: false, message: "Contact not found" });
      }

      await storage.deleteCaseContact(contactId, organizationId);

      // Log audit event
      await logAuditEvent({
        userId: req.user!.id,
        organizationId,
        eventType: AuditEventTypes.CONTACT_DELETED,
        resourceType: "case_contact",
        resourceId: contactId,
        metadata: {
          caseId,
          contactName: existingContact.name,
          contactRole: existingContact.role,
        },
      });

      res.json({
        success: true,
        message: "Contact deleted successfully",
      });
    } catch (error: any) {
      logger.api.error("Error deleting case contact", { contactId: req.params.contactId }, error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

/**
 * POST /api/cases/:caseId/contacts/bulk
 * Create multiple contacts at once
 */
router.post(
  "/:caseId/contacts/bulk",
  requireAuth,
  requireCaseOwnership(),
  async (req: AuthRequest, res: Response) => {
    try {
      const caseId = req.params.caseId as string;
      const organizationId = req.user!.organizationId;

      // Validate request body is an array
      if (!Array.isArray(req.body)) {
        return res.status(400).json({
          success: false,
          message: "Request body must be an array of contacts",
        });
      }

      const results: { success: CaseContactDB[]; errors: { index: number; errors: any }[] } = {
        success: [],
        errors: [],
      };

      for (let i = 0; i < req.body.length; i++) {
        const parseResult = createContactSchema.safeParse(req.body[i]);
        if (!parseResult.success) {
          results.errors.push({ index: i, errors: parseResult.error.errors });
          continue;
        }

        try {
          const contactData: InsertCaseContact = {
            caseId,
            organizationId,
            role: parseResult.data.role,
            name: parseResult.data.name,
            phone: parseResult.data.phone || null,
            email: parseResult.data.email || null,
            company: parseResult.data.company || null,
            notes: parseResult.data.notes || null,
            isPrimary: parseResult.data.isPrimary || false,
            isActive: true,
          };

          const contact = await storage.createCaseContact(contactData);
          results.success.push(contact);
        } catch (err) {
          results.errors.push({ index: i, errors: err instanceof Error ? err.message : "Unknown error" });
        }
      }

      // Log audit event
      if (results.success.length > 0) {
        await logAuditEvent({
          userId: req.user!.id,
          organizationId,
          eventType: AuditEventTypes.CONTACT_CREATED,
          resourceType: "case_contact",
          resourceId: caseId,
          metadata: {
            caseId,
            bulkCreate: true,
            createdCount: results.success.length,
            errorCount: results.errors.length,
          },
        });
      }

      res.status(results.errors.length > 0 ? 207 : 201).json({
        success: results.errors.length === 0,
        data: results.success,
        errors: results.errors.length > 0 ? results.errors : undefined,
        summary: {
          created: results.success.length,
          failed: results.errors.length,
        },
      });
    } catch (error: any) {
      logger.api.error("Error bulk creating contacts", { caseId: req.params.caseId }, error);
      res.status(500).json({ success: false, message: error.message });
    }
  }
);

export default router;
