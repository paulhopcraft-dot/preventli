import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { getCsrfToken } from "@/lib/queryClient";
import { PageLayout } from "@/components/PageLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { UserPlus, Send, CheckCircle, ArrowLeft, Loader2, Paperclip, X } from "lucide-react";

interface AssessmentDraft {
  id: string;
  candidateName: string;
  candidateEmail: string;
  positionTitle: string;
  accessToken: string;
  status: string;
}

type CheckCategory = "pre_employment" | "exit" | "wellness" | "mental_health" | "prevention" | "injury";

const CHECK_META: Record<CheckCategory, { label: string; description: string; requiresJD: boolean }> = {
  pre_employment: {
    label: "Pre-Employment Health Check",
    description: "Send a health questionnaire to a candidate before they start.",
    requiresJD: true,
  },
  exit: {
    label: "Exit Health Check",
    description: "Send a final health assessment to a departing worker.",
    requiresJD: false,
  },
  wellness: {
    label: "General Wellness Assessment",
    description: "Send a wellness check to a worker.",
    requiresJD: false,
  },
  mental_health: {
    label: "Mental Health Assessment",
    description: "Send a mental health check to a worker.",
    requiresJD: false,
  },
  prevention: {
    label: "Prevention & Safety Check",
    description: "Send a proactive prevention check to a worker.",
    requiresJD: false,
  },
  injury: {
    label: "Injury Assessment",
    description: "Send an injury assessment to a worker.",
    requiresJD: false,
  },
};

