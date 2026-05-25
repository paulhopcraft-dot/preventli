import type { RiskLevel, ClinicalEvidenceFlag, MedicalCertificate, WorkCapacity } from "../../shared/schema";

export interface InjuryContext {
  dateOfInjury: string;
  summary: string;
  riskLevel: RiskLevel;
  clinicalFlags: ClinicalEvidenceFlag[];
}

export interface TimelineFactor {
  factor: string;
  impact: "increases" | "decreases" | "neutral";
  description: string;
}

export type TimelineStatus = "estimated" | "pending_medical_assessment" | "insufficient_data";
export type ConfidenceLevel = "low" | "medium" | "high";

export interface TimelineEstimate {
  status: TimelineStatus;
  estimatedWeeks: number | null;
  estimatedCompletionDate: string | null;
  confidence: ConfidenceLevel;
  factors: TimelineFactor[];
  baselineWeeks?: number;
}

// =====================================================
// INJURY TYPE DEFINITIONS - WorkSafe Victoria Common Injuries
// =====================================================

export type InjuryType =
  // Upper limb
  | "fracture_upper_limb"
  | "trigger_finger"
  | "carpal_tunnel"
  | "rotator_cuff"
  | "tennis_elbow"
  // Lower limb
  | "fracture_lower_limb"
  | "knee_injury"
  | "ankle_sprain"
  // Back/Spine
  | "back_strain"
  | "disc_herniation"
  | "sciatica"
  // Soft tissue
  | "soft_tissue_sprain"
  | "laceration"
  | "contusion"
  // Mental health
  | "psychological_stress"
  | "ptsd"
  // Other
  | "chemical_exposure"
  | "hearing_loss"
  | "repetitive_strain"
  | "unknown";

// =====================================================
// INJURY MODEL - Medical Literature Based Recovery Data
// =====================================================

export interface InjuryModel {
  baselineWeeks: number;
  minWeeks: number;
  maxWeeks: number;
  phases: RecoveryPhase[];
  riskFactors: string[];
  diagnosticTests: string[];
  specialistReferrals: string[];
}

export interface RecoveryPhase {
  name: string;
  weekStart: number;
  weekEnd: number;
  expectedCapacity: number; // 0-100%
  description: string;
  milestones: string[];
}

