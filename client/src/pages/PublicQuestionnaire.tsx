/**
 * Public Questionnaire — /check/:token
 * No authentication required. Worker accesses via magic link from email.
 */
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";

interface AssessmentInfo {
  candidateName: string;
  positionTitle: string;
  assessmentId: string;
  assessmentType: string;
}

type Question = {
  id: string;
  label: string;
  type: "radio" | "textarea" | "text" | "date" | "dropdown" | "checkbox";
  options?: string[];
  section?: string;
};

const PRE_EMPLOYMENT_QUESTIONS: Question[] = [
  { id: "general_health", label: "How would you rate your overall health?", type: "radio", options: ["Excellent", "Good", "Fair", "Poor"] },
  { id: "current_conditions", label: "Do you have any current medical conditions or injuries?", type: "radio", options: ["No", "Yes"] },
  { id: "current_conditions_detail", label: "If yes, please describe:", type: "textarea" },
  { id: "medications", label: "Are you currently taking any medications?", type: "radio", options: ["No", "Yes"] },
  { id: "medications_detail", label: "If yes, please list medications:", type: "textarea" },
  { id: "physical_limitations", label: "Do you have any physical limitations that may affect your work?", type: "radio", options: ["No", "Yes"] },
  { id: "physical_limitations_detail", label: "If yes, please describe:", type: "textarea" },
  { id: "mental_health", label: "How would you rate your mental health and wellbeing?", type: "radio", options: ["Excellent", "Good", "Fair", "Poor"] },
];

const PAIN_SCALE = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"];
const CAPACITY = ["Can", "With Modification", "Cannot"];
const FREQ_5 = ["None of the time", "A little of the time", "Some of the time", "Most of the time", "All of the time"];

