import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { fetchWithCsrf } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  ChevronLeft,
  ChevronRight,
  User,
  Briefcase,
  Shield,
  Activity,
  Brain,
  Heart,
  FileText,
  CheckCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Form data interface
interface FormData {
  // Personal Information
  firstName: string;
  lastName: string;
  email: string;
  companyName: string;
  age: string;
  gender: string;
  roleAppliedFor: string;

  // Work History
  workHistory: Array<{
    jobTitle: string;
    commonTasks: string;
    duration: string;
    year: string;
  }>;

  // Occupational Health
  hasWorkInjury: boolean;
  workInjuryDetails: string;
  hasHazardousExposure: boolean;
  hasSilicaExposure: string; // yes/no/not sure
  hasWorkcoverClaims: boolean;
  workcoverDetails: string;
  requiresTimeOff: boolean;

  // Medical Conditions
  medicalConditions: {
    musculoskeletal: string[];
    neurological: string[];
    mentalHealth: string[];
    systemic: string[];
    sensory: string[];
    other: string[];
  };
  medicationDetails: string;
  surgicalHistory: string;

  // Pre-Employment Disclosure
  preEmploymentDisclosure: string;
  conditionDetails: string;

  // Functional Capacity
  painRatings: {
    arms: number;
    shoulders: number;
    upperBack: number;
    lowerBack: number;
    knees: number;
    legs: number;
    feet: number;
  };
  painIntensity: number;
  painHistory: number;
  persistenceRisk: string;
  liftingCapacity: string;
  walkingDistance: string;
  sittingTolerance: string;

  // Psychological Wellbeing
  wellbeingRatings: {
    fatigue: string;
    nervousness: string;
    hopelessness: string;
    restlessness: string;
    depression: string;
    sadness: string;
    worthlessness: string;
  };
  mentalFunction: {
    attention: string;
    memory: string;
    judgment: string;
  };
  additionalComments: string;

  // Family History
  familyHistory: string[];
  familyHistoryDetails: string;

  // Vaccination History
  vaccinations: string[];
  vaccinationDetails: string;

  // Lifestyle
  smoker: boolean;
  smokingDetails: string;
  formerSmoker: boolean;
  smokingCessationDate: string;
  drinksAlcohol: boolean;
  drinkingFrequency: string;
}

// Initial form data
const initialFormData: FormData = {
  firstName: '',
  lastName: '',
  email: '',
  companyName: '',
  age: '',
  gender: '',
  roleAppliedFor: '',
  workHistory: [
    { jobTitle: '', commonTasks: '', duration: '', year: '' },
    { jobTitle: '', commonTasks: '', duration: '', year: '' },
    { jobTitle: '', commonTasks: '', duration: '', year: '' }
  ],
  hasWorkInjury: false,
  workInjuryDetails: '',
  hasHazardousExposure: false,
  hasSilicaExposure: '',
  hasWorkcoverClaims: false,
  workcoverDetails: '',
  requiresTimeOff: false,
  medicalConditions: {
    musculoskeletal: [],
    neurological: [],
    mentalHealth: [],
    systemic: [],
    sensory: [],
    other: []
  },
  medicationDetails: '',
  surgicalHistory: '',
  preEmploymentDisclosure: '',
  conditionDetails: '',
  painRatings: {
    arms: 0,
    shoulders: 0,
    upperBack: 0,
    lowerBack: 0,
    knees: 0,
    legs: 0,
    feet: 0
  },
  painIntensity: 0,
  painHistory: 0,
  persistenceRisk: '',
  liftingCapacity: '',
  walkingDistance: '',
  sittingTolerance: '',
  wellbeingRatings: {
    fatigue: '',
    nervousness: '',
    hopelessness: '',
    restlessness: '',
    depression: '',
    sadness: '',
    worthlessness: ''
  },
  mentalFunction: {
    attention: '',
    memory: '',
    judgment: ''
  },
  additionalComments: '',
  familyHistory: [],
  familyHistoryDetails: '',
  vaccinations: [],
  vaccinationDetails: '',
  smoker: false,
  smokingDetails: '',
  formerSmoker: false,
  smokingCessationDate: '',
  drinksAlcohol: false,
  drinkingFrequency: ''
};

// Form steps configuration
const formSteps = [
  {
    id: 1,
    title: 'Personal Information',
    icon: User,
    description: 'Basic details and contact information'
  },
  {
    id: 2,
    title: 'Work History',
    icon: Briefcase,
    description: 'Previous employment and experience'
  },
  {
    id: 3,
    title: 'Occupational Health',
    icon: Shield,
    description: 'Work-related health history'
  },
  {
    id: 4,
    title: 'Medical Conditions',
    icon: Activity,
    description: 'General health and medical history'
  },
  {
    id: 5,
    title: 'Functional Capacity',
    icon: Activity,
    description: 'Physical capabilities and pain assessment'
  },
  {
    id: 6,
    title: 'Psychological Wellbeing',
    icon: Brain,
    description: 'Mental health and cognitive function'
  },
  {
    id: 7,
    title: 'Family & Vaccination',
    icon: Heart,
    description: 'Family medical history and immunizations'
  },
  {
    id: 8,
    title: 'Lifestyle & Review',
    icon: FileText,
    description: 'Lifestyle factors and final review'
  }
];

