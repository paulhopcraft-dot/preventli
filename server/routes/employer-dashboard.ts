/**
 * Employer Dashboard API Routes
 * Provides summary statistics and priority actions for employer landing page
 */

import { Router, Request, Response } from 'express';
import { authorize } from '../middleware/auth';
import { storage } from '../storage';
import { db } from '../db';
import { organizations, workerCases } from '../../shared/schema';
import { eq, sql, and } from 'drizzle-orm';
import { sendEmail } from '../services/emailService';
import { createLogger } from '../lib/logger';
import { z } from 'zod';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { HybridSummaryService } from '../services/hybridSummary';
import { callClaude } from '../lib/claude-cli';
const hybridSummaryService = new HybridSummaryService();

// Configure multer for file uploads
const uploadDir = path.join(process.cwd(), 'uploads', 'employer-cases');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const fileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({
  storage: fileStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'));
    }
  }
});

// Schema for employer case creation
// Helper: optional email — accepts empty string (form sends "" when blank) OR
// a valid email. Used for physio (optional) and to keep the existing
// workerEmail behaviour permissive.
const optionalEmail = z.union([z.literal(''), z.string().email()]).optional();

const employerCreateCaseSchema = z.object({
  workerType: z.enum(['existing', 'new']),
  existingWorkerId: z.string().optional(),
  workerName: z.string().optional(),
  workerEmail: optionalEmail,
  workerPhone: z.string().optional(),
  workerDob: z.string().optional(),
  workerAddress: z.string().optional(),
  workerRole: z.string().optional(),
  dateOfIncident: z.string(),
  incidentLocation: z.string(),
  incidentDescription: z.string(),
  injuryType: z.string(),
  hasPersonalFactors: z.string().optional(),
  personalFactorsNotes: z.string().optional(),
  requiresAdditionalSupport: z.string().optional(),
  supportNotes: z.string().optional(),
  hasRtwPlan: z.string().optional(),
  // Care team contacts (RTW multi-party distribution — phase 3).
  // Manager + treating doctor required when workerType='new'; physio always
  // optional. Enforcement is done in the route handler so existing-worker
  // submissions (which don't go through the Care Team UI) aren't blocked.
  managerName: z.string().optional(),
  managerEmail: optionalEmail,
  doctorName: z.string().optional(),
  doctorEmail: optionalEmail,
  physioName: z.string().optional(),
  physioEmail: optionalEmail,
  // WorkCover claim (RTW multi-party distribution — phase 3b).
  // Captured when hasLodgedClaim === 'true'. Claim number persists to
  // worker_cases.claimNumber; insurer details become an insurer case_contacts
  // row so phase 2 distribute resolves the insurer for the courtesy CC.
  hasLodgedClaim: z.string().optional(),
  claimNumber: z.string().optional(),
  insurerName: z.string().optional(),
  insurerCsmName: z.string().optional(),
  insurerCsmEmail: optionalEmail,
});

const logger = createLogger('EmployerDashboard');

const router = Router();

interface CaseStatistics {
  totalCases: number;
  atWork: number;
  offWork: number;
  criticalActions: number;
  urgentActions: number;
  routineActions: number;
  expiredCertificates: number;
  overdueReviews: number;
}

interface PriorityAction {
  id: string;
  workerName: string;
  action: string;
  priority: 'critical' | 'urgent' | 'routine';
  daysOverdue?: number;
  type: 'certificate' | 'review' | 'rtw_plan' | 'medical' | 'compliance';
  caseId: string;
  workStatus: string;
}

interface WorkerInfo {
  caseId: string;
  workerName: string;
  workStatus: string;
  company: string;
  dateOfInjury: string;
}

interface DashboardData {
  statistics: CaseStatistics;
  priorityActions: PriorityAction[];
  allWorkers: WorkerInfo[];
  organizationName: string;
}

// Human-readable labels for action types
const actionLabels: Record<string, string> = {
  chase_certificate: 'Obtain updated medical certificate',
  review_case: 'Review case progress',
  follow_up: 'Follow up with worker',
  schedule_appointment: 'Schedule medical appointment',
  update_rtw_plan: 'Update return to work plan',
  contact_employer: 'Contact employer',
  contact_provider: 'Contact treating provider',
};