// Comprehensive injury models based on medical literature and WorkSafe Victoria guidelines
const INJURY_MODELS: Record<InjuryType, InjuryModel> = {
  // ========== UPPER LIMB ==========
  trigger_finger: {
    baselineWeeks: 12,
    minWeeks: 6,
    maxWeeks: 26,
    phases: [
      {
        name: "Initial Treatment & Diagnosis",
        weekStart: 0,
        weekEnd: 4,
        expectedCapacity: 10,
        description: "Rest, splinting, anti-inflammatory treatment",
        milestones: ["GP assessment", "Diagnosis confirmed", "Treatment plan established"],
      },
      {
        name: "Active Treatment",
        weekStart: 4,
        weekEnd: 8,
        expectedCapacity: 30,
        description: "Physiotherapy, possible corticosteroid injection",
        milestones: ["Physiotherapy commenced", "Injection if needed", "Symptom monitoring"],
      },
      {
        name: "Rehabilitation",
        weekStart: 8,
        weekEnd: 12,
        expectedCapacity: 60,
        description: "Graduated hand exercises, work conditioning",
        milestones: ["Range of motion improved", "Grip strength returning", "Modified duties possible"],
      },
      {
        name: "Return to Work",
        weekStart: 12,
        weekEnd: 16,
        expectedCapacity: 85,
        description: "Gradual return to normal duties with monitoring",
        milestones: ["RTW plan implemented", "Capacity increasing", "Symptom management stable"],
      },
    ],
    riskFactors: ["Diabetes", "Rheumatoid arthritis", "Repetitive hand use", "Age over 50"],
    diagnosticTests: ["Physical examination", "Ultrasound", "X-ray if bone involvement suspected"],
    specialistReferrals: ["Hand surgeon if conservative treatment fails after 8-12 weeks"],
  },

  carpal_tunnel: {
    baselineWeeks: 10,
    minWeeks: 4,
    maxWeeks: 24,
    phases: [
      {
        name: "Conservative Treatment",
        weekStart: 0,
        weekEnd: 4,
        expectedCapacity: 20,
        description: "Wrist splinting, activity modification, NSAIDs",
        milestones: ["Night splint fitted", "Ergonomic assessment", "Activity modification"],
      },
      {
        name: "Medical Management",
        weekStart: 4,
        weekEnd: 8,
        expectedCapacity: 50,
        description: "Possible steroid injection, nerve gliding exercises",
        milestones: ["Physiotherapy", "Consider injection", "Symptom reassessment"],
      },
      {
        name: "Recovery/Surgery Decision",
        weekStart: 8,
        weekEnd: 12,
        expectedCapacity: 70,
        description: "Assess response to treatment, surgical referral if needed",
        milestones: ["Treatment response evaluation", "Specialist referral if needed"],
      },
    ],
    riskFactors: ["Pregnancy", "Diabetes", "Hypothyroidism", "Obesity", "Repetitive wrist flexion"],
    diagnosticTests: ["Nerve conduction study", "EMG", "Ultrasound"],
    specialistReferrals: ["Neurologist for nerve studies", "Hand surgeon if surgery indicated"],
  },

  rotator_cuff: {
    baselineWeeks: 16,
    minWeeks: 8,
    maxWeeks: 52,
    phases: [
      {
        name: "Acute Phase",
        weekStart: 0,
        weekEnd: 4,
        expectedCapacity: 10,
        description: "Rest, ice, anti-inflammatory, sling if needed",
        milestones: ["Pain management", "Initial physiotherapy assessment", "Activity restriction"],
      },
      {
        name: "Recovery Phase",
        weekStart: 4,
        weekEnd: 12,
        expectedCapacity: 40,
        description: "Passive then active range of motion exercises",
        milestones: ["Range of motion improving", "Pain decreasing", "Strength exercises begin"],
      },
      {
        name: "Strengthening Phase",
        weekStart: 12,
        weekEnd: 20,
        expectedCapacity: 70,
        description: "Progressive resistance exercises, work conditioning",
        milestones: ["Functional strength returning", "Overhead movements possible", "Modified work tolerated"],
      },
      {
        name: "Return to Full Duties",
        weekStart: 20,
        weekEnd: 26,
        expectedCapacity: 90,
        description: "Full work capacity restoration with ongoing monitoring",
        milestones: ["Full duties resumed", "Maintenance exercises", "3-month stability review"],
      },
    ],
    riskFactors: ["Age over 40", "Overhead work", "Previous shoulder injury", "Smoking"],
    diagnosticTests: ["Ultrasound", "MRI", "X-ray"],
    specialistReferrals: ["Orthopedic surgeon if full thickness tear or failed conservative treatment"],
  },

  tennis_elbow: {
    baselineWeeks: 12,
    minWeeks: 6,
    maxWeeks: 52,
    phases: [
      {
        name: "Acute Management",
        weekStart: 0,
        weekEnd: 3,
        expectedCapacity: 30,
        description: "Rest, ice, brace, activity modification",
        milestones: ["Pain identified", "Activity triggers identified", "Brace fitted"],
      },
      {
        name: "Active Rehabilitation",
        weekStart: 3,
        weekEnd: 8,
        expectedCapacity: 50,
        description: "Eccentric exercises, stretching, workplace ergonomics",
        milestones: ["Physiotherapy program", "Ergonomic modifications", "Grip strengthening"],
      },
      {
        name: "Work Reconditioning",
        weekStart: 8,
        weekEnd: 12,
        expectedCapacity: 80,
        description: "Gradual return to normal activities with technique modification",
        milestones: ["Modified duties", "Full duties graded return", "Prevention strategies"],
      },
    ],
    riskFactors: ["Repetitive gripping", "Poor technique", "Age 35-55", "Smoking"],
    diagnosticTests: ["Physical examination", "Ultrasound if recurrent", "MRI for refractory cases"],
    specialistReferrals: ["Sports medicine specialist", "Orthopedic surgeon if chronic"],
  },

  fracture_upper_limb: {
    baselineWeeks: 8,
    minWeeks: 6,
    maxWeeks: 16,
    phases: [
      {
        name: "Immobilization",
        weekStart: 0,
        weekEnd: 4,
        expectedCapacity: 0,
        description: "Cast/splint, pain management, swelling control",
        milestones: ["Fracture confirmed", "Immobilization applied", "Follow-up X-ray"],
      },
      {
        name: "Early Mobilization",
        weekStart: 4,
        weekEnd: 6,
        expectedCapacity: 20,
        description: "Cast removal, gentle range of motion",
        milestones: ["Healing confirmed", "Cast removed", "Physiotherapy commenced"],
      },
      {
        name: "Rehabilitation",
        weekStart: 6,
        weekEnd: 10,
        expectedCapacity: 60,
        description: "Progressive strengthening, functional exercises",
        milestones: ["Range of motion restored", "Strength improving", "Light duties possible"],
      },
      {
        name: "Return to Work",
        weekStart: 10,
        weekEnd: 12,
        expectedCapacity: 90,
        description: "Full function restoration with monitoring",
        milestones: ["Full duties resumed", "Full strength achieved"],
      },
    ],
    riskFactors: ["Osteoporosis", "Complex fracture", "Displacement", "Smoker"],
    diagnosticTests: ["X-ray", "CT scan for complex fractures"],
    specialistReferrals: ["Orthopedic surgeon if surgical fixation needed"],
  },

  // ========== LOWER LIMB ==========
  fracture_lower_limb: {
    baselineWeeks: 12,
    minWeeks: 8,
    maxWeeks: 26,
    phases: [
      {
        name: "Non-Weight Bearing",
        weekStart: 0,
        weekEnd: 6,
        expectedCapacity: 0,
        description: "Immobilization, crutches, elevation",
        milestones: ["Fracture stabilized", "Non-weight bearing mobility", "Pain controlled"],
      },
      {
        name: "Partial Weight Bearing",
        weekStart: 6,
        weekEnd: 10,
        expectedCapacity: 30,
        description: "Progressive weight bearing, pool therapy if available",
        milestones: ["Bone healing confirmed", "Weight bearing progressing", "Physiotherapy intensive"],
      },
      {
        name: "Full Weight Bearing",
        weekStart: 10,
        weekEnd: 14,
        expectedCapacity: 60,
        description: "Normal gait training, strengthening",
        milestones: ["Full weight bearing achieved", "Gait normalized", "Stairs managed"],
      },
      {
        name: "Work Reconditioning",
        weekStart: 14,
        weekEnd: 18,
        expectedCapacity: 85,
        description: "Return to full activities with monitoring",
        milestones: ["Pre-injury activities resumed", "Full work capacity"],
      },
    ],
    riskFactors: ["Osteoporosis", "Diabetes", "Smoking", "Poor nutrition"],
    diagnosticTests: ["X-ray", "CT scan", "Bone density scan if osteoporosis suspected"],
    specialistReferrals: ["Orthopedic surgeon for surgical management"],
  },

  knee_injury: {
    baselineWeeks: 14,
    minWeeks: 4,
    maxWeeks: 52,
    phases: [
      {
        name: "Acute Phase",
        weekStart: 0,
        weekEnd: 2,
        expectedCapacity: 10,
        description: "RICE protocol, assessment, imaging",
        milestones: ["Diagnosis confirmed", "Swelling controlled", "Weight bearing status determined"],
      },
      {
        name: "Early Rehabilitation",
        weekStart: 2,
        weekEnd: 6,
        expectedCapacity: 30,
        description: "Range of motion, quadriceps activation",
        milestones: ["Range of motion improving", "Muscle activation restored", "Pain decreasing"],
      },
      {
        name: "Strengthening",
        weekStart: 6,
        weekEnd: 12,
        expectedCapacity: 60,
        description: "Progressive resistance, balance training",
        milestones: ["Strength returning", "Functional activities improving", "Modified work possible"],
      },
      {
        name: "Return to Full Function",
        weekStart: 12,
        weekEnd: 16,
        expectedCapacity: 85,
        description: "Sport-specific or work-specific rehabilitation",
        milestones: ["Full work capacity", "Prevention strategies implemented"],
      },
    ],
    riskFactors: ["Previous knee injury", "Obesity", "Poor quadriceps strength", "High-impact work"],
    diagnosticTests: ["MRI", "X-ray", "Arthroscopy if diagnosis unclear"],
    specialistReferrals: ["Orthopedic surgeon if ligament tear or meniscus damage confirmed"],
  },

  ankle_sprain: {
    baselineWeeks: 6,
    minWeeks: 2,
    maxWeeks: 12,
    phases: [
      {
        name: "Acute Phase",
        weekStart: 0,
        weekEnd: 1,
        expectedCapacity: 20,
        description: "RICE protocol, protected weight bearing",
        milestones: ["Swelling controlled", "Pain managed", "Grade determined"],
      },
      {
        name: "Early Mobilization",
        weekStart: 1,
        weekEnd: 3,
        expectedCapacity: 50,
        description: "Range of motion, proprioception exercises",
        milestones: ["Weight bearing progressing", "Range of motion improving"],
      },
      {
        name: "Strengthening",
        weekStart: 3,
        weekEnd: 6,
        expectedCapacity: 80,
        description: "Progressive resistance, balance training",
        milestones: ["Normal walking", "Strength returning", "Return to work"],
      },
    ],
    riskFactors: ["Previous ankle sprain", "Poor proprioception", "Inadequate footwear"],
    diagnosticTests: ["X-ray to rule out fracture", "MRI if chronic instability"],
    specialistReferrals: ["Sports medicine if recurrent or severe Grade 3"],
  },

  // ========== BACK/SPINE ==========
  back_strain: {
    baselineWeeks: 10,
    minWeeks: 2,
    maxWeeks: 26,
    phases: [
      {
        name: "Acute Phase",
        weekStart: 0,
        weekEnd: 2,
        expectedCapacity: 30,
        description: "Pain management, avoid bed rest, gentle movement",
        milestones: ["Pain assessment", "Red flags ruled out", "Activity advice"],
      },
      {
        name: "Active Recovery",
        weekStart: 2,
        weekEnd: 6,
        expectedCapacity: 60,
        description: "Physiotherapy, core strengthening, workplace assessment",
        milestones: ["Pain decreasing", "Function improving", "Modified work commenced"],
      },
      {
        name: "Work Reconditioning",
        weekStart: 6,
        weekEnd: 10,
        expectedCapacity: 85,
        description: "Full duties with ergonomic modifications",
        milestones: ["Full duties resumed", "Prevention strategies", "Manual handling training"],
      },
    ],
    riskFactors: ["Heavy lifting", "Poor posture", "Previous back injury", "Obesity", "Sedentary work"],
    diagnosticTests: ["X-ray if trauma", "MRI if neurological symptoms or no improvement"],
    specialistReferrals: ["Spine specialist if neurological involvement", "Pain specialist if chronic"],
  },

  disc_herniation: {
    baselineWeeks: 16,
    minWeeks: 6,
    maxWeeks: 52,
    phases: [
      {
        name: "Acute Management",
        weekStart: 0,
        weekEnd: 4,
        expectedCapacity: 20,
        description: "Pain management, activity modification, avoid aggravating positions",
        milestones: ["Diagnosis confirmed", "Neurological status monitored", "Conservative treatment"],
      },
      {
        name: "Active Rehabilitation",
        weekStart: 4,
        weekEnd: 12,
        expectedCapacity: 50,
        description: "McKenzie exercises, core stability, epidural if needed",
        milestones: ["Pain improving", "Function returning", "Neurological status stable"],
      },
      {
        name: "Work Integration",
        weekStart: 12,
        weekEnd: 20,
        expectedCapacity: 75,
        description: "Gradual return to work with modifications",
        milestones: ["Modified duties", "Ergonomic modifications", "Ongoing physiotherapy"],
      },
    ],
    riskFactors: ["Heavy lifting", "Vibration exposure", "Smoking", "Previous disc problems"],
    diagnosticTests: ["MRI essential", "Nerve conduction if radiculopathy"],
    specialistReferrals: ["Spine surgeon if cauda equina symptoms or failed conservative treatment after 6-8 weeks"],
  },

  sciatica: {
    baselineWeeks: 12,
    minWeeks: 4,
    maxWeeks: 26,
    phases: [
      {
        name: "Acute Phase",
        weekStart: 0,
        weekEnd: 4,
        expectedCapacity: 30,
        description: "Nerve pain management, positioning, gentle movement",
        milestones: ["Pain pattern identified", "Red flags ruled out", "Medication optimized"],
      },
      {
        name: "Active Treatment",
        weekStart: 4,
        weekEnd: 8,
        expectedCapacity: 50,
        description: "Physiotherapy, nerve mobilization, possible injection",
        milestones: ["Pain reducing", "Mobility improving", "Work modifications planned"],
      },
      {
        name: "Rehabilitation",
        weekStart: 8,
        weekEnd: 12,
        expectedCapacity: 75,
        description: "Strengthening, work reconditioning",
        milestones: ["Return to modified work", "Ongoing improvement", "Prevention strategies"],
      },
    ],
    riskFactors: ["Disc herniation", "Spinal stenosis", "Piriformis syndrome", "Prolonged sitting"],
    diagnosticTests: ["MRI", "CT scan", "Nerve conduction studies"],
    specialistReferrals: ["Spine specialist if surgical cause identified"],
  },

  // ========== SOFT TISSUE ==========
  soft_tissue_sprain: {
    baselineWeeks: 6,
    minWeeks: 2,
    maxWeeks: 12,
    phases: [
      {
        name: "Acute Phase",
        weekStart: 0,
        weekEnd: 1,
        expectedCapacity: 40,
        description: "Protection, rest, ice, compression, elevation",
        milestones: ["Injury assessed", "Swelling controlled", "Pain managed"],
      },
      {
        name: "Recovery Phase",
        weekStart: 1,
        weekEnd: 3,
        expectedCapacity: 60,
        description: "Gentle movement, progressive loading",
        milestones: ["Pain decreasing", "Range of motion returning"],
      },
      {
        name: "Strengthening",
        weekStart: 3,
        weekEnd: 6,
        expectedCapacity: 90,
        description: "Full rehabilitation, return to normal activities",
        milestones: ["Full function restored", "Return to work"],
      },
    ],
    riskFactors: ["Previous injury to same area", "Inadequate warm-up", "Poor conditioning"],
    diagnosticTests: ["Ultrasound if diagnosis unclear"],
    specialistReferrals: ["Sports medicine if recurrent"],
  },

  laceration: {
    baselineWeeks: 3,
    minWeeks: 1,
    maxWeeks: 8,
    phases: [
      {
        name: "Wound Care",
        weekStart: 0,
        weekEnd: 1,
        expectedCapacity: 50,
        description: "Wound closure, infection prevention, tetanus if needed",
        milestones: ["Wound closed", "Infection risk assessed", "Follow-up arranged"],
      },
      {
        name: "Healing",
        weekStart: 1,
        weekEnd: 2,
        expectedCapacity: 80,
        description: "Wound healing, dressing changes, activity modification",
        milestones: ["No infection", "Healing progressing", "Suture removal if applicable"],
      },
      {
        name: "Return to Work",
        weekStart: 2,
        weekEnd: 3,
        expectedCapacity: 95,
        description: "Full activity with wound protection if needed",
        milestones: ["Wound healed", "Full duties resumed"],
      },
    ],
    riskFactors: ["Diabetes", "Immunocompromised", "Deep laceration", "Tendon/nerve involvement"],
    diagnosticTests: ["X-ray if foreign body suspected", "Wound exploration if deep"],
    specialistReferrals: ["Plastic surgeon if cosmetic concern", "Hand surgeon if tendon/nerve damage"],
  },

  contusion: {
    baselineWeeks: 2,
    minWeeks: 1,
    maxWeeks: 6,
    phases: [
      {
        name: "Acute Phase",
        weekStart: 0,
        weekEnd: 1,
        expectedCapacity: 60,
        description: "Ice, compression, elevation, pain relief",
        milestones: ["Swelling peak passed", "Pain controlled"],
      },
      {
        name: "Recovery",
        weekStart: 1,
        weekEnd: 2,
        expectedCapacity: 90,
        description: "Gentle activity, heat therapy",
        milestones: ["Bruising resolving", "Full activity resumed"],
      },
    ],
    riskFactors: ["Anticoagulant use", "Bleeding disorders", "Severe impact"],
    diagnosticTests: ["X-ray to rule out fracture if significant force"],
    specialistReferrals: ["Rarely needed unless compartment syndrome suspected"],
  },

  // ========== MENTAL HEALTH ==========
  psychological_stress: {
    baselineWeeks: 12,
    minWeeks: 4,
    maxWeeks: 52,
    phases: [
      {
        name: "Assessment & Stabilization",
        weekStart: 0,
        weekEnd: 4,
        expectedCapacity: 30,
        description: "Psychiatric assessment, medication if needed, workplace review",
        milestones: ["Diagnosis confirmed", "Treatment plan established", "Workplace factors addressed"],
      },
      {
        name: "Active Treatment",
        weekStart: 4,
        weekEnd: 12,
        expectedCapacity: 50,
        description: "Counselling/therapy, medication optimization, graduated activity",
        milestones: ["Symptoms improving", "Sleep improving", "Anxiety/depression reducing"],
      },
      {
        name: "Work Integration",
        weekStart: 12,
        weekEnd: 20,
        expectedCapacity: 70,
        description: "Graduated return to work, ongoing therapy, workplace support",
        milestones: ["Modified work commenced", "Coping strategies effective", "Support networks active"],
      },
      {
        name: "Maintenance",
        weekStart: 20,
        weekEnd: 26,
        expectedCapacity: 85,
        description: "Full duties with ongoing support and monitoring",
        milestones: ["Full duties resumed", "Relapse prevention plan", "Long-term strategies"],
      },
    ],
    riskFactors: ["Previous mental health history", "Poor workplace support", "Ongoing stressors", "Social isolation"],
    diagnosticTests: ["Psychological assessment", "PHQ-9/GAD-7 screening"],
    specialistReferrals: ["Psychiatrist", "Psychologist", "EAP counsellor"],
  },

  ptsd: {
    baselineWeeks: 26,
    minWeeks: 12,
    maxWeeks: 52,
    phases: [
      {
        name: "Safety & Stabilization",
        weekStart: 0,
        weekEnd: 6,
        expectedCapacity: 20,
        description: "Trauma assessment, safety planning, symptom management",
        milestones: ["PTSD diagnosis confirmed", "Safety established", "Support networks identified"],
      },
      {
        name: "Trauma Processing",
        weekStart: 6,
        weekEnd: 18,
        expectedCapacity: 40,
        description: "Evidence-based trauma therapy (EMDR, CPT, PE)",
        milestones: ["Trauma processing commenced", "Symptoms reducing", "Function improving"],
      },
      {
        name: "Rehabilitation",
        weekStart: 18,
        weekEnd: 26,
        expectedCapacity: 65,
        description: "Graduated return to work, ongoing therapy, relapse prevention",
        milestones: ["Work integration", "Triggers managed", "Quality of life improving"],
      },
    ],
    riskFactors: ["Severity of trauma", "Previous trauma history", "Poor social support", "Concurrent mental health"],
    diagnosticTests: ["Psychological assessment", "PTSD checklist (PCL-5)"],
    specialistReferrals: ["Psychiatrist", "Clinical psychologist with trauma specialization"],
  },

  // ========== OTHER ==========
  chemical_exposure: {
    baselineWeeks: 8,
    minWeeks: 2,
    maxWeeks: 52,
    phases: [
      {
        name: "Acute Treatment",
        weekStart: 0,
        weekEnd: 2,
        expectedCapacity: 40,
        description: "Decontamination, medical monitoring, symptom treatment",
        milestones: ["Exposure source identified", "Decontamination complete", "Monitoring established"],
      },
      {
        name: "Medical Monitoring",
        weekStart: 2,
        weekEnd: 6,
        expectedCapacity: 60,
        description: "Ongoing monitoring, specialist review, workplace assessment",
        milestones: ["No delayed effects", "Workplace controls implemented", "Medical clearance progressing"],
      },
      {
        name: "Return to Work",
        weekStart: 6,
        weekEnd: 8,
        expectedCapacity: 90,
        description: "Return with enhanced safety controls",
        milestones: ["Medical clearance", "PPE review", "Full duties with safety measures"],
      },
    ],
    riskFactors: ["Type and concentration of chemical", "Duration of exposure", "Existing respiratory conditions"],
    diagnosticTests: ["Blood tests", "Lung function tests", "Chest X-ray", "Chemical-specific monitoring"],
    specialistReferrals: ["Toxicologist", "Respiratory physician", "Occupational physician"],
  },

  hearing_loss: {
    baselineWeeks: 8,
    minWeeks: 4,
    maxWeeks: 26,
    phases: [
      {
        name: "Assessment",
        weekStart: 0,
        weekEnd: 2,
        expectedCapacity: 70,
        description: "Audiological assessment, cause determination",
        milestones: ["Audiogram completed", "Type and degree confirmed", "Workplace noise assessment"],
      },
      {
        name: "Treatment Planning",
        weekStart: 2,
        weekEnd: 6,
        expectedCapacity: 75,
        description: "Hearing aids if needed, communication strategies, noise controls",
        milestones: ["Hearing aids fitted if needed", "Workplace accommodations", "Communication training"],
      },
      {
        name: "Adaptation",
        weekStart: 6,
        weekEnd: 12,
        expectedCapacity: 85,
        description: "Adjustment to hearing aids, workplace integration",
        milestones: ["Effective hearing aid use", "Workplace integration successful"],
      },
    ],
    riskFactors: ["Ongoing noise exposure", "Age", "Previous hearing loss", "Ototoxic medications"],
    diagnosticTests: ["Audiogram", "Tympanometry", "Otoscopy"],
    specialistReferrals: ["ENT surgeon", "Audiologist"],
  },

  repetitive_strain: {
    baselineWeeks: 10,
    minWeeks: 4,
    maxWeeks: 26,
    phases: [
      {
        name: "Activity Modification",
        weekStart: 0,
        weekEnd: 3,
        expectedCapacity: 50,
        description: "Rest from aggravating activities, ergonomic assessment",
        milestones: ["Ergonomic review", "Activity modification", "Pain management"],
      },
      {
        name: "Active Rehabilitation",
        weekStart: 3,
        weekEnd: 8,
        expectedCapacity: 70,
        description: "Physiotherapy, stretching, strengthening",
        milestones: ["Symptoms reducing", "Ergonomic changes implemented", "Graduated activity"],
      },
      {
        name: "Return to Work",
        weekStart: 8,
        weekEnd: 12,
        expectedCapacity: 90,
        description: "Full duties with ergonomic controls and regular breaks",
        milestones: ["Full duties", "Break schedule", "Prevention strategies"],
      },
    ],
    riskFactors: ["Poor ergonomics", "High repetition rate", "Sustained static postures", "Vibration"],
    diagnosticTests: ["Physical examination", "Ultrasound", "Nerve conduction if numbness"],
    specialistReferrals: ["Hand therapist", "Occupational medicine specialist"],
  },

  unknown: {
    baselineWeeks: 12,
    minWeeks: 4,
    maxWeeks: 52,
    phases: [
      {
        name: "Assessment",
        weekStart: 0,
        weekEnd: 4,
        expectedCapacity: 50,
        description: "Medical assessment to determine injury type and severity",
        milestones: ["Diagnosis confirmed", "Treatment plan established"],
      },
      {
        name: "Treatment",
        weekStart: 4,
        weekEnd: 8,
        expectedCapacity: 70,
        description: "Appropriate treatment based on confirmed diagnosis",
        milestones: ["Treatment commenced", "Progress monitored"],
      },
      {
        name: "Recovery",
        weekStart: 8,
        weekEnd: 12,
        expectedCapacity: 85,
        description: "Return to work with monitoring",
        milestones: ["Return to work", "Ongoing monitoring"],
      },
    ],
    riskFactors: ["Uncertain diagnosis", "Complex presentation"],
    diagnosticTests: ["Comprehensive medical assessment required"],
    specialistReferrals: ["As indicated by diagnosis"],
  },
};

