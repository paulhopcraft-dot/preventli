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
}

const QUESTIONS = [
  { id: "general_health", label: "How would you rate your overall health?", type: "radio", options: ["Excellent", "Good", "Fair", "Poor"] },
  { id: "current_conditions", label: "Do you have any current medical conditions or injuries?", type: "radio", options: ["No", "Yes"] },
  { id: "current_conditions_detail", label: "Please describe your current medical conditions or injuries:", type: "textarea" },
  { id: "medications", label: "Are you currently taking any medications?", type: "radio", options: ["No", "Yes"] },
  { id: "medications_detail", label: "Please list your current medications:", type: "textarea" },
  { id: "physical_limitations", label: "Do you have any physical limitations that may affect your work?", type: "radio", options: ["No", "Yes"] },
  { id: "physical_limitations_detail", label: "Please describe your physical limitations:", type: "textarea" },
  { id: "mental_health", label: "How would you rate your mental health and wellbeing?", type: "radio", options: ["Excellent", "Good", "Fair", "Poor"] },
] as const;

type QuestionId = typeof QUESTIONS[number]["id"];

// Detail questions only appear when their parent is answered "Yes"
const DETAIL_PARENT: Partial<Record<QuestionId, string>> = {
  current_conditions_detail: "current_conditions",
  medications_detail: "medications",
  physical_limitations_detail: "physical_limitations",
};

function isVisible(questionId: QuestionId, responses: Record<string, string>): boolean {
  const parent = DETAIL_PARENT[questionId];
  if (!parent) return true;
  return responses[parent] === "Yes";
}

function getVisibleQuestions(responses: Record<string, string>) {
  return QUESTIONS.filter(q => isVisible(q.id, responses));
}

function nextIndex(from: number, responses: Record<string, string>): number {
  let next = from + 1;
  while (next < QUESTIONS.length && !isVisible(QUESTIONS[next].id, responses)) next++;
  return next;
}

function prevIndex(from: number, responses: Record<string, string>): number {
  let prev = from - 1;
  while (prev >= 0 && !isVisible(QUESTIONS[prev].id, responses)) prev--;
  return prev;
}

export default function PublicQuestionnaire() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<AssessmentInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

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

  const q = QUESTIONS[currentStep];
  const visibleQuestions = getVisibleQuestions(responses);
  const visibleIndex = visibleQuestions.findIndex(vq => vq.id === q.id);
  const totalSteps = visibleQuestions.length;
  const progress = ((visibleIndex + 1) / totalSteps) * 100;
  const isFirst = prevIndex(currentStep, responses) < 0;
  const nextIdx = nextIndex(currentStep, responses);
  const isLast = nextIdx >= QUESTIONS.length;
  const currentAnswer = responses[q.id] ?? "";
  const canAdvance = q.type === "radio" ? currentAnswer !== "" : true;

  function handleNext() {
    if (isLast) {
      handleSubmit();
    } else {
      setCurrentStep(nextIdx);
    }
  }

  function handleBack() {
    const prev = prevIndex(currentStep, responses);
    if (prev >= 0) setCurrentStep(prev);
  }

  function handleAnswer(value: string) {
    setResponses(prev => ({ ...prev, [q.id]: value }));
  }

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
          <h1 className="text-xl font-bold text-gray-900 mt-3">Pre-Employment Health Check</h1>
          <p className="text-gray-600 mt-1">
            Hello {info?.candidateName} — please complete this health questionnaire for the{" "}
            <strong>{info?.positionTitle}</strong> role.
          </p>
          <p className="text-xs text-gray-400 mt-3">
            Your responses are confidential and used only for workplace health assessment purposes.
          </p>
        </div>

        {/* Step card */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          {/* Progress */}
          <div className="mb-6">
            <div className="flex justify-between text-xs text-gray-500 mb-2">
              <span>Question {visibleIndex + 1} of {totalSteps}</span>
              <span>{Math.round(progress)}% complete</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-1.5">
              <div
                className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* Question */}
          <div className="mb-8">
            <label className="block text-base font-semibold text-gray-900 mb-4">{q.label}</label>

            {q.type === "radio" && "options" in q && (
              <div className="flex flex-col gap-3">
                {q.options.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => handleAnswer(opt)}
                    className={`w-full text-left px-4 py-3 rounded-lg border-2 text-sm font-medium transition-colors ${
                      currentAnswer === opt
                        ? "bg-blue-50 border-blue-600 text-blue-700"
                        : "border-gray-200 text-gray-700 hover:border-blue-300 hover:bg-gray-50"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}

            {q.type === "textarea" && (
              <textarea
                rows={4}
                value={currentAnswer}
                onChange={(e) => handleAnswer(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Type your answer here…"
                autoFocus
              />
            )}
          </div>

          {/* Submission error */}
          {error && submitting === false && (
            <p className="text-sm text-red-600 mb-4">{error}</p>
          )}

          {/* Navigation */}
          <div className="flex gap-3">
            {!isFirst && (
              <button
                type="button"
                onClick={handleBack}
                className="flex-1 border border-gray-300 text-gray-700 font-semibold rounded-lg px-6 py-3 text-sm hover:bg-gray-50 transition-colors"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={handleNext}
              disabled={!canAdvance || submitting}
              className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg px-6 py-3 text-sm transition-colors"
            >
              {submitting ? "Submitting…" : isLast ? "Submit" : "Next"}
            </button>
          </div>

          {isLast && (
            <p className="text-xs text-center text-gray-400 mt-4">
              By submitting, you confirm the information provided is accurate and complete.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