function getActionLabel(actionType: string | null): string {
  if (!actionType) return 'Action required';
  return actionLabels[actionType] || actionType.replace(/_/g, ' ');
}

/**
 * GET /api/employer/dashboard
 * Returns comprehensive dashboard data for employer landing page
 */
router.get('/dashboard', authorize(), async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: 'Organization ID required' });
    }

    // Get organization name from database
    const orgRow = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    const organizationName = orgRow[0]?.name ?? 'Your Organization';

    // Lightweight case query — dashboard only needs basic fields, not notes/attachments/insights
    // Uses raw SQL to avoid loading full case objects with discussion notes, certificates, etc.
    const { rows: allCases } = await db.execute(
      sql`SELECT id, worker_name AS "workerName", company, work_status AS "workStatus",
              date_of_injury AS "dateOfInjury",
              compliance_indicator AS "complianceIndicator", case_status AS "caseStatus",
              has_certificate AS "hasCertificate"
       FROM worker_cases
       WHERE organization_id = ${organizationId}
         AND (case_status = 'open' OR case_status IS NULL)`
    ) as { rows: any[] };

    // Batch fetch actions and certificates in parallel
    const [allActions, allCertificates] = await Promise.all([
      storage.getAllActionsWithCaseInfo(organizationId, { status: 'pending' }),
      storage.getCertificatesByOrganization(organizationId)
    ]);

    // Build lookup maps for O(1) access
    const actionsByCase = new Map<string, typeof allActions>();
    for (const action of allActions) {
      const caseId = action.caseId;
      if (!actionsByCase.has(caseId)) {
        actionsByCase.set(caseId, []);
      }
      actionsByCase.get(caseId)!.push(action);
    }

    const certificatesByCase = new Map<string, typeof allCertificates>();
    for (const cert of allCertificates) {
      const caseId = cert.caseId;
      if (!certificatesByCase.has(caseId)) {
        certificatesByCase.set(caseId, []);
      }
      certificatesByCase.get(caseId)!.push(cert);
    }

    // Calculate statistics
    const statistics: CaseStatistics = {
      totalCases: allCases.length,
      atWork: allCases.filter(c => c.workStatus === 'At work').length,
      offWork: allCases.filter(c => c.workStatus === 'Off work').length,
      criticalActions: 0,
      urgentActions: 0,
      routineActions: 0,
      expiredCertificates: 0,
      overdueReviews: 0
    };

    // Get priority actions by analyzing all cases (now using in-memory lookups)
    const priorityActions: PriorityAction[] = [];
    const now = new Date();

    for (const workerCase of allCases) {
      const caseId = workerCase.id;
      const workerName = workerCase.workerName;

      // Get data from pre-built maps (O(1) lookup)
      const caseActions = actionsByCase.get(caseId) || [];
      const certificates = certificatesByCase.get(caseId) || [];

      // Check for expired certificates
      for (const cert of certificates) {
        if (cert.endDate && new Date(cert.endDate) < now) {
          const daysOverdue = Math.floor((now.getTime() - new Date(cert.endDate).getTime()) / (1000 * 60 * 60 * 24));

          priorityActions.push({
            id: `cert-${cert.id}`,
            workerName,
            action: `Medical certificate expired - obtain updated certificate`,
            priority: daysOverdue > 30 ? 'critical' : daysOverdue > 14 ? 'urgent' : 'routine',
            daysOverdue,
            type: 'certificate',
            caseId,
            workStatus: workerCase.workStatus || 'Unknown'
          });

          statistics.expiredCertificates++;
        }
      }

      // Check for overdue case actions
      for (const action of caseActions) {
        if (action.dueDate && new Date(action.dueDate) < now) {
          const daysOverdue = Math.floor((now.getTime() - new Date(action.dueDate).getTime()) / (1000 * 60 * 60 * 24));

          let priority: 'critical' | 'urgent' | 'routine' = 'routine';
          let actionType: 'certificate' | 'review' | 'rtw_plan' | 'medical' | 'compliance' = 'compliance';

          // Determine priority and type based on action content
          const actionText = action.type?.toLowerCase() || '';

          if (actionText.includes('certificate')) {
            actionType = 'certificate';
            priority = daysOverdue > 21 ? 'critical' : daysOverdue > 7 ? 'urgent' : 'routine';
          } else if (actionText.includes('review') || actionText.includes('follow-up')) {
            actionType = 'review';
            priority = daysOverdue > 30 ? 'critical' : daysOverdue > 14 ? 'urgent' : 'routine';
            statistics.overdueReviews++;
          } else if (actionText.includes('rtw') || actionText.includes('return to work')) {
            actionType = 'rtw_plan';
            priority = daysOverdue > 21 ? 'critical' : daysOverdue > 10 ? 'urgent' : 'routine';
          } else if (actionText.includes('medical') || actionText.includes('doctor')) {
            actionType = 'medical';
            priority = daysOverdue > 21 ? 'critical' : daysOverdue > 7 ? 'urgent' : 'routine';
          }

          priorityActions.push({
            id: `action-${action.id}`,
            workerName,
            action: getActionLabel(action.type),
            priority,
            daysOverdue,
            type: actionType,
            caseId,
            workStatus: workerCase.workStatus || 'Unknown'
          });
        }
      }

      // RTW plan awaiting employer sign-off — surfaces as critical action for Sarah
      if (workerCase.rtwPlanStatus === 'pending_employer_review') {
        priorityActions.push({
          id: `rtw-approval-${caseId}`,
          workerName,
          action: `RTW plan requires your approval`,
          priority: 'critical',
          daysOverdue: 0,
          type: 'rtw_plan',
          caseId,
          workStatus: workerCase.workStatus || 'Unknown'
        });
      } else if (workerCase.workStatus === 'Off work') {
        // Check for missing RTW plans (for cases off work > 4 weeks without any plan)
        const injuryDate = new Date(workerCase.dateOfInjury);
        const weeksSinceInjury = Math.floor((now.getTime() - injuryDate.getTime()) / (1000 * 60 * 60 * 24 * 7));

        if (weeksSinceInjury >= 4 && !workerCase.rtwPlanStatus) {
          priorityActions.push({
            id: `rtw-${caseId}`,
            workerName,
            action: `RTW plan required - worker off work for ${weeksSinceInjury} weeks`,
            priority: weeksSinceInjury > 16 ? 'critical' : weeksSinceInjury > 10 ? 'urgent' : 'routine',
            daysOverdue: Math.max(0, (weeksSinceInjury - 4) * 7),
            type: 'rtw_plan',
            caseId,
            workStatus: workerCase.workStatus || 'Unknown'
          });
        }
      }

      // Check for overdue case reviews based on injury date (every 8 weeks)
      const injuryDate = new Date(workerCase.dateOfInjury);
      const weeksSinceInjury = Math.floor((now.getTime() - injuryDate.getTime()) / (1000 * 60 * 60 * 24 * 7));
      if (weeksSinceInjury > 0 && weeksSinceInjury % 8 === 0) {
        priorityActions.push({
          id: `review-${caseId}`,
          workerName,
          action: `Case review due - ${weeksSinceInjury} weeks since injury`,
          priority: 'routine',
          type: 'review',
          caseId,
          workStatus: workerCase.workStatus || 'Unknown'
        });
      }
    }

    // Sort all actions by days overdue (most urgent first)
    priorityActions.sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0));

    // Deduplicate: each worker appears once — keep their highest-priority action.
    // A worker with Critical + Routine actions should only surface the Critical one.
    // Sarah Chen doesn't need to see the same worker 3 times; she clicks through to the case.
    const priorityOrder: Record<string, number> = { critical: 0, urgent: 1, routine: 2 };
    const bestByCase = new Map<string, PriorityAction>();
    for (const action of priorityActions) {
      const existing = bestByCase.get(action.caseId);
      if (
        !existing ||
        priorityOrder[action.priority] < priorityOrder[existing.priority] ||
        (action.priority === existing.priority && (action.daysOverdue || 0) > (existing.daysOverdue || 0))
      ) {
        bestByCase.set(action.caseId, action);
      }
    }
    const deduplicatedActions = Array.from(bestByCase.values());
    deduplicatedActions.sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0));

    // Use threshold-based priorities set during generation — do NOT redistribute by
    // relative position. Redistribution incorrectly downgrades genuinely critical cases
    // (e.g. Ava Thompson at 413 days) just because Ethan Wells is ranked higher.
    statistics.criticalActions = deduplicatedActions.filter(a => a.priority === 'critical').length;
    statistics.urgentActions = deduplicatedActions.filter(a => a.priority === 'urgent').length;
    statistics.routineActions = deduplicatedActions.filter(a => a.priority === 'routine').length;

    // Build complete worker list for filtering (not just those with actions)
    const allWorkersInfo: WorkerInfo[] = allCases.map(c => ({
      caseId: c.id,
      workerName: c.workerName,
      workStatus: c.workStatus || 'Unknown',
      company: c.company || '',
      dateOfInjury: c.dateOfInjury ? String(c.dateOfInjury) : ''
    }));

    // Take up to 20 critical, 15 urgent, 15 routine for display (50 total max)
    const criticalActions = deduplicatedActions.filter(a => a.priority === 'critical').slice(0, 20);
    const urgentActions = deduplicatedActions.filter(a => a.priority === 'urgent').slice(0, 15);
    const routineActions = deduplicatedActions.filter(a => a.priority === 'routine').slice(0, 15);
    const distributedActions = [...criticalActions, ...urgentActions, ...routineActions];

    const dashboardData: DashboardData = {
      statistics,
      priorityActions: distributedActions,
      allWorkers: allWorkersInfo,
      organizationName
    };

    logger.info('Generated employer dashboard data', {
      organizationId,
      organizationName,
      totalCases: statistics.totalCases,
      totalActions: priorityActions.length,
      criticalActions: statistics.criticalActions,
      urgentActions: statistics.urgentActions
    });

    res.json(dashboardData);

  } catch (error) {
    logger.error('Error generating dashboard data', {
      organizationId: req.user?.organizationId,
    }, error);
    res.status(500).json({
      error: 'Failed to load dashboard data',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/employer/workers
 * Returns list of workers from existing cases for this organization
 */
router.get('/workers', authorize(), async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: 'Organization ID required' });
    }

    const allCases = await storage.getCases(organizationId);

    // Build list of unique workers with their case status
    const workersMap = new Map<string, {
      id: string;
      workerName: string;
      company: string;
      hasActiveCase: boolean;
      activeCaseId?: string;
    }>();

    for (const workerCase of allCases) {
      const existingWorker = workersMap.get(workerCase.workerName);
      if (!existingWorker) {
        workersMap.set(workerCase.workerName, {
          id: workerCase.id, // Use case ID as worker ID for now
          workerName: workerCase.workerName,
          company: workerCase.company,
          hasActiveCase: workerCase.caseStatus !== 'closed',
          activeCaseId: workerCase.caseStatus !== 'closed' ? workerCase.id : undefined,
        });
      } else if (workerCase.caseStatus !== 'closed' && !existingWorker.hasActiveCase) {
        // Update with active case info if found
        existingWorker.hasActiveCase = true;
        existingWorker.activeCaseId = workerCase.id;
      }
    }

    res.json(Array.from(workersMap.values()));
  } catch (error) {
    logger.error('Error fetching workers', { organizationId: req.user?.organizationId }, error);
    res.status(500).json({ error: 'Failed to fetch workers' });
  }
});

