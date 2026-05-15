import React, { useState, useRef } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchWithCsrf } from "@/lib/queryClient";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceDot,
  ComposedChart,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatWeekAsMonthYear } from "@/lib/dateUtils";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  TrendingUp,
  TrendingDown,
  Minus,
  Calendar,
  Activity,
  Stethoscope,
  FileText,
  X,
  Upload,
  Loader2,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";

// Types matching the server-side RecoveryTimelineChartData
interface ChartDataPoint {
  date: string;
  week: number;
  estimatedCapacity: number;
  actualCapacity: number | null;
  label?: string;
}

type RestrictionCapability = "can" | "with_modifications" | "cannot" | "not_assessed";

interface FunctionalRestrictions {
  sitting: RestrictionCapability;
  standingWalking: RestrictionCapability;
  bending: RestrictionCapability;
  squatting: RestrictionCapability;
  kneelingClimbing: RestrictionCapability;
  twisting: RestrictionCapability;
  reachingOverhead: RestrictionCapability;
  reachingForward: RestrictionCapability;
  neckMovement: RestrictionCapability;
  lifting: RestrictionCapability;
  liftingMaxKg?: number;
  carrying: RestrictionCapability;
  pushing: RestrictionCapability;
  pulling: RestrictionCapability;
  repetitiveMovements: RestrictionCapability;
  useOfInjuredLimb: RestrictionCapability;
  maxWorkHoursPerDay?: number;
  maxWorkDaysPerWeek?: number;
}

interface CertificateMarker {
  date: string;
  endDate: string;
  week: number;
  capacity: number;
  certificateNumber: number;
  capacityLabel: string;
  color: string;
  certificateId: string;
  documentUrl?: string | null;
  functionalRestrictions?: FunctionalRestrictions | null;
}

interface RecoveryPhaseDisplay {
  name: string;
  weekStart: number;
  weekEnd: number;
  color: string;
  status: "completed" | "in_progress" | "upcoming";
  milestones: Array<{
    description: string;
    completed: boolean;
    completedDate?: string;
    type?: "clinical" | "case_management";
  }>;
}

interface RecoveryOverride {
  id: string;
  caseId: string;
  originalEstimateWeeks: number;
  adjustedEstimateWeeks: number;
  reason: string;
  factors: string[];
  overriddenBy: string;
  overriddenAt: string;
}

interface DiagnosticRecommendation {
  severity: "info" | "warning" | "critical";
  title: string;
  description: string;
  suggestedAction: string;
  relatedTests?: string[];
  specialistReferral?: string;
}

interface RecoveryAnalysis {
  comparedToExpected: "ahead" | "on_track" | "behind" | "insufficient_data";
  weeksDifference: number | null;
  trend: "improving" | "stable" | "declining" | "unknown";
  message: string;
}

interface RecoveryTimelineChartData {
  caseId: string;
  workerName: string;
  injuryType: string;
  injuryTypeLabel: string;
  injuryDate: string;
  currentDate: string;
  weeksElapsed: number;
  estimatedWeeks: number;
  estimatedRTWDate: string;
  confidence: "low" | "medium" | "high";
  estimatedCurve: ChartDataPoint[];
  actualCurve: ChartDataPoint[];
  certificateMarkers: CertificateMarker[];
  phases: RecoveryPhaseDisplay[];
  currentPhase: string;
  analysis: RecoveryAnalysis;
  diagnosticRecommendations: DiagnosticRecommendation[];
  riskFactors: string[];
  suggestedDiagnosticTests: string[];
  potentialSpecialistReferrals: string[];
  // Dashboard display fields
  currentCapacityPercentage: number;
  weeksOffWork: number;
  riskCategory: "High" | "Medium" | "Low";
  // Clinical override (optional — present when AHR has adjusted timeline)
  recoveryOverride?: RecoveryOverride;
  adjustedEstimateWeeks?: number;
  adjustedCurve?: ChartDataPoint[];
}

interface DynamicRecoveryTimelineProps {
  caseId: string;
  className?: string;
  readOnly?: boolean;
}

// Enhanced custom tooltip for the chart with modern styling
const CustomTooltip = ({ active, payload, label, injuryDate }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="custom-tooltip bg-white/95 backdrop-blur-md p-4 border border-white/20 rounded-xl shadow-2xl backdrop-saturate-150">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 bg-gradient-to-r from-purple-400 to-blue-400 rounded-full"></div>
          <p className="font-bold text-sm text-gray-900">{formatWeekAsMonthYear(label, injuryDate || new Date())}</p>
        </div>
        <div className="space-y-2">
          {payload.map((entry: any, index: number) => (
            <div key={index} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: entry.color }}
                ></div>
                <span className="text-sm font-medium text-gray-700">
                  {entry.name}
                </span>
              </div>
              <span
                className="text-sm font-bold min-w-[3rem] text-right"
                style={{ color: entry.color }}
              >
                {entry.value !== null ? `${Math.round(entry.value)}%` : 'N/A'}
              </span>
            </div>
          ))}
        </div>
        {payload.some((entry: any) => entry.payload?.isMissingCertificate) && (
          <div className="mt-3 pt-2 border-t border-gray-200">
            <div className="flex items-center gap-2 text-xs text-red-600">
              <div className="w-2 h-2 bg-red-500 rounded-full"></div>
              <span>Estimated data (missing certificate)</span>
            </div>
          </div>
        )}
      </div>
    );
  }
  return null;
};