// Legacy baseline map for backward compatibility
const INJURY_BASELINES: Record<InjuryType, number> = Object.fromEntries(
  Object.entries(INJURY_MODELS).map(([key, model]) => [key, model.baselineWeeks])
) as Record<InjuryType, number>;

/**
 * Extract injury type from case summary text
 * Enhanced to recognize comprehensive WorkSafe injury categories
 */
export function extractInjuryType(summary: string): InjuryType {
  if (!summary || typeof summary !== "string") {
    return "unknown";
  }

  const lower = summary.toLowerCase();

  // ========== SPECIFIC CONDITIONS FIRST (before general categories) ==========

  // Trigger finger / stenosing tenosynovitis
  if (
    lower.includes("trigger finger") ||
    lower.includes("stenosing tenosynovitis") ||
    lower.includes("tenosynovitis") ||
    (lower.includes("finger") && (lower.includes("locking") || lower.includes("clicking") || lower.includes("stiff")))
  ) {
    return "trigger_finger";
  }

  // Carpal tunnel syndrome
  if (
    lower.includes("carpal tunnel") ||
    /\bcts\b/.test(lower) ||
    (lower.includes("wrist") && (lower.includes("numbness") || lower.includes("tingling")))
  ) {
    return "carpal_tunnel";
  }

  // Rotator cuff / shoulder
  if (
    lower.includes("rotator cuff") ||
    lower.includes("shoulder impingement") ||
    lower.includes("supraspinatus") ||
    lower.includes("infraspinatus") ||
    (lower.includes("shoulder") && (
      lower.includes("tear") || lower.includes("tendon") ||
      lower.includes("reconstruction") || lower.includes("surgery") ||
      lower.includes("injury") || lower.includes("repair")
    ))
  ) {
    return "rotator_cuff";
  }

  // Tennis elbow / lateral epicondylitis
  if (
    lower.includes("tennis elbow") ||
    lower.includes("lateral epicondyl") ||
    lower.includes("epicondylitis") ||
    (lower.includes("elbow") && lower.includes("tendon"))
  ) {
    return "tennis_elbow";
  }

  // Disc herniation
  if (
    lower.includes("disc herniation") ||
    lower.includes("herniated disc") ||
    lower.includes("bulging disc") ||
    lower.includes("disc bulge") ||
    lower.includes("slipped disc") ||
    lower.includes("prolapsed disc") ||
    /l\d[\s/](?:l|s)\d/.test(lower)
  ) {
    return "disc_herniation";
  }

  // Sciatica
  if (
    lower.includes("sciatica") ||
    lower.includes("sciatic") ||
    (lower.includes("leg") && lower.includes("radiat"))
  ) {
    return "sciatica";
  }

  // Knee injuries
  if (
    lower.includes("knee") &&
    (lower.includes("injury") || lower.includes("tear") || lower.includes("meniscus") ||
     lower.includes("acl") || lower.includes("mcl") || lower.includes("ligament"))
  ) {
    return "knee_injury";
  }

  // Ankle sprain specifically
  if (lower.includes("ankle") && (lower.includes("sprain") || lower.includes("rolled"))) {
    return "ankle_sprain";
  }

  // PTSD
  if (
    lower.includes("ptsd") ||
    lower.includes("post-traumatic") ||
    lower.includes("post traumatic") ||
    lower.includes("trauma") && lower.includes("disorder")
  ) {
    return "ptsd";
  }

  // Chemical exposure
  if (
    lower.includes("chemical") ||
    lower.includes("toxic") ||
    lower.includes("exposure") && (lower.includes("gas") || lower.includes("fume") || lower.includes("substance"))
  ) {
    return "chemical_exposure";
  }

  // Hearing loss
  if (
    lower.includes("hearing loss") ||
    lower.includes("deafness") ||
    lower.includes("tinnitus") ||
    lower.includes("noise induced")
  ) {
    return "hearing_loss";
  }

  // Repetitive strain injury
  if (
    lower.includes("repetitive strain") ||
    /\brsi\b/.test(lower) ||
    lower.includes("overuse injury") ||
    lower.includes("repetitive motion")
  ) {
    return "repetitive_strain";
  }

  // Laceration
  if (
    lower.includes("laceration") ||
    /\bcut\b/.test(lower) ||
    lower.includes("gash") ||
    /\bwound\b/.test(lower)
  ) {
    return "laceration";
  }

  // Contusion
  if (
    lower.includes("contusion") ||
    lower.includes("bruise") ||
    lower.includes("bruising")
  ) {
    return "contusion";
  }

  // ========== GENERAL CATEGORIES ==========

  // Check for psychological injuries
  if (
    lower.includes("stress") ||
    lower.includes("anxiety") ||
    lower.includes("depression") ||
    lower.includes("psychological") ||
    lower.includes("mental health") ||
    lower.includes("burnout")
  ) {
    return "psychological_stress";
  }

  // Check for back injuries
  if (
    (lower.includes("back") || lower.includes("spine") || lower.includes("lumbar") || lower.includes("spinal")) &&
    (lower.includes("strain") || lower.includes("sprain") || lower.includes("pain") || lower.includes("injury"))
  ) {
    return "back_strain";
  }

  // Check for fractures
  if (lower.includes("fracture") || lower.includes("broken") || lower.includes("fractured")) {
    // Determine upper vs lower limb
    if (
      lower.includes("wrist") ||
      lower.includes("arm") ||
      lower.includes("hand") ||
      lower.includes("finger") ||
      lower.includes("elbow") ||
      lower.includes("shoulder") ||
      lower.includes("clavicle") ||
      lower.includes("collarbone")
    ) {
      return "fracture_upper_limb";
    }
    if (
      lower.includes("ankle") ||
      lower.includes("leg") ||
      lower.includes("foot") ||
      lower.includes("toe") ||
      lower.includes("knee") ||
      lower.includes("hip") ||
      lower.includes("femur") ||
      lower.includes("tibia") ||
      lower.includes("fibula")
    ) {
      return "fracture_lower_limb";
    }
    // Default to upper limb if not specified
    return "fracture_upper_limb";
  }

  // Check for soft tissue injuries (sprains, strains)
  if (
    lower.includes("sprain") ||
    lower.includes("strain") ||
    lower.includes("soft tissue") ||
    lower.includes("ligament") ||
    lower.includes("muscle tear") ||
    lower.includes("pulled muscle")
  ) {
    return "soft_tissue_sprain";
  }

  return "unknown";
}

