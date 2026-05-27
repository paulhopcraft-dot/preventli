import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { PageLayout } from "@/components/PageLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getCsrfToken } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import {
  AlertCircle,
  ExternalLink,
  Upload,
  X,
  CheckCircle,
  FileText,
  User,
  Calendar,
  MapPin,
  Heart,
  ClipboardList,
  Paperclip,
  ArrowRight,
  Save,
  Stethoscope,
} from "lucide-react";

// Type for existing workers
interface ExistingWorker {
  id: string;
  workerName: string;
  company: string;
  hasActiveCase: boolean;
  activeCaseId?: string;
}

// Form data structure
interface NewCaseFormData {
  // Gateway
  hasLodgedClaim: boolean | null;

  // Worker selection
  workerType: "existing" | "new";
  existingWorkerId: string;

  // New worker details
  workerName: string;
  workerEmail: string;
  workerPhone: string;
  workerDob: string;
  workerAddress: string;
  workerRole: string;

  // Incident details
  dateOfIncident: string;
  incidentLocation: string;
  incidentDescription: string;
  injuryType: string;

  // Care team (RTW multi-party distribution — phase 3)
  // Captured up front so the plan distribution flow (phase 2) has every
  // recipient available at draft time. Manager + treating doctor are required;
  // physio is optional.
  managerName: string;
  managerEmail: string;
  doctorName: string; // "Dr Greg Practitioner" or practice name
  doctorEmail: string;
  physioName: string;
  physioEmail: string;

  // Insurance / WorkCover (phase 3b — only required when hasLodgedClaim===true)
  // Captured inline so the multi-party distribute flow can CC the insurer case
  // manager on WorkCover claims (spec req 1, WorkCover branch).
  claimNumber: string;
  insurerName: string;
  insurerCsmName: string;
  insurerCsmEmail: string;

  // Recovery & Support
  hasPersonalFactors: boolean | null;
  personalFactorsNotes: string;
  requiresAdditionalSupport: boolean | null;
  supportNotes: string;

  // RTW Plan
  hasRtwPlan: boolean | null;

  // Documents (file references stored as array of objects)
  documents: Array<{
    type: string;
    fileName: string;
    fileSize: number;
    file: File;
  }>;
}

const DOCUMENT_TYPES = [
  { value: "medical_certificate", label: "Medical Certificate(s)" },
  { value: "certificate_of_capacity", label: "Certificate of Capacity" },
  { value: "specialist_report", label: "Specialist Reports" },
  { value: "imaging_results", label: "Imaging Results (X-ray, MRI)" },
  { value: "hospital_discharge", label: "Hospital Discharge Summary" },
  { value: "allied_health_report", label: "Allied Health Reports" },
  { value: "work_capacity_assessment", label: "Work Capacity or Fit for Work Assessments" },
  { value: "incident_report", label: "Incident Report" },
  { value: "rtw_plan", label: "Return to Work Plan" },
  { value: "other", label: "Other" },
];

const INJURY_TYPES = [
  { value: "musculoskeletal", label: "Musculoskeletal" },
  { value: "psychological", label: "Psychological" },
  { value: "laceration", label: "Laceration" },
  { value: "fracture", label: "Fracture" },
  { value: "burn", label: "Burn" },
  { value: "sprain_strain", label: "Sprain/Strain" },
  { value: "crush_injury", label: "Crush Injury" },
  { value: "hearing_loss", label: "Hearing Loss" },
  { value: "respiratory", label: "Respiratory" },
  { value: "skin_condition", label: "Skin Condition" },
  { value: "other", label: "Other" },
];

const initialFormData: NewCaseFormData = {
  hasLodgedClaim: null,
  workerType: "new",
  existingWorkerId: "",
  workerName: "",
  workerEmail: "",
  workerPhone: "",
  workerDob: "",
  workerAddress: "",
  workerRole: "",
  dateOfIncident: "",
  incidentLocation: "",
  incidentDescription: "",
  injuryType: "",
  managerName: "",
  managerEmail: "",
  doctorName: "",
  doctorEmail: "",
  physioName: "",
  physioEmail: "",
  claimNumber: "",
  insurerName: "",
  insurerCsmName: "",
  insurerCsmEmail: "",
  hasPersonalFactors: null,
  personalFactorsNotes: "",
  requiresAdditionalSupport: null,
  supportNotes: "",
  hasRtwPlan: null,
  documents: [],
};