const INJURY_QUESTIONS: Question[] = [
  // Section 1: Personal Information
  { id: "company_name", label: "Company name", type: "text", section: "Personal Information" },
  { id: "employer_email", label: "Employer email", type: "text" },
  { id: "first_name", label: "First name", type: "text" },
  { id: "last_name", label: "Last name", type: "text" },
  { id: "email", label: "Your email", type: "text" },
  { id: "job_title", label: "What is your job title?", type: "text" },
  { id: "age", label: "Age", type: "text" },
  { id: "height", label: "Height", type: "text" },
  { id: "weight", label: "Weight", type: "text" },
  { id: "gender", label: "Gender", type: "radio", options: ["Man", "Non-binary", "Woman", "Prefer to self-describe"] },
  { id: "self_describe_gender", label: "If self-describe, please specify:", type: "text" },

  // Section 2: Incident Details
  { id: "what_happened", label: "What happened?", type: "textarea", section: "Incident Details" },
  { id: "when_happened", label: "When did it happen?", type: "date" },
  { id: "where_happened", label: "Where did it happen?", type: "text" },
  { id: "what_doing", label: "What were you doing?", type: "textarea" },
  { id: "why_doing", label: "Why were you doing that?", type: "textarea" },
  { id: "who_told_you", label: "Who told you to do that?", type: "textarea" },
  { id: "normally_do_that", label: "Do you normally do that?", type: "textarea" },
  { id: "how_happened", label: "How did it happen?", type: "textarea" },
  { id: "who_witnessed", label: "Who witnessed it?", type: "textarea" },
  { id: "reported_to", label: "Who did you report it to?", type: "textarea" },
  { id: "ppe_used", label: "What PPE was used?", type: "textarea" },
  { id: "treatment_sought", label: "What treatment did you seek?", type: "textarea" },
  { id: "when_treated", label: "When was it treated/provided?", type: "date" },
  { id: "offsite_treatment", label: "Any off site treatment?", type: "textarea" },
  { id: "first_treatment_date", label: "When did you first receive treatment?", type: "date" },
  { id: "current_treatment_plan", label: "Do you have a current treatment plan?", type: "radio", options: ["Yes", "No"] },
  { id: "treatment_plan_description", label: "Please describe your current treatment plan:", type: "textarea" },
  { id: "time_off", label: "Did you have any time off?", type: "textarea" },
  { id: "time_off_hours", label: "How long (hours)?", type: "text" },
  { id: "medical_restrictions", label: "Any medical restrictions?", type: "textarea" },
  { id: "prevent_normal_duties", label: "Did the injury prevent you from carrying on with your normal duties?", type: "radio", options: ["Yes", "No"] },
  { id: "prevention_details", label: "In what way?", type: "textarea" },
  { id: "how_managed_work", label: "How did you manage it?", type: "textarea" },
  { id: "rest_of_shift_management", label: "How did you manage the rest of the shift?", type: "textarea" },
  { id: "work_restrictions", label: "Does it restrict you at work?", type: "textarea" },
  { id: "home_management", label: "How did you manage at home?", type: "textarea" },
  { id: "home_restrictions", label: "Does it restrict you at home?", type: "textarea" },
  { id: "previous_injuries", label: "Have you had any previous injuries to the same location?", type: "radio", options: ["Yes", "No"] },
  { id: "previous_injury_details", label: "Please give details:", type: "textarea" },

  // Section 3: Pain Assessment
  { id: "arms_pain", label: "Pain in arm(s) (0 = none, 10 = worst)", type: "dropdown", options: PAIN_SCALE, section: "Pain Assessment" },
  { id: "shoulders_pain", label: "Pain in shoulder(s) (0 = none, 10 = worst)", type: "dropdown", options: PAIN_SCALE },
  { id: "upper_back_pain", label: "Pain in upper back (0 = none, 10 = worst)", type: "dropdown", options: PAIN_SCALE },
  { id: "lower_back_pain", label: "Pain in lower back (0 = none, 10 = worst)", type: "dropdown", options: PAIN_SCALE },
  { id: "legs_pain", label: "Pain in leg(s) (0 = none, 10 = worst)", type: "dropdown", options: PAIN_SCALE },
  { id: "knees_pain", label: "Pain in knee(s) (0 = none, 10 = worst)", type: "dropdown", options: PAIN_SCALE },
  { id: "feet_pain", label: "Pain in feet (0 = none, 10 = worst)", type: "dropdown", options: PAIN_SCALE },
  { id: "pain_elsewhere", label: "Have you experienced pain anywhere else?", type: "radio", options: ["Yes", "No"] },
  { id: "other_pain_details", label: "Level and location of pain elsewhere:", type: "text" },

  // Section 4: Work Capacity & Restrictions
  { id: "can_sit", label: "Sit", type: "radio", options: CAPACITY, section: "Work Capacity & Restrictions" },
  { id: "can_stand_walk", label: "Stand/Walk", type: "radio", options: CAPACITY },
  { id: "can_bend", label: "Bend", type: "radio", options: CAPACITY },
  { id: "can_squat", label: "Squat", type: "radio", options: CAPACITY },
  { id: "can_kneel", label: "Kneel", type: "radio", options: CAPACITY },
  { id: "can_reach_above_shoulder", label: "Reach above shoulder", type: "radio", options: CAPACITY },
  { id: "can_use_arms_hands", label: "Use arms/hands", type: "radio", options: CAPACITY },
  { id: "can_lift", label: "Lift", type: "radio", options: CAPACITY },
  { id: "can_neck_movement", label: "Neck movement", type: "radio", options: CAPACITY },
  { id: "physical_function_comments", label: "Physical function comments:", type: "textarea" },
  { id: "attention_concentration", label: "Attention/Concentration", type: "radio", options: ["Not Affected", "Affected"] },
  { id: "memory", label: "Memory", type: "radio", options: ["Not Affected", "Affected"] },
  { id: "judgement", label: "Judgement", type: "radio", options: ["Not Affected", "Affected"] },
  { id: "mental_health_function_comments", label: "Mental health function comments:", type: "textarea" },
  { id: "other_functional_considerations", label: "Other physical or mental functional considerations:", type: "textarea" },
];

