/**
 * Medico-legal reports — demo content for IME (Independent Medical Examination)
 * reports surfaced on complex/chronic cases.
 *
 * Stored as a TS constant keyed by caseId rather than a DB column so the demo
 * can ship without a schema migration. The DB still gets a `case_attachments`
 * row (type=`medico-legal-report`) to anchor the report in the timeline and
 * downloads list — but the rich structured content (recommendations, capacity,
 * diagnoses) lives here and is rendered client-side.
 */

export type ImeRecommendationCta =
  | "open_rtw_draft"
  | "book_case_conference"
  | "log_referral"
  | "add_diary"
  | "open_vocational_reassessment";

export type ImeRecommendationPriority = "high" | "medium" | "low";

export interface ImeRecommendation {
  id: string;
  title: string;
  description: string;
  ctaLabel: string;
  ctaAction: ImeRecommendationCta;
  priority: ImeRecommendationPriority;
  dueDate?: string; // ISO yyyy-mm-dd
}

export type ImeCapacityVerdict =
  | "fit_full_duties"
  | "fit_modified_duties"
  | "unfit"
  | "unfit_pre_injury_only";

export interface MedicoLegalReport {
  examinerName: string;
  examinerCredentials: string;
  examinerSpecialty: string;
  examinerAddress: string;
  examinationDate: string; // ISO
  claimNumber: string;
  injuryDate: string; // ISO
  clinicalHistory: string;
  currentStatus: string;
  examinationFindings: string;
  diagnoses: string[];
  prognosis: string;
  wholePersonImpairmentEstimate?: string;
  capacityVerdict: ImeCapacityVerdict;
  capacityNotes: string;
  capacityRestrictions: string[];
  recommendations: ImeRecommendation[];
  reportPdfUrl?: string;
}

/**
 * Wallara demo — David Nguyen, 58yo Facilities & Maintenance Coordinator,
 * 6 months off work with chronic L4-L5 discogenic low back pain and L5
 * radiculopathy. IME conducted 08/05/2026 by Dr Margaret Chen.
 */
const WALLARA_DAVID_IME: MedicoLegalReport = {
  examinerName: "Dr Margaret Chen",
  examinerCredentials: "MBBS, FAFOEM",
  examinerSpecialty: "Consultant Occupational Physician",
  examinerAddress: "Level 7, 200 Collins Street, Melbourne VIC 3000",
  examinationDate: "2026-05-08",
  claimNumber: "VWA 24-091847",
  injuryDate: "2025-11-14",
  clinicalHistory:
    "Mr Nguyen sustained a lumbar disc injury on 14/11/2025 lifting a 20kg compressor unit at a Wallara residential site (Keysborough). Initial MRI in December 2025 confirmed L4-L5 disc protrusion with right-sided neural impingement. Conservative management over six months has comprised physiotherapy, NSAIDs and gabapentin. He was reviewed by Mr Patel (neurosurgeon) in February 2026, who determined Mr Nguyen was not a surgical candidate.",
  currentStatus:
    "Persistent right-sided lumbar pain (VAS 5-7/10), L5 dermatomal paraesthesia, limited bending and lifting tolerance. Sleep disturbance reported. Mild reactive low mood — no formal psychiatric diagnosis.",
  examinationFindings:
    "Limited lumbar flexion (~40°), positive right straight-leg raise at 50°, reduced L5 sensation, 4/5 right EHL strength. Gait antalgic on the right. No red flags identified.",
  diagnoses: [
    "Chronic L4-L5 discogenic low back pain with L5 radiculopathy",
    "Secondary physical deconditioning",
    "Mild adjustment disorder (work-related, sub-clinical)",
  ],
  prognosis:
    "Recovery to full pre-injury duties (heavy manual lifting, ladder work) is unlikely. Medical condition expected to stabilise from 9-12 months post-injury. Long-term vocational change probable.",
  wholePersonImpairmentEstimate: "8% (provisional)",
  capacityVerdict: "fit_modified_duties",
  capacityNotes:
    "NOT fit for pre-injury duties as Facilities & Maintenance Coordinator (lifting >10kg, prolonged standing, ladder work). FIT for sedentary / light administrative duties on a graduated basis.",
  capacityRestrictions: [
    "Max 4 hrs/day initially, increasing by 1 hr fortnightly to 6 hrs",
    "No lifting >5kg",
    "Sit-stand workstation required; 5-min break every 30 min",
    "No driving >30 min continuous",
    "No bending or stooping below knee level",
  ],
  recommendations: [
    {
      id: "case-conference",
      title: "Convene case conference",
      description:
        "GP (Dr Saravanan Shanmugam), IME (Dr Margaret Chen) and insurer agent within 2 weeks to align on modified-duties RTW and vocational pathway.",
      ctaLabel: "Book case conference",
      ctaAction: "book_case_conference",
      priority: "high",
      dueDate: "2026-05-22",
    },
    {
      id: "vocational-reassessment",
      title: "Initiate vocational reassessment",
      description:
        "Pre-injury role is no longer suitable in the long term. Engage vocational rehabilitation provider to scope alternative roles within Wallara (administration, scheduling, compliance).",
      ctaLabel: "Open vocational reassessment",
      ctaAction: "open_vocational_reassessment",
      priority: "high",
    },
    {
      id: "auto-draft-rtw",
      title: "Draft modified-duties RTW plan",
      description:
        "Auto-draft a graduated return: 4 hrs/day sedentary, no lifting >5kg, sit-stand workstation. Increase by 1 hr fortnightly subject to tolerance.",
      ctaLabel: "Auto-draft RTW plan",
      ctaAction: "open_rtw_draft",
      priority: "high",
    },
    {
      id: "pain-program-referral",
      title: "Refer to pain management program",
      description:
        "IME recommendation — multidisciplinary chronic-pain program (e.g. St Vincent's Pain Service or Caulfield Pain Management Service).",
      ctaLabel: "Log referral",
      ctaAction: "log_referral",
      priority: "medium",
    },
    {
      id: "re-examination",
      title: "Diary three-month re-examination",
      description:
        "Re-examination with Dr Margaret Chen at 3 months from this report to reassess capacity and impairment.",
      ctaLabel: "Add diary item",
      ctaAction: "add_diary",
      priority: "medium",
      dueDate: "2026-08-08",
    },
  ],
};

