import { eq } from "drizzle-orm";
import {
  terminationProcesses,
  workerCases,
  documentTemplates,
  generatedDocuments,
  auditEvents,
  type TerminationProcessDB,
  type WorkerCaseDB,
  type TerminationProcess,
  type EmploymentStatus,
  type TerminationDecision,
  type PayStatusDuringStandDown,
  type TerminationAuditFlag,
} from "@shared/schema";
import { db } from "../db";
import { logger } from "../lib/logger";

const TERMINATION_TEMPLATE_CODE = "TERMINATION_LETTER";
const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 6;
const DEFAULT_TERMINATION_TEMPLATE = `{{date}}

{{workerName}}
{{workerAddressLine1}}
{{workerAddressLine2}}

Dear {{workerFirstName}},

Re: Termination of Employment

We write further to our recent correspondence and the request for medical information regarding your capacity to perform the inherent requirements of your pre-injury position as {{positionTitle}} at {{companyName}}.

{{#noAdditionalMedicalInfo}}
{{companyName}} has not received any additional medical information regarding your ability to carry out the inherent requirements of your pre-injury position as {{positionTitle}}.
{{/noAdditionalMedicalInfo}}

{{#medicalInfoReceivedNotFit}}
{{companyName}} has received the medical information submitted by {{doctorName}}. After reviewing this material, we are not satisfied that you are fit to carry out the inherent requirements of your pre-injury position as {{positionTitle}} now or in the foreseeable future.

{{medicalExplanation}}
{{/medicalInfoReceivedNotFit}}

{{#medicalInfoReceivedFit}}
{{companyName}} has received the medical information submitted by {{doctorName}} regarding your ability to carry out the inherent requirements of your pre-injury position as {{positionTitle}}. On the basis of that information, we have concluded that your employment will not be terminated at this time, and we will continue to work with you regarding your return to work.
{{/medicalInfoReceivedFit}}

{{#employmentTerminated}}
It is with regret that we advise the available information supports that you are unable to carry out the inherent requirements of your pre-injury position as {{positionTitle}} and are unlikely to be able to do so in the foreseeable future.

Together with you, we have explored alternative positions within {{companyName}} and have not been able to identify any suitable options that would accommodate your current level of reduced capacity.

On the basis of the above, your employment with {{companyName}} is terminated on incapacity grounds, effective from {{terminationDate}}.

Your employment entitlements will be paid to you on {{entitlementPaymentDate}}, including:
- Payment of your notice period (if applicable),
- Accrued but untaken annual leave, and
- Any other applicable entitlements in accordance with legislation and your contract.

We will also provide you with a Separation Certificate.

We thank you for the contribution you have made to our business since your commencement and we wish you well in your future endeavours.
{{/employmentTerminated}}

Yours sincerely,

{{managerName}}
{{managerTitle}}
{{managerPhone}}`;