const PREVENTION_QUESTIONS: Question[] = [
  // Section 1: Personal Information
  { id: "company_name", label: "Company name", type: "text", section: "Personal Information" },
  { id: "employer_email", label: "Employer email", type: "text" },
  { id: "first_name", label: "First name", type: "text" },
  { id: "last_name", label: "Last name", type: "text" },
  { id: "email", label: "Your email", type: "text" },
  { id: "job_title", label: "What is your job title?", type: "text" },
  { id: "age", label: "Age", type: "text" },
  { id: "weight", label: "Weight", type: "text" },
  { id: "gender", label: "Gender: How do you identify?", type: "radio", options: ["Man", "Non-binary", "Woman", "Prefer to self-describe"] },
  { id: "self_describe_gender", label: "If self-describe, please specify:", type: "text" },

  // Section 2: Physical Pain Assessment
  { id: "neck_pain", label: "Neck pain level (0 = none, 10 = worst)", type: "dropdown", options: PAIN_SCALE, section: "Physical Pain Assessment" },
  { id: "arms_pain", label: "Arm(s) pain level (0 = none, 10 = worst)", type: "dropdown", options: PAIN_SCALE },
  { id: "shoulders_pain", label: "Shoulder(s) pain level (0 = none, 10 = worst)", type: "dropdown", options: PAIN_SCALE },
  { id: "upper_back_pain", label: "Upper back pain level (0 = none, 10 = worst)", type: "dropdown", options: PAIN_SCALE },
  { id: "lower_back_pain", label: "Lower back pain level (0 = none, 10 = worst)", type: "dropdown", options: PAIN_SCALE },
  { id: "legs_pain", label: "Legs pain level (0 = none, 10 = worst)", type: "dropdown", options: PAIN_SCALE },
  { id: "knees_pain", label: "Knees pain level (0 = none, 10 = worst)", type: "dropdown", options: PAIN_SCALE },
  { id: "feet_pain", label: "Feet pain level (0 = none, 10 = worst)", type: "dropdown", options: PAIN_SCALE },
  { id: "pain_elsewhere", label: "Have you experienced pain anywhere else?", type: "radio", options: ["Yes", "No"] },
  { id: "other_pain_location", label: "Other pain location:", type: "text" },
  { id: "other_pain_level", label: "Other pain level (0 = none, 10 = worst)", type: "dropdown", options: PAIN_SCALE },
  { id: "pain_last_week", label: "Pain in last week (0 = none, 10 = worst)", type: "dropdown", options: PAIN_SCALE },
  { id: "average_pain_3mo", label: "Average pain over last 3 months (0 = none, 10 = worst)", type: "dropdown", options: PAIN_SCALE },
  { id: "risk_persistent_pain", label: "Risk of persistent pain", type: "radio", options: ["Highly likely", "Likely", "No risk"] },
  { id: "lifting_capacity", label: "Lifting capacity", type: "radio", options: ["Heavy weights (20kg+)", "Moderate weights (10–20kg)", "Light weights (5–10kg)", "Very light (under 5kg)", "Cannot lift"] },
  { id: "walking_capacity", label: "Walking capacity", type: "radio", options: ["More than 1km", "500m–1km", "Less than 500m", "Cannot walk"] },
  { id: "sitting_capacity", label: "Sitting capacity", type: "radio", options: ["More than 4 hours", "2–4 hours", "1–2 hours", "Less than 1 hour", "Cannot sit"] },
  { id: "standing_capacity", label: "Standing capacity", type: "radio", options: ["More than 4 hours", "2–4 hours", "1–2 hours", "Less than 1 hour", "Cannot stand"] },
  { id: "sleeping_impact", label: "How does pain affect your sleep?", type: "radio", options: ["Not affected", "Slightly affected", "Moderately affected", "Significantly affected", "Cannot sleep"] },
  { id: "social_life_impact", label: "How does pain affect your social life?", type: "radio", options: ["Not affected", "Slightly affected", "Moderately affected", "Significantly affected", "No social life due to pain"] },

  // Section 3: Psychological Wellbeing (Last 4 Weeks)
  { id: "psych_tired", label: "Tired out for no reason", type: "radio", options: FREQ_5, section: "Psychological Wellbeing (Last 4 Weeks)" },
  { id: "psych_nervous", label: "Felt nervous", type: "radio", options: FREQ_5 },
  { id: "psych_nervous_no_calm", label: "So nervous that nothing could calm you down", type: "radio", options: FREQ_5 },
  { id: "psych_hopeless", label: "Felt hopeless", type: "radio", options: FREQ_5 },
  { id: "psych_restless", label: "Restless or fidgety", type: "radio", options: FREQ_5 },
  { id: "psych_too_restless", label: "So restless you could not sit still", type: "radio", options: FREQ_5 },
  { id: "psych_depressed", label: "Felt depressed", type: "radio", options: FREQ_5 },
  { id: "psych_effort", label: "Everything was an effort", type: "radio", options: FREQ_5 },
  { id: "psych_sad", label: "So sad nothing could cheer you up", type: "radio", options: FREQ_5 },
  { id: "psych_worthless", label: "Felt worthless", type: "radio", options: FREQ_5 },
  { id: "psych_depressed_week", label: "Felt depressed in the past week", type: "radio", options: FREQ_5 },
  { id: "psych_tense_week", label: "Felt tense or anxious in the past week", type: "radio", options: FREQ_5 },
  { id: "workplace_challenges", label: "Are there workplace challenges affecting your wellbeing?", type: "radio", options: ["Yes", "No"] },
  { id: "workplace_challenges_detail", label: "Describe workplace challenges:", type: "textarea" },
  { id: "factors_job_performance", label: "Factors affecting your job performance:", type: "textarea" },

  // Section 4: Personal Health & Wellbeing
  { id: "smoke", label: "Do you smoke?", type: "radio", options: ["Yes", "No"], section: "Personal Health & Wellbeing" },
  { id: "smoking_duration", label: "How long have you smoked?", type: "dropdown", options: ["Less than a month", "1–6 months", "6–12 months", "1–2 years", "2–5 years", "5+ years"] },
  { id: "veg_servings", label: "Vegetable servings daily", type: "dropdown", options: ["0", "1–2", "3–4", "5+"] },
  { id: "fruit_servings", label: "Fruit servings daily", type: "dropdown", options: ["0", "1–2", "3–4", "5+"] },
  { id: "junk_food_freq", label: "Junk food consumption frequency", type: "dropdown", options: ["Never", "1–2 times/week", "3–4 times/week", "Daily"] },
  { id: "fast_food_reasons", label: "Reasons for choosing fast food (select all that apply)", type: "checkbox", options: ["Never eat fast food", "Cheaper", "Convenient", "Tastes better", "Availability"] },
  { id: "alcohol_weekly", label: "Weekly alcohol consumption", type: "dropdown", options: ["None", "1–5 drinks", "6–10 drinks", "11–20 drinks", "20+ drinks"] },
  { id: "vigorous_activity", label: "Vigorous physical activity days/week", type: "dropdown", options: ["0", "1–3", "4–7", "7+"] },
  { id: "walking_freq", label: "Walking 30+ min days/week", type: "dropdown", options: ["0", "1–3", "4–7", "7+"] },
  { id: "moderate_activity", label: "Moderate activity 30+ min days/week", type: "dropdown", options: ["0", "1–3", "4–7", "7+"] },
  { id: "activity_at_work", label: "Physical activity during work time", type: "dropdown", options: ["None", "Some", "Most", "All"] },
  { id: "low_activity_reasons", label: "Reasons for low physical activity (select all that apply)", type: "checkbox", options: ["Too tired", "No time", "Lack of facilities", "Shift work", "Out on the road"] },

  // Section 5: Job Capacity Assessment
  { id: "can_sit", label: "Sit", type: "radio", options: CAPACITY, section: "Job Capacity Assessment" },
  { id: "can_stand_walk", label: "Stand and Walk", type: "radio", options: CAPACITY },
  { id: "can_bend", label: "Bend", type: "radio", options: CAPACITY },
  { id: "can_squat", label: "Squat", type: "radio", options: CAPACITY },
  { id: "can_kneel", label: "Kneel", type: "radio", options: CAPACITY },
  { id: "can_reach_above_shoulder", label: "Reach above shoulder", type: "radio", options: CAPACITY },
  { id: "can_use_arms_hands", label: "Use arms/hands", type: "radio", options: CAPACITY },
  { id: "can_lift", label: "Lift", type: "radio", options: CAPACITY },
  { id: "can_neck_movement", label: "Neck movement", type: "radio", options: CAPACITY },
  { id: "physical_function_comments", label: "Physical function comments:", type: "textarea" },
  { id: "attention_concentration", label: "Attention/Concentration", type: "radio", options: ["Not Affected", "Affected"] },
  { id: "memory", label: "Memory", type: "radio", options: ["Not Affected", "Affected"] },
  { id: "judgement", label: "Judgement", type: "radio", options: ["Not Affected", "Affected"] },
  { id: "additional_functions", label: "Additional mental/physical functional considerations:", type: "textarea" },
  { id: "mental_health_comments", label: "Mental health challenges comments:", type: "textarea" },
  { id: "general_comments", label: "General additional comments:", type: "textarea" },
  { id: "work_environment", label: "Work environment considerations:", type: "textarea" },
];