// Severity icon component
const SeverityIcon = ({ severity }: { severity: string }) => {
  switch (severity) {
    case "critical":
      return <AlertCircle className="h-5 w-5 text-red-500" />;
    case "warning":
      return <AlertTriangle className="h-5 w-5 text-amber-500" />;
    default:
      return <Info className="h-5 w-5 text-blue-500" />;
  }
};

// Trend icon component
const TrendIcon = ({ trend }: { trend: string }) => {
  switch (trend) {
    case "improving":
      return <TrendingUp className="h-4 w-4 text-emerald-500" />;
    case "declining":
      return <TrendingDown className="h-4 w-4 text-red-500" />;
    default:
      return <Minus className="h-4 w-4 text-gray-400" />;
  }
};

export const DynamicRecoveryTimeline: React.FC<DynamicRecoveryTimelineProps> = ({
  caseId,
  className,
  readOnly = false,
}) => {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data, isLoading, error } = useQuery<RecoveryTimelineChartData>({
    queryKey: [`/api/cases/${caseId}/recovery-chart`],
    enabled: !!caseId,
  });

  const [selectedCertificate, setSelectedCertificate] = useState<CertificateMarker | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [overrideWeeks, setOverrideWeeks] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideFactors, setOverrideFactors] = useState<string[]>([]);
  const [isSubmittingOverride, setIsSubmittingOverride] = useState(false);

  const OVERRIDE_FACTORS = [
    "Comorbidities",
    "Age-related factors",
    "Psychological overlay",
    "Surgical intervention required",
    "Treatment complications",
    "Stronger than expected recovery",
    "Other",
  ] as const;

  // Mutation to upload certificate image
  const uploadImageMutation = useMutation({
    mutationFn: async ({ certificateId, imageData }: { certificateId: string; imageData: string }) => {
      const response = await fetchWithCsrf(`/api/certificates/${certificateId}/image`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData }),
      });
      if (!response.ok) {
        throw new Error("Failed to upload certificate image");
      }
      return response.json();
    },
    onSuccess: (data) => {
      // Update the selected certificate with the new image URL
      if (selectedCertificate) {
        setSelectedCertificate({ ...selectedCertificate, documentUrl: data.documentUrl });
      }
      // Refresh the recovery chart data
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/recovery-chart`] });
    },
  });

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !selectedCertificate) return;

    // Validate file type
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      alert("Please select an image or PDF file");
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert("File size must be less than 5MB");
      return;
    }

    setIsUploading(true);
    try {
      // Convert file to base64
      const reader = new FileReader();
      reader.onload = async () => {
        const base64Data = reader.result as string;
        await uploadImageMutation.mutateAsync({
          certificateId: selectedCertificate.certificateId,
          imageData: base64Data,
        });
        setIsUploading(false);
      };
      reader.onerror = () => {
        alert("Failed to read file");
        setIsUploading(false);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setIsUploading(false);
      alert("Failed to upload image");
    }

    // Reset file input
    event.target.value = "";
  };

  const handleOverrideSubmit = async () => {
    const weeks = parseInt(overrideWeeks, 10);
    if (!weeks || weeks < 1 || weeks > 260) return;
    if (!overrideReason.trim()) return;
    setIsSubmittingOverride(true);
    try {
      const response = await fetchWithCsrf(`/api/cases/${caseId}/recovery-override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adjustedEstimateWeeks: weeks, reason: overrideReason, factors: overrideFactors }),
      });
      if (!response.ok) throw new Error("Failed to save override");
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/recovery-chart`] });
      setShowOverrideForm(false);
      setOverrideWeeks("");
      setOverrideReason("");
      setOverrideFactors([]);
    } catch {
      // silent — user can retry
    } finally {
      setIsSubmittingOverride(false);
    }
  };

  if (isLoading) {
    return (
      <div className={cn("space-y-4", className)}>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error loading recovery timeline</AlertTitle>
        <AlertDescription>
          Unable to load recovery data for this case. Please try again later.
        </AlertDescription>
      </Alert>
    );
  }

  // Prepare chart data with missing certificate detection and assumptions - ONLY show up to current week
  const chartData = data.estimatedCurve
    .filter(point => point.week <= (data.weeksElapsed || 0))  // Only show up to current week
    .map((point) => {
    const actualPoint = data.actualCurve.find((a) => a.week === point.week);
    const certificateExists = data.certificateMarkers.some(cert =>
      Math.abs(cert.week - point.week) <= 0.5 // Allow for slight week variations
    );

    // If no actual data but we're past week 1, make assumption based on trend
    let actualValue = actualPoint?.actualCapacity ?? null;
    let isMissingCertificate = false;

    if (!actualPoint && point.week <= data.weeksElapsed) {
      // We should have data for this week but don't - missing certificate
      isMissingCertificate = true;

      // Make assumption: interpolate between known points or use estimated value
      const previousActual = data.actualCurve
        .filter(p => p.week < point.week)
        .sort((a, b) => b.week - a.week)[0];

      if (previousActual) {
        // Linear interpolation assumption
        const weekDiff = point.week - previousActual.week;
        const estimatedProgress = point.estimatedCapacity - previousActual.actualCapacity;
        actualValue = Math.max(0, previousActual.actualCapacity + (estimatedProgress * 0.7)); // Conservative 70% of estimated progress
      } else {
        // No previous data, assume starting at low capacity
        actualValue = point.week === 1 ? 0 : point.estimatedCapacity * 0.5;
      }
    }

    return {
      week: point.week,
      estimated: point.estimatedCapacity,
      actual: actualValue,
      isMissingCertificate,
      certificateExists,
    };
  });

  // Ensure week 1 always has actual value (even if assumed)
  const week1Point = chartData.find(p => p.week === 1);
  if (week1Point && week1Point.actual === null) {
    week1Point.actual = 0; // Start at 0% capacity
    week1Point.isMissingCertificate = !week1Point.certificateExists;
  }

  // Add any actual points that might be beyond the estimated curve - ONLY up to current week
  data.actualCurve
    .filter(actualPoint => actualPoint.week <= (data.weeksElapsed || 0))  // Only show up to current week
    .forEach((actualPoint) => {
    if (!chartData.find((c) => c.week === actualPoint.week)) {
      const certificateExists = data.certificateMarkers.some(cert =>
        Math.abs(cert.week - actualPoint.week) <= 0.5
      );

      chartData.push({
        week: actualPoint.week,
        estimated: null as any,
        actual: actualPoint.actualCapacity,
        isMissingCertificate: false,
        certificateExists,
      });
    }
  });

  // Sort by week
  chartData.sort((a, b) => a.week - b.week);

  // Format date for display
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case "ahead":
        return "bg-emerald-100 text-emerald-800 border-emerald-300";
      case "on_track":
        return "bg-blue-100 text-blue-800 border-blue-300";
      case "behind":
        return "bg-amber-100 text-amber-800 border-amber-300";
      default:
        return "bg-gray-100 text-gray-800 border-gray-300";
    }
  };

  // Get confidence badge color
  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case "high":
        return "bg-emerald-100 text-emerald-800";
      case "medium":
        return "bg-amber-100 text-amber-800";
      default:
        return "bg-red-100 text-red-800";
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className={cn(
        "hero-motion-container immersive-hero-container space-y-6",
        "min-h-[80vh] relative overflow-hidden",
        "bg-gradient-to-br from-purple-900/20 via-blue-900/20 to-teal-900/20",
        "before:absolute before:inset-0 before:bg-gradient-mesh before:opacity-20 before:animate-gradient",
        className
      )}>

      {/* Background particle effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl animate-pulse-slow"></div>
        <div className="absolute bottom-1/3 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl animate-float"></div>
        <div className="absolute top-1/2 left-1/2 w-80 h-80 bg-teal-500/10 rounded-full blur-3xl animate-gradient"></div>
        {/* Gradient overlays for enhanced animation effects */}
        <div className="gradient-overlay absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-blue-500/5 animate-gradient"></div>
        <div className="gradient-overlay absolute inset-0 bg-gradient-to-tl from-teal-500/5 via-transparent to-purple-500/5 animate-pulse-slow"></div>
      </div>

      {/* Main content */}
      <div className="relative z-10 space-y-6">
        {/* Hero Typography Section */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="hero-title text-4xl font-bold text-white mb-2 flex items-center gap-3">
            <Activity className="h-8 w-8 text-white/90" />
            Recovery Dashboard
          </h1>
          <h2 className="text-xl font-semibold text-white/90 mb-1">
            {data.injuryTypeLabel} Recovery Timeline
          </h2>
          <p className="text-sm text-white/70 mt-1">
            Injury Date: {formatDate(data.injuryDate)} | Duration: {data.weeksElapsed} weeks
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {(() => {
            // When cert data is absent, fall back to elapsed vs estimated to determine status
            const overdue = data.weeksElapsed > (data.estimatedWeeks || 0);
            const derivedStatus = data.analysis.comparedToExpected === "ahead" ? "ahead"
              : data.analysis.comparedToExpected === "on_track" ? "on_track"
              : (data.analysis.comparedToExpected === "behind" || overdue) ? "behind"
              : "unknown";
            return (
              <Badge className={getStatusColor(derivedStatus)}>
                {derivedStatus === "ahead" ? "Ahead of Schedule"
                  : derivedStatus === "on_track" ? "On Track"
                  : derivedStatus === "behind" ? "Behind Schedule"
                  : "Assessment Needed"}
              </Badge>
            );
          })()}
          <Badge className={getConfidenceColor(data.confidence)}>
            {data.confidence.charAt(0).toUpperCase() + data.confidence.slice(1)} Confidence
          </Badge>
          {!readOnly && (
            <Button
              size="sm"
              variant="outline"
              className="bg-white/10 border-white/30 text-white hover:bg-white/20"
              onClick={() => setShowOverrideForm(true)}
            >
              <SlidersHorizontal className="h-4 w-4 mr-1" />
              Adjust Timeline
            </Button>
          )}
        </div>
      </div>

      {/* Enhanced Recovery Chart */}
      <motion.div
        className="animated-chart-container"
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
      >
      <Card className="enhanced-recovery-chart">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            Recovery Progress: Estimated vs Actual
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-72 relative">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 40 }}>
                <defs>
                  <linearGradient id="estimatedGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.8} />
                    <stop offset="50%" stopColor="#3b82f6" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#06b6d4" stopOpacity={0.2} />
                  </linearGradient>
                  <linearGradient id="actualGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.9} />
                    <stop offset="50%" stopColor="#059669" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#047857" stopOpacity={0.3} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="week"
                  tickFormatter={(w) => formatWeekAsMonthYear(w, data.injuryDate)}
                  label={{
                    value: "Timeline (Month/Year)",
                    position: "insideBottom",
                    offset: -5,
                    style: { fontSize: 11 },
                  }}
                />
                <YAxis
                  domain={[0, 100]}
                  label={{
                    value: "Work Capacity %",
                    angle: -90,
                    position: "insideLeft",
                    style: { fontSize: 12 },
                  }}
                />
                <Tooltip content={(props) => <CustomTooltip {...props} injuryDate={data.injuryDate} />} />
                <Legend verticalAlign="bottom" wrapperStyle={{ paddingTop: '20px' }} />

                {/* Estimated recovery area (dashed outline with gradient) */}
                <Area
                  type="monotone"
                  dataKey="estimated"
                  stroke="#8b5cf6"
                  strokeWidth={2}
                  strokeDasharray="8 4"
                  fill="url(#estimatedGradient)"
                  name="Estimated Recovery"
                  dot={false}
                />

                {/* Actual recovery area (solid with gradient) */}
                <Area
                  type="monotone"
                  dataKey="actual"
                  stroke="#10b981"
                  strokeWidth={3}
                  fill="url(#actualGradient)"
                  name="Actual Recovery"
                  dot={false}
                  connectNulls
                />

                {/* Certificate markers as independent clickable dots */}
                {data.certificateMarkers
                  .filter(marker => {
                    // Only show markers within the chart range and with valid data
                    return marker.week >= 0 &&
                           marker.week <= (data.weeksElapsed + 2) &&
                           marker.capacity >= 0 &&
                           marker.capacity <= 100;
                  })
                  .map((marker, index) => {
                    const isExpired = marker.endDate ? new Date(marker.endDate) < new Date() : false;
                    const markerFill = isExpired ? "#f59e0b" : "#3b82f6";
                    const tooltipLines = [
                      `Cert #${marker.certificateNumber} — ${new Date(marker.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`,
                      `Capacity: ${marker.capacityLabel}`,
                      isExpired ? "Status: Expired" : "Status: Current",
                    ].join("\n");

                    return (
                      <ReferenceDot
                        key={`cert-${marker.certificateId}-${index}`}
                        x={marker.week}
                        y={marker.capacity}
                        r={8}
                        fill={markerFill}
                        stroke="#ffffff"
                        strokeWidth={2.5}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setSelectedCertificate(marker)}
                        shape={(props: any) => {
                          const { cx, cy } = props;
                          return (
                            <g style={{ cursor: 'pointer' }} onClick={() => setSelectedCertificate(marker)}>
                              <title>{tooltipLines}</title>
                              <circle
                                cx={cx}
                                cy={cy}
                                r={8}
                                fill={markerFill}
                                stroke="#ffffff"
                                strokeWidth={2.5}
                              />
                              {/* Clipboard icon path scaled to fit inside 8px radius circle */}
                              <g transform={`translate(${cx - 5}, ${cy - 6})`}>
                                <rect x="2" y="1" width="7" height="9" rx="0.8" fill="none" stroke="#ffffff" strokeWidth="1" />
                                <rect x="3.5" y="0" width="4" height="2" rx="0.5" fill="#ffffff" />
                                <line x1="3.5" y1="4.5" x2="7.5" y2="4.5" stroke="#ffffff" strokeWidth="0.8" />
                                <line x1="3.5" y1="6.5" x2="7.5" y2="6.5" stroke="#ffffff" strokeWidth="0.8" />
                                <line x1="3.5" y1="8" x2="6" y2="8" stroke="#ffffff" strokeWidth="0.8" />
                              </g>
                            </g>
                          );
                        }}
                      />
                    );
                  })}

                {/* Current week marker */}
                <ReferenceLine
                  x={data.weeksElapsed}
                  stroke="#f97316"
                  strokeWidth={2}
                  strokeDasharray="4 2"
                  label={{
                    value: "Now",
                    position: "top",
                    fill: "#f97316",
                    fontSize: 11,
                  }}
                />

                {/* Expected RTW marker */}
                <ReferenceLine
                  x={data.estimatedWeeks}
                  stroke="#8b5cf6"
                  strokeWidth={1}
                  strokeDasharray="4 4"
                  label={{
                    value: "Est. RTW",
                    position: "top",
                    fill: "#8b5cf6",
                    fontSize: 10,
                  }}
                />

                {/* Adjusted RTW marker (when override set) */}
                {data.adjustedEstimateWeeks && data.adjustedEstimateWeeks !== data.estimatedWeeks && (
                  <ReferenceLine
                    x={data.adjustedEstimateWeeks}
                    stroke="#059669"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    label={{
                      value: "Adj. RTW",
                      position: "top",
                      fill: "#059669",
                      fontSize: 10,
                    }}
                  />
                )}

                {/* Compliance deadline markers */}
                {[
                  { week: 10, label: "RTW Plan", color: "#3b82f6" },
                  { week: 13, label: "Pay ↓", color: "#f59e0b" },
                  { week: 52, label: "52wk ↓", color: "#ef4444" },
                  { week: 130, label: "130wk", color: "#dc2626" },
                ].map((dl) => (
                  <ReferenceLine
                    key={dl.label}
                    x={dl.week}
                    stroke={dl.color}
                    strokeWidth={1}
                    strokeDasharray="2 4"
                    strokeOpacity={0.6}
                    label={{
                      value: dl.label,
                      position: "insideTopRight",
                      fill: dl.color,
                      fontSize: 9,
                    }}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Certificate markers legend */}
          <div className="mt-4">
            <div className="text-xs font-medium text-gray-600 mb-2">
              Medical Certificates ({data.certificateMarkers.length})
              {data.certificateMarkers.length === 0 && (
                <span className="text-amber-600 ml-2">(No certificates found - dots won't be visible)</span>
              )}
            </div>
            {data.certificateMarkers.length > 0 ? (
              <div className="max-h-32 overflow-y-auto flex flex-wrap gap-2 p-2 bg-gray-50 rounded-lg">
                {data.certificateMarkers.map((marker) => {
                  const isExpired = marker.endDate ? new Date(marker.endDate) < new Date() : false;
                  const chipColor = isExpired ? "#f59e0b" : "#3b82f6";
                  return (
                    <div
                      key={marker.certificateNumber}
                      className="flex items-center gap-2 text-xs bg-white px-2 py-1 rounded border cursor-pointer hover:bg-gray-100 transition-colors"
                      onClick={() => setSelectedCertificate(marker)}
                    >
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: chipColor }}
                      />
                      <span className="whitespace-nowrap">
                        #{marker.certificateNumber} - Week {marker.week} - {marker.capacity}%{isExpired ? " (expired)" : ""}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-600">
                No medical certificates uploaded yet. Upload a certificate to see recovery milestones on the timeline.
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      </motion.div>

      {/* Summary Row — replaces glass panels and progress rings */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 px-1 py-3 bg-white/10 rounded-xl text-sm text-white/90 border border-white/20">
        <span>
          <span className="font-semibold">Week {Math.floor(data.weeksOffWork || 0)}</span>
          {" "}of ~{data.adjustedEstimateWeeks || data.estimatedWeeks} expected
        </span>
        <span className="text-white/40">|</span>
        <span>
          Capacity:{" "}
          <span className="font-semibold">{data.currentCapacityPercentage || 0}%</span>
        </span>
        <span className="text-white/40">|</span>
        <span>
          Phase:{" "}
          <span className="font-semibold">{data.currentPhase || "Active Recovery"}</span>
        </span>
        <span className="text-white/40">|</span>
        <span className={cn(
          "font-semibold",
          data.riskCategory === "High" ? "text-red-300" :
          data.riskCategory === "Medium" ? "text-amber-300" :
          "text-emerald-300"
        )}>
          Risk: {data.riskCategory || "Unknown"}
        </span>
        {data.recoveryOverride && (
          <>
            <span className="text-white/40">|</span>
            <span className="text-emerald-300 text-xs flex items-center gap-1">
              <SlidersHorizontal className="h-3 w-3" />
              Timeline adjusted by clinician
            </span>
          </>
        )}
      </div>

      {/* Analysis Summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Stethoscope className="h-4 w-4" />
            Recovery Analysis
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-3">
            <TrendIcon trend={data.analysis.trend} />
            <div>
              <p className="text-sm">{data.analysis.message}</p>
              <p className="text-xs text-slate-600 mt-1">
                Trend: <span className="font-medium capitalize">{data.analysis.trend}</span>
                {data.analysis.weeksDifference !== null && (
                  <> | Difference: {Math.abs(data.analysis.weeksDifference)} weeks</>
                )}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recovery Phases */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Recovery Phases
            <Badge variant="outline" className="ml-2 font-normal">
              Current: {data.currentPhase}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-4 top-6 bottom-6 w-0.5 bg-gradient-to-b from-red-500 via-amber-500 via-blue-500 to-emerald-500" />

            {/* Phases */}
            <div className="space-y-6">
              {data.phases.map((phase, index) => (
                <div key={index} className="relative flex items-start gap-4">
                  <div
                    className={cn(
                      "relative z-10 w-8 h-8 rounded-full flex items-center justify-center border-4",
                      phase.status === "completed"
                        ? "bg-white border-emerald-500"
                        : phase.status === "in_progress"
                        ? "bg-white border-blue-500"
                        : "bg-gray-100 border-gray-300"
                    )}
                  >
                    <div
                      className={cn(
                        "w-2 h-2 rounded-full",
                        phase.status === "completed"
                          ? "bg-emerald-500"
                          : phase.status === "in_progress"
                          ? "bg-blue-500"
                          : "bg-gray-400"
                      )}
                    />
                  </div>
                  <div className="flex-1 pb-4">
                    <div
                      className={cn(
                        "rounded-lg p-3 border",
                        phase.status === "completed"
                          ? "bg-emerald-50 border-emerald-200"
                          : phase.status === "in_progress"
                          ? "bg-blue-50 border-blue-200"
                          : "bg-gray-50 border-gray-200"
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <h4
                          className={cn(
                            "font-semibold text-sm",
                            phase.status === "completed"
                              ? "text-emerald-800"
                              : phase.status === "in_progress"
                              ? "text-blue-800"
                              : "text-gray-600"
                          )}
                        >
                          {phase.name}
                        </h4>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-xs",
                            phase.status === "completed"
                              ? "border-emerald-300 text-emerald-700"
                              : phase.status === "in_progress"
                              ? "border-blue-300 text-blue-700"
                              : "border-gray-300 text-gray-500"
                          )}
                        >
                          {formatWeekAsMonthYear(phase.weekStart, data.injuryDate)}-{formatWeekAsMonthYear(phase.weekEnd, data.injuryDate)}
                        </Badge>
                      </div>
                      <div className="space-y-1">
                        {phase.milestones
                          .filter((m) => !m.type || m.type === "clinical")
                          .slice(0, 3)
                          .map((milestone, mIdx) => (
                          <div key={mIdx} className="flex items-center gap-2 text-xs">
                            <span
                              className={cn(
                                "w-1.5 h-1.5 rounded-full",
                                milestone.completed ? "bg-emerald-500" : "bg-gray-300"
                              )}
                            />
                            <span
                              className={
                                milestone.completed ? "text-emerald-700" : "text-gray-600"
                              }
                            >
                              {milestone.description}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Diagnostic Recommendations */}
      {data.diagnosticRecommendations.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Diagnostic Recommendations
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.diagnosticRecommendations.map((rec, index) => (
                <Alert
                  key={index}
                  variant={rec.severity === "critical" ? "destructive" : "default"}
                  className={cn(
                    rec.severity === "warning" && "border-amber-300 bg-amber-50 text-amber-900",
                    rec.severity === "info" && "border-blue-300 bg-blue-50 text-blue-900"
                  )}
                >
                  <SeverityIcon severity={rec.severity} />
                  <AlertTitle className="text-sm font-semibold">{rec.title}</AlertTitle>
                  <AlertDescription className="text-xs mt-1">
                    <p className="text-slate-800 dark:text-slate-200">{rec.description}</p>
                    <p className="mt-2 font-medium text-slate-900 dark:text-slate-100">Action: {rec.suggestedAction}</p>
                    {rec.relatedTests && rec.relatedTests.length > 0 && (
                      <p className="mt-1 text-slate-700 dark:text-slate-300">
                        Suggested tests: {rec.relatedTests.join(", ")}
                      </p>
                    )}
                    {rec.specialistReferral && (
                      <p className="mt-1 text-slate-700 dark:text-slate-300">Specialist: {rec.specialistReferral}</p>
                    )}
                  </AlertDescription>
                </Alert>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Risk Factors & Resources */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Risk Factors for {data.injuryTypeLabel}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {data.riskFactors.map((factor, index) => (
                <li key={index} className="text-xs text-slate-600 flex items-center gap-2">
                  <span className="w-1 h-1 bg-amber-500 rounded-full" />
                  {factor}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Potential Specialist Referrals</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1">
              {data.potentialSpecialistReferrals.map((specialist, index) => (
                <li key={index} className="text-xs text-slate-600 flex items-center gap-2">
                  <span className="w-1 h-1 bg-blue-500 rounded-full" />
                  {specialist}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

        {/* Estimated RTW */}
        <div className="text-center text-sm border-t pt-4">
          {data.estimatedRTWDate && new Date(data.estimatedRTWDate) < new Date() ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-left">
              <p className="font-semibold text-red-700">
                RTW Not Achieved — {Math.round((Date.now() - new Date(data.estimatedRTWDate).getTime()) / (7 * 24 * 60 * 60 * 1000))} weeks overdue
              </p>
              <p className="text-xs text-red-600 mt-1">
                Expected return was <strong>{formatDate(data.estimatedRTWDate)}</strong> ({data.adjustedEstimateWeeks || data.estimatedWeeks} weeks from injury).
                Case has significantly exceeded the estimated recovery timeline — immediate escalation and case review required.
              </p>
            </div>
          ) : (
            <p className="text-slate-600">
              Estimated Return to Work: <strong>{formatDate(data.estimatedRTWDate)}</strong>
              {" "}({data.adjustedEstimateWeeks || data.estimatedWeeks} weeks from injury)
            </p>
          )}
          <p className="text-xs mt-1 text-slate-500">
            This timeline is advisory only and based on typical recovery patterns for{" "}
            {data.injuryTypeLabel.toLowerCase()}. Individual recovery may vary.
          </p>
        </div>
      </div>

      {/* Certificate Details Modal */}
      {selectedCertificate && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setSelectedCertificate(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-emerald-500 to-teal-500 px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FileText className="h-6 w-6 text-white" />
                <h3 className="text-lg font-semibold text-white">
                  Medical Certificate #{selectedCertificate.certificateNumber}
                </h3>
              </div>
              <button
                onClick={() => setSelectedCertificate(null)}
                className="text-white/80 hover:text-white transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Certificate Image */}
              {selectedCertificate.documentUrl ? (
                <div className="border rounded-lg overflow-hidden bg-gray-100">
                  <img
                    src={selectedCertificate.documentUrl}
                    alt={`Medical Certificate #${selectedCertificate.certificateNumber}`}
                    className="w-full h-auto max-h-96 object-contain"
                    onError={(e) => {
                      // Hide image on error and show fallback
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              ) : (
                <div className="border rounded-lg p-8 bg-gray-50 text-center">
                  <FileText className="h-12 w-12 text-gray-400 mx-auto mb-2" />
                  <p className="text-sm text-gray-700 mb-3">No certificate image available</p>
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    accept="image/*,application/pdf"
                    className="hidden"
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4" />
                        Upload Certificate Image
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Capacity Badge */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-600">Work Capacity</span>
                <Badge
                  style={{ backgroundColor: selectedCertificate.color }}
                  className="text-white px-3 py-1"
                >
                  {selectedCertificate.capacity}% Capacity
                </Badge>
              </div>

              {/* Details Grid */}
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-gray-700 text-xs mb-1">
                    <Calendar className="h-3 w-3" />
                    Date
                  </div>
                  <p className="font-medium text-gray-900">
                    {new Date(selectedCertificate.date).toLocaleDateString('en-AU', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric'
                    })}
                  </p>
                </div>

                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-gray-700 text-xs mb-1">
                    <Activity className="h-3 w-3" />
                    Week
                  </div>
                  <p className="font-medium text-gray-900">
                    Week {selectedCertificate.week}
                  </p>
                </div>

                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-gray-700 text-xs mb-1">
                    <Calendar className="h-3 w-3" />
                    Expires
                  </div>
                  <p className="font-medium text-gray-900">
                    {selectedCertificate.endDate
                      ? new Date(selectedCertificate.endDate).toLocaleDateString('en-AU', {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric'
                        })
                      : "—"}
                  </p>
                </div>

                <div className="bg-gray-50 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-gray-700 text-xs mb-1">
                    <FileText className="h-3 w-3" />
                    Fitness Status
                  </div>
                  {selectedCertificate.endDate && new Date(selectedCertificate.endDate) < new Date() ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                      Expired
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full">
                      Current
                    </span>
                  )}
                </div>
              </div>

              {/* Capacity Visual Bar */}
              <div className="pt-2">
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
                <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${selectedCertificate.capacity}%`,
                      backgroundColor: selectedCertificate.color
                    }}
                  />
                </div>
              </div>

              {/* Functional Restrictions Matrix */}
              {selectedCertificate.functionalRestrictions && (() => {
                const r = selectedCertificate.functionalRestrictions!;
                const capabilityColor = (v: RestrictionCapability) => {
                  if (v === "can") return "text-emerald-700 bg-emerald-50";
                  if (v === "with_modifications") return "text-amber-700 bg-amber-50";
                  if (v === "cannot") return "text-red-700 bg-red-50";
                  return "text-gray-500 bg-gray-50";
                };
                const capabilityLabel = (v: RestrictionCapability) => {
                  if (v === "can") return "Can";
                  if (v === "with_modifications") return "Modified";
                  if (v === "cannot") return "Cannot";
                  return "N/A";
                };
                const rows: Array<{ label: string; value: RestrictionCapability; note?: string }> = [
                  { label: "Sitting", value: r.sitting },
                  { label: "Standing / Walking", value: r.standingWalking },
                  { label: "Bending", value: r.bending },
                  { label: "Lifting", value: r.lifting, note: r.liftingMaxKg ? `max ${r.liftingMaxKg}kg` : undefined },
                  { label: "Carrying", value: r.carrying },
                  { label: "Reaching Overhead", value: r.reachingOverhead },
                  { label: "Reaching Forward", value: r.reachingForward },
                  { label: "Twisting", value: r.twisting },
                  { label: "Repetitive Movements", value: r.repetitiveMovements },
                  { label: "Injured Limb Use", value: r.useOfInjuredLimb },
                ];
                return (
                  <div className="pt-2">
                    <p className="text-xs font-semibold text-gray-700 mb-2 uppercase tracking-wide">Functional Restrictions</p>
                    {(r.maxWorkHoursPerDay || r.maxWorkDaysPerWeek) && (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {r.maxWorkHoursPerDay && (
                          <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                            Max {r.maxWorkHoursPerDay}h/day
                          </span>
                        )}
                        {r.maxWorkDaysPerWeek && (
                          <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                            Max {r.maxWorkDaysPerWeek} days/week
                          </span>
                        )}
                      </div>
                    )}
                    <div className="space-y-1">
                      {rows.map(({ label, value, note }) => (
                        <div key={label} className="flex items-center justify-between text-xs">
                          <span className="text-gray-600">{label}</span>
                          <span className={cn("px-2 py-0.5 rounded-full font-medium", capabilityColor(value))}>
                            {capabilityLabel(value)}{note ? ` (${note})` : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-4 bg-gray-50 border-t flex gap-2">
              {selectedCertificate.documentUrl && (
                <a
                  href={selectedCertificate.documentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-2 px-4 rounded-lg transition-colors text-center"
                >
                  Open Full Size
                </a>
              )}
              <button
                onClick={() => setSelectedCertificate(null)}
                className={cn(
                  "bg-gray-900 hover:bg-gray-800 text-white font-medium py-2 px-4 rounded-lg transition-colors",
                  selectedCertificate.documentUrl ? "flex-1" : "w-full"
                )}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust Timeline Modal (Phase 6.2) */}
      {showOverrideForm && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
          onClick={() => setShowOverrideForm(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-6 py-4 flex items-center justify-between rounded-t-xl">
              <div className="flex items-center gap-3">
                <SlidersHorizontal className="h-5 w-5 text-white" />
                <h3 className="text-base font-semibold text-white">Adjust Recovery Timeline</h3>
              </div>
              <button onClick={() => setShowOverrideForm(false)} className="text-white/80 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {data.recoveryOverride && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                  Current override: {data.recoveryOverride.adjustedEstimateWeeks} weeks
                  {" "}(original: {data.recoveryOverride.originalEstimateWeeks} weeks)
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="override-weeks" className="text-sm font-medium">
                  New expected duration (weeks) <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="override-weeks"
                  type="number"
                  min={1}
                  max={260}
                  value={overrideWeeks}
                  onChange={(e) => setOverrideWeeks(e.target.value)}
                  placeholder={String(data.estimatedWeeks)}
                  className="w-32"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="override-reason" className="text-sm font-medium">
                  Reason for adjustment <span className="text-red-500">*</span>
                </Label>
                <Textarea
                  id="override-reason"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Clinical basis for adjusting the expected recovery timeline..."
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-medium">Factors</Label>
                <div className="grid grid-cols-1 gap-2">
                  {OVERRIDE_FACTORS.map((factor) => (
                    <div key={factor} className="flex items-center gap-2">
                      <Checkbox
                        id={`factor-${factor}`}
                        checked={overrideFactors.includes(factor)}
                        onCheckedChange={(checked) => {
                          setOverrideFactors(checked
                            ? [...overrideFactors, factor]
                            : overrideFactors.filter((f) => f !== factor)
                          );
                        }}
                      />
                      <Label htmlFor={`factor-${factor}`} className="text-sm font-normal cursor-pointer">
                        {factor}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 bg-gray-50 border-t rounded-b-xl flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowOverrideForm(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleOverrideSubmit}
                disabled={isSubmittingOverride || !overrideWeeks || !overrideReason.trim()}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {isSubmittingOverride ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</>
                ) : (
                  "Save Override"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};