export const MEDICO_LEGAL_REPORTS: Record<string, MedicoLegalReport> = {
  "case-wallara-david": WALLARA_DAVID_IME,
};

export function getMedicoLegalReport(caseId: string): MedicoLegalReport | null {
  return MEDICO_LEGAL_REPORTS[caseId] ?? null;
}

// ────────────────────────────────────────────────────────────────────────────
// Health & Wellbeing reports — preventative occupational health assessments
// that surface a parallel "report + recommendations" panel on case detail.
// ────────────────────────────────────────────────────────────────────────────

export type WellbeingRecommendationCta =
  | "book_followup"
  | "log_referral"
  | "open_workstation_review"
  | "schedule_training"
  | "add_diary";

export interface WellbeingRecommendation {
  id: string;
  title: string;
  description: string;
  ctaLabel: string;
  ctaAction: WellbeingRecommendationCta;
  priority: ImeRecommendationPriority;
  dueDate?: string;
}

export type WellbeingDomain =
  | "musculoskeletal"
  | "psychosocial"
  | "lifestyle"
  | "ergonomic"
  | "cardiometabolic";

export interface WellbeingFinding {
  domain: WellbeingDomain;
  finding: string;
  riskLevel: "low" | "moderate" | "elevated";
}

export type WellbeingOverallRisk = "low" | "moderate" | "elevated" | "high";

export interface HealthWellbeingReport {
  assessorName: string;
  assessorCredentials: string;
  assessorSpecialty: string;
  assessorAddress: string;
  assessmentDate: string;
  assessmentType: string;
  purpose: string;
  summary: string;
  findings: WellbeingFinding[];
  overallRisk: WellbeingOverallRisk;
  overallRiskNotes: string;
  recommendations: WellbeingRecommendation[];
  reportPdfUrl?: string;
}

/**
 * Wallara demo — Naomi Wright, 41yo Support Coordinator. Preventative
 * health & wellbeing assessment after self-flagging fatigue + intermittent
 * neck pain during the quarterly pulse survey.
 */