const EXIT_QUESTIONS: Question[] = [
  // Section 1: Personal Information
  { id: "company_name", label: "Company name", type: "text", section: "Personal Information" },
  { id: "employer_email", label: "Employer email", type: "text" },
  { id: "ticket_id", label: "Ticket ID (if provided)", type: "text" },
  { id: "first_name", label: "First name", type: "text" },
  { id: "last_name", label: "Last name", type: "text" },
  { id: "email", label: "Your email", type: "text" },
  { id: "job_title", label: "What is your job title?", type: "text" },
  { id: "gender", label: "Gender: How do you identify?", type: "radio", options: ["Man", "Non-binary", "Woman", "Prefer to self-describe"] },
  { id: "self_describe_gender", label: "If self-describe, please specify:", type: "text" },

  // Section 2: Exit Reasons
  { id: "why_leaving", label: "Why are you leaving?", type: "textarea", section: "Exit Reasons" },
  { id: "could_do_better", label: "Could we have done anything better?", type: "radio", options: ["Yes", "No"] },
  { id: "could_do_better_comment", label: "Please comment:", type: "textarea" },
  { id: "would_return", label: "Would you ever consider returning?", type: "radio", options: ["Yes", "No"] },
  { id: "would_return_comment", label: "Please comment:", type: "textarea" },
  { id: "felt_valued", label: "Did you feel like a valuable team member?", type: "radio", options: ["Yes", "No"] },
  { id: "felt_valued_comment", label: "Please comment:", type: "textarea" },
  { id: "had_tools", label: "Did you have the necessary tools to succeed?", type: "radio", options: ["Yes", "No"] },
  { id: "had_tools_comment", label: "Please comment:", type: "textarea" },
  { id: "best_part", label: "What was the best part of your job?", type: "textarea" },
  { id: "worst_part", label: "What was the worst part of your job?", type: "textarea" },

  // Section 3: Health & Wellbeing
  { id: "pain_injury", label: "Did you experience any pain or injury related to your job role?", type: "radio", options: ["Yes", "No"], section: "Health & Wellbeing" },
  { id: "pain_injury_comment", label: "Please comment:", type: "textarea" },
  { id: "psych_tired", label: "Tired out for no good reason", type: "radio", options: FREQ_5 },
  { id: "psych_nervous", label: "Nervous", type: "radio", options: FREQ_5 },
  { id: "psych_nervous_no_calm", label: "So nervous that nothing could calm you down", type: "radio", options: FREQ_5 },
  { id: "psych_hopeless", label: "Hopeless", type: "radio", options: FREQ_5 },
  { id: "psych_restless", label: "Restless or fidgety", type: "radio", options: FREQ_5 },
  { id: "psych_too_restless", label: "So restless you could not sit still", type: "radio", options: FREQ_5 },
  { id: "psych_depressed", label: "Sad or depressed", type: "radio", options: FREQ_5 },
  { id: "psych_effort", label: "Everything was an effort", type: "radio", options: FREQ_5 },
  { id: "psych_sad", label: "So sad nothing could cheer you up", type: "radio", options: FREQ_5 },
  { id: "psych_worthless", label: "Worthless", type: "radio", options: FREQ_5 },
  { id: "awareness_job_performance", label: "Describe any awareness affecting your job performance:", type: "textarea" },

  // Section 4: Capacity Assessment
  { id: "can_sit", label: "Sit", type: "radio", options: CAPACITY, section: "Capacity Assessment" },
  { id: "can_stand_walk", label: "Stand/Walk", type: "radio", options: CAPACITY },
  { id: "can_bend", label: "Bend", type: "radio", options: CAPACITY },
  { id: "can_squat", label: "Squat", type: "radio", options: CAPACITY },
  { id: "can_kneel", label: "Kneel", type: "radio", options: CAPACITY },
  { id: "can_reach_above_shoulder", label: "Reach above shoulder", type: "radio", options: CAPACITY },
  { id: "can_use_arms_hands", label: "Use arms/hands", type: "radio", options: CAPACITY },
  { id: "can_lift", label: "Lift", type: "radio", options: CAPACITY },
  { id: "can_neck_movement", label: "Neck movement", type: "radio", options: CAPACITY },
  { id: "physical_function_comments", label: "Physical function comments:", type: "textarea" },
  { id: "attention_concentration", label: "Attention/Concentration", type: "radio", options: ["Not Affected", "Affected"] },
  { id: "memory", label: "Memory", type: "radio", options: ["Not Affected", "Affected"] },
  { id: "judgement", label: "Judgement", type: "radio", options: ["Not Affected", "Affected"] },
  { id: "mental_health_comments", label: "Mental health comments:", type: "textarea" },
  { id: "additional_comments", label: "Additional comments:", type: "textarea" },
  { id: "work_environment", label: "Work environment considerations:", type: "textarea" },
];