/**
 * POST /api/employer/cases
 * Creates a new case from employer form submission
 */
router.post('/cases', authorize(), upload.any(), async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(400).json({ error: 'Organization ID required' });
    }

    // Parse and validate form data
    const validationResult = employerCreateCaseSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: validationResult.error.errors,
      });
    }

    const formData = validationResult.data;

    // Determine worker name and company
    let workerName: string;
    let existingCaseId: string | undefined;

    if (formData.workerType === 'existing' && formData.existingWorkerId) {
      // Fetch existing worker info
      const allCases = await storage.getCases(organizationId);
      const existingCase = allCases.find(c => c.id === formData.existingWorkerId);
      if (!existingCase) {
        return res.status(404).json({ error: 'Worker not found' });
      }
      workerName = existingCase.workerName;

      // Check if this is an existing active case
      if (existingCase.caseStatus !== 'closed') {
        existingCaseId = existingCase.id;
      }
    } else {
      workerName = formData.workerName || 'Unknown Worker';
    }

    // Get company name from the organization record (was previously inferred
    // from the first existing case, which fell back to "Unknown Company" for
    // any tenant with zero prior cases — e.g. Jane / Arc Electrical).
    const org = await storage.getOrganization(organizationId);
    const companyName = org?.name ?? 'Unknown Company';

    // Build summary from incident details
    const summary = `${formData.injuryType}: ${formData.incidentDescription.substring(0, 200)}${formData.incidentDescription.length > 200 ? '...' : ''}`;

    // Determine work status based on RTW plan
    const workStatus = formData.hasRtwPlan === 'true' ? 'At work' : 'Off work';

    // If existing case, we could link incident - for now, always create new case
    // TODO: In future, support linking incidents to existing cases

    // Create the case
    const newCase = await storage.createCase({
      organizationId,
      workerName,
      company: companyName,
      dateOfInjury: formData.dateOfIncident,
      workStatus,
      riskLevel: 'Medium', // Default, can be updated after review
      summary,
      workerEmail: formData.workerEmail ?? null,
    });

    // RTW multi-party distribution — phase 3:
    // Capture care-team contacts as case_contacts rows so the plan-distribute
    // flow has every recipient available at draft time. Manager + treating
    // doctor are required for new-worker submissions; physio is optional.
    // Existing-worker submissions don't go through the Care Team UI yet so
    // we only create rows when the relevant email is populated.
    const careTeamContacts: Array<{ role: string; name: string; email: string }> = [];
    if (formData.managerEmail && formData.managerName) {
      careTeamContacts.push({
        role: 'employer_primary',
        name: formData.managerName,
        email: formData.managerEmail,
      });
    }
    if (formData.doctorEmail && formData.doctorName) {
      careTeamContacts.push({
        role: 'treating_gp',
        name: formData.doctorName,
        email: formData.doctorEmail,
      });
    }
    if (formData.physioEmail && formData.physioName) {
      careTeamContacts.push({
        role: 'physiotherapist',
        name: formData.physioName,
        email: formData.physioEmail,
      });
    }

    // Phase 3b — WorkCover claim: persist claim number on the case and create
    // the insurer case_contacts row so phase 2 distribute resolves them as the
    // courtesy CC. Only when the gateway question was answered YES.
    const isWorkCover = formData.hasLodgedClaim === 'true';
    if (isWorkCover && formData.claimNumber && formData.claimNumber.trim().length > 0) {
      try {
        await db.update(workerCases)
          .set({ claimNumber: formData.claimNumber.trim() } as any)
          .where(eq(workerCases.id, newCase.id));
      } catch (err) {
        logger.error('Failed to persist claimNumber on new WorkCover case', {
          caseId: newCase.id,
        }, err);
      }
    }
    if (isWorkCover && formData.insurerCsmEmail && formData.insurerCsmName) {
      careTeamContacts.push({
        role: 'insurer',
        name: formData.insurerCsmName,
        email: formData.insurerCsmEmail,
      });
    }
    for (const c of careTeamContacts) {
      try {
        await storage.createCaseContact({
          caseId: newCase.id,
          organizationId,
          role: c.role,
          name: c.name,
          email: c.email,
          isPrimary: true,
          isActive: true,
        });
      } catch (err) {
        logger.error('Failed to create case_contact for new case', {
          caseId: newCase.id,
          role: c.role,
        }, err);
        // Don't fail the whole case creation — the contact can be added
        // manually later. Phase 2 distribute flow will surface the missing
        // contact with a blocking error pointing back to the contacts page.
      }
    }

    // Handle file uploads - store file references in caseAttachments table directly
    const files = req.files as Express.Multer.File[];
    if (files && files.length > 0) {
      const { db } = await import('../db');
      const { caseAttachments } = await import('../../shared/schema');

      for (const file of files) {
        // Get file type from form data (e.g., document_0_type)
        const fieldName = file.fieldname;
        const indexMatch = fieldName.match(/document_(\d+)/);
        const docType = indexMatch ? req.body[`document_${indexMatch[1]}_type`] || 'other' : 'other';

        await db.insert(caseAttachments).values({
          organizationId,
          caseId: newCase.id,
          name: file.originalname,
          type: docType,
          url: `/uploads/employer-cases/${file.filename}`,
        });
      }
    }

    // Store additional employer-submitted data as part of the case summary for now
    // In future, this could be stored in a dedicated employer_case_details table
    const additionalInfo = {
      incidentLocation: formData.incidentLocation,
      injuryType: formData.injuryType,
      hasPersonalFactors: formData.hasPersonalFactors === 'true',
      personalFactorsNotes: formData.personalFactorsNotes,
      requiresAdditionalSupport: formData.requiresAdditionalSupport === 'true',
      supportNotes: formData.supportNotes,
      hasRtwPlan: formData.hasRtwPlan === 'true',
      workerEmail: formData.workerEmail,
      workerPhone: formData.workerPhone,
      workerRole: formData.workerRole,
      submittedBy: req.user?.email || 'employer',
      submittedAt: new Date().toISOString(),
    };

    // Log the submission details (would be captured in audit log in production)
    logger.info('Employer case additional info', {
      caseId: newCase.id,
      additionalInfo,
    });

    logger.info('Employer case created', {
      caseId: newCase.id,
      organizationId,
      workerName,
      filesCount: files?.length || 0,
    });

    // Trigger AI summary generation asynchronously (don't block the response)
    hybridSummaryService.getCachedOrGenerateSummary(newCase.id, true).catch((err) => {
      logger.error('Failed to generate AI summary for employer case', { caseId: newCase.id }, err);
    });

    res.status(201).json({
      caseId: newCase.id,
      workerName,
      message: 'Case created successfully',
    });

  } catch (error) {
    logger.error('Error creating employer case', { organizationId: req.user?.organizationId }, error);
    res.status(500).json({
      error: 'Failed to create case',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Helper: load the injury-check-relevant fields for a case scoped to the org.
 * Returns null when the case doesn't exist or belongs to a different tenant.
 */
async function loadInjuryCheckCase(caseId: string, organizationId: string) {
  const [row] = await db
    .select({
      id: workerCases.id,
      workerName: workerCases.workerName,
      company: workerCases.company,
      summary: workerCases.summary,
      workStatus: workerCases.workStatus,
      workerEmail: workerCases.workerEmail,
      injuryCheckSentAt: workerCases.injuryCheckSentAt,
    })
    .from(workerCases)
    .where(and(eq(workerCases.id, caseId), eq(workerCases.organizationId, organizationId)))
    .limit(1);
  return row ?? null;
}

/**
 * GET /api/employer/cases/:id/injury-check-state
 * Returns the injury-check display state for the success page:
 *   { workerEmail, injuryCheckSentAt, workerName }
 * Used by the success page to render a persistent "sent" confirmation that
 * survives reloads (instead of relying on local component state).
 */
router.get('/cases/:id/injury-check-state', authorize(), async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;
    const caseId = String(req.params.id);
    if (!organizationId) return res.status(400).json({ error: 'Organization ID required' });

    const workerCase = await loadInjuryCheckCase(caseId, organizationId);
    if (!workerCase) return res.status(404).json({ error: 'Case not found' });

    res.json({
      workerName: workerCase.workerName,
      workerEmail: workerCase.workerEmail ?? '',
      injuryCheckSentAt: workerCase.injuryCheckSentAt
        ? workerCase.injuryCheckSentAt.toISOString()
        : null,
    });
  } catch (error) {
    logger.error('Error fetching injury-check state', { caseId: req.params.id }, error);
    res.status(500).json({ error: 'Failed to fetch injury-check state' });
  }
});

/**
 * POST /api/employer/cases/:id/injury-check/draft
 * Generates an AI-drafted injury check email and returns it as
 *   { to, subject, body }
 * for the employer to review/edit in the modal before sending. Does NOT send.
 *
 * Subject is generated server-side from a template (NOT the LLM) to keep it
 * deterministic and free of LLM drift / prompt-injection artefacts.
 */
router.post('/cases/:id/injury-check/draft', authorize(), async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;
    const caseId = String(req.params.id);
    if (!organizationId) return res.status(400).json({ error: 'Organization ID required' });

    const workerCase = await loadInjuryCheckCase(caseId, organizationId);
    if (!workerCase) return res.status(404).json({ error: 'Case not found' });

    const summary = workerCase.summary || '';
    const isSerious = summary.toLowerCase().includes('serious') ||
                      summary.toLowerCase().includes('severe') ||
                      summary.toLowerCase().includes('fracture') ||
                      summary.toLowerCase().includes('hospital') ||
                      workerCase.workStatus === 'Off work';

    const emailPrompt = isSerious
      ? `Generate a compassionate, supportive injury check email for a worker who has experienced a serious workplace injury.
         Worker name: ${workerCase.workerName}
         Company: ${workerCase.company}
         Injury: ${summary}

         The email should:
         - Express genuine concern for their wellbeing
         - Acknowledge the difficulty of their situation
         - Offer support and resources
         - Ask how they are recovering
         - Not pressure them about returning to work
         - Be warm and human, not corporate

         Keep it under 200 words. Start with "Dear ${workerCase.workerName}," and end with appropriate regards.`
      : `Generate a friendly check-in email for a worker who had a minor workplace incident.
         Worker name: ${workerCase.workerName}
         Company: ${workerCase.company}
         Injury: ${summary}

         The email should:
         - Check how they are doing
         - Confirm if they need any support
         - Be professional but warm
         - Ask if they have any questions about their return to work

         Keep it under 150 words. Start with "Hi ${workerCase.workerName}," and end with appropriate regards.`;

    const body = await callClaude(emailPrompt, 30_000);

    res.json({
      to: workerCase.workerEmail ?? '',
      subject: `Injury check-in — ${workerCase.workerName}`,
      body,
      tone: isSerious ? 'compassionate' : 'friendly',
    });
  } catch (error) {
    logger.error('Error generating injury-check draft', { caseId: req.params.id }, error);
    res.status(500).json({
      error: 'Failed to generate injury-check draft',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * Zod schema for the injury-check send payload. Enforced before any email
 * provider call so a malformed body can never reach Resend / SMTP.
 */
const injuryCheckSendSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
});

/**
 * POST /api/employer/cases/:id/injury-check/send
 * Sends the (possibly edited) injury-check email via the shared emailService.
 * Records injuryCheckSentAt on the case so the success page can render a
 * persistent "sent" confirmation that survives reloads.
 */
router.post('/cases/:id/injury-check/send', authorize(), async (req: Request, res: Response) => {
  try {
    const organizationId = req.user?.organizationId;
    const caseId = String(req.params.id);
    if (!organizationId) return res.status(400).json({ error: 'Organization ID required' });

    const parsed = injuryCheckSendSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: parsed.error.errors,
      });
    }

    const workerCase = await loadInjuryCheckCase(caseId, organizationId);
    if (!workerCase) return res.status(404).json({ error: 'Case not found' });

    const result = await sendEmail({
      to: parsed.data.to,
      subject: parsed.data.subject,
      body: parsed.data.body,
    });

    if (!result.success) {
      logger.error('Injury-check send failed', { caseId, error: result.error });
      return res.status(502).json({ error: 'Failed to send email', details: result.error });
    }

    const sentAt = new Date();
    // Drizzle's PgUpdateSetSource narrows to a subset of columns and doesn't
    // include the recently-added injuryCheckSentAt. Cast matches the same
    // pattern used elsewhere in storage.ts for additive columns.
    await db.update(workerCases)
      .set({ injuryCheckSentAt: sentAt } as any)
      .where(eq(workerCases.id, caseId));

    logger.info('Injury-check email sent', {
      caseId,
      workerName: workerCase.workerName,
      to: parsed.data.to,
      messageId: result.messageId,
    });

    res.json({
      success: true,
      sentTo: parsed.data.to,
      sentAt: sentAt.toISOString(),
      messageId: result.messageId,
    });
  } catch (error) {
    logger.error('Error sending injury-check', { caseId: req.params.id }, error);
    res.status(500).json({
      error: 'Failed to send injury-check email',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export { router as employerDashboardRouter };