function toIso(value: Date | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function mapProcess(row: TerminationProcessDB): TerminationProcess {
  return {
    id: row.id,
    workerCaseId: row.workerCaseId,
    status: row.status as TerminationProcess["status"],
    preInjuryRole: row.preInjuryRole ?? null,
    rtWAttemptsSummary: row.rtWAttemptsSummary ?? null,
    hasSustainableRole: row.hasSustainableRole ?? null,
    alternativeRolesConsideredSummary: row.alternativeRolesConsideredSummary ?? null,
    agentMeetingDate: toIso(row.agentMeetingDate),
    agentMeetingNotesId: row.agentMeetingNotesId ?? null,
    consultantInviteDate: toIso(row.consultantInviteDate),
    consultantAppointmentDate: toIso(row.consultantAppointmentDate),
    consultantReportId: row.consultantReportId ?? null,
    longTermRestrictionsSummary: row.longTermRestrictionsSummary ?? null,
    canReturnPreInjuryRole: row.canReturnPreInjuryRole ?? null,
    preTerminationInviteSentDate: toIso(row.preTerminationInviteSentDate),
    preTerminationMeetingDate: toIso(row.preTerminationMeetingDate),
    preTerminationMeetingLocation: row.preTerminationMeetingLocation ?? null,
    workerAllowedRepresentative: row.workerAllowedRepresentative ?? null,
    workerInstructedNotToAttendWork: row.workerInstructedNotToAttendWork ?? null,
    payStatusDuringStandDown: row.payStatusDuringStandDown as PayStatusDuringStandDown | null,
    preTerminationLetterDocId: row.preTerminationLetterDocId ?? null,
    preTerminationMeetingHeld: row.preTerminationMeetingHeld ?? null,
    preTerminationMeetingNotesId: row.preTerminationMeetingNotesId ?? null,
    anyNewMedicalInfoProvided: row.anyNewMedicalInfoProvided ?? null,
    newMedicalDocsSummary: row.newMedicalDocsSummary ?? null,
    decision: row.decision as TerminationDecision,
    decisionDate: toIso(row.decisionDate),
    decisionRationale: row.decisionRationale ?? null,
    terminationEffectiveDate: toIso(row.terminationEffectiveDate),
    terminationNoticeWeeks: row.terminationNoticeWeeks ?? null,
    noticeType: row.noticeType as TerminationProcess["noticeType"],
    terminationLetterDocId: row.terminationLetterDocId ?? null,
    entitlementsSummary: row.entitlementsSummary ?? null,
    ongoingCompArrangements: row.ongoingCompArrangements ?? null,
    createdAt: toIso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIso(row.updatedAt) ?? new Date().toISOString(),
  };
}

async function recordAudit(caseId: string, eventType: string, metadata?: Record<string, any>) {
  try {
    await db.insert(auditEvents).values({
      eventType,
      resourceType: "worker_case",
      resourceId: caseId,
      metadata: metadata ?? null,
    } as any);
  } catch (err) {
    logger.audit.warn("Failed to record termination audit event", { caseId, eventType }, err);
  }
}

async function ensureWorkerCase(caseId: string): Promise<WorkerCaseDB> {
  const rows = await db.select().from(workerCases).where(eq(workerCases.id, caseId)).limit(1);
  if (!rows.length) {
    throw Object.assign(new Error("Case not found"), { status: 404 });
  }
  return rows[0];
}

export class TerminationService {
  // Internal method that returns raw DB type for update operations
  private async getOrCreateProcessRaw(workerCaseId: string): Promise<TerminationProcessDB> {
    const workerCase = await ensureWorkerCase(workerCaseId);
    const existing = await db
      .select()
      .from(terminationProcesses)
      .where(eq(terminationProcesses.workerCaseId, workerCaseId))
      .limit(1);

    if (existing.length) {
      return existing[0];
    }

    const inserted = await db
      .insert(terminationProcesses)
      .values({
        organizationId: workerCase.organizationId,
        workerCaseId,
        status: "NOT_STARTED",
        preInjuryRole: null,
      } as any)
      .returning();

    const newProcess = inserted[0];

    await db
      .update(workerCases)
      .set({ terminationProcessId: newProcess.id, employmentStatus: "ACTIVE" } as any)
      .where(eq(workerCases.id, workerCaseId));

    await recordAudit(workerCaseId, "termination_process_created", { processId: newProcess.id });
    return newProcess;
  }

  async getOrCreateProcess(workerCaseId: string): Promise<TerminationProcess> {
    const raw = await this.getOrCreateProcessRaw(workerCaseId);
    return mapProcess(raw);
  }

  async initiate(workerCaseId: string, payload: { rtWAttemptsSummary: string; alternativeRolesConsideredSummary: string; hasSustainableRole: boolean; preInjuryRole?: string }) {
    const workerCase = await ensureWorkerCase(workerCaseId);
    if (payload.hasSustainableRole) {
      throw Object.assign(new Error("Sustainable role available – cannot initiate termination."), { status: 400 });
    }

    const process = await this.getOrCreateProcessRaw(workerCaseId);
    const [updated] = await db
      .update(terminationProcesses)
      .set({
        status: "PREP_EVIDENCE",
        preInjuryRole: payload.preInjuryRole ?? process.preInjuryRole ?? workerCase.summary ?? null,
        rtWAttemptsSummary: payload.rtWAttemptsSummary,
        hasSustainableRole: false,
        alternativeRolesConsideredSummary: payload.alternativeRolesConsideredSummary,
        updatedAt: new Date(),
      } as any)
      .where(eq(terminationProcesses.id, process.id))
      .returning();

    await db
      .update(workerCases)
      .set({
        employmentStatus: "TERMINATION_IN_PROGRESS",
        terminationProcessId: process.id,
        terminationReason: "INCAPACITY",
        updatedAt: new Date(),
      } as any)
      .where(eq(workerCases.id, workerCaseId));

    await recordAudit(workerCaseId, "termination_initiated", { processId: process.id });
    return mapProcess(updated);
  }

  async updateEvidence(workerCaseId: string, payload: Partial<TerminationProcess>) {
    const process = await this.getOrCreateProcessRaw(workerCaseId);
    const [updated] = await db
      .update(terminationProcesses)
      .set({
        preInjuryRole: payload.preInjuryRole ?? process.preInjuryRole,
        rtWAttemptsSummary: payload.rtWAttemptsSummary ?? process.rtWAttemptsSummary,
        alternativeRolesConsideredSummary:
          payload.alternativeRolesConsideredSummary ?? process.alternativeRolesConsideredSummary,
        hasSustainableRole: payload.hasSustainableRole ?? process.hasSustainableRole,
        status: process.status === "NOT_STARTED" ? "PREP_EVIDENCE" : process.status,
        updatedAt: new Date(),
      } as any)
      .where(eq(terminationProcesses.id, process.id))
      .returning();

    await recordAudit(workerCaseId, "termination_evidence_updated", { processId: process.id });
    return mapProcess(updated);
  }

  async updateAgentMeeting(workerCaseId: string, payload: { agentMeetingDate?: string; agentMeetingNotesId?: string }) {
    const process = await this.getOrCreateProcessRaw(workerCaseId);
    const [updated] = await db
      .update(terminationProcesses)
      .set({
        agentMeetingDate: payload.agentMeetingDate ? new Date(payload.agentMeetingDate) : process.agentMeetingDate,
        agentMeetingNotesId: payload.agentMeetingNotesId ?? process.agentMeetingNotesId,
        status: "AGENT_MEETING",
        updatedAt: new Date(),
      } as any)
      .where(eq(terminationProcesses.id, process.id))
      .returning();

    await recordAudit(workerCaseId, "termination_agent_meeting_updated", { processId: process.id });
    return mapProcess(updated);
  }

  async updateConsultantConfirmation(
    workerCaseId: string,
    payload: {
      consultantInviteDate?: string;
      consultantAppointmentDate?: string;
      consultantReportId?: string;
      longTermRestrictionsSummary?: string;
      canReturnPreInjuryRole?: boolean | null;
    },
  ) {
    const process = await this.getOrCreateProcessRaw(workerCaseId);
    if (payload.canReturnPreInjuryRole === true) {
      throw Object.assign(
        new Error("Consultant indicates worker can return to pre-injury role. Do not proceed to termination."),
        { status: 400 },
      );
    }

    const [updated] = await db
      .update(terminationProcesses)
      .set({
        consultantInviteDate: payload.consultantInviteDate ? new Date(payload.consultantInviteDate) : process.consultantInviteDate,
        consultantAppointmentDate: payload.consultantAppointmentDate ? new Date(payload.consultantAppointmentDate) : process.consultantAppointmentDate,
        consultantReportId: payload.consultantReportId ?? process.consultantReportId,
        longTermRestrictionsSummary: payload.longTermRestrictionsSummary ?? process.longTermRestrictionsSummary,
        canReturnPreInjuryRole:
          payload.canReturnPreInjuryRole !== undefined ? payload.canReturnPreInjuryRole : process.canReturnPreInjuryRole,
        status: "CONSULTANT_CONFIRMATION",
        updatedAt: new Date(),
      } as any)
      .where(eq(terminationProcesses.id, process.id))
      .returning();

    await recordAudit(workerCaseId, "termination_consultant_confirmation", { processId: process.id });
    return mapProcess(updated);
  }

  async preTerminationInvite(
    workerCaseId: string,
    payload: {
      preTerminationMeetingDate: string;
      preTerminationMeetingLocation?: string;
      workerAllowedRepresentative?: boolean;
      workerInstructedNotToAttendWork?: boolean;
      payStatusDuringStandDown?: PayStatusDuringStandDown | null;
    },
  ) {
    const process = await this.getOrCreateProcessRaw(workerCaseId);
    const meetingDate = new Date(payload.preTerminationMeetingDate);
    const now = new Date();
    const diffDays = (meetingDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays < 7) {
      throw Object.assign(new Error("Pre-termination meeting must be scheduled at least 7 days from today."), {
        status: 400,
      });
    }

    const inviteContent = `Pre-termination invite for case ${workerCaseId} scheduled on ${meetingDate.toISOString()} at ${payload.preTerminationMeetingLocation || "TBD"}. Representative allowed: ${
      payload.workerAllowedRepresentative ?? true
    }.`;
    const [doc] = await db
      .insert(generatedDocuments)
      .values({
        workerCaseId,
        templateCode: "PRE_TERMINATION_INVITE",
        content: inviteContent,
      } as any)
      .returning();

    const [updated] = await db
      .update(terminationProcesses)
      .set({
        preTerminationInviteSentDate: now,
        preTerminationMeetingDate: meetingDate,
        preTerminationMeetingLocation: payload.preTerminationMeetingLocation ?? null,
        workerAllowedRepresentative:
          payload.workerAllowedRepresentative !== undefined ? payload.workerAllowedRepresentative : true,
        workerInstructedNotToAttendWork:
          payload.workerInstructedNotToAttendWork !== undefined ? payload.workerInstructedNotToAttendWork : null,
        payStatusDuringStandDown: payload.payStatusDuringStandDown ?? null,
        preTerminationLetterDocId: doc.id,
        status: "PRE_TERMINATION_INVITE_SENT",
        updatedAt: new Date(),
      } as any)
      .where(eq(terminationProcesses.id, process.id))
      .returning();

    await recordAudit(workerCaseId, "termination_pre_invite_sent", { processId: process.id, docId: doc.id });
    return mapProcess(updated);
  }

  async preTerminationMeeting(
    workerCaseId: string,
    payload: {
      preTerminationMeetingHeld?: boolean;
      preTerminationMeetingNotesId?: string;
      anyNewMedicalInfoProvided?: boolean;
      newMedicalDocsSummary?: string | null;
    },
  ) {
    const process = await this.getOrCreateProcessRaw(workerCaseId);
    const [updated] = await db
      .update(terminationProcesses)
      .set({
        preTerminationMeetingHeld:
          payload.preTerminationMeetingHeld !== undefined
            ? payload.preTerminationMeetingHeld
            : process.preTerminationMeetingHeld,
        preTerminationMeetingNotesId: payload.preTerminationMeetingNotesId ?? process.preTerminationMeetingNotesId,
        anyNewMedicalInfoProvided:
          payload.anyNewMedicalInfoProvided !== undefined
            ? payload.anyNewMedicalInfoProvided
            : process.anyNewMedicalInfoProvided,
        newMedicalDocsSummary: payload.newMedicalDocsSummary ?? process.newMedicalDocsSummary,
        status: "DECISION_PENDING",
        updatedAt: new Date(),
      } as any)
      .where(eq(terminationProcesses.id, process.id))
      .returning();

    await recordAudit(workerCaseId, "termination_pre_meeting_logged", { processId: process.id });
    return mapProcess(updated);
  }

  private async fetchTemplate(): Promise<string> {
    const rows = await db
      .select()
      .from(documentTemplates)
      .where(eq(documentTemplates.code, TERMINATION_TEMPLATE_CODE))
      .limit(1);
    if (rows.length) return rows[0].body;
    return DEFAULT_TERMINATION_TEMPLATE;
  }

  private renderTemplate(template: string, context: Record<string, string | boolean | null | undefined>) {
    // Handle conditional sections
    template = template.replace(/{{#(.*?)}}([\s\S]*?){{\/\1}}/g, (_match, key, inner) => {
      const value = context[key];
      if (value === undefined || value === null || value === false) {
        return "";
      }
      return inner;
    });

    return template.replace(/{{(.*?)}}/g, (_m, key) => {
      const value = context[key.trim()];
      return value === undefined || value === null ? "" : String(value);
    });
  }

  private buildTerminationLetterContext(process: TerminationProcessDB, workerCase: WorkerCaseDB, extra: {
    medicalExplanation?: string;
    doctorName?: string;
    managerName?: string;
    managerTitle?: string;
    managerPhone?: string;
  }) {
    const terminationDate = process.terminationEffectiveDate
      ? new Date(process.terminationEffectiveDate).toLocaleDateString("en-AU")
      : "";
    const entitlementPaymentDate = process.terminationEffectiveDate
      ? new Date(process.terminationEffectiveDate).toLocaleDateString("en-AU")
      : "";
    const workerName = workerCase.workerName;
    const workerFirstName = workerName.split(" ")[0] || workerName;
    return {
      date: new Date().toLocaleDateString("en-AU"),
      workerName,
      workerFirstName,
      workerAddressLine1: "",
      workerAddressLine2: "",
      positionTitle: process.preInjuryRole ?? "your pre-injury role",
      companyName: workerCase.company,
      doctorName: extra.doctorName ?? "",
      medicalExplanation: extra.medicalExplanation ?? "",
      terminationDate,
      entitlementPaymentDate,
      managerName: extra.managerName ?? "Preventli Manager",
      managerTitle: extra.managerTitle ?? "Manager",
      managerPhone: extra.managerPhone ?? "",
      noAdditionalMedicalInfo: !process.anyNewMedicalInfoProvided,
      medicalInfoReceivedNotFit: process.canReturnPreInjuryRole === false,
      medicalInfoReceivedFit: process.canReturnPreInjuryRole === true,
      employmentTerminated: process.decision === "TERMINATE",
    };
  }

  async decide(workerCaseId: string, payload: {
    decision: TerminationDecision;
    decisionRationale?: string;
    terminationEffectiveDate?: string;
    terminationNoticeWeeks?: number | null;
    noticeType?: "WORKED" | "PAID_IN_LIEU" | "MIXED" | null;
    entitlementsSummary?: string | null;
    ongoingCompArrangements?: string | null;
    medicalExplanation?: string;
    doctorName?: string;
    managerName?: string;
    managerTitle?: string;
    managerPhone?: string;
  }) {
    const process = await this.getOrCreateProcessRaw(workerCaseId);
    const workerCase = await ensureWorkerCase(workerCaseId);
    const now = new Date();

    let terminationLetterDocId: string | null = process.terminationLetterDocId ?? null;
    let terminationAuditFlag: TerminationAuditFlag = workerCase.terminationAuditFlag as TerminationAuditFlag ?? null;

    if (payload.decision === "TERMINATE") {
      const template = await this.fetchTemplate();
      const context = this.buildTerminationLetterContext(process, workerCase, {
        medicalExplanation: payload.medicalExplanation,
        doctorName: payload.doctorName,
        managerName: payload.managerName,
        managerTitle: payload.managerTitle,
        managerPhone: payload.managerPhone,
      });
      const content = this.renderTemplate(template, context);
      const [doc] = await db
        .insert(generatedDocuments)
        .values({
          workerCaseId,
          templateCode: TERMINATION_TEMPLATE_CODE,
          content,
        } as any)
        .returning();
      terminationLetterDocId = doc.id;

      // audit flag if evidence is stale
      if (process.consultantAppointmentDate) {
        const consultantDate = new Date(process.consultantAppointmentDate);
        if (now.getTime() - consultantDate.getTime() > SIX_MONTHS_MS) {
          terminationAuditFlag = "HIGH_RISK";
        } else {
          terminationAuditFlag = "OK";
        }
      }
    }

    const decisionDate = now;
    const terminationEffectiveDate = payload.terminationEffectiveDate ? new Date(payload.terminationEffectiveDate) : null;

    const [updatedProcess] = await db
      .update(terminationProcesses)
      .set({
        decision: payload.decision,
        decisionRationale: payload.decisionRationale ?? null,
        decisionDate,
        terminationEffectiveDate,
        terminationNoticeWeeks: payload.terminationNoticeWeeks ?? null,
        noticeType: payload.noticeType ?? null,
        entitlementsSummary: payload.entitlementsSummary ?? null,
        ongoingCompArrangements: payload.ongoingCompArrangements ?? null,
        terminationLetterDocId,
        status: payload.decision === "TERMINATE" ? "TERMINATED" : "TERMINATION_ABORTED",
        updatedAt: new Date(),
      } as any)
      .where(eq(terminationProcesses.id, process.id))
      .returning();

    const employmentStatus: EmploymentStatus =
      payload.decision === "TERMINATE" ? "TERMINATED" : "ACTIVE";

    await db
      .update(workerCases)
      .set({
        employmentStatus,
        terminationReason: payload.decision === "TERMINATE" ? "INCAPACITY" : null,
        terminationAuditFlag: terminationAuditFlag ?? workerCase.terminationAuditFlag ?? null,
        updatedAt: new Date(),
      } as any)
      .where(eq(workerCases.id, workerCaseId));

    await recordAudit(workerCaseId, "termination_decision", { processId: process.id, decision: payload.decision });
    return mapProcess(updatedProcess);
  }

  /**
   * Phase 9.3 — Record WorkSafe notification (mandatory step after TERMINATED).
   * Transitions the process to WORKSAFE_NOTIFIED terminal state.
   */
  async notifyWorksafe(workerCaseId: string, notifiedAt?: string): Promise<TerminationProcess> {
    const process = await this.getOrCreateProcessRaw(workerCaseId);
    if (!process) throw Object.assign(new Error("Termination process not found"), { status: 404 });

    if (process.status !== "TERMINATED") {
      throw Object.assign(
        new Error(`Cannot record WorkSafe notification from status '${process.status}'. Process must be TERMINATED first.`),
        { status: 400 }
      );
    }

    const [updated] = await db
      .update(terminationProcesses)
      .set({
        status: "WORKSAFE_NOTIFIED",
        updatedAt: new Date(),
      } as any)
      .where(eq(terminationProcesses.id, process.id))
      .returning();

    await recordAudit(workerCaseId, "termination_worksafe_notified", {
      processId: process.id,
      notifiedAt: notifiedAt ?? new Date().toISOString(),
    });

    return mapProcess(updated);
  }
}

export const terminationService = new TerminationService();