const MENTAL_HEALTH_QUESTIONS: Question[] = [
  // Section 1: Personal Information
  { id: "company_name", label: "Company name", type: "text", section: "Personal Information" },
  { id: "first_name", label: "First name", type: "text" },
  { id: "last_name", label: "Last name", type: "text" },
  { id: "age", label: "Age", type: "text" },
  { id: "email", label: "Your email", type: "text" },
  { id: "gender", label: "Gender", type: "radio", options: ["Man", "Woman", "Prefer not to say"] },

  // Section 2: Psychological Distress (K10) — past 4 weeks
  { id: "psych_tired", label: "Tired out for no good reason", type: "radio", options: FREQ_5, section: "Psychological Distress (Past 4 Weeks)" },
  { id: "psych_nervous", label: "Nervous", type: "radio", options: FREQ_5 },
  { id: "psych_nervous_no_calm", label: "So nervous that nothing could calm you down", type: "radio", options: FREQ_5 },
  { id: "psych_hopeless", label: "Hopeless", type: "radio", options: FREQ_5 },
  { id: "psych_restless", label: "Restless or fidgety", type: "radio", options: FREQ_5 },
  { id: "psych_too_restless", label: "So restless you could not sit still", type: "radio", options: FREQ_5 },
  { id: "psych_sad", label: "Sad or depressed", type: "radio", options: FREQ_5 },
  { id: "psych_effort", label: "Everything was an effort", type: "radio", options: FREQ_5 },
  { id: "psych_nothing_cheer", label: "So sad that nothing could cheer you up", type: "radio", options: FREQ_5 },
  { id: "psych_worthless", label: "Worthless", type: "radio", options: FREQ_5 },

  // Section 3: Mental Health & Vitality — past 4 weeks
  { id: "vitality_full_of_life", label: "Have you felt full of life?", type: "radio", options: FREQ_5, section: "Mental Health & Vitality (Past 4 Weeks)" },
  { id: "vitality_happy", label: "Have you been a happy person?", type: "radio", options: FREQ_5 },
  { id: "vitality_calm", label: "Have you felt calm and peaceful?", type: "radio", options: FREQ_5 },
  { id: "vitality_energy", label: "Have you had a lot of energy?", type: "radio", options: FREQ_5 },
  { id: "vitality_worn_out", label: "Have you felt worn out or fatigued?", type: "radio", options: FREQ_5 },
  { id: "vitality_social", label: "Has physical or emotional health interfered with social activities?", type: "radio", options: FREQ_5 },
  { id: "vitality_work", label: "Have emotional problems caused difficulties with work or daily tasks?", type: "radio", options: FREQ_5 },

  // Section 4: Workplace Wellbeing
  { id: "mh_raise_concerns", label: "Do you feel comfortable raising mental health concerns at work?", type: "radio", options: ["Yes", "No", "Unsure"], section: "Workplace Wellbeing" },
  { id: "mh_raise_concerns_why", label: "If no, why not?", type: "textarea" },
  { id: "mh_stress", label: "Are you experiencing stress that affects your work, sleep, or personal life?", type: "radio", options: ["Yes", "No", "Unsure"] },
  { id: "mh_stress_contributing", label: "If yes, what's contributing to this?", type: "textarea" },
  { id: "mh_supported", label: "Do you feel supported by your manager or team when you're struggling?", type: "radio", options: ["Always", "Usually", "Sometimes", "Rarely"] },
  { id: "mh_aware_support", label: "Are you aware of available support services (e.g. EAP or counselling)?", type: "radio", options: ["Yes", "No", "Unsure"] },
  { id: "mh_want_resources", label: "Would you like to receive confidential support resources?", type: "radio", options: ["Yes", "No"] },
  { id: "mh_workload_reasonable", label: "Do you believe your current workload is reasonable and sustainable?", type: "radio", options: ["Yes", "No", "Sometimes"] },
  { id: "mh_workload_unsustainable", label: "If no, please describe what's making it unsustainable:", type: "textarea" },

  // Section 5: Psychosocial Risks
  { id: "risk_workload_manageable", label: "In the past 4 weeks, how manageable has your workload been?", type: "radio", options: ["Always manageable", "Sometimes overwhelming", "Often excessive", "Constantly overwhelming"], section: "Psychosocial Risks" },
  { id: "risk_unrealistic", label: "Do you feel expected to complete more than is reasonably achievable?", type: "radio", options: ["No", "Occasionally", "Often", "Always"] },
  { id: "risk_unrealistic_example", label: "Can you give an example or explain why?", type: "textarea" },
  { id: "risk_safe_to_ask", label: "When you're struggling, do you feel safe to ask for help at work?", type: "radio", options: ["Yes", "No", "Unsure"] },
  { id: "risk_acknowledged", label: "Do you feel your contributions are acknowledged or appreciated at work?", type: "radio", options: ["Always", "Sometimes", "Rarely", "Never"] },
  { id: "risk_bullying", label: "Have you experienced or witnessed bullying or exclusion at work?", type: "radio", options: ["No", "Yes, I witnessed it", "Yes, I experienced it", "Prefer not to say"] },
  { id: "risk_bullying_detail", label: "If you experienced it, would you like to share about it?", type: "textarea" },
  { id: "risk_concern_heard", label: "If you raised a workplace concern, do you believe it would be taken seriously?", type: "radio", options: ["Yes", "No", "Unsure"] },
  { id: "risk_traumatic", label: "Does your job expose you to emotionally distressing or traumatic situations?", type: "radio", options: ["No", "Occasionally", "Often", "Always"] },
  { id: "risk_recovery_time", label: "If yes, are you given time/space to recover?", type: "textarea" },
  { id: "risk_emotionally_drained", label: "Do you feel emotionally drained by your work?", type: "radio", options: ["Never", "Sometimes", "Often", "Always"] },
  { id: "risk_drained_cause", label: "What contributes most to this?", type: "textarea" },
  { id: "risk_breaks", label: "Are you able to take regular breaks during your workday?", type: "radio", options: ["Yes", "Sometimes", "No"] },
  { id: "risk_recovery_between", label: "Do you feel you have enough time to recover between workdays?", type: "radio", options: ["Always", "Sometimes", "Rarely", "Never"] },

  // Section 6: Personal Stress & Coping
  { id: "personal_stress", label: "Are you dealing with personal stress (e.g. health, financial, family) that affects your wellbeing?", type: "radio", options: ["Yes", "No", "Prefer not to say"], section: "Personal Stress & Coping" },
  { id: "personal_stress_detail", label: "Describe if you'd like help around this:", type: "textarea" },
  { id: "coping_strategies", label: "What do you usually do to cope with stress or pressure? (select all that apply)", type: "checkbox", options: ["Talk to someone", "Exercise", "Sleep/rest", "Withdraw", "Work more", "Other"] },
  { id: "coping_working", label: "Are these strategies working for you? Why or why not?", type: "textarea" },
  { id: "someone_to_talk", label: "Do you feel you have someone to talk to when things are hard?", type: "radio", options: ["Yes", "No"] },

  // Section 7: Growth, Meaning & Fulfillment
  { id: "work_meaningful", label: "Do you find your work meaningful or personally fulfilling?", type: "radio", options: ["Always", "Sometimes", "Rarely", "Never"], section: "Growth, Meaning & Fulfillment" },
  { id: "using_strengths", label: "Do you feel you're using your strengths at work?", type: "radio", options: ["Yes", "No", "Not sure"] },
  { id: "growth_opportunities", label: "Are there growth or learning opportunities in your current role?", type: "radio", options: ["Yes", "No", "Not sure"] },
  { id: "mh_changed", label: "Over the past 3 months, has your mental health, energy, or motivation changed?", type: "radio", options: ["Improved", "Declined", "Stayed the same"] },
  { id: "mh_changed_cause", label: "What contributed to this?", type: "textarea" },
  { id: "one_change", label: "What is one thing we could change at work to support your wellbeing?", type: "textarea" },

  // Section 8: Optional Feedback
  { id: "additional_feedback", label: "Is there anything else you would like to share about your wellbeing, stress levels, or support needs? (Confidential — not shared with your employer)", type: "textarea", section: "Optional Feedback" },
];