/**
 * Calculate dynamic recovery timeline based on injury context
 *
 * PRD Compliance: Advisory only, not medical diagnosis
 */
export function calculateRecoveryTimeline(context: InjuryContext): TimelineEstimate {
  const factors: TimelineFactor[] = [];

  // Handle missing data - return pending status
  if (!context.summary || context.summary.trim() === "") {
    return {
      status: "pending_medical_assessment",
      estimatedWeeks: null,
      estimatedCompletionDate: null,
      confidence: "low",
      factors: [
        {
          factor: "Awaiting medical assessment",
          impact: "neutral",
          description: "Estimate will be available once medical details are received",
        },
      ],
    };
  }

  // Extract injury type and get baseline
  const injuryType = extractInjuryType(context.summary);
  const baselineWeeks = INJURY_BASELINES[injuryType];
  let estimatedWeeks = baselineWeeks;

  // Add baseline factor
  const injuryTypeLabel = injuryType.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
  factors.push({
    factor: injuryType === "unknown" ? "Unknown injury type" : injuryTypeLabel,
    impact: "neutral",
    description:
      injuryType === "unknown"
        ? "Using conservative 12-week default for unrecognized injury"
        : `Typical recovery time for ${injuryTypeLabel.toLowerCase()}`,
  });

  // Risk level adjustments
  if (context.riskLevel === "Medium") {
    estimatedWeeks += 2;
    factors.push({
      factor: "Medium risk level",
      impact: "increases",
      description: "Medium risk cases typically experience complications, adding 2 weeks",
    });
  } else if (context.riskLevel === "High") {
    estimatedWeeks += 4;
    factors.push({
      factor: "High risk level",
      impact: "increases",
      description: "High risk cases often have extended recovery, adding 4 weeks",
    });
  }

  // Clinical flag adjustments
  const highRiskFlags = context.clinicalFlags.filter((f) => f.severity === "high_risk");
  if (highRiskFlags.length > 0) {
    const weeksAdded = highRiskFlags.length * 2;
    estimatedWeeks += weeksAdded;
    factors.push({
      factor: `${highRiskFlags.length} high-risk clinical flag${highRiskFlags.length > 1 ? "s" : ""}`,
      impact: "increases",
      description: `Clinical concerns identified, adding ${weeksAdded} weeks to timeline`,
    });
  }

  // Apply bounds: minimum 1 week, maximum 52 weeks
  estimatedWeeks = Math.max(1, Math.min(52, estimatedWeeks));

  // Calculate completion date
  const injuryDate = new Date(context.dateOfInjury);
  const completionDate = new Date(injuryDate);
  completionDate.setDate(completionDate.getDate() + estimatedWeeks * 7);

  // Determine confidence level
  let confidence: ConfidenceLevel = "high";
  if (injuryType === "unknown") {
    confidence = "low";
  } else if (context.riskLevel === "High" && highRiskFlags.length > 0) {
    confidence = "low";
  } else if (context.riskLevel === "Medium" || highRiskFlags.length > 0) {
    confidence = "medium";
  }

  return {
    status: "estimated",
    estimatedWeeks,
    estimatedCompletionDate: completionDate.toISOString(),
    confidence,
    factors,
    baselineWeeks,
  };
}

