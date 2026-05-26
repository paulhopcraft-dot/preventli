import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, boolean, json, jsonb, integer, numeric, primaryKey, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// GPNet2 Dashboard Types
export type CompanyName = "Symmetry" | "Allied Health" | "Apex Labour" | "SafeWorks" | "Core Industrial";
export type WorkStatus = "At work" | "Off work";
export type RiskLevel = "High" | "Medium" | "Low";
export type ComplianceIndicator = "Very High" | "High" | "Medium" | "Low" | "Very Low";
export type WorkCapacity = "fit" | "partial" | "unfit" | "unknown";
export interface MedicalConstraints {
  // Negative constraints – what the worker MUST NOT do
  noLiftingOverKg?: number;
  noBending?: boolean;
  noTwisting?: boolean;
  noProlongedStanding?: boolean;
  noProlongedSitting?: boolean;
  noDriving?: boolean;
  noClimbing?: boolean;
  otherConstraints?: string;

  // Positive capacity markers
  suitableForLightDuties?: boolean;
  suitableForSeatedWork?: boolean;
  suitableForModifiedHours?: boolean;

  lastUpdatedBy?: "GP" | "Physiotherapist" | "Specialist" | "CaseManager" | "Unknown";
  lastUpdatedAt?: string;
}

export interface FunctionalCapacity {
  canLiftKg?: number;
  canStandMinutes?: number;
  canSitMinutes?: number;
  canWalkMinutes?: number;
  maxWorkHoursPerDay?: number;
  maxWorkDaysPerWeek?: number;
  otherCapacityNotes?: string;
}

export type CaseLifecycleStage =
  | "intake"
  | "assessment"
  | "active_treatment"
  | "rtw_transition"
  | "maintenance"
  | "closed_rtw"
  | "closed_medical_retirement"
  | "closed_terminated"
  | "closed_claim_denied"
  | "closed_other";

export const LIFECYCLE_STAGE_LABELS: Record<CaseLifecycleStage, string> = {
  intake: "Intake",
  assessment: "Assessment",
  active_treatment: "Active Treatment",
  rtw_transition: "RTW Transition",
  maintenance: "Maintenance",
  closed_rtw: "Closed — Return to Work",
  closed_medical_retirement: "Closed — Medical Retirement",
  closed_terminated: "Closed — Terminated",
  closed_claim_denied: "Closed — Claim Denied",
  closed_other: "Closed — Other",
};

// Phase 3.4 — Human-readable label maps for all key enums

export const RTW_PLAN_STATUS_LABELS: Record<string, string> = {
  not_planned: "Not Planned",
  pending_employer_review: "Pending Employer Review",
  planned_not_started: "Planned — Not Started",
  in_progress: "In Progress",
  working_well: "Working Well",
  failing: "Failing",
  on_hold: "On Hold",
  completed: "Completed",
};

export const COMPLIANCE_STATUS_LABELS: Record<string, string> = {
  unknown: "Unknown",
  compliant: "Compliant",
  partially_compliant: "Partially Compliant",
  non_compliant: "Non-Compliant",
};

export const WORK_STATUS_LABELS: Record<string, string> = {
  off_work: "Off Work",
  modified_duties: "Modified Duties",
  full_duties: "Full Duties",
  unknown: "Unknown",
};

export const RISK_LEVEL_LABELS: Record<string, string> = {
  low: "Low Risk",
  medium: "Medium Risk",
  high: "High Risk",
  critical: "Critical",
};

export const ACTION_SOURCE_LABELS: Record<string, string> = {
  compliance: "Compliance Engine",
  clinical: "Clinical Analysis",
  rtw: "RTW Planning",
  manual: "Manual",
  ai_recommendation: "AI Advisor",
};

export const ACTION_ASSIGNEE_LABELS: Record<string, string> = {
  case_manager: "Case Manager",
  ahr_manager: "AHR Manager",
  hr: "HR Manager",
  employer: "Employer",
  worker: "Worker",
  gp: "GP / Treating Doctor",
  specialist: "Specialist",
};

export const ACTION_PRIORITY_LABELS: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export const ACTION_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  done: "Completed",
  cancelled: "Cancelled",
  overdue: "Overdue",
};

export const SPECIALIST_STATUS_LABELS: Record<string, string> = {
  none: "None",
  referred: "Referred",
  appointment_booked: "Appointment Booked",
  seen_waiting_report: "Seen — Awaiting Report",
  report_received: "Report Received",
  did_not_attend: "Did Not Attend",
  not_required: "Not Required",
};

// Valid transitions: from → allowed next stages
export const LIFECYCLE_TRANSITIONS: Record<CaseLifecycleStage, CaseLifecycleStage[]> = {
  intake: ["assessment"],
  assessment: ["active_treatment", "closed_claim_denied"],
  active_treatment: ["rtw_transition", "closed_medical_retirement", "closed_terminated"],
  rtw_transition: ["maintenance", "active_treatment", "closed_terminated"],
  maintenance: ["closed_rtw", "rtw_transition", "active_treatment"],
  closed_rtw: [],
  closed_medical_retirement: [],
  closed_terminated: [],
  closed_claim_denied: [],
  closed_other: [],
};

export type RTWPlanStatus =
  | "not_planned"
  | "pending_employer_review"   // Phase 5.3 — awaiting employer sign-off
  | "planned_not_started"
  | "in_progress"
  | "working_well"
  | "failing"
  | "on_hold"
  | "completed";

export type ComplianceStatus =
  | "unknown"
  | "compliant"
  | "partially_compliant"
  | "non_compliant";

export type SpecialistStatus =
  | "none"
  | "referred"
  | "appointment_booked"
  | "seen_waiting_report"
  | "report_received"
  | "did_not_attend"
  | "not_required";

export interface SpecialistReportSummary {
  specialistType?: string;
  specialistName?: string;
  lastAppointmentDate?: string;
  diagnosisSummary?: string;
  improving?: boolean | null;
  surgeryLikely?: boolean | null;
  surgeryPlannedDate?: string | null;
  functionalSummary?: string;
  recommendations?: string;
  rawSource?: string;
}

export type TreatmentPlanStatus = "active" | "completed" | "superseded" | "archived";

export type TreatmentInterventionType =
  | "physiotherapy"
  | "medication"
  | "specialist"
  | "surgical"
  | "workplace_modification"
  | "psychological"
  | "diagnostic"
  | "other";

export type TreatmentPriority = "critical" | "recommended" | "optional";

export interface TreatmentIntervention {
  type: TreatmentInterventionType;
  description: string;
  frequency?: string;
  duration?: string;
  priority?: TreatmentPriority;
}

export interface TreatmentMilestone {
  weekNumber: number;
  description: string;
  expectedOutcome: string;
  completed?: boolean;
  completedDate?: string;
}

export interface TreatmentPlan {
  id: string;
  status: TreatmentPlanStatus;
  generatedAt: string;
  generatedBy: "ai" | "clinician" | "manual";
  aiModel?: string;
  confidence: number; // 0-100
  injuryType: string;
  diagnosisSummary?: string;
  functionalLimitations?: string[];
  interventions: TreatmentIntervention[];
  specialistReferrals?: string[];
  diagnosticTests?: string[];           // Recommended diagnostic tests
  expectedDurationWeeks: number;
  milestones: TreatmentMilestone[];
  expectedOutcomes: string[];
  successCriteria?: string[];
  factorsConsidered: string[];
  disclaimerText: string;
  completedAt?: string;
  supersededAt?: string;
  supersededBy?: string;
  notes?: string;
  plateauAnalysis?: string;             // Analysis if recovery plateau detected

  // RTW Plan Timeline Fields (added for RTW plan expiry tracking)
  rtwPlanStartDate?: string;        // When RTW plan became active (ISO date string)
  rtwPlanTargetEndDate?: string;    // Calculated: startDate + expectedDurationWeeks
  rtwPlanActualEndDate?: string;    // When plan actually completed
  rtwPlanLastReviewDate?: string;   // Last plan review/update
}

export interface CaseClinicalStatus {
  medicalConstraints?: MedicalConstraints;
  functionalCapacity?: FunctionalCapacity;
  rtwPlanStatus?: RTWPlanStatus;
  complianceStatus?: ComplianceStatus;
  specialistStatus?: SpecialistStatus;
  specialistReportSummary?: SpecialistReportSummary;
  treatmentPlan?: TreatmentPlan;
  treatmentPlanHistory?: TreatmentPlan[];

  // Compliance rule support fields
  centrelinkClearance?: boolean;
  suitableDutiesOffered?: boolean;
  suitableDutiesDate?: string;
  cooperationFlags?: string[];
}

export type DutySafetyStatus = "safe" | "unsafe" | "unknown";

export interface ClinicalEvidenceFlag {
  code:
    | "MISSING_TREATMENT_PLAN"
    | "TREATMENT_PLAN_OUTDATED"
    | "CERTIFICATE_OUT_OF_DATE"
    | "NO_RECENT_CERTIFICATE"
    | "NOT_IMPROVING_AGAINST_EXPECTED_TIMELINE"
    | "SPECIALIST_REFERRED_NO_APPOINTMENT"
    | "SPECIALIST_APPOINTMENT_OVERDUE"
    | "SPECIALIST_SEEN_NO_REPORT"
    | "SPECIALIST_REPORT_OUTDATED"
    | "RTW_PLAN_FAILING"
    | "WORKER_NON_COMPLIANT"
    | "EVIDENCE_INCOMPLETE"
    | "OTHER";
  severity: "info" | "warning" | "high_risk";
  message: string;
  details?: string;
}

export interface ClinicalEvidenceEvaluation {
  caseId: string;
  hasCurrentTreatmentPlan: boolean;
  hasCurrentCertificate: boolean;
  isImprovingOnExpectedTimeline: boolean | null;
  dutySafetyStatus: DutySafetyStatus;
  specialistStatus: SpecialistStatus;
  specialistReportPresent: boolean;
  specialistReportCurrent: boolean | null;
  rtwPlanStatus?: RTWPlanStatus;
  complianceStatus?: ComplianceStatus;
  flags: ClinicalEvidenceFlag[];
  lastClinicalUpdateDate?: string;
  recommendedActions?: ClinicalActionRecommendation[];
}

export type ActionTarget =
  | "WORKER"
  | "EMPLOYER_INTERNAL"
  | "GP"
  | "PHYSIOTHERAPIST"
  | "SPECIALIST"
  | "INSURER";

export type ClinicalActionType =
  | "REQUEST_TREATMENT_PLAN"
  | "REQUEST_UPDATED_CERTIFICATE"
  | "REQUEST_CLINICAL_EXPLANATION_FOR_DELAY"
  | "REQUEST_SPECIALIST_APPOINTMENT_STATUS"
  | "REQUEST_SPECIALIST_REPORT"
  | "ESCALATE_NON_COMPLIANCE_TO_INSURER"
  | "REVIEW_RTW_PLAN_WITH_GP"
  | "REVIEW_DUTIES_WITH_WORKER"
  | "DOCUMENT_EVIDENCE_GAP"
  | "OTHER";

export interface ClinicalActionRecommendation {
  id: string;
  type: ClinicalActionType;
  target: ActionTarget;
  label: string;
  explanation: string;
  relatedFlagCodes: ClinicalEvidenceFlag["code"][];
  suggestedSubject?: string;
  suggestedBody?: string;
  suggestedScript?: string;
}

export type CaseReportType =
  | "NON_COMPLIANCE"
  | "RTW_PLAN_FAILURE";

export interface CaseReport {
  id: string;
  caseId: string;
  type: CaseReportType;
  target: ActionTarget;
  title: string;
  summary: string;
  body: string;
  createdAt: string;
  sourceActionIds?: string[];
}
export type EmploymentStatus = "ACTIVE" | "SUSPENDED" | "TERMINATION_IN_PROGRESS" | "TERMINATED";
export type TerminationReason = "INCAPACITY" | "OTHER";
export type TerminationAuditFlag = "OK" | "HIGH_RISK" | null;
/** Phase 11.2 — Dispute status for claims under conciliation or court proceedings */
export type DisputeStatus =
  | "none"
  | "liability_disputed"
  | "worker_disputing_capacity"
  | "worker_disputing_duties"
  | "conciliation_requested"         // s97 conciliation
  | "conciliation_in_progress"
  | "court_proceedings"
  | "resolved";

export interface CaseDispute {
  id: string;
  caseId: string;
  disputeType: DisputeStatus;
  raisedBy: "worker" | "employer" | "insurer";
  raisedAt: string;
  description: string;
  resolvedAt?: string;
  resolution?: string;
  conciliationDate?: string;
  conciliationOutcome?: string;
}