const FORM_CONFIG: Record<string, { title: string; intro: string; questions: Question[] }> = {
  injury: {
    title: "Injury Assessment",
    intro: "Please complete this injury assessment as accurately as possible. Your responses help us support your recovery and return to work.",
    questions: INJURY_QUESTIONS,
  },
  baseline_health: {
    title: "Pre-Employment Health Check",
    intro: "Please complete this health questionnaire for the",
    questions: PRE_EMPLOYMENT_QUESTIONS,
  },
  pre_employment: {
    title: "Pre-Employment Health Check",
    intro: "Please complete this health questionnaire for the",
    questions: PRE_EMPLOYMENT_QUESTIONS,
  },
  exit: {
    title: "Exit Health Check",
    intro: "Please complete this exit assessment as accurately as possible.",
    questions: EXIT_QUESTIONS,
  },
  wellness: {
    title: "General Wellness Assessment",
    intro: "Please complete this wellness assessment for the",
    questions: PRE_EMPLOYMENT_QUESTIONS,
  },
  mental_health: {
    title: "Mental Health Check",
    intro: "Please complete this mental health assessment as accurately as possible. Your responses are confidential.",
    questions: MENTAL_HEALTH_QUESTIONS,
  },
  prevention: {
    title: "Prevention & Safety Check",
    intro: "Please complete this prevention and safety assessment as accurately as possible.",
    questions: PREVENTION_QUESTIONS,
  },
};