export default function EmployerNewCasePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<NewCaseFormData>(initialFormData);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedDocType, setSelectedDocType] = useState<string>("");

  // Fetch existing workers for this organization
  const { data: existingWorkers = [] } = useQuery<ExistingWorker[]>({
    queryKey: ["employer-workers"],
    queryFn: async () => {
      const res = await fetch("/api/employer/workers");
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Auto-save draft every 30 seconds
  const saveDraft = useCallback(async () => {
    if (!isDirty) return;
    try {
      // Store draft in localStorage for now (could be server-side)
      localStorage.setItem("employer-new-case-draft", JSON.stringify({
        ...formData,
        documents: formData.documents.map(d => ({
          type: d.type,
          fileName: d.fileName,
          fileSize: d.fileSize,
        })),
      }));
      setLastSaved(new Date());
      setIsDirty(false);
    } catch (error) {
      console.error("Failed to save draft:", error);
    }
  }, [formData, isDirty]);

  useEffect(() => {
    const interval = setInterval(saveDraft, 30000);
    return () => clearInterval(interval);
  }, [saveDraft]);

  // Load draft on mount
  useEffect(() => {
    const saved = localStorage.getItem("employer-new-case-draft");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setFormData({ ...parsed, documents: [] });
      } catch {
        // Ignore invalid saved data
      }
    }
  }, []);

  const updateField = <K extends keyof NewCaseFormData>(
    field: K,
    value: NewCaseFormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setIsDirty(true);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || !selectedDocType) return;

    const newDocs = Array.from(files).map((file) => ({
      type: selectedDocType,
      fileName: file.name,
      fileSize: file.size,
      file,
    }));

    setFormData((prev) => ({
      ...prev,
      documents: [...prev.documents, ...newDocs],
    }));
    setIsDirty(true);
    setSelectedDocType("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeDocument = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      documents: prev.documents.filter((_, i) => i !== index),
    }));
    setIsDirty(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Build form data for multipart submission
      const submitData = new FormData();

      // Add all form fields
      submitData.append("workerType", formData.workerType);
      if (formData.workerType === "existing") {
        submitData.append("existingWorkerId", formData.existingWorkerId);
      } else {
        submitData.append("workerName", formData.workerName);
        submitData.append("workerEmail", formData.workerEmail);
        submitData.append("workerPhone", formData.workerPhone);
        submitData.append("workerDob", formData.workerDob);
        submitData.append("workerAddress", formData.workerAddress);
        submitData.append("workerRole", formData.workerRole);
      }

      submitData.append("dateOfIncident", formData.dateOfIncident);
      submitData.append("incidentLocation", formData.incidentLocation);
      submitData.append("incidentDescription", formData.incidentDescription);
      submitData.append("injuryType", formData.injuryType);
      submitData.append("hasPersonalFactors", String(formData.hasPersonalFactors));
      submitData.append("personalFactorsNotes", formData.personalFactorsNotes);
      submitData.append("requiresAdditionalSupport", String(formData.requiresAdditionalSupport));
      submitData.append("supportNotes", formData.supportNotes);
      submitData.append("hasRtwPlan", String(formData.hasRtwPlan));

      // Care team contacts (RTW multi-party distribution — phase 3)
      submitData.append("managerName", formData.managerName);
      submitData.append("managerEmail", formData.managerEmail);
      submitData.append("doctorName", formData.doctorName);
      submitData.append("doctorEmail", formData.doctorEmail);
      submitData.append("physioName", formData.physioName);
      submitData.append("physioEmail", formData.physioEmail);

      // WorkCover / insurance details (phase 3b — only meaningful when hasLodgedClaim===true)
      submitData.append("hasLodgedClaim", String(formData.hasLodgedClaim));
      submitData.append("claimNumber", formData.claimNumber);
      submitData.append("insurerName", formData.insurerName);
      submitData.append("insurerCsmName", formData.insurerCsmName);
      submitData.append("insurerCsmEmail", formData.insurerCsmEmail);

      // Add files
      formData.documents.forEach((doc, index) => {
        submitData.append(`document_${index}`, doc.file);
        submitData.append(`document_${index}_type`, doc.type);
      });

      const csrfToken = await getCsrfToken();
      const response = await fetch("/api/employer/cases", {
        method: "POST",
        body: submitData,
        credentials: "include",
        headers: { "X-CSRF-Token": csrfToken },
      });

      if (!response.ok) {
        throw new Error("Failed to create case");
      }

      const result = await response.json();

      // Clear draft
      localStorage.removeItem("employer-new-case-draft");

      // Invalidate queries
      await queryClient.invalidateQueries({ queryKey: ["/api/cases"] });

      toast({
        title: "Case Created Successfully",
        description: `Case for ${formData.workerType === "existing" ? "worker" : formData.workerName} has been created.`,
      });

      // Navigate to success page with options
      navigate(`/employer/case/${result.caseId}/success`);
    } catch (error) {
      console.error("Error creating case:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create case. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Check if selected worker has existing active case
  const selectedWorker = existingWorkers.find(w => w.id === formData.existingWorkerId);
  const hasExistingCase = selectedWorker?.hasActiveCase;

  // (WorkCover-redirect view removed 2026-05-27 — both lodged and non-lodged
  // claims now go through the same form; WorkCover details are captured inline
  // when hasLodgedClaim === true so the RTW plan distribute flow has the
  // insurer case manager available at draft time.)

  return (
    <PageLayout title="New Case" subtitle="Report a workplace incident">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Auto-save indicator */}
        {lastSaved && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Save className="w-4 h-4" />
            Draft saved at {lastSaved.toLocaleTimeString()}
          </div>
        )}

        {/* Section 1: Gateway Question */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-primary" />
              Claim Status
            </CardTitle>
            <CardDescription>
              This helps us determine the appropriate process for this case.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <Label className="text-base font-semibold">
                Has the worker lodged a workers' compensation claim?
              </Label>
              <RadioGroup
                value={formData.hasLodgedClaim === null ? "" : formData.hasLodgedClaim ? "yes" : "no"}
                onValueChange={(value) => updateField("hasLodgedClaim", value === "yes")}
                className="flex gap-6"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="yes" id="claim-yes" />
                  <Label htmlFor="claim-yes" className="cursor-pointer">Yes</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="no" id="claim-no" />
                  <Label htmlFor="claim-no" className="cursor-pointer">No</Label>
                </div>
              </RadioGroup>
            </div>
          </CardContent>
        </Card>

        {/* Rest of form shows once the claim-status question has been answered.
            Both YES (WorkCover) and NO (preventative) flow through the same form;
            WorkCover details are captured in the conditional Insurance card below. */}
        {formData.hasLodgedClaim !== null && (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Section 2: Worker Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <User className="w-5 h-5 text-primary" />
                  Worker Details
                </CardTitle>
                <CardDescription>
                  Select an existing worker or add a new one.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <RadioGroup
                  value={formData.workerType}
                  onValueChange={(value: "existing" | "new") => updateField("workerType", value)}
                  className="flex gap-6"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="existing" id="worker-existing" />
                    <Label htmlFor="worker-existing" className="cursor-pointer">Select Existing Worker</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="new" id="worker-new" />
                    <Label htmlFor="worker-new" className="cursor-pointer">Add New Worker</Label>
                  </div>
                </RadioGroup>

                {formData.workerType === "existing" ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="existingWorker">Select Worker *</Label>
                      <Select
                        value={formData.existingWorkerId}
                        onValueChange={(value) => updateField("existingWorkerId", value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a worker..." />
                        </SelectTrigger>
                        <SelectContent>
                          {existingWorkers.map((worker) => (
                            <SelectItem key={worker.id} value={worker.id}>
                              {worker.workerName}
                              {worker.hasActiveCase && " (Has active case)"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {hasExistingCase && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                        <div className="flex items-start gap-3">
                          <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
                          <div>
                            <h4 className="font-semibold text-amber-800">Worker Has Active Case</h4>
                            <p className="text-sm text-amber-700 mt-1">
                              This worker already has an active case. This incident will be linked to the existing case rather than creating a new one.
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="mt-2"
                              onClick={() => navigate(`/employer/case/${selectedWorker?.activeCaseId}`)}
                            >
                              View Existing Case <ArrowRight className="w-4 h-4 ml-1" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="workerName">Full Name *</Label>
                      <Input
                        id="workerName"
                        placeholder="Enter worker's full name"
                        value={formData.workerName}
                        onChange={(e) => updateField("workerName", e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="workerEmail">Email *</Label>
                      <Input
                        id="workerEmail"
                        type="email"
                        placeholder="worker@example.com"
                        value={formData.workerEmail}
                        onChange={(e) => updateField("workerEmail", e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="workerPhone">Phone *</Label>
                      <Input
                        id="workerPhone"
                        type="tel"
                        placeholder="0400 000 000"
                        value={formData.workerPhone}
                        onChange={(e) => updateField("workerPhone", e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="workerDob">Date of Birth *</Label>
                      <Input
                        id="workerDob"
                        type="date"
                        value={formData.workerDob}
                        onChange={(e) => updateField("workerDob", e.target.value)}
                        max={new Date().toISOString().split("T")[0]}
                        required
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="workerAddress">Address *</Label>
                      <Input
                        id="workerAddress"
                        placeholder="123 Main Street, Melbourne VIC 3000"
                        value={formData.workerAddress}
                        onChange={(e) => updateField("workerAddress", e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="workerRole">Role/Position *</Label>
                      <Input
                        id="workerRole"
                        placeholder="e.g., Warehouse Operator"
                        value={formData.workerRole}
                        onChange={(e) => updateField("workerRole", e.target.value)}
                        required
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Section 2b: Care Team (RTW multi-party distribution — phase 3) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Stethoscope className="w-5 h-5 text-primary" />
                  Care Team
                </CardTitle>
                <CardDescription>
                  Captured up front so the worker's return-to-work plan can be sent to everyone at once.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="managerName">Manager Name *</Label>
                    <Input
                      id="managerName"
                      placeholder="e.g., Mick Manager"
                      value={formData.managerName}
                      onChange={(e) => updateField("managerName", e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="managerEmail">Manager Email *</Label>
                    <Input
                      id="managerEmail"
                      type="email"
                      placeholder="manager@example.com"
                      value={formData.managerEmail}
                      onChange={(e) => updateField("managerEmail", e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="doctorName">Treating Doctor / Practice *</Label>
                    <Input
                      id="doctorName"
                      placeholder="e.g., Dr Greg Practitioner or Smith Family Practice"
                      value={formData.doctorName}
                      onChange={(e) => updateField("doctorName", e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="doctorEmail">Doctor Email *</Label>
                    <Input
                      id="doctorEmail"
                      type="email"
                      placeholder="doctor@practice.com"
                      value={formData.doctorEmail}
                      onChange={(e) => updateField("doctorEmail", e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="physioName">Physio Name / Practice</Label>
                    <Input
                      id="physioName"
                      placeholder="Optional"
                      value={formData.physioName}
                      onChange={(e) => updateField("physioName", e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="physioEmail">Physio Email</Label>
                    <Input
                      id="physioEmail"
                      type="email"
                      placeholder="Optional"
                      value={formData.physioEmail}
                      onChange={(e) => updateField("physioEmail", e.target.value)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Section 2c: Insurance / WorkCover (phase 3b — visible only when claim lodged) */}
            {formData.hasLodgedClaim === true && (
              <Card className="border-blue-200">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <ExternalLink className="w-5 h-5 text-primary" />
                    Insurance / WorkCover
                  </CardTitle>
                  <CardDescription>
                    Required for WorkCover claims so the insurer case manager can be CC'd on the return-to-work plan.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="claimNumber">Claim Number *</Label>
                      <Input
                        id="claimNumber"
                        placeholder="e.g., WC-2026-12345"
                        value={formData.claimNumber}
                        onChange={(e) => updateField("claimNumber", e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="insurerName">Insurer Name *</Label>
                      <Input
                        id="insurerName"
                        placeholder="e.g., Allianz, EML, Gallagher Bassett"
                        value={formData.insurerName}
                        onChange={(e) => updateField("insurerName", e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="insurerCsmName">Insurance Case Manager Name *</Label>
                      <Input
                        id="insurerCsmName"
                        placeholder="e.g., Carla CaseManager"
                        value={formData.insurerCsmName}
                        onChange={(e) => updateField("insurerCsmName", e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="insurerCsmEmail">Insurance Case Manager Email *</Label>
                      <Input
                        id="insurerCsmEmail"
                        type="email"
                        placeholder="case.manager@allianz.com.au"
                        value={formData.insurerCsmEmail}
                        onChange={(e) => updateField("insurerCsmEmail", e.target.value)}
                        required
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Section 3: Incident Details */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-primary" />
                  Incident Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="dateOfIncident">Date of Incident *</Label>
                    <Input
                      id="dateOfIncident"
                      type="date"
                      value={formData.dateOfIncident}
                      onChange={(e) => updateField("dateOfIncident", e.target.value)}
                      max={new Date().toISOString().split("T")[0]}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="incidentLocation">Location of Incident *</Label>
                    <Input
                      id="incidentLocation"
                      placeholder="e.g., Warehouse Floor, Section B"
                      value={formData.incidentLocation}
                      onChange={(e) => updateField("incidentLocation", e.target.value)}
                      required
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="incidentDescription">Description of Incident *</Label>
                  <Textarea
                    id="incidentDescription"
                    placeholder="Describe what happened, how the injury occurred, and any immediate actions taken..."
                    value={formData.incidentDescription}
                    onChange={(e) => updateField("incidentDescription", e.target.value)}
                    rows={4}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="injuryType">Injury Type / Body Part *</Label>
                  <Select
                    value={formData.injuryType}
                    onValueChange={(value) => updateField("injuryType", value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select injury type" />
                    </SelectTrigger>
                    <SelectContent>
                      {INJURY_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Section 4: Recovery & Support */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Heart className="w-5 h-5 text-primary" />
                  Recovery & Support
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <Label className="text-base">
                    Are there any known personal factors that may impact recovery or return to work? *
                  </Label>
                  <RadioGroup
                    value={formData.hasPersonalFactors === null ? "" : formData.hasPersonalFactors ? "yes" : "no"}
                    onValueChange={(value) => updateField("hasPersonalFactors", value === "yes")}
                    className="flex gap-6"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="yes" id="factors-yes" />
                      <Label htmlFor="factors-yes" className="cursor-pointer">Yes</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="no" id="factors-no" />
                      <Label htmlFor="factors-no" className="cursor-pointer">No</Label>
                    </div>
                  </RadioGroup>
                  {formData.hasPersonalFactors && (
                    <Textarea
                      placeholder="Please describe any relevant personal factors (optional)..."
                      value={formData.personalFactorsNotes}
                      onChange={(e) => updateField("personalFactorsNotes", e.target.value)}
                      rows={3}
                    />
                  )}
                </div>

                <div className="space-y-4">
                  <Label className="text-base">
                    Does the worker require additional support to engage in the return-to-work process? *
                  </Label>
                  <RadioGroup
                    value={formData.requiresAdditionalSupport === null ? "" : formData.requiresAdditionalSupport ? "yes" : "no"}
                    onValueChange={(value) => updateField("requiresAdditionalSupport", value === "yes")}
                    className="flex gap-6"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="yes" id="support-yes" />
                      <Label htmlFor="support-yes" className="cursor-pointer">Yes</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="no" id="support-no" />
                      <Label htmlFor="support-no" className="cursor-pointer">No</Label>
                    </div>
                  </RadioGroup>
                  {formData.requiresAdditionalSupport && (
                    <Textarea
                      placeholder="Please describe what support may be needed (optional)..."
                      value={formData.supportNotes}
                      onChange={(e) => updateField("supportNotes", e.target.value)}
                      rows={3}
                    />
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Section 5: RTW Plan */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="w-5 h-5 text-primary" />
                  Return to Work Plan
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <Label className="text-base">
                    Has a formal Return to Work Plan been created? *
                  </Label>
                  <RadioGroup
                    value={formData.hasRtwPlan === null ? "" : formData.hasRtwPlan ? "yes" : "no"}
                    onValueChange={(value) => updateField("hasRtwPlan", value === "yes")}
                    className="flex gap-6"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="yes" id="rtw-yes" />
                      <Label htmlFor="rtw-yes" className="cursor-pointer">Yes</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="no" id="rtw-no" />
                      <Label htmlFor="rtw-no" className="cursor-pointer">No</Label>
                    </div>
                  </RadioGroup>
                  {formData.hasRtwPlan && (
                    <p className="text-sm text-muted-foreground">
                      You can attach the RTW Plan document in the Documents section below.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Section 6: Documents */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Paperclip className="w-5 h-5 text-primary" />
                  Documents
                </CardTitle>
                <CardDescription>
                  Attach any relevant documents (if available).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-3">
                  <Select
                    value={selectedDocType}
                    onValueChange={setSelectedDocType}
                  >
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder="Select document type" />
                    </SelectTrigger>
                    <SelectContent>
                      {DOCUMENT_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!selectedDocType}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Upload
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    multiple
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                    onChange={handleFileUpload}
                  />
                </div>

                {formData.documents.length > 0 && (
                  <div className="space-y-2">
                    {formData.documents.map((doc, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between bg-slate-50 rounded-lg p-3"
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="w-5 h-5 text-slate-500" />
                          <div>
                            <p className="font-medium text-sm">{doc.fileName}</p>
                            <p className="text-xs text-muted-foreground">
                              {DOCUMENT_TYPES.find(t => t.value === doc.type)?.label} •
                              {(doc.fileSize / 1024).toFixed(1)} KB
                            </p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeDocument(index)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Submit */}
            <div className="flex justify-end gap-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate("/")}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={saveDraft}
              >
                <Save className="w-4 h-4 mr-2" />
                Save Draft
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <span className="animate-spin mr-2">⏳</span>
                    Creating Case...
                  </>
                ) : (
                  <>
                    <CheckCircle className="w-4 h-4 mr-2" />
                    Submit Case
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </div>
    </PageLayout>
  );
}