// =====================================================
// RECOVERY TIMELINE CHART DATA - Frontend Visualization
// =====================================================

export interface ChartDataPoint {
  date: string;
  week: number;
  estimatedCapacity: number;
  actualCapacity: number | null;
  label?: string;
}

export interface CertificateMarker {
  date: string;
  endDate: string;
  week: number;
  capacity: number;
  certificateNumber: number;
  capacityLabel: string;
  color: string;
  certificateId: string;
  documentUrl?: string | null;
  functionalRestrictions?: import("../../shared/schema").FunctionalRestrictionsExtracted | null;
}

export interface RecoveryPhaseDisplay {
  name: string;
  weekStart: number;
  weekEnd: number;
  color: string;
  status: "completed" | "in_progress" | "upcoming";
  milestones: Array<{
    description: string;
    completed: boolean;
    completedDate?: string;
  }>;
}

export interface DiagnosticRecommendation {
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  suggestedAction: string;
  relatedTests?: string[];
  specialistReferral?: string;
}

export interface RecoveryAnalysis {
  comparedToExpected: "ahead" | "on_track" | "behind" | "insufficient_data";
  weeksDifference: number | null;
  trend: "improving" | "stable" | "declining" | "unknown";
  message: string;
}

export interface RecoveryTimelineChartData {
  caseId: string;
  workerName: string;
  injuryType: InjuryType;
  injuryTypeLabel: string;
  injuryDate: string;
  currentDate: string;
  weeksElapsed: number;