export default function PreEmploymentForm() {
  const navigate = useNavigate();
  const { token } = useParams<{ token?: string }>();
  const isTokenMode = Boolean(token);

  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // Token mode: pre-populate name/role from magic link token
  useEffect(() => {
    if (!isTokenMode || !token) return;
    fetch(`/api/public/check/${token}`, { credentials: 'include' })
      .then((res) => {
        if (res.status === 404) throw new Error('Invalid or expired link');
        if (res.status === 410) throw new Error('This questionnaire has already been submitted');
        if (!res.ok) throw new Error('Failed to load assessment');
        return res.json();
      })
      .then((data: { candidateName?: string; positionTitle?: string }) => {
        if (data.candidateName) {
          const parts = data.candidateName.trim().split(' ');
          const firstName = parts[0] ?? '';
          const lastName = parts.slice(1).join(' ');
          setFormData((prev) => ({
            ...prev,
            firstName,
            lastName,
            roleAppliedFor: data.positionTitle ?? prev.roleAppliedFor,
          }));
        }
      })
      .catch((err: Error) => setTokenError(err.message));
  }, [isTokenMode, token]);

  // Auto-save to localStorage (auth mode only — don't cache health data in public browser)
  useEffect(() => {
    if (isTokenMode) return;
    const savedData = localStorage.getItem('preEmploymentFormData');
    if (savedData) {
      try {
        setFormData(JSON.parse(savedData));
      } catch {
        // ignore corrupt cached data
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (isTokenMode) return;
    localStorage.setItem('preEmploymentFormData', JSON.stringify(formData));
  }, [isTokenMode, formData]);

  // Progress calculation
  const progress = (currentStep / formSteps.length) * 100;

  // Update form data
  const updateFormData = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  // Navigation
  const nextStep = () => {
    if (validateCurrentStep()) {
      setCurrentStep(prev => Math.min(prev + 1, formSteps.length));
    }
  };

  const prevStep = () => {
    setCurrentStep(prev => Math.max(prev - 1, 1));
  };

  // Validation for current step
  // Calculate risk score based on form responses
  const calculateRiskScore = (): number => {
    let riskScore = 0;

    // Work injury history
    if (formData.hasWorkInjury) riskScore += 2;

    // Hazardous exposure
    if (formData.hasHazardousExposure) riskScore += 1;
    if (formData.hasSilicaExposure === 'yes') riskScore += 2;

    // Medical conditions
    const conditions = formData.medicalConditions;
    if (conditions.musculoskeletal.length > 0) riskScore += 1;
    if (conditions.neurological.length > 0) riskScore += 2;
    if (conditions.mentalHealth.length > 0) riskScore += 1;
    if (conditions.systemic.length > 0) riskScore += 2;
    if (conditions.sensory.length > 0) riskScore += 1;

    // Pain levels (higher pain = higher risk)
    const avgPain = (
      formData.painRatings.lowerBack +
      formData.painRatings.upperBack +
      formData.painRatings.shoulders +
      formData.painRatings.knees
    ) / 4;
    riskScore += Math.floor(avgPain / 2); // 0-10 scale divided by 2

    // Lifestyle factors
    if (formData.smoker) riskScore += 2;
    if (formData.formerSmoker) riskScore += 1;
    if (formData.drinksAlcohol) riskScore += 1;

    // Normalize to 0-10 scale
    return Math.min(Math.max(riskScore, 0), 10);
  };

  // Calculate clearance level based on risk score
  const calculateClearanceLevel = (): 'cleared' | 'conditional' | 'requires_review' | 'not_cleared' => {
    const riskScore = calculateRiskScore();

    if (riskScore <= 2) return 'cleared';
    if (riskScore <= 5) return 'conditional';
    if (riskScore <= 8) return 'requires_review';
    return 'not_cleared';
  };

  const validateCurrentStep = (): boolean => {
    const newErrors: Record<string, string> = {};

    switch (currentStep) {
      case 1:
        if (!formData.firstName.trim()) newErrors.firstName = 'First name is required';
        if (!formData.lastName.trim()) newErrors.lastName = 'Last name is required';
        if (!formData.email.trim()) newErrors.email = 'Email is required';
        if (!formData.companyName.trim()) newErrors.companyName = 'Company name is required';
        if (!formData.age.trim()) newErrors.age = 'Age is required';
        if (!formData.gender) newErrors.gender = 'Gender selection is required';
        if (!formData.roleAppliedFor.trim()) newErrors.roleAppliedFor = 'Role is required';
        break;
      // Add validation for other steps as needed
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle final submission
  const handleSubmit = async () => {
    if (!validateCurrentStep()) return;

    setIsSubmitting(true);
    try {
      if (isTokenMode && token) {
        // Public magic-link path — no auth / CSRF needed
        const response = await fetch(`/api/public/check/${token}`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ responses: formData }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? 'Failed to submit assessment');
        }
        setSubmitted(true);
      } else {
        // Authenticated path — creates a new assessment record
        const response = await fetchWithCsrf('/api/pre-employment/assessments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            candidateName: `${formData.firstName} ${formData.lastName}`,
            candidateEmail: formData.email,
            positionTitle: formData.roleAppliedFor,
            departmentName: formData.companyName,
            assessmentType: 'comprehensive_health_screening',
            status: 'completed',
            clearanceLevel: calculateClearanceLevel(),
            notes: `Risk score: ${calculateRiskScore()}/10. Comprehensive health screening completed via self-assessment form.`
          }),
        });
        if (response.ok) {
          localStorage.removeItem('preEmploymentFormData');
          navigate('/checks', {
            state: { message: 'Pre-employment assessment submitted successfully!' }
          });
        } else {
          throw new Error('Failed to submit assessment');
        }
      }
    } catch (error) {
      console.error('Submission error:', error);
      // Handle error (show toast, etc.)
    } finally {
      setIsSubmitting(false);
    }
  };

  // Render current step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return <PersonalInformationStep formData={formData} updateFormData={updateFormData} errors={errors} />;
      case 2:
        return <WorkHistoryStep formData={formData} updateFormData={updateFormData} errors={errors} />;
      case 3:
        return <OccupationalHealthStep formData={formData} updateFormData={updateFormData} errors={errors} />;
      case 4:
        return <MedicalConditionsStep formData={formData} updateFormData={updateFormData} errors={errors} />;
      case 5:
        return <FunctionalCapacityStep formData={formData} updateFormData={updateFormData} errors={errors} />;
      case 6:
        return <PsychologicalWellbeingStep formData={formData} updateFormData={updateFormData} errors={errors} />;
      case 7:
        return <FamilyVaccinationStep formData={formData} updateFormData={updateFormData} errors={errors} />;
      case 8:
        return <LifestyleReviewStep formData={formData} updateFormData={updateFormData} errors={errors} />;
      default:
        return null;
    }
  };

  if (tokenError) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <Card className="max-w-md w-full mx-4">
          <CardHeader>
            <CardTitle className="text-red-600">Link Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">{tokenError}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <Card className="max-w-md w-full mx-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle className="h-6 w-6" />
              Assessment Submitted
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600">
              Thank you — your responses have been submitted successfully.
              You may now close this page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8">
      <div className="container mx-auto max-w-4xl px-4">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Pre-Employment Health Assessment
          </h1>
          <p className="text-gray-600">
            Complete health screening for your new role
          </p>
        </div>

        {/* Progress Bar */}
        <Card className="mb-8">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm font-medium text-gray-700">
                Step {currentStep} of {formSteps.length}
              </span>
              <span className="text-sm text-gray-500">
                {Math.round(progress)}% Complete
              </span>
            </div>
            <Progress value={progress} className="mb-4" />

            {/* Step indicators */}
            <div className="flex items-center justify-between">
              {formSteps.map((step, index) => {
                const isCompleted = currentStep > step.id;
                const isCurrent = currentStep === step.id;
                const Icon = step.icon;

                return (
                  <div key={step.id} className="flex flex-col items-center">
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center border-2 mb-2",
                      isCompleted && "bg-green-500 border-green-500 text-white",
                      isCurrent && "bg-blue-500 border-blue-500 text-white",
                      !isCompleted && !isCurrent && "bg-gray-100 border-gray-300 text-gray-400"
                    )}>
                      {isCompleted ? (
                        <CheckCircle className="h-5 w-5" />
                      ) : (
                        <Icon className="h-5 w-5" />
                      )}
                    </div>
                    <span className={cn(
                      "text-xs text-center font-medium",
                      isCurrent && "text-blue-600",
                      isCompleted && "text-green-600",
                      !isCompleted && !isCurrent && "text-gray-400"
                    )}>
                      {step.title}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Current Step */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-3">
              {React.createElement(formSteps[currentStep - 1].icon, { className: "h-6 w-6 text-blue-600" })}
              {formSteps[currentStep - 1].title}
            </CardTitle>
            <p className="text-gray-600">{formSteps[currentStep - 1].description}</p>
          </CardHeader>
          <CardContent className="space-y-6">
            {renderStepContent()}
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex justify-between">
          <Button
            variant="outline"
            onClick={prevStep}
            disabled={currentStep === 1}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Previous
          </Button>

          {currentStep < formSteps.length ? (
            <Button onClick={nextStep}>
              Next
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="bg-green-600 hover:bg-green-700"
            >
              {isSubmitting ? 'Submitting...' : 'Submit Assessment'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// Step Components (I'll create these next)

interface StepProps {
  formData: FormData;
  updateFormData: (field: string, value: any) => void;
  errors: Record<string, string>;
}

function PersonalInformationStep({ formData, updateFormData, errors }: StepProps) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="firstName">First Name *</Label>
          <Input
            id="firstName"
            value={formData.firstName}
            onChange={(e) => updateFormData('firstName', e.target.value)}
            className={errors.firstName ? 'border-red-500' : ''}
          />
          {errors.firstName && <p className="text-red-500 text-sm mt-1">{errors.firstName}</p>}
        </div>
        <div>
          <Label htmlFor="lastName">Last Name *</Label>
          <Input
            id="lastName"
            value={formData.lastName}
            onChange={(e) => updateFormData('lastName', e.target.value)}
            className={errors.lastName ? 'border-red-500' : ''}
          />
          {errors.lastName && <p className="text-red-500 text-sm mt-1">{errors.lastName}</p>}
        </div>
      </div>

      <div>
        <Label htmlFor="email">Email Address *</Label>
        <Input
          id="email"
          type="email"
          value={formData.email}
          onChange={(e) => updateFormData('email', e.target.value)}
          className={errors.email ? 'border-red-500' : ''}
        />
        {errors.email && <p className="text-red-500 text-sm mt-1">{errors.email}</p>}
      </div>

      <div>
        <Label htmlFor="companyName">Company Name *</Label>
        <Input
          id="companyName"
          value={formData.companyName}
          onChange={(e) => updateFormData('companyName', e.target.value)}
          className={errors.companyName ? 'border-red-500' : ''}
        />
        {errors.companyName && <p className="text-red-500 text-sm mt-1">{errors.companyName}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor="age">Age *</Label>
          <Input
            id="age"
            type="number"
            value={formData.age}
            onChange={(e) => updateFormData('age', e.target.value)}
            className={errors.age ? 'border-red-500' : ''}
          />
          {errors.age && <p className="text-red-500 text-sm mt-1">{errors.age}</p>}
        </div>
        <div>
          <Label>Gender *</Label>
          <RadioGroup
            value={formData.gender}
            onValueChange={(value) => updateFormData('gender', value)}
            className="mt-2"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="man" id="man" />
              <Label htmlFor="man">Man</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="woman" id="woman" />
              <Label htmlFor="woman">Woman</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="non-binary" id="non-binary" />
              <Label htmlFor="non-binary">Non-binary</Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="self-describe" id="self-describe" />
              <Label htmlFor="self-describe">Self-describe</Label>
            </div>
          </RadioGroup>
          {errors.gender && <p className="text-red-500 text-sm mt-1">{errors.gender}</p>}
        </div>
      </div>

      <div>
        <Label htmlFor="roleAppliedFor">Role Applied For *</Label>
        <Input
          id="roleAppliedFor"
          value={formData.roleAppliedFor}
          onChange={(e) => updateFormData('roleAppliedFor', e.target.value)}
          className={errors.roleAppliedFor ? 'border-red-500' : ''}
        />
        {errors.roleAppliedFor && <p className="text-red-500 text-sm mt-1">{errors.roleAppliedFor}</p>}
      </div>
    </div>
  );
}

function WorkHistoryStep({ formData, updateFormData, errors }: StepProps) {
  const updateWorkHistory = (index: number, field: string, value: string) => {
    const newWorkHistory = [...formData.workHistory];
    newWorkHistory[index] = { ...newWorkHistory[index], [field]: value };
    updateFormData('workHistory', newWorkHistory);
  };

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h3 className="text-lg font-medium mb-2">Previous Employment History</h3>
        <p className="text-gray-600">Please provide details of your last three positions</p>
      </div>

      {formData.workHistory.map((job, index) => (
        <Card key={index} className="p-4 bg-gray-50">
          <h4 className="font-medium mb-4">Position {index + 1}</h4>
          <div className="space-y-4">
            <div>
              <Label htmlFor={`jobTitle${index}`}>Job Title</Label>
              <Input
                id={`jobTitle${index}`}
                value={job.jobTitle}
                onChange={(e) => updateWorkHistory(index, 'jobTitle', e.target.value)}
                placeholder="e.g., Warehouse Operator"
              />
            </div>
            <div>
              <Label htmlFor={`commonTasks${index}`}>Common Tasks Performed</Label>
              <Textarea
                id={`commonTasks${index}`}
                value={job.commonTasks}
                onChange={(e) => updateWorkHistory(index, 'commonTasks', e.target.value)}
                placeholder="Describe the main tasks and responsibilities..."
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor={`duration${index}`}>Duration of Employment</Label>
                <Input
                  id={`duration${index}`}
                  value={job.duration}
                  onChange={(e) => updateWorkHistory(index, 'duration', e.target.value)}
                  placeholder="e.g., 2 years 3 months"
                />
              </div>
              <div>
                <Label htmlFor={`year${index}`}>Approximate Year</Label>
                <Input
                  id={`year${index}`}
                  type="number"
                  value={job.year}
                  onChange={(e) => updateWorkHistory(index, 'year', e.target.value)}
                  placeholder="e.g., 2022"
                />
              </div>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function OccupationalHealthStep({ formData, updateFormData, errors }: StepProps) {
  return (
    <div className="space-y-8">
      <div className="text-center mb-6">
        <h3 className="text-lg font-medium mb-2">Occupational Health History</h3>
        <p className="text-gray-600">Information about work-related health matters</p>
      </div>

      {/* Work-Related Injuries */}
      <Card className="p-6 bg-blue-50 border-blue-200">
        <h4 className="font-medium text-blue-900 mb-4">Work-Related Injuries & Illness</h4>

        <div className="space-y-4">
          <div>
            <Label className="text-base">Have you ever had a work-related injury or illness?</Label>
            <RadioGroup
              value={formData.hasWorkInjury.toString()}
              onValueChange={(value) => updateFormData('hasWorkInjury', value === 'true')}
              className="mt-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="false" id="no-injury" />
                <Label htmlFor="no-injury">No</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="true" id="yes-injury" />
                <Label htmlFor="yes-injury">Yes</Label>
              </div>
            </RadioGroup>
          </div>

          {formData.hasWorkInjury && (
            <div>
              <Label htmlFor="workInjuryDetails">Please provide details of your work-related injury or illness</Label>
              <Textarea
                id="workInjuryDetails"
                value={formData.workInjuryDetails}
                onChange={(e) => updateFormData('workInjuryDetails', e.target.value)}
                placeholder="Describe the nature of the injury, when it occurred, and any ongoing effects..."
                className="mt-2"
              />
            </div>
          )}
        </div>
      </Card>

      {/* Hazardous Exposure */}
      <Card className="p-6 bg-orange-50 border-orange-200">
        <h4 className="font-medium text-orange-900 mb-4">Hazardous Substance Exposure</h4>

        <div className="space-y-4">
          <div>
            <Label className="text-base">Have you been exposed to hazardous substances at work?</Label>
            <RadioGroup
              value={formData.hasHazardousExposure.toString()}
              onValueChange={(value) => updateFormData('hasHazardousExposure', value === 'true')}
              className="mt-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="false" id="no-hazardous" />
                <Label htmlFor="no-hazardous">No</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="true" id="yes-hazardous" />
                <Label htmlFor="yes-hazardous">Yes</Label>
              </div>
            </RadioGroup>
          </div>

          <div>
            <Label className="text-base">Have you been exposed to crystalline silica?</Label>
            <RadioGroup
              value={formData.hasSilicaExposure}
              onValueChange={(value) => updateFormData('hasSilicaExposure', value)}
              className="mt-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="no" id="no-silica" />
                <Label htmlFor="no-silica">No</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="yes" id="yes-silica" />
                <Label htmlFor="yes-silica">Yes</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="not-sure" id="not-sure-silica" />
                <Label htmlFor="not-sure-silica">Not sure</Label>
              </div>
            </RadioGroup>
          </div>
        </div>
      </Card>

      {/* WorkCover Claims */}
      <Card className="p-6 bg-red-50 border-red-200">
        <h4 className="font-medium text-red-900 mb-4">WorkCover Claims History</h4>

        <div className="space-y-4">
          <div>
            <Label className="text-base">Have you ever made a WorkCover claim?</Label>
            <RadioGroup
              value={formData.hasWorkcoverClaims.toString()}
              onValueChange={(value) => updateFormData('hasWorkcoverClaims', value === 'true')}
              className="mt-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="false" id="no-workcover" />
                <Label htmlFor="no-workcover">No</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="true" id="yes-workcover" />
                <Label htmlFor="yes-workcover">Yes</Label>
              </div>
            </RadioGroup>
          </div>

          {formData.hasWorkcoverClaims && (
            <div>
              <Label htmlFor="workcoverDetails">Please provide details of your WorkCover claims</Label>
              <Textarea
                id="workcoverDetails"
                value={formData.workcoverDetails}
                onChange={(e) => updateFormData('workcoverDetails', e.target.value)}
                placeholder="Include dates, nature of claims, and current status..."
                className="mt-2"
              />
            </div>
          )}

          <div>
            <Label className="text-base">Would this position require time off work for medical appointments?</Label>
            <RadioGroup
              value={formData.requiresTimeOff.toString()}
              onValueChange={(value) => updateFormData('requiresTimeOff', value === 'true')}
              className="mt-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="false" id="no-time-off" />
                <Label htmlFor="no-time-off">No</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="true" id="yes-time-off" />
                <Label htmlFor="yes-time-off">Yes</Label>
              </div>
            </RadioGroup>
          </div>
        </div>
      </Card>
    </div>
  );
}

function MedicalConditionsStep({ formData, updateFormData, errors }: StepProps) {
  const medicalConditionCategories = {
    musculoskeletal: [
      'Broken bones', 'Neck pain', 'Back pain', 'Joint stiffness',
      'Arm/shoulder pain', 'Leg/foot pain', 'Arthritis', 'Other muscle/bone problems'
    ],
    neurological: [
      'Sleep apnea', 'Epilepsy', 'Dizziness/vertigo', 'Chronic headaches/migraines',
      'Nerve problems', 'Other neurological conditions'
    ],
    mentalHealth: [
      'Anxiety disorders', 'Depression', 'Stress-related conditions',
      'PTSD', 'Bipolar disorder', 'Other mental health conditions'
    ],
    systemic: [
      'Allergies', 'Diabetes', 'Heart disease', 'High blood pressure',
      'Thyroid problems', 'Cancer', 'Autoimmune conditions', 'Kidney disease'
    ],
    sensory: [
      'Hearing loss', 'Vision problems', 'Eye disease', 'Balance problems'
    ]
  };

  const updateMedicalCondition = (category: keyof typeof formData.medicalConditions, condition: string, checked: boolean) => {
    const currentConditions = formData.medicalConditions[category];
    const updatedConditions = checked
      ? [...currentConditions, condition]
      : currentConditions.filter(c => c !== condition);

    updateFormData('medicalConditions', {
      ...formData.medicalConditions,
      [category]: updatedConditions
    });
  };

  return (
    <div className="space-y-8">
      <div className="text-center mb-6">
        <h3 className="text-lg font-medium mb-2">Medical Conditions</h3>
        <p className="text-gray-600">Please indicate any current or past medical conditions</p>
      </div>

      {/* Musculoskeletal Conditions */}
      <Card className="p-6 bg-green-50 border-green-200">
        <h4 className="font-medium text-green-900 mb-4">Musculoskeletal Conditions</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {medicalConditionCategories.musculoskeletal.map((condition) => (
            <div key={condition} className="flex items-center space-x-2">
              <Checkbox
                id={`musculoskeletal-${condition}`}
                checked={formData.medicalConditions.musculoskeletal.includes(condition)}
                onCheckedChange={(checked) => updateMedicalCondition('musculoskeletal', condition, checked as boolean)}
              />
              <Label htmlFor={`musculoskeletal-${condition}`} className="text-sm">{condition}</Label>
            </div>
          ))}
        </div>
      </Card>

      {/* Neurological Conditions */}
      <Card className="p-6 bg-purple-50 border-purple-200">
        <h4 className="font-medium text-purple-900 mb-4">Neurological Conditions</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {medicalConditionCategories.neurological.map((condition) => (
            <div key={condition} className="flex items-center space-x-2">
              <Checkbox
                id={`neurological-${condition}`}
                checked={formData.medicalConditions.neurological.includes(condition)}
                onCheckedChange={(checked) => updateMedicalCondition('neurological', condition, checked as boolean)}
              />
              <Label htmlFor={`neurological-${condition}`} className="text-sm">{condition}</Label>
            </div>
          ))}
        </div>
      </Card>

      {/* Mental Health Conditions */}
      <Card className="p-6 bg-blue-50 border-blue-200">
        <h4 className="font-medium text-blue-900 mb-4">Mental Health Conditions</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {medicalConditionCategories.mentalHealth.map((condition) => (
            <div key={condition} className="flex items-center space-x-2">
              <Checkbox
                id={`mental-${condition}`}
                checked={formData.medicalConditions.mentalHealth.includes(condition)}
                onCheckedChange={(checked) => updateMedicalCondition('mentalHealth', condition, checked as boolean)}
              />
              <Label htmlFor={`mental-${condition}`} className="text-sm">{condition}</Label>
            </div>
          ))}
        </div>
      </Card>

      {/* Systemic Conditions */}
      <Card className="p-6 bg-orange-50 border-orange-200">
        <h4 className="font-medium text-orange-900 mb-4">Systemic Conditions</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {medicalConditionCategories.systemic.map((condition) => (
            <div key={condition} className="flex items-center space-x-2">
              <Checkbox
                id={`systemic-${condition}`}
                checked={formData.medicalConditions.systemic.includes(condition)}
                onCheckedChange={(checked) => updateMedicalCondition('systemic', condition, checked as boolean)}
              />
              <Label htmlFor={`systemic-${condition}`} className="text-sm">{condition}</Label>
            </div>
          ))}
        </div>
      </Card>

      {/* Sensory Conditions */}
      <Card className="p-6 bg-yellow-50 border-yellow-200">
        <h4 className="font-medium text-yellow-900 mb-4">Vision & Hearing</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {medicalConditionCategories.sensory.map((condition) => (
            <div key={condition} className="flex items-center space-x-2">
              <Checkbox
                id={`sensory-${condition}`}
                checked={formData.medicalConditions.sensory.includes(condition)}
                onCheckedChange={(checked) => updateMedicalCondition('sensory', condition, checked as boolean)}
              />
              <Label htmlFor={`sensory-${condition}`} className="text-sm">{condition}</Label>
            </div>
          ))}
        </div>
      </Card>

      {/* Additional Information */}
      <div className="space-y-4">
        <div>
          <Label htmlFor="medicationDetails">Current Medications & Supplements</Label>
          <Textarea
            id="medicationDetails"
            value={formData.medicationDetails}
            onChange={(e) => updateFormData('medicationDetails', e.target.value)}
            placeholder="List any medications, vitamins, or supplements you currently take..."
            className="mt-2"
          />
        </div>

        <div>
          <Label htmlFor="surgicalHistory">Surgical History</Label>
          <Textarea
            id="surgicalHistory"
            value={formData.surgicalHistory}
            onChange={(e) => updateFormData('surgicalHistory', e.target.value)}
            placeholder="List any surgeries or medical procedures you've had..."
            className="mt-2"
          />
        </div>
      </div>

      {/* Pre-Employment Health Disclosure */}
      <Card className="p-6 bg-red-50 border-red-200">
        <h4 className="font-medium text-red-900 mb-4">Pre-Employment Health Disclosure (Victorian Legal Requirement)</h4>
        <div className="space-y-4">
          <RadioGroup
            value={formData.preEmploymentDisclosure}
            onValueChange={(value) => updateFormData('preEmploymentDisclosure', value)}
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="no-conditions" id="no-conditions" />
              <Label htmlFor="no-conditions" className="text-sm">
                I do not have any pre-existing medical conditions that may affect my ability to perform the role
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="have-conditions" id="have-conditions" />
              <Label htmlFor="have-conditions" className="text-sm">
                I have pre-existing medical conditions that may require workplace accommodations
              </Label>
            </div>
          </RadioGroup>

          {formData.preEmploymentDisclosure === 'have-conditions' && (
            <div>
              <Label htmlFor="conditionDetails">Please provide details of conditions requiring accommodation</Label>
              <Textarea
                id="conditionDetails"
                value={formData.conditionDetails}
                onChange={(e) => updateFormData('conditionDetails', e.target.value)}
                placeholder="Describe any conditions that may require workplace modifications or accommodations..."
                className="mt-2"
              />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

function FunctionalCapacityStep({ formData, updateFormData, errors }: StepProps) {
  const painAreas = [
    { key: 'arms', label: 'Arms' },
    { key: 'shoulders', label: 'Shoulders' },
    { key: 'upperBack', label: 'Upper Back' },
    { key: 'lowerBack', label: 'Lower Back' },
    { key: 'knees', label: 'Knees' },
    { key: 'legs', label: 'Legs' },
    { key: 'feet', label: 'Feet' }
  ];

  const updatePainRating = (area: string, value: number[]) => {
    updateFormData('painRatings', {
      ...formData.painRatings,
      [area]: value[0]
    });
  };

  return (
    <div className="space-y-8">
      <div className="text-center mb-6">
        <h3 className="text-lg font-medium mb-2">Functional Capacity Assessment</h3>
        <p className="text-gray-600">Physical capabilities and pain assessment</p>
      </div>

      {/* Pain Rating Scales */}
      <Card className="p-6 bg-red-50 border-red-200">
        <h4 className="font-medium text-red-900 mb-4">Current Pain Levels</h4>
        <p className="text-sm text-gray-600 mb-6">Rate your current pain level in each area (0 = No Pain, 10 = Severe Pain)</p>

        <div className="space-y-6">
          {painAreas.map(({ key, label }) => (
            <div key={key}>
              <div className="flex justify-between items-center mb-2">
                <Label className="text-base">{label}</Label>
                <Badge variant="outline" className="bg-white">
                  {formData.painRatings[key as keyof typeof formData.painRatings]}/10
                </Badge>
              </div>
              <Slider
                value={[formData.painRatings[key as keyof typeof formData.painRatings]]}
                onValueChange={(value) => updatePainRating(key, value)}
                max={10}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-gray-500 mt-1">
                <span>No Pain</span>
                <span>Severe Pain</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Pain History */}
      <Card className="p-6 bg-orange-50 border-orange-200">
        <h4 className="font-medium text-orange-900 mb-4">Pain History</h4>

        <div className="space-y-6">
          <div>
            <div className="flex justify-between items-center mb-2">
              <Label className="text-base">Pain intensity in the past week (average)</Label>
              <Badge variant="outline" className="bg-white">
                {formData.painIntensity}/10
              </Badge>
            </div>
            <Slider
              value={[formData.painIntensity]}
              onValueChange={(value) => updateFormData('painIntensity', value[0])}
              max={10}
              step={1}
              className="w-full"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <Label className="text-base">Average pain over the last 3 months</Label>
              <Badge variant="outline" className="bg-white">
                {formData.painHistory}/10
              </Badge>
            </div>
            <Slider
              value={[formData.painHistory]}
              onValueChange={(value) => updateFormData('painHistory', value[0])}
              max={10}
              step={1}
              className="w-full"
            />
          </div>

          <div>
            <Label className="text-base">How likely is it that your pain will persist or worsen?</Label>
            <RadioGroup
              value={formData.persistenceRisk}
              onValueChange={(value) => updateFormData('persistenceRisk', value)}
              className="mt-3"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="not-likely" id="not-likely" />
                <Label htmlFor="not-likely">Not likely</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="somewhat" id="somewhat" />
                <Label htmlFor="somewhat">Somewhat likely</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="highly" id="highly" />
                <Label htmlFor="highly">Highly likely</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="very" id="very" />
                <Label htmlFor="very">Very likely</Label>
              </div>
            </RadioGroup>
          </div>
        </div>
      </Card>

      {/* Functional Limitations */}
      <Card className="p-6 bg-blue-50 border-blue-200">
        <h4 className="font-medium text-blue-900 mb-4">Physical Capabilities</h4>

        <div className="space-y-6">
          <div>
            <Label className="text-base">Maximum lifting capacity</Label>
            <RadioGroup
              value={formData.liftingCapacity}
              onValueChange={(value) => updateFormData('liftingCapacity', value)}
              className="mt-3"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="under-5kg" id="under-5kg" />
                <Label htmlFor="under-5kg">Under 5kg</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="5-15kg" id="5-15kg" />
                <Label htmlFor="5-15kg">5-15kg</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="15-25kg" id="15-25kg" />
                <Label htmlFor="15-25kg">15-25kg</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="25-40kg" id="25-40kg" />
                <Label htmlFor="25-40kg">25-40kg</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="over-40kg" id="over-40kg" />
                <Label htmlFor="over-40kg">Over 40kg</Label>
              </div>
            </RadioGroup>
          </div>

          <div>
            <Label className="text-base">Walking distance without rest</Label>
            <RadioGroup
              value={formData.walkingDistance}
              onValueChange={(value) => updateFormData('walkingDistance', value)}
              className="mt-3"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="under-100m" id="under-100m" />
                <Label htmlFor="under-100m">Under 100 meters</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="100-500m" id="100-500m" />
                <Label htmlFor="100-500m">100-500 meters</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="500m-1km" id="500m-1km" />
                <Label htmlFor="500m-1km">500m - 1km</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="over-1km" id="over-1km" />
                <Label htmlFor="over-1km">Over 1km</Label>
              </div>
            </RadioGroup>
          </div>

          <div>
            <Label className="text-base">Sitting tolerance</Label>
            <RadioGroup
              value={formData.sittingTolerance}
              onValueChange={(value) => updateFormData('sittingTolerance', value)}
              className="mt-3"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="under-30min" id="under-30min" />
                <Label htmlFor="under-30min">Under 30 minutes</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="30min-1hr" id="30min-1hr" />
                <Label htmlFor="30min-1hr">30 minutes - 1 hour</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="1-2hr" id="1-2hr" />
                <Label htmlFor="1-2hr">1-2 hours</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="over-2hr" id="over-2hr" />
                <Label htmlFor="over-2hr">Over 2 hours</Label>
              </div>
            </RadioGroup>
          </div>
        </div>
      </Card>
    </div>
  );
}

function PsychologicalWellbeingStep({ formData, updateFormData, errors }: StepProps) {
  const wellbeingQuestions = [
    { key: 'fatigue', label: 'Feeling tired or having little energy' },
    { key: 'nervousness', label: 'Feeling nervous, anxious, or on edge' },
    { key: 'hopelessness', label: 'Feeling down, depressed, or hopeless' },
    { key: 'restlessness', label: 'Trouble relaxing or feeling restless' },
    { key: 'depression', label: 'Little interest or pleasure in doing things' },
    { key: 'sadness', label: 'Feeling sad or empty' },
    { key: 'worthlessness', label: 'Feeling worthless or guilty' }
  ];

  const mentalFunctionQuestions = [
    { key: 'attention', label: 'Attention and concentration' },
    { key: 'memory', label: 'Memory' },
    { key: 'judgment', label: 'Judgment and decision making' }
  ];

  const updateWellbeingRating = (key: string, value: string) => {
    updateFormData('wellbeingRatings', {
      ...formData.wellbeingRatings,
      [key]: value
    });
  };

  const updateMentalFunction = (key: string, value: string) => {
    updateFormData('mentalFunction', {
      ...formData.mentalFunction,
      [key]: value
    });
  };

  return (
    <div className="space-y-8">
      <div className="text-center mb-6">
        <h3 className="text-lg font-medium mb-2">Psychological Wellbeing</h3>
        <p className="text-gray-600">Mental health and cognitive function assessment</p>
      </div>

      {/* Wellbeing Assessment */}
      <Card className="p-6 bg-purple-50 border-purple-200">
        <h4 className="font-medium text-purple-900 mb-4">In the last 4 weeks, how often have you experienced:</h4>

        <div className="space-y-6">
          {wellbeingQuestions.map(({ key, label }) => (
            <div key={key}>
              <Label className="text-base mb-3 block">{label}</Label>
              <RadioGroup
                value={formData.wellbeingRatings[key as keyof typeof formData.wellbeingRatings]}
                onValueChange={(value) => updateWellbeingRating(key, value)}
                className="grid grid-cols-2 md:grid-cols-4 gap-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="never" id={`${key}-never`} />
                  <Label htmlFor={`${key}-never`} className="text-sm">Never</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="rarely" id={`${key}-rarely`} />
                  <Label htmlFor={`${key}-rarely`} className="text-sm">Rarely</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="sometimes" id={`${key}-sometimes`} />
                  <Label htmlFor={`${key}-sometimes`} className="text-sm">Sometimes</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="often" id={`${key}-often`} />
                  <Label htmlFor={`${key}-often`} className="text-sm">Often</Label>
                </div>
              </RadioGroup>
            </div>
          ))}
        </div>
      </Card>

      {/* Mental Function Assessment */}
      <Card className="p-6 bg-blue-50 border-blue-200">
        <h4 className="font-medium text-blue-900 mb-4">Mental Function Assessment</h4>
        <p className="text-sm text-gray-600 mb-6">How would you rate your current:</p>

        <div className="space-y-6">
          {mentalFunctionQuestions.map(({ key, label }) => (
            <div key={key}>
              <Label className="text-base mb-3 block">{label}</Label>
              <RadioGroup
                value={formData.mentalFunction[key as keyof typeof formData.mentalFunction]}
                onValueChange={(value) => updateMentalFunction(key, value)}
                className="grid grid-cols-2 md:grid-cols-4 gap-2"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="excellent" id={`${key}-excellent`} />
                  <Label htmlFor={`${key}-excellent`} className="text-sm">Excellent</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="good" id={`${key}-good`} />
                  <Label htmlFor={`${key}-good`} className="text-sm">Good</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="fair" id={`${key}-fair`} />
                  <Label htmlFor={`${key}-fair`} className="text-sm">Fair</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="poor" id={`${key}-poor`} />
                  <Label htmlFor={`${key}-poor`} className="text-sm">Poor</Label>
                </div>
              </RadioGroup>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <Label htmlFor="additionalComments">Additional Mental Health Comments</Label>
          <Textarea
            id="additionalComments"
            value={formData.additionalComments}
            onChange={(e) => updateFormData('additionalComments', e.target.value)}
            placeholder="Any additional information about your mental health or cognitive function..."
            className="mt-2"
          />
        </div>
      </Card>
    </div>
  );
}

function FamilyVaccinationStep({ formData, updateFormData, errors }: StepProps) {
  const familyHistoryOptions = [
    'Diabetes', 'Heart disease', 'Stroke', 'Asthma', 'Epilepsy',
    'Tuberculosis', 'Hypertension', 'Eczema/Hay fever', 'Cancer', 'Other'
  ];

  const vaccinationOptions = [
    'Tetanus', 'Influenza (annual)', 'Hepatitis A', 'Hepatitis B',
    'COVID-19', 'Polio', 'Tuberculosis (BCG)', 'Measles/Mumps/Rubella',
    'Pneumococcal', 'Other'
  ];

  const updateFamilyHistory = (condition: string, checked: boolean) => {
    const current = formData.familyHistory;
    const updated = checked
      ? [...current, condition]
      : current.filter(c => c !== condition);
    updateFormData('familyHistory', updated);
  };

  const updateVaccinations = (vaccine: string, checked: boolean) => {
    const current = formData.vaccinations;
    const updated = checked
      ? [...current, vaccine]
      : current.filter(v => v !== vaccine);
    updateFormData('vaccinations', updated);
  };

  return (
    <div className="space-y-8">
      <div className="text-center mb-6">
        <h3 className="text-lg font-medium mb-2">Family & Vaccination History</h3>
        <p className="text-gray-600">Family medical history and immunization records</p>
      </div>

      {/* Family Medical History */}
      <Card className="p-6 bg-green-50 border-green-200">
        <h4 className="font-medium text-green-900 mb-4">Family Medical History</h4>
        <p className="text-sm text-gray-600 mb-4">Select any conditions that run in your family:</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          {familyHistoryOptions.map((condition) => (
            <div key={condition} className="flex items-center space-x-2">
              <Checkbox
                id={`family-${condition}`}
                checked={formData.familyHistory.includes(condition)}
                onCheckedChange={(checked) => updateFamilyHistory(condition, checked as boolean)}
              />
              <Label htmlFor={`family-${condition}`} className="text-sm">{condition}</Label>
            </div>
          ))}
        </div>

        <div>
          <Label htmlFor="familyHistoryDetails">Additional Family History Details</Label>
          <Textarea
            id="familyHistoryDetails"
            value={formData.familyHistoryDetails}
            onChange={(e) => updateFormData('familyHistoryDetails', e.target.value)}
            placeholder="Please provide additional details about your family medical history..."
            className="mt-2"
          />
        </div>
      </Card>

      {/* Vaccination History */}
      <Card className="p-6 bg-blue-50 border-blue-200">
        <h4 className="font-medium text-blue-900 mb-4">Vaccination History</h4>
        <p className="text-sm text-gray-600 mb-4">Select all vaccinations you have received:</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          {vaccinationOptions.map((vaccine) => (
            <div key={vaccine} className="flex items-center space-x-2">
              <Checkbox
                id={`vaccine-${vaccine}`}
                checked={formData.vaccinations.includes(vaccine)}
                onCheckedChange={(checked) => updateVaccinations(vaccine, checked as boolean)}
              />
              <Label htmlFor={`vaccine-${vaccine}`} className="text-sm">{vaccine}</Label>
            </div>
          ))}
        </div>

        <div>
          <Label htmlFor="vaccinationDetails">Vaccination Details & Dates</Label>
          <Textarea
            id="vaccinationDetails"
            value={formData.vaccinationDetails}
            onChange={(e) => updateFormData('vaccinationDetails', e.target.value)}
            placeholder="Please provide dates and additional details about your vaccinations..."
            className="mt-2"
          />
        </div>
      </Card>
    </div>
  );
}

function LifestyleReviewStep({ formData, updateFormData, errors }: StepProps) {
  return (
    <div className="space-y-8">
      <div className="text-center mb-6">
        <h3 className="text-lg font-medium mb-2">Lifestyle & Final Review</h3>
        <p className="text-gray-600">Lifestyle factors and assessment summary</p>
      </div>

      {/* Smoking History */}
      <Card className="p-6 bg-red-50 border-red-200">
        <h4 className="font-medium text-red-900 mb-4">Smoking History</h4>

        <div className="space-y-4">
          <div>
            <Label className="text-base">Do you currently smoke?</Label>
            <RadioGroup
              value={formData.smoker.toString()}
              onValueChange={(value) => updateFormData('smoker', value === 'true')}
              className="mt-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="false" id="no-smoking" />
                <Label htmlFor="no-smoking">No</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="true" id="yes-smoking" />
                <Label htmlFor="yes-smoking">Yes</Label>
              </div>
            </RadioGroup>
          </div>

          {formData.smoker && (
            <div>
              <Label htmlFor="smokingDetails">Smoking Details</Label>
              <Textarea
                id="smokingDetails"
                value={formData.smokingDetails}
                onChange={(e) => updateFormData('smokingDetails', e.target.value)}
                placeholder="How much and for how long have you been smoking?"
                className="mt-2"
              />
            </div>
          )}

          <div>
            <Label className="text-base">Have you smoked in the past?</Label>
            <RadioGroup
              value={formData.formerSmoker.toString()}
              onValueChange={(value) => updateFormData('formerSmoker', value === 'true')}
              className="mt-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="false" id="never-smoked" />
                <Label htmlFor="never-smoked">No, never smoked</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="true" id="former-smoker" />
                <Label htmlFor="former-smoker">Yes, former smoker</Label>
              </div>
            </RadioGroup>
          </div>

          {formData.formerSmoker && (
            <div>
              <Label htmlFor="smokingCessationDate">When did you quit smoking?</Label>
              <Textarea
                id="smokingCessationDate"
                value={formData.smokingCessationDate}
                onChange={(e) => updateFormData('smokingCessationDate', e.target.value)}
                placeholder="Approximate date when you stopped smoking..."
                className="mt-2"
              />
            </div>
          )}
        </div>
      </Card>

      {/* Alcohol Consumption */}
      <Card className="p-6 bg-orange-50 border-orange-200">
        <h4 className="font-medium text-orange-900 mb-4">Alcohol Consumption</h4>

        <div className="space-y-4">
          <div>
            <Label className="text-base">Do you drink alcohol?</Label>
            <RadioGroup
              value={formData.drinksAlcohol.toString()}
              onValueChange={(value) => updateFormData('drinksAlcohol', value === 'true')}
              className="mt-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="false" id="no-alcohol" />
                <Label htmlFor="no-alcohol">No</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="true" id="yes-alcohol" />
                <Label htmlFor="yes-alcohol">Yes</Label>
              </div>
            </RadioGroup>
          </div>

          {formData.drinksAlcohol && (
            <div>
              <Label className="text-base">How often do you drink alcohol?</Label>
              <RadioGroup
                value={formData.drinkingFrequency}
                onValueChange={(value) => updateFormData('drinkingFrequency', value)}
                className="mt-3"
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="less-than-weekly" id="less-than-weekly" />
                  <Label htmlFor="less-than-weekly">Less than once per week</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="weekly" id="weekly" />
                  <Label htmlFor="weekly">1-2 times per week</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="several-weekly" id="several-weekly" />
                  <Label htmlFor="several-weekly">3-4 times per week</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="daily" id="daily" />
                  <Label htmlFor="daily">Daily</Label>
                </div>
              </RadioGroup>
            </div>
          )}
        </div>
      </Card>

      {/* Final Review Summary */}
      <Card className="p-6 bg-green-50 border-green-200">
        <h4 className="font-medium text-green-900 mb-4">Assessment Summary</h4>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="font-medium">Name:</span>
            <span>{formData.firstName} {formData.lastName}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium">Company:</span>
            <span>{formData.companyName}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium">Role:</span>
            <span>{formData.roleAppliedFor}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium">Age:</span>
            <span>{formData.age}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium">Work Injury History:</span>
            <span>{formData.hasWorkInjury ? 'Yes' : 'No'}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium">WorkCover Claims:</span>
            <span>{formData.hasWorkcoverClaims ? 'Yes' : 'No'}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium">Current Smoker:</span>
            <span>{formData.smoker ? 'Yes' : 'No'}</span>
          </div>
        </div>

        <div className="mt-6 p-4 bg-white rounded-lg border">
          <h5 className="font-medium mb-2">Declaration</h5>
          <p className="text-sm text-gray-600">
            By submitting this assessment, I declare that the information provided is true and complete to the best of my knowledge.
            I understand that providing false or misleading information may result in the termination of my employment.
          </p>
        </div>
      </Card>
    </div>
  );
}