/**
 * Health check categories — single source of truth.
 *
 * A "check category" is the lifecycle stage a health check belongs to
 * (pre-employment, prevention, injury, wellness, mental health, exit).
 *
 * New assessments store their category in
 * `preEmploymentAssessments.assessmentType`. Pre-employment is the exception:
 * it maps to one of six legacy clinical enum values rather than the literal
 * string `pre_employment`. `assessmentTypesForCategory` encapsulates that
 * mapping so the API can filter assessments by category.
 */

export const CHECK_CATEGORIES = [
  "pre_employment",
  "prevention",
  "injury",
  "wellness",
  "mental_health",
  "exit",
] as const;

export type CheckCategory = (typeof CHECK_CATEGORIES)[number];

export const CHECK_LABELS: Record<CheckCategory, string> = {
  pre_employment: "Pre-Employment Health Check",
  prevention: "Prevention & Safety Check",
  injury: "Injury Assessment",
  wellness: "General Wellness Assessment",
  mental_health: "Mental Health Assessment",
  exit: "Exit Health Check",
};

/**
 * Clinical assessment-type values that legacy pre-employment rows use.
 * Newer pre-employment rows store `baseline_health`; the others remain valid
 * for historical data.
 */
const PRE_EMPLOYMENT_ASSESSMENT_TYPES: string[] = [
  "baseline_health",
  "functional_capacity",
  "medical_screening",
  "fitness_for_duty",
  "psychological_assessment",
  "substance_screening",
];

/**
 * Returns the set of `assessmentType` values that belong to a check category.
 *
 * - `pre_employment` → the six clinical enum values.
 * - every other category → the category name itself (stored verbatim).
 */
export function assessmentTypesForCategory(category: CheckCategory): string[] {
  if (category === "pre_employment") {
    return [...PRE_EMPLOYMENT_ASSESSMENT_TYPES];
  }
  return [category];
}