export type TerminationStatus =
  | "NOT_STARTED"
  | "PREP_EVIDENCE"
  | "AGENT_MEETING"
  | "CONSULTANT_CONFIRMATION"
  | "PRE_TERMINATION_INVITE_SENT"
  | "PRE_TERMINATION_MEETING_COMPLETED"
  | "DECISION_PENDING"
  | "TERMINATED"
  | "WORKSAFE_NOTIFIED"   // Phase 9.3 — mandatory final step after termination
  | "TERMINATION_ABORTED";

/** Phase 9.2 — Legislative citations for each termination step */
export const TERMINATION_STEP_LABELS: Record<TerminationStatus, string> = {
  NOT_STARTED: "Not Started",
  PREP_EVIDENCE: "Gather evidence of incapacity (s82(1)(a) WIRC Act)",
  AGENT_MEETING: "Independent medical/occupational assessment (s82(1)(b))",
  CONSULTANT_CONFIRMATION: "Obtain consultant report confirming incapacity (s82(3))",
  PRE_TERMINATION_INVITE_SENT: "Written invitation to pre-termination meeting (s82(4)) — minimum 7 days notice",
  PRE_TERMINATION_MEETING_COMPLETED: "Pre-termination meeting held — worker response documented (s82(5))",
  DECISION_PENDING: "Consider worker's response and decide (s82(6))",
  TERMINATED: "Notice of termination issued (s82(7)) — notify WorkSafe within 10 business days",
  WORKSAFE_NOTIFIED: "WorkSafe notification completed ✓",
  TERMINATION_ABORTED: "Termination Aborted",
};
export type PayStatusDuringStandDown = "NORMAL" | "WORKCOVER_ONLY" | "SPECIAL_PAID_LEAVE";
export type TerminationDecision = "NO_DECISION" | "TERMINATE" | "DEFER" | "ALTERNATIVE_ROLE_FOUND";

export interface CaseCompliance {
  indicator: ComplianceIndicator;
  reason: string;
  source: 'freshdesk' | 'claude' | 'manual';
  lastChecked: string;
}

export interface MedicalCertificate {
  id: string;
  caseId: string;
  issueDate: string;
  startDate: string;
  endDate: string;
  capacity: WorkCapacity;
  workCapacityPercentage?: number; // Actual percentage 0-100
  notes?: string;
  source: "freshdesk" | "manual";
  documentUrl?: string;
  sourceReference?: string;
  createdAt?: string;
  updatedAt?: string;
  restrictions?: RestrictionItem[];
  practitionerName?: string;
  functionalRestrictionsJson?: FunctionalRestrictionsExtracted | null;
}

export interface MedicalCertificateInput {
  caseId?: string;
  issueDate: string;
  startDate: string;
  endDate: string;
  capacity: WorkCapacity;
  notes?: string;
  source: "freshdesk" | "manual";
  documentUrl?: string;
  sourceReference?: string;
}

// Certificate Engine v1 - Additional types
export type CertificateType = "medical_certificate" | "clearance" | "fitness_assessment" | "other";
export type CertificateCapacity = "fit" | "partial" | "unfit" | "unknown";
export type PractitionerType = "gp" | "specialist" | "physiotherapist" | "psychologist" | "other";
export type AlertType = "expiring_soon" | "expired" | "review_needed";

export interface RestrictionItem {
  type: "modified_duties" | "no_lifting" | "reduced_hours" | "work_from_home" | "other";
  description: string;
  startDate?: string;
  endDate?: string;
}

export interface OcrExtractedData {
  rawText: string;
  extractedFields: {
    issueDate?: string;
    startDate?: string;
    endDate?: string;
    practitionerName?: string;
    capacity?: string;
    restrictions?: string[];
  };
  confidence: {
    overall: number;
    fields: Record<string, number>;
  };
}

// Helper function to check if a company value is valid
export function isValidCompany(company: string | null | undefined): boolean {
  if (!company) return false;
  const normalized = company.trim().toLowerCase();

  // Filter out test/placeholder companies
  const invalidCompanies = [
    "unknown",
    "unknown company",
    "symmetry",
    "symmetry manufacturing",
    ""
  ];

  return !invalidCompanies.includes(normalized);
}

// Check if a case represents a legitimate worker injury case vs generic email
export function isLegitimateCase(workerCase: {
  workerName: string;
  company: string;
  dateOfInjury?: string;
}): boolean {
  // Must have a worker name
  if (!workerCase.workerName || workerCase.workerName.trim() === "") {
    return false;
  }

  const normalizedName = workerCase.workerName.trim().toLowerCase();
  const originalName = workerCase.workerName.trim();

  // Filter out purely numeric names (e.g., "08250027189", "123456")
  if (/^\d+$/.test(originalName)) {
    return false;
  }

  // Filter out names containing brackets (e.g., "Melad [2510092]", "[pay 2025", "Please (s25wf307549)")
  if (originalName.includes('[') || originalName.includes(']') ||
      originalName.includes('(') || originalName.includes(')')) {
    return false;
  }

  // Filter out names that are mostly numbers (e.g., "Melad 08250027189", "pay 2025")
  // A real name shouldn't have long sequences of digits
  if (/\d{7,}/.test(originalName)) {
    return false;
  }

  // Filter out generic claim numbers masquerading as names
  if (normalizedName.startsWith("claim ") || /^claim\s*\d+/.test(normalizedName)) {
    return false;
  }

  // Filter out single character names or very short placeholder names
  if (normalizedName.length < 2 || normalizedName === "--" || normalizedName === ".." || normalizedName === "..") {
    return false;
  }

  // Filter out generic test/placeholder names (exact match)
  const genericNames = [
    "test", "testing", "unknown", "n/a", "none", "my certificate", "workcover",
    "work period", "adjustment", "adjustment request", "payroll", "hr request",
    "admin", "query", "request", "general inquiry", "information request",
    "case report", "welfare check", "rehabilitation review", "new online",
    "simple time", "great account", "how form", "gpnet transcript",
    "food poisoning", "vince" // single name only, insufficient for identification
  ];
  if (genericNames.includes(normalizedName)) {
    return false;
  }

  // Filter out names that contain generic administrative terms (substring match)
  const adminTerms = [
    "work period", "adjustment", "payroll", "hr request", "admin query",
    "lower check", "welfare check", "case report", "rehabilitation",
    "transcript"
  ];
  if (adminTerms.some(term => normalizedName.includes(term))) {
    return false;
  }

  // Filter out names that start with "test" or "testing" (common test data)
  if (normalizedName.startsWith("test ") || normalizedName.startsWith("testing ")) {
    return false;
  }

  // Filter out names that start with generic worker identifiers
  if (normalizedName.startsWith("workcover ") || normalizedName.startsWith("worker ")) {
    return false;
  }

  // Filter out names that start with company prefixes (e.g., "Symmetry- Worker", "Lower Murray-")
  const companyPrefixes = ["symmetry-", "symmetry ", "lower ", "cobild-", "marley-"];
  if (companyPrefixes.some(prefix => normalizedName.startsWith(prefix) &&
      !normalizedName.includes(" ") || // Single word after prefix
      /^(symmetry|lower|cobild|marley)[-\s]+\w+$/i.test(normalizedName))) {
    // Additional check: if it's "Company- Word", it's invalid
    if (/^[a-z]+-\s*\w+$/i.test(normalizedName)) {
      return false;
    }
  }

  // Filter out email subject line patterns (e.g., "Fwd: Staff", "Re: Aparicio")
  if (/^(fwd|re|fw):\s*/i.test(originalName)) {
    return false;
  }

  // Filter out names that start with action verbs (often email subjects)
  const actionVerbs = ["please", "don't", "write", "you ", "new ", "automatic ", "formal "];
  if (actionVerbs.some(verb => normalizedName.startsWith(verb))) {
    return false;
  }

  // Filter out names that look like descriptions (e.g., "Mei Certificate", "Mei Injury")
  const descriptionPatterns = ["certificate", "injury", " check", " report", " review", " images", " account"];
  if (descriptionPatterns.some(pattern => normalizedName.endsWith(pattern))) {
    return false;
  }

  // Filter out names that start with special characters or numbers
  if (/^[^a-z]/i.test(originalName)) {
    return false;
  }

  // Must have either a valid company OR a date of injury (some legitimate cases may lack company info)
  const hasValidCompany = isValidCompany(workerCase.company);
  const hasInjuryDate = !!workerCase.dateOfInjury &&
    typeof workerCase.dateOfInjury === 'string' &&
    workerCase.dateOfInjury.trim() !== "";

  return hasValidCompany || hasInjuryDate;
}

// Extract surname (last name) from a worker name for sorting
export function getSurname(workerName: string): string {
  if (!workerName || workerName.trim() === "") {
    return "";
  }
  
  const parts = workerName.trim().split(/\s+/);
  // Return the last word as the surname
  return parts[parts.length - 1].toLowerCase();
}

export interface CaseAttachment {
  id: string;
  name: string;
  type: string;
  url: string;
}

export interface CaseDiscussionNote {
  id: string;
  caseId: string;
  workerName: string;
  timestamp: string;
  rawText: string;
  summary: string;
  nextSteps?: string[];
  riskFlags?: string[];
  updatesCompliance: boolean;
  updatesRecoveryTimeline: boolean;
}

export type TranscriptInsightSeverity = "info" | "warning" | "critical";
export type TranscriptInsightArea =
  | "compliance"
  | "recovery"
  | "risk"
  | "returnToWork"
  | "engagement";

export interface AuditEvent {
  id: string;
  timestamp: string;
  userId?: string | null;
  organisationId?: string | null;
  eventType: string;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, any> | null;
}

export interface TranscriptInsight {
  id: string;
  caseId: string;
  noteId: string;
  area: TranscriptInsightArea;
  severity: TranscriptInsightSeverity;
  summary: string;
  detail?: string;
  createdAt: string;
}

export type WorkerCaseType =
  | "injury"
  | "pre_employment"
  | "prevention"
  | "wellness"
  | "mental_health"
  | "exit";

export interface WorkerCase {
  id: string;
  organizationId: string; // Organization/tenant isolation - added in migration 0003
  type: WorkerCaseType; // Case type — distinguishes injury cases from health-check-originated cases
  assessmentId?: string | null; // Link back to originating pre-employment assessment (nullable)
  workerId?: string | null;
  workerName: string;
  company: string; // Allow any company name from Freshdesk, not just predefined ones
  dateOfInjury: string;
  dateOfInjurySource?: string; // "verified" | "extracted" | "fallback" | "unknown"
  dateOfInjuryConfidence?: string; // "high" | "medium" | "low"
  riskLevel: RiskLevel;
  workStatus: WorkStatus;
  hasCertificate: boolean;
  certificateUrl?: string;
  complianceIndicator: ComplianceIndicator; // Legacy field - kept for backward compatibility
  compliance?: CaseCompliance; // New structured compliance object
  complianceOverride?: boolean;
  complianceOverrideValue?: ComplianceIndicator;
  complianceOverrideReason?: string;
  complianceOverrideBy?: string;
  complianceOverrideAt?: string;
  medicalConstraints?: MedicalConstraints;
  functionalCapacity?: FunctionalCapacity;
  rtwPlanStatus?: RTWPlanStatus;
  complianceStatus?: ComplianceStatus;
  specialistStatus?: SpecialistStatus;
  specialistReportSummary?: SpecialistReportSummary;
  clinical_status_json?: CaseClinicalStatus; // JSONB column (treatment plans, medical constraints)
  clinicalEvidence?: ClinicalEvidenceEvaluation;
  currentStatus: string;
  nextStep: string;
  owner: string;
  dueDate: string;
  summary: string;
  ticketIds: string[]; // Track all Freshdesk ticket IDs for this worker
  ticketCount: number; // Number of tickets merged into this case
  masterTicketId?: string; // Primary ticket ID after merge
  aiSummary?: string; // Cached AI-generated summary
  aiSummaryGeneratedAt?: string; // When AI summary was last generated
  aiSummaryModel?: string; // AI model used for summary generation
  aiWorkStatusClassification?: string; // AI-classified work status (At work full hours full duties, etc.)
  ticketLastUpdatedAt?: string; // Most recent updated_at from Freshdesk tickets
  attachments?: CaseAttachment[];
  clcLastFollowUp?: string;
  clcNextFollowUp?: string;
  latestCertificate?: MedicalCertificate;
  certificateHistory?: MedicalCertificateInput[];
  riskFlags?: string[];
  injuryDescription?: string;
  injuryType?: string;
  contactPhone?: string;
  currentCertificateStart?: string;
  currentCertificateEnd?: string;
  latestDiscussionNotes?: CaseDiscussionNote[];
  discussionInsights?: TranscriptInsight[];
  employmentStatus?: EmploymentStatus;
  caseStatus?: "open" | "closed";
  closedAt?: string;
  closedReason?: string;
  terminationProcessId?: string | null;
  terminationReason?: TerminationReason | null;
  terminationAuditFlag?: TerminationAuditFlag;