function getFormConfig(assessmentType: string) {
  return FORM_CONFIG[assessmentType] ?? FORM_CONFIG.baseline_health;
}

export default function PublicQuestionnaire() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<AssessmentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/check/${token}`)
      .then((r) => {
        if (r.status === 404) throw new Error("Invalid or expired link");
        if (r.status === 410) throw new Error("This questionnaire has already been submitted");
        if (!r.ok) throw new Error("Failed to load assessment");
        return r.json();
      })
      .then((data: AssessmentInfo) => setInfo(data))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  function set(id: string, value: string) {
    setResponses((prev) => ({ ...prev, [id]: value }));
  }

  async function handleSubmit() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/check/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses }),
      });
      if (!res.ok) throw new Error("Submission failed");
      setSubmitted(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error && !submitting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white rounded-xl shadow p-8 max-w-md w-full text-center">
          <div className="mb-4 flex justify-center">
            <div className="h-14 w-14 rounded-full bg-yellow-100 flex items-center justify-center">
              <svg className="h-7 w-7 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-2">Unable to Load Assessment</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="bg-white rounded-xl shadow p-8 max-w-md w-full text-center">
          <div className="mb-4 flex justify-center">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
              <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Thank You!</h1>
          <p className="text-gray-600">
            Your health questionnaire has been submitted. Our team will review your responses and
            be in touch shortly.
          </p>
        </div>
      </div>
    );
  }

  const config = getFormConfig(info?.assessmentType ?? "baseline_health");
  const roleCheckTypes = new Set(["baseline_health", "pre_employment", "wellness"]);
  const isRoleCheck = roleCheckTypes.has(info?.assessmentType ?? "");

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-lg">
              P
            </div>
            <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Preventli</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mt-3">{config.title}</h1>
          <p className="text-gray-600 mt-1">
            Hello {info?.candidateName} —{" "}
            {isRoleCheck
              ? <>{config.intro} <strong>{info?.positionTitle}</strong> role.</>
              : config.intro}
          </p>
          <p className="text-xs text-gray-400 mt-3">
            Your responses are confidential and used only for workplace health assessment purposes.
          </p>
        </div>

        {/* Questions */}
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-6">
          {config.questions.map((q) => (
            <div key={q.id}>
              {q.section && (
                <h2 className="text-base font-semibold text-gray-900 border-b border-gray-200 pb-2 mb-4 -mt-2">
                  {q.section}
                </h2>
              )}
              <label className="block text-sm font-medium text-gray-800 mb-2">{q.label}</label>

              {q.type === "radio" && q.options && (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => set(q.id, opt)}
                      className={`px-4 py-2 rounded-full text-sm border transition-colors ${
                        responses[q.id] === opt
                          ? "bg-blue-600 text-white border-blue-600"
                          : "border-gray-300 text-gray-700 hover:border-blue-400"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              )}

              {q.type === "textarea" && (
                <textarea
                  rows={3}
                  value={responses[q.id] ?? ""}
                  onChange={(e) => set(q.id, e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="Type your answer here…"
                />
              )}

              {q.type === "text" && (
                <input
                  type="text"
                  value={responses[q.id] ?? ""}
                  onChange={(e) => set(q.id, e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}

              {q.type === "date" && (
                <input
                  type="date"
                  value={responses[q.id] ?? ""}
                  onChange={(e) => set(q.id, e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}

              {q.type === "dropdown" && q.options && (
                <select
                  value={responses[q.id] ?? ""}
                  onChange={(e) => set(q.id, e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">Select…</option>
                  {q.options.map((opt) => (
                    <option key={opt} value={opt}>{opt}</option>
                  ))}
                </select>
              )}

              {q.type === "checkbox" && q.options && (
                <div className="flex flex-col gap-2">
                  {q.options.map((opt) => {
                    const selected = (responses[q.id] ?? "").split("|").filter(Boolean);
                    const checked = selected.includes(opt);
                    return (
                      <label key={opt} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = checked
                              ? selected.filter((v) => v !== opt)
                              : [...selected, opt];
                            set(q.id, next.join("|"));
                          }}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm text-gray-700">{opt}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          ))}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold rounded-lg px-6 py-3 text-sm transition-colors"
          >
            {submitting ? "Submitting…" : "Submit Health Questionnaire"}
          </button>

          <p className="text-xs text-center text-gray-400">
            By submitting, you confirm the information provided is accurate and complete.
          </p>
        </div>
      </div>
    </div>
  );
}