  // Timeline estimate
  estimatedWeeks: number;
  estimatedRTWDate: string;
  confidence: ConfidenceLevel;

  // Chart data points
  estimatedCurve: ChartDataPoint[];
  actualCurve: ChartDataPoint[];
  certificateMarkers: CertificateMarker[];

  // Phase information
  phases: RecoveryPhaseDisplay[];
  currentPhase: string;

  // Analysis
  analysis: RecoveryAnalysis;
  diagnosticRecommendations: DiagnosticRecommendation[];

  // Injury model info
  riskFactors: string[];
  suggestedDiagnosticTests: string[];
  potentialSpecialistReferrals: string[];

  // Dashboard display fields
  currentCapacityPercentage: number;
  weeksOffWork: number;
  riskCategory: "High" | "Medium" | "Low";
}

/**
 * Convert capacity string to percentage (fallback when workCapacityPercentage not available)
 */
function capacityToPercentage(capacity: WorkCapacity): number {
  switch (capacity) {
    case "fit":
      return 100;
    case "partial":
      return 50;
    case "unfit":
      return 0;
    case "unknown":
    default:
      return 50; // Default assumption
  }
}

/**
 * Get the actual capacity percentage from a certificate
 * Uses workCapacityPercentage if available, otherwise falls back to enum conversion
 */
function getCertificateCapacity(cert: MedicalCertificate): number {
  // Use actual percentage if available
  if (cert.workCapacityPercentage !== undefined && cert.workCapacityPercentage !== null) {
    return cert.workCapacityPercentage;
  }
  // Fall back to enum conversion
  return capacityToPercentage(cert.capacity);
}

/**
 * Get color for capacity level
 */
function getCapacityColor(capacity: number): string {
  if (capacity >= 80) return "#10b981"; // Emerald
  if (capacity >= 60) return "#3b82f6"; // Blue
  if (capacity >= 40) return "#f59e0b"; // Amber
  if (capacity >= 20) return "#f97316"; // Orange
  return "#ef4444"; // Red
}

/**
 * Get phase color based on index
 */
function getPhaseColor(index: number): string {
  const colors = ["#ef4444", "#f59e0b", "#3b82f6", "#10b981"];
  return colors[index % colors.length];
}

/**
 * Generate estimated recovery curve based on injury model phases
 */
function generateEstimatedCurve(
  injuryDate: Date,
  model: InjuryModel,
  adjustedWeeks: number,
  currentWeek?: number
): ChartDataPoint[] {
  const points: ChartDataPoint[] = [];
  const scaleFactor = adjustedWeeks / model.baselineWeeks;

  // Generate points at regular intervals - extend to current week if beyond estimated
  const estimatedEndWeek = Math.ceil(adjustedWeeks * 1.2);
  const totalWeeks = Math.max(estimatedEndWeek, currentWeek || 0);
  for (let week = 0; week <= totalWeeks; week++) {
    const date = new Date(injuryDate);
    date.setDate(date.getDate() + week * 7);

    // Find the phase for this week (scaled)
    const scaledWeek = week / scaleFactor;
    let capacity = 0;
    let foundPhase = false;

    // Get the last phase for determining when recovery is complete
    const lastPhase = model.phases[model.phases.length - 1];
    const lastPhaseEndWeek = lastPhase?.weekEnd ?? 0;

    // If we're past all phases, capacity is 100%
    if (scaledWeek > lastPhaseEndWeek) {
      capacity = 100;
      foundPhase = true;
    } else {
      for (const phase of model.phases) {
        if (scaledWeek >= phase.weekStart && scaledWeek <= phase.weekEnd) {
          // Linear interpolation within phase
          const phaseProgress = (scaledWeek - phase.weekStart) / (phase.weekEnd - phase.weekStart);
          const nextPhase = model.phases.find((p) => p.weekStart === phase.weekEnd);
          const nextCapacity = nextPhase?.expectedCapacity ?? 100;
          capacity = phase.expectedCapacity + phaseProgress * (nextCapacity - phase.expectedCapacity);
          foundPhase = true;
          break;
        } else if (scaledWeek > phase.weekEnd) {
          capacity = phase.expectedCapacity;
        }
      }
    }

    // Cap at 100%
    capacity = Math.min(100, Math.max(0, capacity));

    points.push({
      date: date.toISOString(),
      week,
      estimatedCapacity: Math.round(capacity),
      actualCapacity: null,
    });
  }

  return points;
}