  // Phase 3.1 — Case Lifecycle
  lifecycleStage?: CaseLifecycleStage;
  lifecycleStageChangedAt?: string;
  lifecycleStageChangedBy?: string;
  lifecycleStageReason?: string;

  // Phase 3.2 — Case Assignment
  caseManagerId?: string;
  caseManagerName?: string;
  assignedAt?: string;
  secondaryAssigneeId?: string;

  // Phase 11.1 — Multiple Simultaneous Claims
  relatedCaseIds?: string[];
  claimType?: "primary" | "secondary" | "consequential";
  primaryCaseId?: string;

  // Phase 11.2 — Disputed Claims
  disputeStatus?: DisputeStatus;

  // GP escalation detection (computed, not stored). Surfaces cases where the
  // latest medical certificate expired beyond the org's threshold without a
  // fresh cert arriving — signal to chase the GP or trigger an IME.
  gpEscalation?: {
    escalated: boolean;
    daysOverdue: number;
    reason: "no_certificate" | "no_end_date" | "cert_current" | "cert_expired_no_followup";
  };
}

// Paginated response for cases list endpoint
export interface PaginatedCasesResponse {
  cases: WorkerCase[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface TerminationProcess {
  id: string;
  workerCaseId: string;
  status: TerminationStatus;
  preInjuryRole: string | null;
  rtWAttemptsSummary: string | null;
  hasSustainableRole: boolean | null;
  alternativeRolesConsideredSummary: string | null;
  agentMeetingDate: string | null;
  agentMeetingNotesId: string | null;
  consultantInviteDate: string | null;
  consultantAppointmentDate: string | null;
  consultantReportId: string | null;
  longTermRestrictionsSummary: string | null;
  canReturnPreInjuryRole: boolean | null;
  preTerminationInviteSentDate: string | null;
  preTerminationMeetingDate: string | null;
  preTerminationMeetingLocation: string | null;
  workerAllowedRepresentative: boolean | null;
  workerInstructedNotToAttendWork: boolean | null;
  payStatusDuringStandDown: PayStatusDuringStandDown | null;
  preTerminationLetterDocId: string | null;
  preTerminationMeetingHeld: boolean | null;
  preTerminationMeetingNotesId: string | null;
  anyNewMedicalInfoProvided: boolean | null;
  newMedicalDocsSummary: string | null;
  decision: TerminationDecision;
  decisionDate: string | null;
  decisionRationale: string | null;
  terminationEffectiveDate: string | null;
  terminationNoticeWeeks: number | null;
  noticeType: "WORKED" | "PAID_IN_LIEU" | "MIXED" | null;
  terminationLetterDocId: string | null;
  entitlementsSummary: string | null;
  ongoingCompArrangements: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentTemplate {
  id: string;
  code: string;
  body: string;
  createdAt: string;
}

export interface GeneratedDocument {
  id: string;
  workerCaseId: string;
  templateCode: string | null;
  content: string;
  createdAt: string;
}

// Database tables
export const workerCases = pgTable("worker_cases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(), // Added in migration 0003 - tenant isolation
  workerId: varchar("worker_id"),                       // links to normalized workers table (nullable for existing cases)
  workerName: text("worker_name").notNull(),
  company: text("company").notNull(),
  dateOfInjury: timestamp("date_of_injury").notNull(),
  dateOfInjurySource: varchar("date_of_injury_source").default("unknown"), // "verified" | "extracted" | "ai_extracted" | "fallback" | "unknown"
  dateOfInjuryConfidence: varchar("date_of_injury_confidence").default("low"), // "high" | "medium" | "low"
  dateOfInjuryRequiresReview: boolean("date_of_injury_requires_review").default(false),
  dateOfInjuryExtractionMethod: varchar("date_of_injury_extraction_method").default("fallback"), // "custom_field" | "regex" | "ai_nlp" | "fallback"
  dateOfInjurySourceText: text("date_of_injury_source_text"), // Fragment where date was found
  dateOfInjuryAiReasoning: text("date_of_injury_ai_reasoning"), // AI explanation when used
  dateOfInjuryReviewedBy: varchar("date_of_injury_reviewed_by"), // User ID who reviewed
  dateOfInjuryReviewedAt: timestamp("date_of_injury_reviewed_at"), // When review was completed
  claimNumber: text("claim_number"), // NULL = preventative case (no WorkCover claim); populated = injury case
  riskLevel: text("risk_level").notNull(),
  workStatus: text("work_status").notNull(),
  hasCertificate: boolean("has_certificate").notNull().default(false),
  certificateUrl: text("certificate_url"),
  complianceIndicator: text("compliance_indicator").notNull(),
  complianceJson: jsonb("compliance_json").$type<CaseCompliance>(),
  complianceOverride: boolean("compliance_override").default(false),
  complianceOverrideValue: text("compliance_override_value"), // Overridden indicator value
  complianceOverrideReason: text("compliance_override_reason"),
  complianceOverrideBy: text("compliance_override_by"),
  complianceOverrideAt: timestamp("compliance_override_at"),
  clinicalStatusJson: jsonb("clinical_status_json").$type<CaseClinicalStatus | null>(),
  currentStatus: text("current_status").notNull(),
  nextStep: text("next_step").notNull(),
  owner: text("owner").notNull(),
  dueDate: text("due_date").notNull(),
  summary: text("summary").notNull(),
  ticketIds: text("ticket_ids").array().notNull().default(sql`ARRAY[]::text[]`),
  ticketCount: text("ticket_count").notNull().default('1'),
  masterTicketId: text("master_ticket_id"), // Primary ticket ID after merge
  aiSummary: text("ai_summary"),
  aiSummaryGeneratedAt: timestamp("ai_summary_generated_at"),
  aiSummaryModel: text("ai_summary_model"),
  aiWorkStatusClassification: text("ai_work_status_classification"),
  ticketLastUpdatedAt: timestamp("ticket_last_updated_at"),
  clcLastFollowUp: text("clc_last_follow_up"),
  clcNextFollowUp: text("clc_next_follow_up"),
  employmentStatus: text("employment_status").notNull().default("ACTIVE"),

  // Case type discrimination — injury vs health-check-originated cases
  // SCOPE NOTE: case auto-creation is currently wired ONLY for pre-employment checks
  // (POST /api/public/check/:token). Exit / Prevention / Wellness / MentalHealth forms
  // will get their own hooks in a follow-up plan once their submission paths are confirmed.
  type: text("type").notNull().default("injury").$type<WorkerCaseType>(),
  // Link back to the originating pre-employment assessment (nullable; only set for health-check rows)
  assessmentId: varchar("assessment_id"),

  // Phase 3.2 — Case Assignment
  caseManagerId: varchar("case_manager_id"),      // Assigned case manager user ID
  caseManagerName: text("case_manager_name"),     // Denormalized for display
  assignedAt: timestamp("assigned_at"),           // When the case was assigned
  secondaryAssigneeId: varchar("secondary_assignee_id"), // Optional secondary (e.g., AHR manager)

  caseStatus: text("case_status").notNull().default("open"), // open, closed
  lifecycleStage: text("lifecycle_stage").notNull().default("intake").$type<CaseLifecycleStage>(),
  lifecycleStageChangedAt: timestamp("lifecycle_stage_changed_at").defaultNow(),
  lifecycleStageChangedBy: text("lifecycle_stage_changed_by"),
  lifecycleStageReason: text("lifecycle_stage_reason"),
  closedAt: timestamp("closed_at"),
  closedReason: text("closed_reason"),
  terminationProcessId: varchar("termination_process_id"),
  terminationReason: text("termination_reason"),
  terminationAuditFlag: text("termination_audit_flag"),

  // Worker contact email captured at employer case creation (used to send the
  // injury-check email without re-asking). Nullable for back-compat with cases
  // created before this column existed.
  workerEmail: text("worker_email"),

  // Set when the employer's injury-check email has actually been sent (via
  // /api/employer/cases/:id/injury-check/send). Used by the success page to
  // render a persistent "sent" confirmation that survives reloads.
  injuryCheckSentAt: timestamp("injury_check_sent_at"),

  // RTW Auto-Draft (2026-05-13): per-case override of worker's baseline role.
  // NULL = use workers.roleId; populated = role at injury differed from baseline.
  preInjuryRoleOverrideId: varchar("pre_injury_role_override_id"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const terminationProcesses = pgTable("termination_processes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(), // Added in migration 0009 - tenant isolation
  workerCaseId: varchar("worker_case_id")
    .notNull()
    .references(() => workerCases.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("NOT_STARTED"),
  preInjuryRole: text("pre_injury_role"),
  rtWAttemptsSummary: text("rtw_attempts_summary"),
  hasSustainableRole: boolean("has_sustainable_role"),
  alternativeRolesConsideredSummary: text("alternative_roles_considered_summary"),
  agentMeetingDate: timestamp("agent_meeting_date"),
  agentMeetingNotesId: text("agent_meeting_notes_id"),
  consultantInviteDate: timestamp("consultant_invite_date"),
  consultantAppointmentDate: timestamp("consultant_appointment_date"),
  consultantReportId: text("consultant_report_id"),
  longTermRestrictionsSummary: text("long_term_restrictions_summary"),
  canReturnPreInjuryRole: boolean("can_return_pre_injury_role"),
  preTerminationInviteSentDate: timestamp("pre_termination_invite_sent_date"),
  preTerminationMeetingDate: timestamp("pre_termination_meeting_date"),
  preTerminationMeetingLocation: text("pre_termination_meeting_location"),
  workerAllowedRepresentative: boolean("worker_allowed_representative"),
  workerInstructedNotToAttendWork: boolean("worker_instructed_not_to_attend_work"),
  payStatusDuringStandDown: text("pay_status_during_stand_down"),
  preTerminationLetterDocId: text("pre_termination_letter_doc_id"),
  preTerminationMeetingHeld: boolean("pre_termination_meeting_held"),
  preTerminationMeetingNotesId: text("pre_termination_meeting_notes_id"),
  anyNewMedicalInfoProvided: boolean("any_new_medical_info_provided"),
  newMedicalDocsSummary: text("new_medical_docs_summary"),
  decision: text("decision").notNull().default("NO_DECISION"),
  decisionDate: timestamp("decision_date"),
  decisionRationale: text("decision_rationale"),
  terminationEffectiveDate: timestamp("termination_effective_date"),
  terminationNoticeWeeks: integer("termination_notice_weeks"),
  noticeType: text("notice_type"),
  terminationLetterDocId: text("termination_letter_doc_id"),
  entitlementsSummary: text("entitlements_summary"),
  ongoingCompArrangements: text("ongoing_comp_arrangements"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const documentTemplates = pgTable("document_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: text("code").notNull().unique(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const generatedDocuments = pgTable("generated_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerCaseId: varchar("worker_case_id")
    .references(() => workerCases.id, { onDelete: "cascade" }),
  templateCode: text("template_code"),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const medicalCertificates = pgTable("medical_certificates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => workerCases.id),
  issueDate: timestamp("issue_date").notNull(),
  startDate: timestamp("start_date").notNull(),
  endDate: timestamp("end_date").notNull(),
  capacity: text("capacity").notNull(),
  workCapacityPercentage: integer("work_capacity_percentage"), // Actual percentage 0-100
  notes: text("notes"),
  source: text("source").notNull().default("freshdesk"),
  documentUrl: text("document_url"),
  sourceReference: text("source_reference"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),

  // Certificate Engine v1 - Extended fields
  certificateType: text("certificate_type").notNull().default("medical_certificate"),
  organizationId: varchar("organization_id"),
  workerId: varchar("worker_id"),
  documentId: varchar("document_id"),
  restrictions: jsonb("restrictions").default(sql`'[]'::jsonb`).$type<RestrictionItem[]>(),
  treatingPractitioner: varchar("treating_practitioner"),
  practitionerType: varchar("practitioner_type"),
  clinicName: varchar("clinic_name"),
  rawExtractedData: jsonb("raw_extracted_data").$type<OcrExtractedData>(),
  extractionConfidence: numeric("extraction_confidence", { precision: 3, scale: 2 }),
  requiresReview: boolean("requires_review").default(false),
  isCurrentCertificate: boolean("is_current_certificate").default(false),
  reviewDate: timestamp("review_date"),
  fileName: varchar("file_name"),
  fileUrl: varchar("file_url"),

  // RTW Planner Engine - Functional restrictions extracted from certificate
  functionalRestrictionsJson: jsonb("functional_restrictions_json").$type<FunctionalRestrictionsExtracted | null>(),
});

export const caseAttachments = pgTable("case_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(), // Added in migration 0009 - tenant isolation
  caseId: varchar("case_id").notNull().references(() => workerCases.id),
  name: text("name").notNull(),
  type: text("type").notNull(),
  url: text("url").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const caseDiscussionNotes = pgTable("case_discussion_notes", {
  id: text("id").primaryKey(),
  organizationId: varchar("organization_id").notNull(), // Added in migration 0009 - tenant isolation
  caseId: text("case_id").references(() => workerCases.id).notNull(),
  workerName: text("worker_name").notNull(),
  timestamp: timestamp("timestamp").defaultNow(),
  rawText: text("raw_text").notNull(),
  summary: text("summary").notNull(),
  nextSteps: json("next_steps").$type<string[]>(),
  riskFlags: json("risk_flags").$type<string[]>(),
  updatesCompliance: boolean("updates_compliance").default(false),
  updatesRecoveryTimeline: boolean("updates_recovery_timeline").default(false),
});

export const caseDiscussionInsights = pgTable("case_discussion_insights", {
  id: text("id").primaryKey(),
  caseId: text("case_id").references(() => workerCases.id).notNull(),
  noteId: text("note_id").references(() => caseDiscussionNotes.id).notNull(),
  area: text("area").notNull(),
  severity: text("severity").notNull(),
  summary: text("summary").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const auditEvents = pgTable("audit_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  userId: varchar("user_id"),
  organisationId: varchar("organisation_id"),
  eventType: text("event_type").notNull(),
  resourceType: text("resource_type"),
  resourceId: varchar("resource_id"),
  metadata: jsonb("metadata"),
});

export const certificateExpiryAlerts = pgTable("certificate_expiry_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  certificateId: varchar("certificate_id").notNull().references(() => medicalCertificates.id, { onDelete: "cascade" }),
  alertType: text("alert_type").notNull(), // 'expiring_soon' | 'expired' | 'review_needed'
  alertDate: timestamp("alert_date").notNull(),
  acknowledged: boolean("acknowledged").default(false),
  acknowledgedBy: varchar("acknowledged_by"),
  acknowledgedAt: timestamp("acknowledged_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Authentication Types
export type UserRole = "admin" | "employer" | "clinician" | "insurer" | "partner";

export interface User {
  id: string;
  email: string;
  password: string; // This will be hashed
  role: UserRole;
  subrole: string | null;
  organizationId: string; // Organization/tenant isolation
  companyId: string | null; // Deprecated - use organizationId
  insurerId: string | null;
  isActive: boolean;
  createdAt: Date;
}

// Users table for authentication
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(), // Note: Unique constraint is (email, organization_id) - see migration 0003
  password: text("password").notNull(), // bcrypt hashed
  role: text("role").notNull(), // admin | employer | clinician | insurer | partner
  subrole: text("subrole"), // e.g., "doctor", "physio"
  organizationId: varchar("organization_id").notNull(), // Added in migration 0003
  companyId: varchar("company_id"), // Deprecated - use organizationId
  insurerId: varchar("insurer_id"), // UUID reference to insurer
  // How Alex addresses the user ("morning {preferredName}"). Captured at
  // setup or in profile settings. Nullable: falls back to email-derived
  // first name when missing.
  preferredName: text("preferred_name"),
  isActive: boolean("is_active").notNull().default(true),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// User invites table for secure registration
export const userInvites = pgTable("user_invites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull(),
  organizationId: varchar("organization_id").notNull(),
  role: text("role").notNull(), // admin | employer | clinician | insurer
  subrole: text("subrole"), // e.g., "doctor", "physio"
  invitedByUserId: varchar("invited_by_user_id").notNull().references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  status: text("status").notNull().default("pending"), // pending | used | expired | cancelled
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Refresh tokens for session management
export const refreshTokens = pgTable("refresh_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(), // SHA-256 hash of the token
  tokenFamily: varchar("token_family").notNull(), // For detecting token reuse attacks
  deviceName: text("device_name"), // Optional device identifier
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"), // Null if active, set when revoked
  createdAt: timestamp("created_at").defaultNow().notNull(),
});


// Password reset tokens for self-service password recovery
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Webhook form mappings for secure webhook authentication
export const webhookFormMappings = pgTable("webhook_form_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  formId: text("form_id").notNull().unique(), // JotForm form ID
  organizationId: varchar("organization_id").notNull(),
  formType: text("form_type").notNull(), // "worker_injury", "medical_certificate", etc.
  webhookPassword: text("webhook_password").notNull(), // Secure password for webhook verification
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertWorkerCaseSchema = createInsertSchema(workerCases);

export const insertCaseAttachmentSchema = createInsertSchema(caseAttachments);

export const insertUserSchema = createInsertSchema(users);

export const insertUserInviteSchema = createInsertSchema(userInvites);

export const insertWebhookFormMappingSchema = createInsertSchema(webhookFormMappings);

export const insertRefreshTokenSchema = createInsertSchema(refreshTokens);

export type InsertWorkerCase = z.infer<typeof insertWorkerCaseSchema>;
export type WorkerCaseDB = typeof workerCases.$inferSelect;
export type InsertCaseAttachment = z.infer<typeof insertCaseAttachmentSchema>;
export type CaseAttachmentDB = typeof caseAttachments.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type UserDB = typeof users.$inferSelect;
export type InsertUserInvite = z.infer<typeof insertUserInviteSchema>;
export type UserInviteDB = typeof userInvites.$inferSelect;
export type InsertWebhookFormMapping = z.infer<typeof insertWebhookFormMappingSchema>;
export type WebhookFormMappingDB = typeof webhookFormMappings.$inferSelect;
export type InsertRefreshToken = z.infer<typeof insertRefreshTokenSchema>;
export type RefreshTokenDB = typeof refreshTokens.$inferSelect;
export type MedicalCertificateDB = typeof medicalCertificates.$inferSelect;
export type InsertMedicalCertificate = typeof medicalCertificates.$inferInsert;
export type CaseDiscussionNoteDB = typeof caseDiscussionNotes.$inferSelect;
export type InsertCaseDiscussionNote = typeof caseDiscussionNotes.$inferInsert;
export type CaseDiscussionInsightDB = typeof caseDiscussionInsights.$inferSelect;
export type InsertCaseDiscussionInsight = typeof caseDiscussionInsights.$inferInsert;
export type TerminationProcessDB = typeof terminationProcesses.$inferSelect;
export type InsertTerminationProcess = typeof terminationProcesses.$inferInsert;
export type DocumentTemplateDB = typeof documentTemplates.$inferSelect;
export type GeneratedDocumentDB = typeof generatedDocuments.$inferSelect;
export type CertificateExpiryAlertDB = typeof certificateExpiryAlerts.$inferSelect;
export type InsertCertificateExpiryAlert = typeof certificateExpiryAlerts.$inferInsert;

// Zod schemas for Certificate Engine v1
export const insertMedicalCertificateSchema = createInsertSchema(medicalCertificates);
export const selectMedicalCertificateSchema = createInsertSchema(medicalCertificates);
export const insertCertificateExpiryAlertSchema = createInsertSchema(certificateExpiryAlerts);
export const selectCertificateExpiryAlertSchema = createInsertSchema(certificateExpiryAlerts);

export interface RecoveryTimelineSummary {
  totalCertificates: number;
  daysOnReducedCapacity: number;
  lastKnownCapacity: WorkCapacity;
  lastUpdated?: string | null;
}

export interface RecoveryTimelineResponse {
  certificates: MedicalCertificate[];
  summary: RecoveryTimelineSummary;
}

export type TimelineEventType =
  | "certificate_added"
  | "discussion_note"
  | "attachment_uploaded"
  | "termination_milestone"
  | "case_status_change"
  | "case_created"
  | "compliance_deadline";  // Phase 7.2 — computed compliance milestones

export interface TimelineEvent {
  id: string;
  caseId: string;
  eventType: TimelineEventType;
  timestamp: string;
  title: string;
  description?: string;
  metadata?: Record<string, any>;
  sourceId?: string;
  sourceTable?: string;
  icon?: string;
  severity?: "info" | "warning" | "critical";
}

export interface TimelineResponse {
  caseId: string;
  events: TimelineEvent[];
  totalEvents: number;
}

// =====================================================
// Compliance Knowledge Base - WorkSafe Manual + WIRC Act
// =====================================================

export interface ComplianceDocument {
  id: string;
  source: "worksafe_manual" | "wirc_act";
  sectionId: string;
  title: string;
  content: string;
  fullReference: string;
  url?: string;
  createdAt: string;
  updatedAt: string;
}

export const complianceDocuments = pgTable("compliance_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  source: text("source").notNull(), // 'worksafe_manual' or 'wirc_act'
  sectionId: varchar("section_id").notNull(), // e.g., '2.4' or 's38'
  title: text("title").notNull(),
  content: text("content").notNull(),
  fullReference: text("full_reference").notNull(), // e.g., "WorkSafe Manual Section 2.4"
  url: text("url"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type ComplianceDocumentDB = typeof complianceDocuments.$inferSelect;
export type InsertComplianceDocument = typeof complianceDocuments.$inferInsert;

// =====================================================
// Compliance Rules - Evaluation Rules
// =====================================================

export interface ComplianceRule {
  id: string;
  ruleCode: string; // e.g., 'CERT_CURRENT'
  name: string;
  description: string;
  documentReferences: Array<{ source: string; section: string }>; // e.g., [{"source": "wirc_act", "section": "s38"}]
  checkType: "certificate" | "rtw_plan" | "file_review" | "payment" | "other";
  severity: "critical" | "high" | "medium" | "low";
  evaluationLogic: Record<string, any>; // JSON evaluation logic
  recommendedAction: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const complianceRules = pgTable("compliance_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ruleCode: varchar("rule_code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  documentReferences: jsonb("document_references").$type<Array<{ source: string; section: string }>>().notNull(),
  checkType: text("check_type").notNull(), // 'certificate', 'rtw_plan', 'file_review', 'payment', 'other'
  severity: text("severity").notNull(), // 'critical', 'high', 'medium', 'low'
  evaluationLogic: jsonb("evaluation_logic").$type<Record<string, any>>().notNull(),
  recommendedAction: text("recommended_action").notNull(),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type ComplianceRuleDB = typeof complianceRules.$inferSelect;
export type InsertComplianceRule = typeof complianceRules.$inferInsert;

// =====================================================
// Case Compliance Checks - Rule Evaluation Results
// =====================================================

export interface CaseComplianceCheck {
  id: string;
  caseId: string;
  ruleId: string;
  status: "compliant" | "warning" | "non_compliant";
  checkedAt: string;
  finding?: string; // What was found
  recommendation?: string; // What to do
  actionCreated: boolean;
  actionId?: string;
  createdAt: string;
}

export const caseComplianceChecks = pgTable("case_compliance_checks", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => workerCases.id, { onDelete: "cascade" }),
  ruleId: varchar("rule_id").notNull().references(() => complianceRules.id, { onDelete: "cascade" }),
  status: text("status").notNull(), // 'compliant', 'warning', 'non_compliant'
  checkedAt: timestamp("checked_at").notNull(),
  finding: text("finding"),
  recommendation: text("recommendation"),
  actionCreated: boolean("action_created").default(false),
  actionId: varchar("action_id").references(() => caseActions.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CaseComplianceCheckDB = typeof caseComplianceChecks.$inferSelect;
export type InsertCaseComplianceCheck = typeof caseComplianceChecks.$inferInsert;

// =====================================================
// Phase 2: Explanation Layer — universal explanation type
// =====================================================

export interface ExplanationFactor {
  factor: string;      // e.g., "Duration exceeds expected"
  impact: "positive" | "negative" | "neutral";
  detail: string;      // e.g., "Off work 8 weeks vs expected 4-6 weeks"
  weight?: number;     // 0-1
}

export interface Explanation {
  summary: string;               // One-sentence plain English (shown by default)
  detail?: string;               // 2-3 sentence expanded explanation
  factors?: ExplanationFactor[];
  legislativeRef?: {
    act: string;                 // e.g., "WIRC Act 2013"
    section: string;             // e.g., "s82"
    description: string;
  };
  consequence?: string;          // What happens if ignored
  remedy?: string;               // Specific next step to resolve
  confidence?: "high" | "medium" | "low";
}

// =====================================================
// Action Queue v1 - Case Actions for Compliance
// =====================================================

export type CaseActionType = "chase_certificate" | "review_case" | "follow_up";
export type CaseActionStatus = "pending" | "in_progress" | "done" | "cancelled" | "overdue";

// Phase 3.3 — Unified Action System types
export type ActionSource =
  | "compliance"       // Triggered by the compliance engine (certificate gaps, rule violations)
  | "clinical"         // Triggered by the clinical analysis pipeline
  | "rtw"              // Triggered by the RTW planning engine
  | "manual"           // Created by a user manually
  | "ai_recommendation"; // Generated by AI advisor

export type ActionAssignee =
  | "case_manager"
  | "ahr_manager"
  | "hr"
  | "employer"
  | "worker"
  | "gp"
  | "specialist";

export type ActionPriority = "critical" | "high" | "medium" | "low";

export interface CaseAction {
  id: string;
  organizationId: string; // Tenant isolation
  caseId: string;
  type: CaseActionType;
  status: CaseActionStatus;
  dueDate?: string;
  priority: number;
  notes?: string;

  // Phase 2: why this action is needed now (computed at response time)
  rationale?: string;
  workerName?: string; // Denormalized for display
  company?: string; // Denormalized for display

  // Phase 3.3 — Unified Action System fields
  source?: ActionSource;
  title?: string;
  description?: string;
  triggerCondition?: string;
  complianceRuleCode?: string;
  legislativeRef?: string;
  draftEmailContent?: string;
  phoneScript?: string;
  explanationJson?: unknown;
  priorityLevel?: ActionPriority;
  assignedRole?: ActionAssignee;

  // WHO does what BY WHEN
  assignedTo?: string; // User/organization responsible
  assignedToName?: string; // Display name (e.g., "GPNet (Paul)", "DXC (Saurav)")

  // Completion tracking
  completedAt?: string;
  completedBy?: string;
  autoCompleted?: boolean;
  emailReference?: string; // Email ID that triggered auto-completion

  // Cancellation
  cancelledAt?: string;
  cancelledBy?: string;
  cancelledReason?: string;

  // Status indicators
  isBlocker?: boolean; // Blocks case progress
  failed?: boolean; // Attempted but didn't work
  failureReason?: string;

  createdAt: string;
  updatedAt: string;
}

export const caseActions = pgTable("case_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(), // Added in migration 0009 - tenant isolation
  caseId: varchar("case_id").notNull().references(() => workerCases.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // chase_certificate, review_case, follow_up

  // Phase 3.3 — Unified Action System fields
  title: text("title"),                           // Human-readable action title
  description: text("description"),               // Detailed description of what to do
  rationale: text("rationale"),                   // WHY this action is needed (persisted, not computed)
  source: text("source").$type<ActionSource>(),   // What system generated this action
  triggerCondition: text("trigger_condition"),     // The condition that triggered this action
  complianceRuleCode: text("compliance_rule_code"), // e.g., "s38", "s82"
  legislativeRef: text("legislative_ref"),         // e.g., "WIRC Act 2013 s38"
  draftEmailContent: text("draft_email_content"), // Pre-written email for this action
  phoneScript: text("phone_script"),               // Phone call script
  explanationJson: jsonb("explanation_json"),      // Full Explanation object from Phase 2
  priorityLevel: text("priority_level").$type<ActionPriority>().default("medium"), // critical|high|medium|low

  status: text("status").notNull().default("pending"), // pending, in_progress, done, cancelled, overdue
  dueDate: timestamp("due_date"),
  priority: integer("priority").default(1), // Legacy numeric priority (kept for backwards compat)
  notes: text("notes"),

  // WHO does what BY WHEN
  assignedTo: varchar("assigned_to"), // User/organization responsible
  assignedToName: varchar("assigned_to_name"), // Display name (e.g., "GPNet (Paul)")
  assignedRole: text("assigned_role").$type<ActionAssignee>(), // Role responsible (case_manager, hr, etc.)

  // Completion tracking
  completedAt: timestamp("completed_at"),
  completedBy: varchar("completed_by"),
  autoCompleted: boolean("auto_completed").default(false),
  emailReference: varchar("email_reference"), // Email ID that triggered auto-completion

  // Cancellation
  cancelledAt: timestamp("cancelled_at"),
  cancelledBy: varchar("cancelled_by"),
  cancelledReason: text("cancelled_reason"),

  // Status indicators
  isBlocker: boolean("is_blocker").default(false),
  failed: boolean("failed").default(false),
  failureReason: text("failure_reason"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertCaseActionSchema = createInsertSchema(caseActions);

export type InsertCaseAction = typeof caseActions.$inferInsert;
export type CaseActionDB = typeof caseActions.$inferSelect;

// =====================================================
// Certificate Compliance Engine v1
// =====================================================

export type CertificateComplianceFlag =
  | "no_certificate"
  | "certificate_expiring_soon"
  | "certificate_expired"
  | "compliant";

export interface CertificateCompliance {
  status: CertificateComplianceFlag;
  activeCertificate?: MedicalCertificate;
  newestCertificate?: MedicalCertificate;
  daysUntilExpiry?: number;
  daysSinceExpiry?: number;
  message: string;
}

// =====================================================
// RTW Plan Compliance Types (mirroring certificate compliance)
// =====================================================

export type RTWComplianceStatus =
  | "no_plan"
  | "plan_expiring_soon"    // 1-7 days until expiry
  | "plan_expired"          // Past target end date
  | "plan_compliant";       // Active plan within timeline

export interface RTWCompliance {
  status: RTWComplianceStatus;
  activePlan?: TreatmentPlan;
  daysUntilExpiry?: number;
  daysSinceExpiry?: number;
  requiresReview: boolean;
  message: string;
}

// =====================================================
// Smart Summary Engine v1 - Structured Case Analysis
// =====================================================

export type SummaryRiskLevel = "high" | "medium" | "low";
export type ImportanceLevel = "critical" | "recommended";
export type PriorityLevel = "urgent" | "normal";
export type RTWReadinessLevel = "ready" | "conditional" | "not_ready" | "unknown";
export type ComplianceStatusLevel = "compliant" | "at_risk" | "non_compliant";

export interface SummaryRisk {
  level: SummaryRiskLevel;
  description: string;
  source: string;
}

export interface MissingInfoItem {
  item: string;
  importance: ImportanceLevel;
}

export interface RecommendedAction {
  action: string;
  priority: PriorityLevel;
  reason: string;
}

export interface RTWReadiness {
  level: RTWReadinessLevel;
  conditions: string[];
  blockers: string[];
}

export interface ComplianceSummary {
  status: ComplianceStatusLevel;
  issues: string[];
}

export interface CaseSummary {
  caseId: string;
  generatedAt: string;

  // Narrative
  summaryText: string;
  currentStatus: string;

  // Structured data
  risks: SummaryRisk[];
  missingInfo: MissingInfoItem[];
  recommendedActions: RecommendedAction[];
  rtwReadiness: RTWReadiness;
  compliance: ComplianceSummary;

  confidence: number;
}

// =====================================================
// IR Email Drafter v1 - AI-Powered Email Generation
// =====================================================

export type EmailDraftType =
  | "initial_contact"
  | "certificate_chase"
  | "check_in_follow_up"
  | "rtw_update"
  | "duties_proposal"
  | "non_compliance_warning"
  | "employer_update"
  | "insurer_report"
  | "general_response";

export type EmailRecipientType = "worker" | "employer" | "insurer" | "host" | "other";
export type EmailTone = "formal" | "supportive" | "firm";
export type EmailDraftStatus = "draft" | "sent" | "discarded";

export const emailDrafts = pgTable("email_drafts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(), // Added in migration 0009 - tenant isolation
  caseId: varchar("case_id").notNull().references(() => workerCases.id, { onDelete: "cascade" }),
  emailType: text("email_type").notNull(),
  recipient: text("recipient").notNull(),
  recipientName: text("recipient_name"),
  recipientEmail: text("recipient_email"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  tone: text("tone").notNull().default("formal"),
  additionalContext: text("additional_context"),
  caseContextSnapshot: jsonb("case_context_snapshot"),
  status: text("status").notNull().default("draft"),
  createdBy: varchar("created_by"),
  // v0 email-drafter (inbound auto-reply): which GPNet mailbox the reply
  // will be sent from, and the Message-ID being replied to (for threading).
  // Nullable — only populated by the inbound-reply drafter, not by the
  // case-manager-triggered draft service.
  mailbox: text("mailbox"),
  inReplyTo: text("in_reply_to"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type InsertEmailDraft = typeof emailDrafts.$inferInsert;
export type EmailDraftDB = typeof emailDrafts.$inferSelect;

export interface EmailDraft {
  id: string;
  caseId: string;
  emailType: EmailDraftType;
  recipient: EmailRecipientType;
  recipientName: string | null;
  recipientEmail: string | null;
  subject: string;
  body: string;
  tone: EmailTone;
  additionalContext: string | null;
  status: EmailDraftStatus;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailDraftRequest {
  emailType: EmailDraftType;
  recipient: EmailRecipientType;
  recipientName?: string;
  recipientEmail?: string;
  additionalContext?: string;
  tone?: EmailTone;
}

export interface EmailTypeInfo {
  value: EmailDraftType;
  label: string;
  description: string;
  defaultRecipient: EmailRecipientType;
}

// =====================================================
// Email Templates - Organization-specific email templates (EMAIL-09)
// =====================================================

export const emailTemplates = pgTable("email_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),
  templateType: varchar("template_type").notNull(), // 'rtw_plan_notification', 'certificate_chase', etc.
  templateName: varchar("template_name"), // User-friendly name
  subjectTemplate: text("subject_template").notNull(),
  bodyTemplate: text("body_template").notNull(),
  format: varchar("format").notNull().default("plain"), // 'plain' or 'html'
  isActive: boolean("is_active").notNull().default(true),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type EmailTemplateDB = typeof emailTemplates.$inferSelect;
export type InsertEmailTemplate = typeof emailTemplates.$inferInsert;

// =====================================================
// Email Notifications Engine v1 - Automated Alerts
// =====================================================

export type NotificationType =
  | "certificate_expiring"
  | "certificate_expired"
  | "action_overdue"
  | "case_attention_needed"
  | "weekly_digest"
  | "check_in_follow_up"
  | "rtw_plan_expiring"     // RTW plan expires in 7/3/1 days
  | "rtw_plan_expired"      // RTW plan has expired
  | "health_check_due";     // Pre-employment health check overdue or due within 60 days

export type NotificationPriority = "low" | "medium" | "high" | "critical";
export type NotificationStatus = "pending" | "sent" | "failed" | "skipped";

export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(), // Added in migration 0009 - tenant isolation
  type: text("type").notNull(),
  priority: text("priority").notNull().default("medium"),
  caseId: varchar("case_id").references(() => workerCases.id, { onDelete: "cascade" }),
  recipientId: varchar("recipient_id"),
  recipientEmail: text("recipient_email").notNull(),
  recipientName: text("recipient_name"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("pending"),
  sentAt: timestamp("sent_at"),
  failureReason: text("failure_reason"),
  dedupeKey: text("dedupe_key").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type InsertNotification = typeof notifications.$inferInsert;
export type NotificationDB = typeof notifications.$inferSelect;

export interface Notification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  caseId: string | null;
  recipientId: string | null;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  body: string;
  status: NotificationStatus;
  sentAt: string | null;
  failureReason: string | null;
  dedupeKey: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

// ============================================
// INSURERS TABLE
// ============================================
export const insurers = pgTable("insurers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  code: varchar("code", { length: 50 }).unique(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertInsurerSchema = createInsertSchema(insurers);

export type Insurer = typeof insurers.$inferSelect;
export type InsertInsurer = z.infer<typeof insertInsurerSchema>;

// ============================================
// ORGANIZATIONS TABLE
// ============================================
export const auStateCodes = ["VIC", "NSW", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const;
export type AuState = typeof auStateCodes[number];

export const employeeCountBands = ["1-10", "11-50", "51-200", "201-500", "500+"] as const;
export type EmployeeCountBand = typeof employeeCountBands[number];

export const organizations = pgTable("organizations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  slug: varchar("slug", { length: 100 }).unique().notNull(),
  kind: text("kind").$type<"employer" | "partner">().notNull().default("employer"), // 'employer' = owns its own cases (default, all existing rows); 'partner' = manages cases on behalf of others
  logoUrl: text("logo_url"),
  contactName: text("contact_name"),
  contactPhone: varchar("contact_phone", { length: 50 }),
  contactEmail: text("contact_email"),
  insurerId: varchar("insurer_id").references(() => insurers.id),
  isActive: boolean("is_active").notNull().default(true),
  // Partner-tier slice 2 — additive, all nullable
  abn: varchar("abn", { length: 11 }),
  worksafeState: text("worksafe_state").$type<AuState>(),
  policyNumber: text("policy_number"),
  wicCode: varchar("wic_code", { length: 20 }),
  addressLine1: text("address_line_1"),
  addressLine2: text("address_line_2"),
  suburb: text("suburb"),
  state: text("state").$type<AuState>(),
  postcode: varchar("postcode", { length: 4 }),
  insurerClaimContactEmail: text("insurer_claim_contact_email"),
  rtwCoordinatorName: text("rtw_coordinator_name"),
  rtwCoordinatorEmail: text("rtw_coordinator_email"),
  rtwCoordinatorPhone: varchar("rtw_coordinator_phone", { length: 50 }),
  hrContactName: text("hr_contact_name"),
  hrContactEmail: text("hr_contact_email"),
  hrContactPhone: varchar("hr_contact_phone", { length: 50 }),
  notificationEmails: text("notification_emails"), // comma-separated; trimmed + lowercased on write
  employeeCount: text("employee_count").$type<EmployeeCountBand>(),
  notes: text("notes"),
  // GP escalation detection: days past latest cert expiry before flagging the case
  gpEscalationThresholdDays: integer("gp_escalation_threshold_days").notNull().default(7),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertOrganizationSchema = createInsertSchema(organizations);

export type Organization = typeof organizations.$inferSelect;
export type InsertOrganization = z.infer<typeof insertOrganizationSchema>;

// ============================================
// PARTNER USER ORGANIZATIONS — many-to-many access table for partner-role users
// ============================================
export const partnerUserOrganizations = pgTable(
  "partner_user_organizations",
  {
    userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    organizationId: varchar("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    grantedAt: timestamp("granted_at").defaultNow().notNull(),
    grantedBy: varchar("granted_by").references(() => users.id), // nullable — system seeds may have no granter
  },
  (table) => ({
    pk: primaryKey({ columns: [table.userId, table.organizationId] }),
    userIdIdx: index("partner_user_organizations_user_id_idx").on(table.userId),
  })
);

export type PartnerUserOrganization = typeof partnerUserOrganizations.$inferSelect;
export type InsertPartnerUserOrganization = typeof partnerUserOrganizations.$inferInsert;

// ============================================
// CASE CONTACTS TABLE - Key contacts for worker cases
// ============================================

export type CaseContactRole =
  | "worker"
  | "employer_primary"
  | "employer_secondary"
  | "host_employer"
  | "case_manager"
  | "treating_gp"
  | "physiotherapist"
  | "specialist"
  | "orp"
  | "insurer"
  | "gpnet"
  | "other";

export interface CaseContact {
  id: string;
  caseId: string;
  organizationId: string;
  role: CaseContactRole;
  name: string;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  notes?: string | null;
  isPrimary: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const caseContacts = pgTable("case_contacts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => workerCases.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull(),
  role: text("role").notNull(), // worker, employer_primary, employer_secondary, host_employer, case_manager, treating_gp, physiotherapist, specialist, orp, insurer, gpnet, other
  name: text("name").notNull(),
  phone: varchar("phone", { length: 50 }),
  email: text("email"),
  company: text("company"),
  notes: text("notes"),
  isPrimary: boolean("is_primary").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCaseContactSchema = createInsertSchema(caseContacts);

export type CaseContactDB = typeof caseContacts.$inferSelect;
export type InsertCaseContact = z.infer<typeof insertCaseContactSchema>;

// Contact role display labels
export const contactRoleLabels: Record<CaseContactRole, string> = {
  worker: "Worker",
  employer_primary: "Employer (Primary)",
  employer_secondary: "Employer (Secondary)",
  host_employer: "Host Employer",
  case_manager: "Case Manager",
  treating_gp: "Treating GP",
  physiotherapist: "Physiotherapist",
  specialist: "Specialist",
  orp: "ORP",
  insurer: "Insurer",
  gpnet: "GPNet Contact",
  other: "Other",
};

// =====================================================
// RTW Planner Engine - Job Roles & Duties (DB-01 to DB-10)
// =====================================================

// Demand frequency for physical/cognitive requirements (DB-04)
export type DemandFrequency = "never" | "occasionally" | "frequently" | "constantly";

// Physical demand categories (per requirement)
export type PhysicalDemandCategory =
  | "bending"
  | "squatting"
  | "kneeling"
  | "twisting"
  | "reaching_overhead"
  | "reaching_forward"
  | "lifting"
  | "carrying"
  | "standing"
  | "sitting"
  | "walking"
  | "repetitive_movements";

// Cognitive demand categories
export type CognitiveDemandCategory =
  | "concentration"
  | "stress_tolerance"
  | "work_pace";

// Duty suitability based on matrix evaluation
export type DutySuitability = "suitable" | "suitable_with_modification" | "not_suitable";

// RTW Plan types
export type RTWPlanType = "normal_hours" | "partial_hours" | "graduated_return";

// RTW Plan approval status
export type RTWApprovalStatus = "draft" | "pending" | "approved" | "rejected" | "modification_requested";

// Physical demands structure for a duty (matches medical certificate format)
export interface DutyPhysicalDemands {
  // Core physical functions (from Bridge Street Clinic format)
  sitting: DemandFrequency;
  standingWalking: DemandFrequency;
  bending: DemandFrequency;
  squatting: DemandFrequency;
  kneelingClimbing: DemandFrequency;
  twisting: DemandFrequency;
  reachingOverhead: DemandFrequency;
  reachingForward: DemandFrequency;
  neckMovement: DemandFrequency;

  // Lifting/carrying with weight limits
  lifting: DemandFrequency;
  liftingMaxKg?: number;
  carrying: DemandFrequency;
  carryingMaxKg?: number;

  // Additional
  pushing: DemandFrequency;
  pulling: DemandFrequency;
  repetitiveMovements: DemandFrequency;
  useOfInjuredLimb: DemandFrequency;
}

// Cognitive demands structure for a duty
export interface DutyCognitiveDemands {
  concentration: DemandFrequency;
  stressTolerance: DemandFrequency;
  workPace: DemandFrequency;
}

// Medical restriction capability (from medical certificates)
export type RestrictionCapability = "can" | "with_modifications" | "cannot" | "not_assessed";

// Functional restrictions from medical certificate (CAN/WITH MODS/CANNOT matrix)
export interface FunctionalRestrictions {
  sitting: RestrictionCapability;
  standingWalking: RestrictionCapability;
  bending: RestrictionCapability;
  squatting: RestrictionCapability;
  kneelingClimbing: RestrictionCapability;
  twisting: RestrictionCapability;
  reachingOverhead: RestrictionCapability;
  reachingForward: RestrictionCapability;
  neckMovement: RestrictionCapability;
  lifting: RestrictionCapability;
  liftingMaxKg?: number;
  carrying: RestrictionCapability;
  carryingMaxKg?: number;
  pushing: RestrictionCapability;
  pulling: RestrictionCapability;
  repetitiveMovements: RestrictionCapability;
  useOfInjuredLimb: RestrictionCapability;

  // Exercise and rest requirements (from medical certs)
  exerciseMinutesPerHour?: number;
  restMinutesPerHour?: number;

  // Duration and review
  constraintDurationWeeks?: number;
  nextExaminationDate?: string;
}

// Extended FunctionalRestrictions with time limits for certificate storage
export interface FunctionalRestrictionsExtracted extends FunctionalRestrictions {
  // Time limits (extracted from "reduced hours" restrictions)
  maxWorkHoursPerDay?: number;
  maxWorkDaysPerWeek?: number;

  // Repetitive movement limit (MED-06) - when certificate specifies quantitative limit
  repetitiveMovementsMaxPerHour?: number;

  // Extraction metadata
  extractionConfidence?: number;
  extractedAt?: string;
}

// =====================================================
// RTW Planner Engine - Database Tables (DB-01 to DB-09)
// =====================================================

// DB-01: Job Roles Table - Organization-specific job roles
export const rtwRoles = pgTable("rtw_roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type RTWRoleDB = typeof rtwRoles.$inferSelect;
export type InsertRTWRole = typeof rtwRoles.$inferInsert & Partial<typeof rtwRoles.$inferSelect>;

// DB-02: Duties Table - Duties for each role with modifiable flag
export const rtwDuties = pgTable("rtw_duties", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  roleId: varchar("role_id").notNull().references(() => rtwRoles.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  description: text("description"),
  isModifiable: boolean("is_modifiable").notNull().default(false),
  riskFlags: text("risk_flags").array().default(sql`ARRAY[]::text[]`),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type RTWDutyDB = typeof rtwDuties.$inferSelect;
export type InsertRTWDuty = typeof rtwDuties.$inferInsert;

// DB-03: Duty Demands Table - Physical and cognitive demands for each duty
export const rtwDutyDemands = pgTable("rtw_duty_demands", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  dutyId: varchar("duty_id").notNull().references(() => rtwDuties.id, { onDelete: "cascade" }).unique(),

  // Physical demands (Never/Occasionally/Frequently/Constantly)
  bending: varchar("bending").notNull().default("never"),
  squatting: varchar("squatting").notNull().default("never"),
  kneeling: varchar("kneeling").notNull().default("never"),
  twisting: varchar("twisting").notNull().default("never"),
  reachingOverhead: varchar("reaching_overhead").notNull().default("never"),
  reachingForward: varchar("reaching_forward").notNull().default("never"),
  lifting: varchar("lifting").notNull().default("never"),
  liftingMaxKg: integer("lifting_max_kg"),
  carrying: varchar("carrying").notNull().default("never"),
  carryingMaxKg: integer("carrying_max_kg"),
  standing: varchar("standing").notNull().default("never"),
  sitting: varchar("sitting").notNull().default("never"),
  walking: varchar("walking").notNull().default("never"),
  repetitiveMovements: varchar("repetitive_movements").notNull().default("never"),

  // Cognitive demands
  concentration: varchar("concentration").notNull().default("never"),
  stressTolerance: varchar("stress_tolerance").notNull().default("never"),
  workPace: varchar("work_pace").notNull().default("never"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type RTWDutyDemandsDB = typeof rtwDutyDemands.$inferSelect;
export type InsertRTWDutyDemands = typeof rtwDutyDemands.$inferInsert;

// Phase 8.3 — Structured RTW Pathways
export type RTWPathway =
  | "same_role_full_duties"         // Return to pre-injury role, no modifications
  | "same_role_modified_duties"     // Same role, modified tasks
  | "same_employer_different_role"  // Different role with same employer
  | "different_employer"            // Labour hire or host employer placement
  | "retraining"                    // Vocational retraining program
  | "self_employment";              // Supported transition to self-employment

export const RTW_PATHWAY_LABELS: Record<RTWPathway, string> = {
  same_role_full_duties: "Same Role — Full Duties",
  same_role_modified_duties: "Same Role — Modified Duties",
  same_employer_different_role: "Same Employer — Different Role",
  different_employer: "Different Employer / Labour Hire",
  retraining: "Vocational Retraining",
  self_employment: "Self-Employment Transition",
};

// Phase 8.2 — Worker Consent
export type RTWConsentStatus = "pending" | "agreed" | "agreed_with_conditions" | "refused";
export type RTWConsentMethod = "verbal" | "written" | "email";

// DB-05: RTW Plans Table - Formal return-to-work plans
export const rtwPlans = pgTable("rtw_plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),
  caseId: varchar("case_id").notNull().references(() => workerCases.id, { onDelete: "cascade" }),
  workerId: varchar("worker_id"),
  roleId: varchar("role_id").references(() => rtwRoles.id),

  planType: varchar("plan_type").notNull().default("graduated_return"), // normal_hours, partial_hours, graduated_return
  status: varchar("status").notNull().default("draft"), // draft, pending, approved, rejected, modification_requested
  version: integer("version").notNull().default(1),

  // Phase 8.3 — Pathway
  pathway: text("pathway").$type<RTWPathway>(),
  pathwayRationale: text("pathway_rationale"),

  startDate: timestamp("start_date"),
  targetEndDate: timestamp("target_end_date"),
  restrictionReviewDate: timestamp("restriction_review_date"),

  // RTW Auto-Draft (2026-05-13): flag + confidence for auto-generated drafts.
  // autoGenerated=true → consultant approval required; false → manual creation.
  // autoGenerationConfidence: calculator confidence score 0.00-1.00; <0.50 triggers manual-review flag.
  autoGenerated: boolean("auto_generated").default(false),
  autoGenerationConfidence: numeric("auto_generation_confidence", { precision: 3, scale: 2 }),

  createdBy: varchar("created_by").notNull().references(() => users.id),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type RTWPlanDB = typeof rtwPlans.$inferSelect;
export type InsertRTWPlan = typeof rtwPlans.$inferInsert;

// DB-06: RTW Plan Versions Table - Version control for plans
export const rtwPlanVersions = pgTable("rtw_plan_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  planId: varchar("plan_id").notNull().references(() => rtwPlans.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  dataJson: jsonb("data_json").notNull(),
  createdBy: varchar("created_by").notNull().references(() => users.id),
  changeReason: text("change_reason"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type RTWPlanVersionDB = typeof rtwPlanVersions.$inferSelect;

// DB-07: RTW Plan Consents — Phase 8.2 Worker Consent Tracking
export const rtwPlanConsents = pgTable("rtw_plan_consents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  planId: varchar("plan_id").references(() => rtwPlans.id, { onDelete: "cascade" }),
  caseId: varchar("case_id").notNull().references(() => workerCases.id, { onDelete: "cascade" }),
  consentStatus: text("consent_status").$type<RTWConsentStatus>().notNull().default("pending"),
  conditions: text("conditions"),         // If agreed_with_conditions
  refusalReason: text("refusal_reason"),  // If refused
  method: text("method").$type<RTWConsentMethod>().notNull().default("verbal"),
  recordedBy: varchar("recorded_by").notNull().references(() => users.id),
  documentUrl: text("document_url"),      // Uploaded signed consent form
  notes: text("notes"),
  recordedAt: timestamp("recorded_at").defaultNow(),
});

export type RTWPlanConsentDB = typeof rtwPlanConsents.$inferSelect;
export type InsertRTWPlanConsent = typeof rtwPlanConsents.$inferInsert;
export type InsertRTWPlanVersion = typeof rtwPlanVersions.$inferInsert;

// DB-07: RTW Plan Duties Table - Plan-duty assignments with suitability
export const rtwPlanDuties = pgTable("rtw_plan_duties", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  planVersionId: varchar("plan_version_id").notNull().references(() => rtwPlanVersions.id, { onDelete: "cascade" }),
  dutyId: varchar("duty_id").notNull().references(() => rtwDuties.id),
  suitability: varchar("suitability").notNull(), // suitable, suitable_with_modification, not_suitable
  modificationNotes: text("modification_notes"),
  excludedReason: text("excluded_reason"),
  manuallyOverridden: boolean("manually_overridden").default(false),
  overrideReason: text("override_reason"),
  overriddenBy: varchar("overridden_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export type RTWPlanDutyDB = typeof rtwPlanDuties.$inferSelect;
export type InsertRTWPlanDuty = typeof rtwPlanDuties.$inferInsert & Partial<typeof rtwPlanDuties.$inferSelect>;

// DB-08: RTW Plan Schedule Table - Week-by-week schedule
export const rtwPlanSchedule = pgTable("rtw_plan_schedule", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  planVersionId: varchar("plan_version_id").notNull().references(() => rtwPlanVersions.id, { onDelete: "cascade" }),
  weekNumber: integer("week_number").notNull(),
  hoursPerDay: numeric("hours_per_day", { precision: 4, scale: 2 }).notNull(),
  daysPerWeek: integer("days_per_week").notNull(),
  dutiesJson: jsonb("duties_json").default(sql`'[]'::jsonb`),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type RTWPlanScheduleDB = typeof rtwPlanSchedule.$inferSelect;
export type InsertRTWPlanSchedule = typeof rtwPlanSchedule.$inferInsert;

// DB-09: RTW Approvals Table - Manager approval workflow
export const rtwApprovals = pgTable("rtw_approvals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  planVersionId: varchar("plan_version_id").notNull().references(() => rtwPlanVersions.id, { onDelete: "cascade" }),
  approverId: varchar("approver_id").notNull().references(() => users.id),
  status: varchar("status").notNull(), // approved, rejected, modification_requested
  reason: text("reason"),
  modificationComments: text("modification_comments"),
  notificationSent: boolean("notification_sent").default(false),
  notificationSentAt: timestamp("notification_sent_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type RTWApprovalDB = typeof rtwApprovals.$inferSelect;
export type InsertRTWApproval = typeof rtwApprovals.$inferInsert;

// RTW Audit Event Types (DB-10 - extends existing auditEvents)
export type RTWAuditEventType =
  | "rtw_plan_created"
  | "rtw_plan_updated"
  | "rtw_plan_submitted"
  | "rtw_plan_approved"
  | "rtw_plan_rejected"
  | "rtw_plan_modification_requested"
  | "rtw_duty_override"
  | "rtw_role_created"
  | "rtw_role_updated"
  | "rtw_duty_created"
  | "rtw_duty_updated";

// Zod schemas for RTW Planner
export const insertRTWRoleSchema = createInsertSchema(rtwRoles);

export const insertRTWDutySchema = createInsertSchema(rtwDuties);

export const insertRTWDutyDemandsSchema = createInsertSchema(rtwDutyDemands);

export const insertRTWPlanSchema = createInsertSchema(rtwPlans);

export const insertRTWPlanVersionSchema = createInsertSchema(rtwPlanVersions);

export const insertRTWPlanDutySchema = createInsertSchema(rtwPlanDuties);

export const insertRTWPlanScheduleSchema = createInsertSchema(rtwPlanSchedule);

export const insertRTWApprovalSchema = createInsertSchema(rtwApprovals);

// =============================================================================
// Pre-Employment Health Checks Module
// =============================================================================

// ============================================
// WORKERS TABLE
// Normalized worker identity — linked to cases, assessments, bookings
// ============================================
export const workers = pgTable("workers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id),
  name: text("name").notNull(),
  email: text("email"),
  phone: text("phone"),
  dateOfBirth: timestamp("date_of_birth"),
  // RTW Auto-Draft (2026-05-13): worker's baseline role for return-to-work planning.
  // roleId is the structured link to rtwRoles; role is free-text legacy fallback.
  // worker_cases.preInjuryRoleOverrideId overrides this per-case when role at injury differs.
  roleId: varchar("role_id").references(() => rtwRoles.id),
  role: text("role"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type WorkerDB = typeof workers.$inferSelect;
export type InsertWorker = typeof workers.$inferInsert;

export const insertWorkerSchema = createInsertSchema(workers);

// Pre-Employment Assessment Status Types
export type PreEmploymentAssessmentStatus =
  | "created"   // assessment created, not yet sent to worker
  | "sent"      // questionnaire link emailed to worker
  | "pending"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "failed"
  | "cancelled";

// Assessment-type values stored in preEmploymentAssessments.assessmentType.
// The first six are the legacy clinical types used by pre-employment checks;
// the last five are the non-pre-employment check categories, stored verbatim.
export type AssessmentType =
  | "baseline_health"
  | "functional_capacity"
  | "medical_screening"
  | "fitness_for_duty"
  | "psychological_assessment"
  | "substance_screening"
  | "prevention"
  | "injury"
  | "wellness"
  | "mental_health"
  | "exit";

/** @deprecated Use {@link AssessmentType}. Kept for back-compat. */
export type PreEmploymentAssessmentType = AssessmentType;

export type PreEmploymentClearanceLevel =
  | "cleared_unconditional"
  | "cleared_conditional"
  | "cleared_with_restrictions"
  | "not_cleared"
  | "pending_review"
  | "requires_review";   // AI-flagged: needs human review before employer notification

// Pre-Employment Health Assessments
export const preEmploymentAssessments = pgTable("pre_employment_assessments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),
  workerId: varchar("worker_id").references(() => workers.id), // normalized worker record

  // Candidate Information
  candidateName: text("candidate_name").notNull(),
  candidateEmail: text("candidate_email"),
  candidatePhone: text("candidate_phone"),
  dateOfBirth: timestamp("date_of_birth"),

  // Position Information
  positionTitle: text("position_title").notNull(),
  departmentName: text("department_name"),
  roleId: varchar("role_id").references(() => rtwRoles.id), // Links to existing RTW roles

  // Assessment Details
  assessmentType: text("assessment_type").notNull().$type<AssessmentType>(),
  status: text("status").notNull().default("pending").$type<PreEmploymentAssessmentStatus>(),
  scheduledDate: timestamp("scheduled_date"),
  completedDate: timestamp("completed_date"),

  // Results
  clearanceLevel: text("clearance_level").$type<PreEmploymentClearanceLevel>(),
  medicalRestrictions: jsonb("medical_restrictions").$type<MedicalConstraints | null>(),
  functionalCapacityJson: jsonb("functional_capacity_json").$type<FunctionalCapacity | null>(),

  // Assessment Provider
  assessorName: text("assessor_name"),
  assessorType: text("assessor_type"), // 'GP', 'Occupational Physician', 'Physiotherapist', etc.
  assessmentLocation: text("assessment_location"),

  // Documentation
  reportUrl: text("report_url"),
  certificateUrl: text("certificate_url"),
  notes: text("notes"),

  // Self-service workflow (magic link questionnaire)
  accessToken: varchar("access_token", { length: 64 }).unique(), // magic link token for /check/:token
  jobDescription: text("job_description"),               // role physical demands for AI analysis
  jobDescriptionFileUrl: text("job_description_file_url"), // uploaded JD attachment (PDF/Word)
  questionnaireResponses: jsonb("questionnaire_responses").$type<Record<string, unknown> | null>(),
  sentAt: timestamp("sent_at"),                          // when questionnaire link was emailed
  employerNotifiedAt: timestamp("employer_notified_at"), // when report was sent to employer
  reportJson: jsonb("report_json").$type<Record<string, unknown> | null>(), // AI-generated report
  alertSent: boolean("alert_sent").default(false),       // flagged to jacinta@preventli.ai

  // RTW linkage — set when assessment is triggered by a worker case (e.g. cert downgrade)
  caseId: varchar("case_id").references(() => workerCases.id, { onDelete: "set null" }),

  // Tracking
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Pre-Employment Health Requirements (job-specific requirements)
export const preEmploymentHealthRequirements = pgTable("pre_employment_health_requirements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull().references(() => organizations.id),

  // Role/Position Information
  roleId: varchar("role_id").references(() => rtwRoles.id),
  positionTitle: text("position_title").notNull(),

  // Required Assessments
  requiresBaselineHealth: boolean("requires_baseline_health").default(true),
  requiresFunctionalCapacity: boolean("requires_functional_capacity").default(false),
  requiresMedicalScreening: boolean("requires_medical_screening").default(false),
  requiresFitnessForDuty: boolean("requires_fitness_for_duty").default(false),
  requiresPsychologicalAssessment: boolean("requires_psychological_assessment").default(false),
  requiresSubstanceScreening: boolean("requires_substance_screening").default(false),

  // Physical Requirements (inherited from RTW role demands)
  minimumLiftingCapacityKg: integer("minimum_lifting_capacity_kg"),
  requiresExtendedStanding: boolean("requires_extended_standing").default(false),
  requiresExtendedSitting: boolean("requires_extended_sitting").default(false),
  requiresClimbing: boolean("requires_climbing").default(false),
  requiresDriving: boolean("requires_driving").default(false),

  // Additional Requirements
  requiredCertifications: text("required_certifications"), // JSON array of certification types
  medicalClearanceValidityMonths: integer("medical_clearance_validity_months").default(12),

  // Compliance & Legal
  legislativeRequirement: text("legislative_requirement"), // Reference to relevant legislation
  industryStandards: text("industry_standards"), // Reference to industry-specific standards

  // Tracking
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Pre-Employment Assessment Components (individual tests within an assessment)
export const preEmploymentAssessmentComponents = pgTable("pre_employment_assessment_components", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  assessmentId: varchar("assessment_id").notNull().references(() => preEmploymentAssessments.id, { onDelete: "cascade" }),

  // Component Details
  componentType: text("component_type").notNull(), // 'vision_test', 'hearing_test', 'cardio_assessment', etc.
  componentName: text("component_name").notNull(),

  // Results
  result: text("result"), // 'pass', 'fail', 'conditional', 'pending'
  measurementValue: text("measurement_value"), // Actual measurement if applicable
  measurementUnit: text("measurement_unit"),
  normalRange: text("normal_range"),

  // Recommendations
  recommendations: text("recommendations"),
  restrictions: jsonb("restrictions").$type<MedicalConstraints | null>(),
  followUpRequired: boolean("follow_up_required").default(false),
  followUpDate: timestamp("follow_up_date"),

  // Tracking
  completedDate: timestamp("completed_date"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Pre-Employment Health History (candidate's health background)
export const preEmploymentHealthHistory = pgTable("pre_employment_health_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  assessmentId: varchar("assessment_id").notNull().references(() => preEmploymentAssessments.id, { onDelete: "cascade" }),

  // Medical History
  previousInjuries: text("previous_injuries"), // JSON array of injury details
  ongoingMedicalConditions: text("ongoing_medical_conditions"), // JSON array
  currentMedications: text("current_medications"), // JSON array
  allergies: text("allergies"),

  // Work History
  previousWorkersCompClaims: boolean("previous_workers_comp_claims").default(false),
  previousWorkersCompClaimsDetails: text("previous_workers_comp_claims_details"),

  // Lifestyle Factors
  smokingStatus: text("smoking_status"), // 'never', 'former', 'current'
  exerciseLevel: text("exercise_level"), // 'sedentary', 'light', 'moderate', 'high'

  // Declarations
  healthDeclarationComplete: boolean("health_declaration_complete").default(false),
  healthDeclarationDate: timestamp("health_declaration_date"),
  declarationAccurate: boolean("declaration_accurate").default(false),

  // Privacy & Consent
  consentToAssessment: boolean("consent_to_assessment").default(false),
  consentToDataSharing: boolean("consent_to_data_sharing").default(false),
  consentDate: timestamp("consent_date"),

  // Tracking
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Database type exports for Pre-Employment module
export type PreEmploymentAssessmentDB = typeof preEmploymentAssessments.$inferSelect;
export type InsertPreEmploymentAssessment = typeof preEmploymentAssessments.$inferInsert;

export type PreEmploymentHealthRequirementDB = typeof preEmploymentHealthRequirements.$inferSelect;
export type InsertPreEmploymentHealthRequirement = typeof preEmploymentHealthRequirements.$inferInsert;

export type PreEmploymentAssessmentComponentDB = typeof preEmploymentAssessmentComponents.$inferSelect;
export type InsertPreEmploymentAssessmentComponent = typeof preEmploymentAssessmentComponents.$inferInsert;

export type PreEmploymentHealthHistoryDB = typeof preEmploymentHealthHistory.$inferSelect;
export type InsertPreEmploymentHealthHistory = typeof preEmploymentHealthHistory.$inferInsert;

// Zod schemas for Pre-Employment module
export const insertPreEmploymentAssessmentSchema = createInsertSchema(preEmploymentAssessments);

export const insertPreEmploymentHealthRequirementSchema = createInsertSchema(preEmploymentHealthRequirements);

export const insertPreEmploymentAssessmentComponentSchema = createInsertSchema(preEmploymentAssessmentComponents);

export const insertPreEmploymentHealthHistorySchema = createInsertSchema(preEmploymentHealthHistory);

// =============================================================================
// Inbound Email System - Direct email ingestion (bypasses Freshdesk)
// =============================================================================

export type EmailProcessingStatus = "received" | "matched" | "case_created" | "failed";
export type EmailSource = "sendgrid" | "demo" | "freshdesk" | "manual";
export type EmailMatchMethod = "thread" | "claim_number" | "sender_email" | "worker_name" | "new_case" | "none";

export const caseEmails = pgTable("case_emails", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar("message_id").unique(), // RFC 2822 Message-ID (idempotency)
  inReplyTo: varchar("in_reply_to"), // Thread tracking
  caseId: varchar("case_id").references(() => workerCases.id, { onDelete: "set null" }),
  organizationId: varchar("organization_id"),
  fromEmail: text("from_email").notNull(),
  fromName: text("from_name"),
  toEmail: text("to_email"),
  subject: text("subject").notNull(),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  attachmentCount: integer("attachment_count").default(0),
  attachmentsJson: jsonb("attachments_json").$type<Array<{ filename: string; contentType: string; sizeBytes: number }>>(),
  processingStatus: text("processing_status").notNull().default("received"),
  matchMethod: text("match_method"),
  matchConfidence: numeric("match_confidence", { precision: 3, scale: 2 }),
  source: text("source").notNull().default("sendgrid"),
  receivedAt: timestamp("received_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const emailAttachments = pgTable("email_attachments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  emailId: varchar("email_id").notNull().references(() => caseEmails.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").default(0),
  base64Data: text("base64_data"),
  isCertificate: boolean("is_certificate").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CaseEmailDB = typeof caseEmails.$inferSelect;
export type InsertCaseEmail = typeof caseEmails.$inferInsert;
export type EmailAttachmentDB = typeof emailAttachments.$inferSelect;
export type InsertEmailAttachment = typeof emailAttachments.$inferInsert;

export const insertCaseEmailSchema = createInsertSchema(caseEmails);

export const insertEmailAttachmentSchema = createInsertSchema(emailAttachments);

// =============================================================================
// Org Inbound Email Aliases — multi-tenant email-to-org routing
// Maps a destination email address (e.g. "support@preventli.ai") to the owning
// org. Replaces the single-tenant PREVENTLI_DEFAULT_INBOUND_ORG_ID env var and
// enables correct routing when multiple orgs share the same inbound gateway.
// =============================================================================

export const orgInboundAliases = pgTable("org_inbound_aliases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orgId: varchar("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  emailAlias: varchar("email_alias").notNull().unique(), // e.g. "support@preventli.ai"
  isDefault: boolean("is_default").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export type OrgInboundAliasDB = typeof orgInboundAliases.$inferSelect;
export type InsertOrgInboundAlias = typeof orgInboundAliases.$inferInsert;
export const insertOrgInboundAliasSchema = createInsertSchema(orgInboundAliases);

// =============================================================================
// Agentic System — Agent Jobs & Actions
// =============================================================================

export type AgentType =
  | "coordinator"
  | "rtw"
  | "recovery"
  | "certificate";

export type AgentJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export type AgentTriggerSource =
  | "cron"
  | "webhook"
  | "manual"
  | "agent"; // triggered by another agent

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected";

// One job = one agent run for one case
export const agentJobs = pgTable("agent_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  caseId: varchar("case_id").references(() => workerCases.id, { onDelete: "cascade" }),
  agentType: text("agent_type").notNull().$type<AgentType>(),
  status: text("status").notNull().default("queued").$type<AgentJobStatus>(),
  triggeredBy: text("triggered_by").notNull().$type<AgentTriggerSource>(),
  triggeredByUserId: varchar("triggered_by_user_id"),
  context: jsonb("context").$type<Record<string, unknown>>(), // task context passed to agent
  summary: text("summary"),    // plain-English summary of what happened
  error: text("error"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AgentJobDB = typeof agentJobs.$inferSelect;
export type InsertAgentJob = typeof agentJobs.$inferInsert;

export const insertAgentJobSchema = createInsertSchema(agentJobs);

// One action = one tool call made by an agent during a job
export const agentActions = pgTable("agent_actions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => agentJobs.id, { onDelete: "cascade" }),
  caseId: varchar("case_id"),                  // nullable: coordinator actions have no case
  actionType: text("action_type").notNull(),   // tool name called
  reasoning: text("reasoning"),                // WHY the agent called this tool
  args: jsonb("args").$type<Record<string, unknown>>(),
  result: jsonb("result").$type<Record<string, unknown>>(),
  autoExecuted: boolean("auto_executed").default(true),
  approvalStatus: text("approval_status").$type<ApprovalStatus>(), // null = auto, pending/approved/rejected for human-in-loop
  approvedBy: varchar("approved_by"),
  approvedAt: timestamp("approved_at"),
  executedAt: timestamp("executed_at").defaultNow(),
});

export type AgentActionDB = typeof agentActions.$inferSelect;
export type InsertAgentAction = typeof agentActions.$inferInsert;

export const insertAgentActionSchema = createInsertSchema(agentActions);

// ============================================
// TELEHEALTH BOOKINGS TABLE
// ============================================
export type TelehealthServiceType = "pre_employment" | "injury" | "mental_health" | "exit" | "wellbeing";
export type TelehealthAppointmentType = "video" | "face_to_face";
export type TelehealthBookingStatus = "pending" | "confirmed" | "completed" | "cancelled";

export const telehealthBookings = pgTable("telehealth_bookings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").references(() => organizations.id),
  caseId: varchar("case_id"),               // nullable — booking may not be linked to a case
  workerId: varchar("worker_id").references(() => workers.id),
  workerName: text("worker_name").notNull(),
  workerEmail: text("worker_email"),
  employerName: text("employer_name"),
  serviceType: text("service_type").$type<TelehealthServiceType>(),
  appointmentType: text("appointment_type").notNull().$type<TelehealthAppointmentType>(),
  employerNotes: text("employer_notes"),
  requestReferral: boolean("request_referral").default(false),
  status: text("status").notNull().default("pending").$type<TelehealthBookingStatus>(),
  // Worker-completed form responses (exit interview answers, pre-employment
  // questionnaire, etc.). Shape is flexible per service type.
  questionnaireResponses: jsonb("questionnaire_responses").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type TelehealthBookingDB = typeof telehealthBookings.$inferSelect;
export type InsertTelehealthBooking = typeof telehealthBookings.$inferInsert;

export const insertTelehealthBookingSchema = createInsertSchema(telehealthBookings);

// ============================================
// CASE DOCUMENTS TABLE
// ============================================
export type DocumentSource = "email" | "portal_upload" | "freshdesk";

export const caseDocuments = pgTable("case_documents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id"),               // nullable — document may belong to worker not case
  workerId: varchar("worker_id").references(() => workers.id),
  documentType: text("document_type"),      // medical_certificate, physio_report, xray, etc.
  fileUrl: text("file_url").notNull(),
  fileName: text("file_name"),
  source: text("source").$type<DocumentSource>(),
  extractedData: jsonb("extracted_data").$type<Record<string, unknown> | null>(), // AI-extracted fields
  notes: text("notes"),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

export type CaseDocumentDB = typeof caseDocuments.$inferSelect;
export type InsertCaseDocument = typeof caseDocuments.$inferInsert;

export const insertCaseDocumentSchema = createInsertSchema(caseDocuments);

// ============================================
// CHAT MEMORY TABLE (Alex per-case/worker memory)
// ============================================

export const chatMemory = pgTable("chat_memory", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id"),
  caseId: varchar("case_id"),       // nullable — set when context is a case
  workerId: varchar("worker_id"),   // nullable — set when context is a worker profile
  role: text("role").notNull(),     // "user" | "assistant"
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export type ChatMemoryDB = typeof chatMemory.$inferSelect;
export type InsertChatMemory = typeof chatMemory.$inferInsert;

// ============================================
// CASE LIFECYCLE LOG (audit trail for stage transitions)
// ============================================

export const caseLifecycleLogs = pgTable("case_lifecycle_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  caseId: varchar("case_id").notNull().references(() => workerCases.id, { onDelete: "cascade" }),
  organizationId: varchar("organization_id").notNull(),
  fromStage: text("from_stage").notNull().$type<CaseLifecycleStage>(),
  toStage: text("to_stage").notNull().$type<CaseLifecycleStage>(),
  changedBy: text("changed_by").notNull(),
  changedAt: timestamp("changed_at").defaultNow(),
  reason: text("reason"),
  automated: boolean("automated").notNull().default(false),
});

export type CaseLifecycleLogDB = typeof caseLifecycleLogs.$inferSelect;
export type InsertCaseLifecycleLog = typeof caseLifecycleLogs.$inferInsert;

// ─── Worker Outreach ──────────────────────────────────────────────────────────

export type OutreachTrigger =
  | "cert_expiring_7d"   // cert expires in ≤7 days → email worker
  | "cert_expired"       // cert expired, no renewal → email worker
  | "manager_no_response" // worker didn't respond in 3 days → alert HR
  | "cert_downgraded";   // new cert has lower capacity than previous → send Prevention Check

export type OutreachStatus = "sent" | "responded" | "failed";

/**
 * Log of every automated outreach sent to a worker or manager.
 * Used for deduplication and response tracking.
 */
export const workerOutreachLog = pgTable("worker_outreach_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  caseId: varchar("case_id").notNull().references(() => workerCases.id, { onDelete: "cascade" }),
  trigger: varchar("trigger").notNull().$type<OutreachTrigger>(),
  channel: varchar("channel").notNull().default("email"),
  recipientEmail: varchar("recipient_email"),
  recipientType: varchar("recipient_type").notNull().default("worker"), // 'worker' | 'manager'
  subject: text("subject"),
  bodyPreview: text("body_preview"),       // first 500 chars of email body (for audit)
  sentAt: timestamp("sent_at").defaultNow(),
  respondedAt: timestamp("responded_at"),  // set when worker replies via inbound email
  status: varchar("status").notNull().default("sent").$type<OutreachStatus>(),
  dedupeKey: varchar("dedupe_key").unique(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type WorkerOutreachLogDB = typeof workerOutreachLog.$inferSelect;
export type InsertWorkerOutreachLog = typeof workerOutreachLog.$inferInsert;

/**
 * Per-org editable email templates for each outreach trigger.
 * Falls back to hardcoded defaults when no org template exists.
 */
export const outreachTemplates = pgTable("outreach_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: varchar("organization_id").notNull(),
  trigger: varchar("trigger").notNull().$type<OutreachTrigger>(),
  subject: text("subject").notNull(),
  body: text("body").notNull(), // supports {{workerName}}, {{expiryDate}}, {{daysUntil}}, {{company}}, {{caseUrl}}
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type OutreachTemplateDB = typeof outreachTemplates.$inferSelect;
export type InsertOutreachTemplate = typeof outreachTemplates.$inferInsert;
export const insertOutreachTemplateSchema = createInsertSchema(outreachTemplates);

// Build status board — shared with preventli-dashboard repo.
// Column shape must match D:\dev\preventli-dashboard\lib\schema.ts so both
// Drizzle layers see identical rows. Table name "Node" (quoted, capital N)
// matches the dashboard's expectations.
export const node = pgTable("Node", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  parentId: text("parent_id"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status"),
  ownerType: text("owner_type"),
  ownerId: text("owner_id"),
  priority: integer("priority").default(0),
  metadata: json("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type NodeDB = typeof node.$inferSelect;
export type InsertNode = typeof node.$inferInsert;