const WALLARA_NAOMI_WELLBEING: HealthWellbeingReport = {
  assessorName: "Dr Priya Khatri",
  assessorCredentials: "MBBS, FRACGP, DipOccMed",
  assessorSpecialty: "Occupational Health Physician",
  assessorAddress: "Suite 4, 350 Queen Street, Melbourne VIC 3000",
  assessmentDate: "2026-05-12",
  assessmentType: "Preventative Health & Wellbeing Assessment",
  purpose:
    "Voluntary preventative review following Ms Wright's quarterly pulse-survey responses indicating elevated workload pressure, fatigue and intermittent cervical discomfort. No claim, no injury — preventative pathway only.",
  summary:
    "Ms Wright is generally well with no acute medical concerns. Cumulative workload, screen-based posture and a sedentary home workstation are contributing to a moderate musculoskeletal and psychosocial risk profile. Targeted ergonomic and recovery-based interventions are likely to fully resolve current symptoms within 4-6 weeks. No work restrictions warranted.",
  findings: [
    {
      domain: "musculoskeletal",
      finding:
        "Intermittent upper-trapezius and posterior-cervical tightness, worse after Tuesday/Thursday back-to-back coordination shifts. No neurological symptoms. ROM full.",
      riskLevel: "moderate",
    },
    {
      domain: "ergonomic",
      finding:
        "Home workstation monitor below eye-line, no document holder, non-adjustable chair. Average 6.5 hours/day screen time at this setup.",
      riskLevel: "elevated",
    },
    {
      domain: "psychosocial",
      finding:
        "Self-reported workload pressure 7/10 over preceding 4 weeks. Recovery-time index reduced — limited transition between work and personal time. No signs of clinical anxiety or depression on K10 (score 17).",
      riskLevel: "moderate",
    },
    {
      domain: "lifestyle",
      finding:
        "Sleep 6.5-7 hrs/night, weekly exercise ~3 sessions, diet self-rated good. Caffeine intake elevated (~5 cups/day).",
      riskLevel: "low",
    },
    {
      domain: "cardiometabolic",
      finding:
        "BP 122/78, BMI 24.6, resting HR 68. Annual screening normal — no further investigation indicated this assessment.",
      riskLevel: "low",
    },
  ],
  overallRisk: "moderate",
  overallRiskNotes:
    "Symptoms are early-stage and modifiable. Without intervention the trajectory is gradual worsening; with the recommended steps, full resolution is expected within 4-6 weeks. Re-assessment recommended at 3 months.",
  recommendations: [
    {
      id: "workstation-review",
      title: "Home workstation ergonomic review",
      description:
        "Refer Ms Wright for a virtual ergonomic assessment of her home workstation. Likely outcomes: monitor riser, document holder, height-adjustable chair (subject to Wallara's wellbeing budget).",
      ctaLabel: "Open workstation review",
      ctaAction: "open_workstation_review",
      priority: "high",
      dueDate: "2026-05-26",
    },
    {
      id: "physio-referral",
      title: "Physiotherapy referral — neck & upper back",
      description:
        "Two-to-three session block with a musculoskeletal physiotherapist focusing on cervical mobility, upper trapezius release, and a self-managed exercise plan. Funded through the Wallara wellbeing budget.",
      ctaLabel: "Log referral",
      ctaAction: "log_referral",
      priority: "medium",
    },
    {
      id: "recovery-coaching",
      title: "Recovery & workload-pacing coaching",
      description:
        "Two sessions with the EAP recovery coach to build sustainable work-rest transitions. Practical focus: end-of-day shutdown ritual, micro-breaks every 90 minutes, weekly planning rhythm.",
      ctaLabel: "Schedule coaching",
      ctaAction: "schedule_training",
      priority: "medium",
    },
    {
      id: "manager-checkin",
      title: "Diary manager-checkin — workload",
      description:
        "Ellen to schedule a 30-minute workload check-in within the next two weeks. Focus: distribution of complex client load, scope for case-load smoothing, recovery-time protection.",
      ctaLabel: "Add diary item",
      ctaAction: "add_diary",
      priority: "medium",
      dueDate: "2026-05-26",
    },
    {
      id: "reassessment",
      title: "Diary 3-month reassessment",
      description:
        "Voluntary reassessment with Dr Khatri at 3 months to verify resolution. No automatic referral — Ms Wright opts in.",
      ctaLabel: "Add diary item",
      ctaAction: "add_diary",
      priority: "low",
      dueDate: "2026-08-12",
    },
  ],
};

export const HEALTH_WELLBEING_REPORTS: Record<string, HealthWellbeingReport> = {
  "case-wallara-naomi": WALLARA_NAOMI_WELLBEING,
};

export function getHealthWellbeingReport(caseId: string): HealthWellbeingReport | null {
  return HEALTH_WELLBEING_REPORTS[caseId] ?? null;
}

export const WELLBEING_DOMAIN_LABELS: Record<WellbeingDomain, string> = {
  musculoskeletal: "Musculoskeletal",
  psychosocial: "Psychosocial",
  lifestyle: "Lifestyle",
  ergonomic: "Ergonomic",
  cardiometabolic: "Cardiometabolic",
};

export const WELLBEING_RISK_LABELS: Record<WellbeingOverallRisk, string> = {
  low: "Low",
  moderate: "Moderate",
  elevated: "Elevated",
  high: "High",
};

export const CAPACITY_VERDICT_LABELS: Record<ImeCapacityVerdict, string> = {
  fit_full_duties: "Fit for full duties",
  fit_modified_duties: "Fit for modified duties",
  unfit: "Unfit for any work",
  unfit_pre_injury_only: "Unfit for pre-injury duties",
};

export const RECOMMENDATION_PRIORITY_LABELS: Record<ImeRecommendationPriority, string> = {
  high: "High priority",
  medium: "Medium priority",
  low: "Low priority",
};