export default function NewAssessmentPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const rawType = searchParams.get("type") ?? "pre_employment";
  const checkCategory: CheckCategory = (rawType in CHECK_META ? rawType : "pre_employment") as CheckCategory;
  const meta = CHECK_META[checkCategory];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"form" | "created" | "sent">("form");
  const [assessment, setAssessment] = useState<AssessmentDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jdFile, setJdFile] = useState<File | null>(null);

  const [fields, setFields] = useState({
    candidateName: "",
    candidateEmail: "",
    positionTitle: "",
    startDate: "",
    jobDescription: "",
  });

  function set(key: keyof typeof fields, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setJdFile(file);
  }

  function clearFile() {
    setJdFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Pre-employment requires job description; other types don't
    if (meta.requiresJD && !fields.jobDescription.trim() && !jdFile) {
      setError("Please add a role description or attach a job description document.");
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("candidateName", fields.candidateName);
      formData.append("candidateEmail", fields.candidateEmail);
      formData.append("positionTitle", fields.positionTitle);
      formData.append("checkCategory", checkCategory);
      if (fields.startDate) formData.append("startDate", fields.startDate);
      if (fields.jobDescription.trim()) formData.append("jobDescription", fields.jobDescription);
      if (jdFile) formData.append("jobDescriptionFile", jdFile);

      const csrfToken = await getCsrfToken();
      const res = await fetch("/api/assessments", {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRF-Token": csrfToken },
        body: formData,
        // No Content-Type header — browser sets multipart boundary automatically
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const data = await res.json();
      // Bust every per-category assessments cache so the new check appears
      // on /checks (queryClient defaults to staleTime: Infinity).
      queryClient.invalidateQueries({ queryKey: ["assessments"] });
      setAssessment(data.assessment);
      setStep("created");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSend() {
    if (!assessment) return;
    setError(null);
    setSending(true);
    try {
      const csrfToken = await getCsrfToken();
      const res = await fetch(`/api/assessments/${assessment.id}/send`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      // Status changed to "sent" server-side — refresh the checks lists.
      queryClient.invalidateQueries({ queryKey: ["assessments"] });
      setStep("sent");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSending(false);
    }
  }

  function resetForm() {
    setStep("form");
    setAssessment(null);
    setJdFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setFields({ candidateName: "", candidateEmail: "", positionTitle: "", startDate: "", jobDescription: "" });
  }

  if (step === "sent") {
    return (
      <PageLayout title="Assessment Sent" subtitle={meta.label}>
        <div className="max-w-lg mx-auto">
          <Card>
            <CardContent className="pt-8 pb-8 text-center space-y-4">
              <div className="flex justify-center">
                <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle className="h-8 w-8 text-green-600" />
                </div>
              </div>
              <h2 className="text-xl font-semibold">Questionnaire sent!</h2>
              <p className="text-muted-foreground text-sm">
                A secure link has been emailed to{" "}
                <span className="font-medium text-foreground">{assessment?.candidateEmail}</span>.
                <br />
                You'll be notified automatically once they complete it.
              </p>
              <div className="flex gap-3 justify-center pt-2">
                <Button variant="outline" onClick={() => navigate("/checks")}>
                  Back to Checks
                </Button>
                <Button onClick={resetForm}>
                  <UserPlus className="h-4 w-4 mr-2" />
                  New Assessment
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </PageLayout>
    );
  }

  if (step === "created" && assessment) {
    return (
      <PageLayout title="Assessment Created" subtitle={meta.label}>
        <div className="max-w-lg mx-auto space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Ready to send</CardTitle>
                <Badge variant="outline">Created</Badge>
              </div>
              <CardDescription>Review the details below, then send the questionnaire link to the worker.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Candidate</p>
                  <p className="font-medium">{assessment.candidateName}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Email</p>
                  <p className="font-medium">{assessment.candidateEmail}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-muted-foreground">Position</p>
                  <p className="font-medium">{assessment.positionTitle}</p>
                </div>
                {jdFile && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground">Job Description</p>
                    <p className="font-medium flex items-center gap-1.5">
                      <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                      {jdFile.name}
                    </p>
                  </div>
                )}
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => navigate("/checks")} className="flex-1">
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Not now
                </Button>
                <Button onClick={handleSend} disabled={sending} className="flex-1">
                  {sending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  {sending ? "Sending…" : "Send to Worker"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title={`New ${meta.label}`} subtitle={meta.description}>
      <div className="max-w-lg mx-auto">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Candidate Details
            </CardTitle>
            <CardDescription>
              Enter the candidate's details. They'll receive a secure link by email to complete their health check.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="candidateName">Full Name *</Label>
                  <Input
                    id="candidateName"
                    value={fields.candidateName}
                    onChange={(e) => set("candidateName", e.target.value)}
                    placeholder="Jane Smith"
                    required
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="candidateEmail">Email Address *</Label>
                  <Input
                    id="candidateEmail"
                    type="email"
                    value={fields.candidateEmail}
                    onChange={(e) => set("candidateEmail", e.target.value)}
                    placeholder="jane.smith@email.com"
                    required
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="positionTitle">Role / Position *</Label>
                  <Input
                    id="positionTitle"
                    value={fields.positionTitle}
                    onChange={(e) => set("positionTitle", e.target.value)}
                    placeholder="Warehouse Operator"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="startDate">Proposed Start Date</Label>
                  <Input
                    id="startDate"
                    type="date"
                    value={fields.startDate}
                    onChange={(e) => set("startDate", e.target.value)}
                  />
                </div>
              </div>

              {/* Job Description — text + file, only required for pre-employment */}
              {meta.requiresJD && <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
                <div>
                  <Label className="text-sm font-medium">
                    Job Description / Physical Demands <span className="text-destructive">*</span>
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Provide a description of the role's physical requirements and/or attach the job description document.
                    At least one is required.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="jobDescription" className="text-xs text-muted-foreground">
                    Role description (text)
                  </Label>
                  <Textarea
                    id="jobDescription"
                    value={fields.jobDescription}
                    onChange={(e) => set("jobDescription", e.target.value)}
                    placeholder="E.g. Manual handling up to 20kg, standing 8hrs/day, outdoor work, forklift operation…"
                    rows={3}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="jdFile" className="text-xs text-muted-foreground">
                    Job description document (PDF, DOC, DOCX — max 10MB)
                  </Label>
                  {jdFile ? (
                    <div className="flex items-center gap-2 text-sm border rounded-md px-3 py-2 bg-background">
                      <Paperclip className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      <span className="flex-1 truncate">{jdFile.name}</span>
                      <button
                        type="button"
                        onClick={clearFile}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        aria-label="Remove file"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div>
                      <input
                        ref={fileInputRef}
                        id="jdFile"
                        type="file"
                        accept=".pdf,.doc,.docx"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Paperclip className="h-4 w-4 mr-2" />
                        Attach document
                      </Button>
                    </div>
                  )}
                </div>
              </div>}

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => navigate("/checks")} className="flex-1">
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting} className="flex-1">
                  {submitting ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4 mr-2" />
                  )}
                  {submitting ? "Creating…" : "Create Assessment"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
