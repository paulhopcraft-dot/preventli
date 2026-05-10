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
  organizationName: string | null;
}

const QUESTIONS = [
  { id: "general_health", label: "How would you rate your overall health?", type: "radio", options: ["Excellent", "Good", "Fair", "Poor"] },
  { id: "current_conditions", label: "Do you have any current medical conditions or injuries?", type: "radio", options: ["No", "Yes"] },
  { id: "current_conditions_detail", label: "If yes, please describe:", type: "textarea" },
  { id: "medications", label: "Are you currently taking any medications?", type: "radio", options: ["No", "Yes"] },
  { id: "medications_detail", label: "If yes, please list medications:", type: "textarea" },
  { id: "physical_limitations", label: "Do you have any physical limitations that may affect your work?", type: "radio", options: ["No", "Yes"] },
  { id: "physical_limitations_detail", label: "If yes, please describe:", type: "textarea" },
  { id: "mental_health", label: "How would you rate your mental health and wellbeing?", type: "radio", options: ["Excellent", "Good", "Fair", "Poor"] },
];

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

  if (error) {
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

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold text-lg">
              {(info?.organizationName ?? "P").charAt(0).toUpperCase()}
            </div>
            <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              {info?.organizationName ?? "Preventli"}
            </span>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mt-3">Pre-Employment Health Check</h1>
          <p className="text-gray-600 mt-1">
            Hello {info?.candidateName} —{" "}
            {info?.organizationName ? (
              <>
                <strong>{info.organizationName}</strong> has invited you to complete a health
                questionnaire as part of your application for the{" "}
                <strong>{info.positionTitle}</strong> role.
              </>
            ) : (
              <>
                please complete this health questionnaire for the{" "}
                <strong>{info?.positionTitle}</strong> role.
              </>
            )}
          </p>
          <p className="text-xs text-gray-400 mt-3">
            Your responses are confidential and used only for workplace health assessment purposes.
          </p>
        </div>

        {/* Questions */}
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-6">
          {QUESTIONS.map((q) => (
            <div key={q.id}>
              <label className="block text-sm font-medium text-gray-800 mb-2">{q.label}</label>
              {q.type === "radio" && q.options && (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setResponses((prev) => ({ ...prev, [q.id]: opt }))}
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
                  onChange={(e) => setResponses((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="Type your answer here…"
                />
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
