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
  type: "radio" | "textarea" | "text" | "date" | "dropdown";
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
    intro: "Please complete this exit health questionnaire for the",
    questions: PRE_EMPLOYMENT_QUESTIONS,
  },
  wellness: {
    title: "General Wellness Assessment",
    intro: "Please complete this wellness assessment for the",
    questions: PRE_EMPLOYMENT_QUESTIONS,
  },
  mental_health: {
    title: "Mental Health Assessment",
    intro: "Please complete this mental health assessment for the",
    questions: PRE_EMPLOYMENT_QUESTIONS,
  },
  prevention: {
    title: "Prevention & Safety Check",
    intro: "Please complete this prevention and safety check for the",
    questions: PRE_EMPLOYMENT_QUESTIONS,
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
  const isRoleCheck = info?.assessmentType !== "injury";

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