/**
 * Generate actual recovery curve from medical certificates
 *
 * Creates a continuous step-function curve from certificate data by:
 * 1. Starting at week 0 with the first certificate's capacity (or 0 if no early cert)
 * 2. Carrying forward capacity between certificates
 * 3. Extending to current week with the most recent capacity
 *
 * This ensures the chart shows a visible actual line that can be compared
 * against the estimated recovery curve.
 */
function generateActualCurve(
  injuryDate: Date,
  certificates: MedicalCertificate[],
  currentWeek: number
): { curve: ChartDataPoint[]; markers: CertificateMarker[] } {
  const curve: ChartDataPoint[] = [];
  const markers: CertificateMarker[] = [];

  if (certificates.length === 0) {
    return { curve, markers };
  }

  // Sort certificates by start date (ascending)
  const sortedCerts = [...certificates].sort(
    (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
  );

  // Create markers for each certificate
  sortedCerts.forEach((cert, index) => {
    const certDate = new Date(cert.startDate);
    const weeksSinceInjury = Math.max(0, Math.round(
      (certDate.getTime() - injuryDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
    ));
    const capacity = getCertificateCapacity(cert);

    const docUrl = (cert as any).fileUrl || cert.documentUrl || null;

    markers.push({
      date: cert.startDate,
      endDate: cert.endDate,
      week: weeksSinceInjury,
      capacity,
      certificateNumber: index + 1,
      capacityLabel: `${capacity}% Capacity`,
      color: getCapacityColor(capacity),
      certificateId: cert.id,
      documentUrl: docUrl,
      functionalRestrictions: cert.functionalRestrictionsJson ?? null,
    });
  });

  // Sort markers by week
  markers.sort((a, b) => a.week - b.week);

  // Generate a continuous curve from week 0 to current week
  // This creates a step function where capacity changes at certificate dates
  const firstCertWeek = markers[0]?.week ?? 0;
  const lastCertWeek = Math.max(currentWeek, markers[markers.length - 1]?.week ?? 0);

  // Build a map of week -> capacity changes
  const capacityChanges = new Map<number, number>();
  for (const marker of markers) {
    capacityChanges.set(marker.week, marker.capacity);
  }

  // Generate data points for every week from week 0 to current week
  // This ensures the actual curve starts at the same point as the estimated curve
  let currentCapacity: number | null = null;

  for (let week = 0; week <= lastCertWeek; week++) {
    // Check if there's a capacity change at this week
    if (capacityChanges.has(week)) {
      currentCapacity = capacityChanges.get(week)!;
    }

    // Add points for all weeks, with null capacity before first certificate
    const date = new Date(injuryDate);
    date.setDate(date.getDate() + week * 7);

    // Find if this week corresponds to a certificate marker
    const matchingMarker = markers.find(m => m.week === week);

    curve.push({
      date: date.toISOString(),
      week,
      estimatedCapacity: 0, // Will be filled from estimated curve
      actualCapacity: currentCapacity, // Will be null before first certificate
      label: matchingMarker ? `Cert #${matchingMarker.certificateNumber}` : undefined,
    });
  }

  // Ensure we have a point at the current week if we have any certificate data
  if (currentCapacity !== null && !curve.find(c => c.week === currentWeek)) {
    const date = new Date(injuryDate);
    date.setDate(date.getDate() + currentWeek * 7);
    curve.push({
      date: date.toISOString(),
      week: currentWeek,
      estimatedCapacity: 0,
      actualCapacity: currentCapacity,
      label: "Current",
    });
  }

  // Sort curve by week to ensure proper ordering
  curve.sort((a, b) => a.week - b.week);

  return { curve, markers };
}

/**
 * Analyze recovery progress compared to expected timeline
 */
function analyzeRecoveryProgress(
  certificates: MedicalCertificate[],
  estimatedCurve: ChartDataPoint[],
  weeksElapsed: number,
  model: InjuryModel
): RecoveryAnalysis {
  if (certificates.length === 0) {
    return {
      comparedToExpected: "insufficient_data",
      weeksDifference: null,
      trend: "unknown",
      message: "No medical certificate data available to assess recovery progress.",
    };
  }

  // Get the most recent certificate
  const sortedCerts = [...certificates].sort(
    (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
  );
  const latestCert = sortedCerts[0];
  const actualCapacity = getCertificateCapacity(latestCert);

  // Find expected capacity at current week
  const expectedPoint = estimatedCurve.find((p) => p.week === weeksElapsed) ||
    estimatedCurve[estimatedCurve.length - 1];
  const expectedCapacity = expectedPoint?.estimatedCapacity ?? 50;

  // Calculate difference
  const capacityDiff = actualCapacity - expectedCapacity;
  const weeksDiff = Math.round(capacityDiff / 5); // Rough estimate: 5% = 1 week

  // Determine trend from certificate history
  let trend: RecoveryAnalysis["trend"] = "unknown";
  if (certificates.length >= 2) {
    const previousCert = sortedCerts[1];
    const previousCapacity = getCertificateCapacity(previousCert);
    if (actualCapacity > previousCapacity) {
      trend = "improving";
    } else if (actualCapacity < previousCapacity) {
      trend = "declining";
    } else {
      trend = "stable";
    }
  }

  // Determine status
  let comparedToExpected: RecoveryAnalysis["comparedToExpected"];
  let message: string;

  if (capacityDiff >= 10) {
    comparedToExpected = "ahead";
    message = `Recovery is progressing better than expected. Actual capacity (${actualCapacity}%) is ${capacityDiff}% higher than expected (${expectedCapacity}%) at week ${weeksElapsed}.`;
  } else if (capacityDiff <= -10) {
    comparedToExpected = "behind";
    message = `Recovery is slower than expected. Actual capacity (${actualCapacity}%) is ${Math.abs(capacityDiff)}% lower than expected (${expectedCapacity}%) at week ${weeksElapsed}. Consider diagnostic review.`;
  } else {
    comparedToExpected = "on_track";
    message = `Recovery is on track. Actual capacity (${actualCapacity}%) is within expected range (${expectedCapacity}%) at week ${weeksElapsed}.`;
  }

  return {
    comparedToExpected,
    weeksDifference: weeksDiff,
    trend,
    message,
  };
}

/**
 * Generate diagnostic recommendations based on recovery analysis
 */
function generateDiagnosticRecommendations(
  analysis: RecoveryAnalysis,
  model: InjuryModel,
  weeksElapsed: number,
  certificates: MedicalCertificate[]
): DiagnosticRecommendation[] {
  const recommendations: DiagnosticRecommendation[] = [];

  // Check if recovery is behind schedule
  if (analysis.comparedToExpected === "behind") {
    recommendations.push({
      severity: "warning",
      title: "Recovery Below Expected Timeline",
      description: `The worker's recovery is progressing slower than typical for this injury type. At ${weeksElapsed} weeks post-injury, capacity is lower than expected.`,
      suggestedAction: "Request updated medical assessment to identify any complications or factors affecting recovery.",
      relatedTests: model.diagnosticTests,
      specialistReferral: model.specialistReferrals[0],
    });
  }

  // Check for declining trend
  if (analysis.trend === "declining") {
    recommendations.push({
      severity: "critical",
      title: "Declining Capacity Detected",
      description: "Recent medical certificates show a decrease in work capacity. This may indicate a setback or complication.",
      suggestedAction: "Urgent medical review recommended to assess for complications, re-injury, or inadequate treatment.",
      relatedTests: model.diagnosticTests,
      specialistReferral: model.specialistReferrals[0],
    });
  }

  // Check for stagnant recovery (stable for too long)
  if (analysis.trend === "stable" && weeksElapsed > model.baselineWeeks / 2) {
    const lastCert = certificates.sort(
      (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    )[0];
    const capacity = lastCert ? getCertificateCapacity(lastCert) : 0;
    if (capacity < 80) {
      recommendations.push({
        severity: "warning",
        title: "Recovery Plateau Detected",
        description: `Work capacity has remained stable at ${capacity}% for an extended period. Consider whether additional interventions are needed.`,
        suggestedAction: "Review treatment plan with treating practitioner. Consider additional diagnostic tests or specialist referral.",
        relatedTests: model.diagnosticTests,
      });
    }
  }

  // No certificates for extended period
  if (certificates.length === 0) {
    recommendations.push({
      severity: "critical",
      title: "No Medical Certificate on File",
      description: "Unable to assess recovery progress due to missing medical documentation.",
      suggestedAction: "Request updated medical certificate from treating practitioner to establish current capacity.",
    });
  } else {
    // Check if latest certificate is stale
    const latestCert = certificates.sort(
      (a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime()
    )[0];
    const certEndDate = new Date(latestCert.endDate);
    const daysSinceExpiry = Math.floor((Date.now() - certEndDate.getTime()) / (24 * 60 * 60 * 1000));
    if (daysSinceExpiry > 14) {
      recommendations.push({
        severity: "warning",
        title: "Medical Certificate Expired",
        description: `The most recent medical certificate expired ${daysSinceExpiry} days ago. Current capacity status is unknown.`,
        suggestedAction: "Chase updated medical certificate to confirm current work capacity and recovery status.",
      });
    }
  }

  // Long recovery - consider specialist if not already involved
  if (weeksElapsed > model.baselineWeeks && model.specialistReferrals.length > 0) {
    recommendations.push({
      severity: "info",
      title: "Consider Specialist Review",
      description: `Recovery has exceeded the typical ${model.baselineWeeks}-week timeline for this injury type.`,
      suggestedAction: "If not already involved, consider referral to specialist for assessment.",
      specialistReferral: model.specialistReferrals.join(", "),
    });
  }

  return recommendations;
}

/**
 * Generate recovery phases with status
 */
function generatePhases(
  model: InjuryModel,
  weeksElapsed: number,
  scaleFactor: number
): RecoveryPhaseDisplay[] {
  return model.phases.map((phase, index) => {
    const scaledStart = Math.round(phase.weekStart * scaleFactor);
    const scaledEnd = Math.round(phase.weekEnd * scaleFactor);

    let status: RecoveryPhaseDisplay["status"];
    if (weeksElapsed >= scaledEnd) {
      status = "completed";
    } else if (weeksElapsed >= scaledStart) {
      status = "in_progress";
    } else {
      status = "upcoming";
    }

    return {
      name: phase.name,
      weekStart: scaledStart,
      weekEnd: scaledEnd,
      color: getPhaseColor(index),
      status,
      milestones: phase.milestones.map((m) => ({
        description: m,
        completed: status === "completed",
        completedDate: status === "completed" ? undefined : undefined, // Would need tracking
      })),
    };
  });
}

/**
 * Generate complete recovery timeline chart data for a case
 */
export function generateRecoveryTimelineChartData(
  caseId: string,
  workerName: string,
  dateOfInjury: string,
  summary: string,
  riskLevel: RiskLevel,
  clinicalFlags: ClinicalEvidenceFlag[],
  certificates: MedicalCertificate[]
): RecoveryTimelineChartData {
  let injuryDate = new Date(dateOfInjury);

  // If certificates predate the recorded injury date, use the earliest certificate
  // as the effective timeline start (common when Freshdesk injury date is inaccurate)
  if (certificates.length > 0) {
    const earliestCertDate = certificates.reduce((earliest, cert) => {
      const d = new Date(cert.startDate);
      return d < earliest ? d : earliest;
    }, injuryDate);
    if (earliestCertDate < injuryDate) {
      injuryDate = earliestCertDate;
    }
  }

  const currentDate = new Date();
  const weeksElapsed = Math.round(
    (currentDate.getTime() - injuryDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
  );

  // Get injury type and model
  const injuryType = extractInjuryType(summary);
  const model = INJURY_MODELS[injuryType];
  const injuryTypeLabel = injuryType.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());

  // Calculate timeline estimate
  const estimate = calculateRecoveryTimeline({
    dateOfInjury,
    summary,
    riskLevel,
    clinicalFlags,
  });

  const adjustedWeeks = estimate.estimatedWeeks ?? model.baselineWeeks;
  const scaleFactor = adjustedWeeks / model.baselineWeeks;

  // Generate chart curves
  const estimatedCurve = generateEstimatedCurve(injuryDate, model, adjustedWeeks, weeksElapsed);
  const { curve: actualCurve, markers: certificateMarkers } = generateActualCurve(
    injuryDate,
    certificates,
    weeksElapsed
  );

  // Generate phases
  const phases = generatePhases(model, weeksElapsed, scaleFactor);
  const currentPhase = phases.find((p) => p.status === "in_progress")?.name ??
    phases.find((p) => p.status === "upcoming")?.name ??
    phases[phases.length - 1]?.name ?? "Unknown";

  // Analyze progress
  const analysis = analyzeRecoveryProgress(certificates, estimatedCurve, weeksElapsed, model);

  // Generate diagnostic recommendations
  const diagnosticRecommendations = generateDiagnosticRecommendations(
    analysis,
    model,
    weeksElapsed,
    certificates
  );

  // Calculate current capacity from most recent certificate
  let currentCapacityPercentage = 0;
  if (certificates.length > 0) {
    const sortedCerts = [...certificates].sort(
      (a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    );
    currentCapacityPercentage = getCertificateCapacity(sortedCerts[0]);
  }

  // Calculate weeks off work (weeks where capacity < 100%)
  const weeksOffWork = weeksElapsed;

  // Map risk level to category
  const riskCategory = riskLevel;

  return {
    caseId,
    workerName,
    injuryType,
    injuryTypeLabel,
    injuryDate: dateOfInjury,
    currentDate: currentDate.toISOString(),
    weeksElapsed,
    estimatedWeeks: adjustedWeeks,
    estimatedRTWDate: estimate.estimatedCompletionDate ?? "",
    confidence: estimate.confidence,
    estimatedCurve,
    actualCurve,
    certificateMarkers,
    phases,
    currentPhase,
    analysis,
    diagnosticRecommendations,
    riskFactors: model.riskFactors,
    suggestedDiagnosticTests: model.diagnosticTests,
    potentialSpecialistReferrals: model.specialistReferrals,
    currentCapacityPercentage,
    weeksOffWork,
    riskCategory,
  };
}

/**
 * Get injury model for a specific injury type
 */
export function getInjuryModel(injuryType: InjuryType): InjuryModel {
  return INJURY_MODELS[injuryType];
}

/**
 * Get all available injury types with labels
 */
export function getAvailableInjuryTypes(): Array<{ type: InjuryType; label: string }> {
  return Object.keys(INJURY_MODELS).map((type) => ({
    type: type as InjuryType,
    label: type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
  }));
}
