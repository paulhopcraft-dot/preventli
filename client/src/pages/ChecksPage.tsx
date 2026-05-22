import React, { useState } from "react";
import type { TelehealthBookingDB } from "@shared/schema";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { fetchWithCsrf } from "@/lib/queryClient";
import { PageLayout } from "@/components/PageLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CHECK_LABELS, type CheckCategory } from "@shared/check-categories";
import {
  UserPlus,
  Shield,
  Activity,
  Heart,
  Brain,
  LogOut,
  CheckCircle,
  Clock,
  AlertTriangle,
  Users,
  FileText,
  Send,
  Search,
  XCircle,
  type LucideIcon,
} from "lucide-react";

interface ReportJson {
  executiveSummary: string;
  healthStatus: string;
  fitnessAssessment: string;
  flags: string[];
  clearanceRecommendation: string;
  aiRecommendation?: string;
  conditions?: string | null;
  notes?: string;
}

interface Assessment {
  id: string;
  workerId?: string | null;
  candidateName: string;
  positionTitle: string;
  status: string;
  clearanceLevel?: string | null;
  sentAt?: string | null;
  createdAt: string;
  reportJson?: ReportJson | null;
}

interface WorkerSummary {
  id: string;
  name: string;
  email: string | null;
  latestAssessmentStatus: string | null;
  latestClearanceLevel: string | null;
  latestPositionTitle: string | null;
  nextCheckDue: string | null;
  recheckUrgency: "overdue" | "due_soon" | "upcoming" | "pending" | "not_applicable" | null;
}

/** A stat card: a labelled count derived from a predicate over the list. */
interface StatCardDef {
  label: string;
  description: string;
  match: (a: Assessment) => boolean;
  icon: LucideIcon;
  color: string;
}

/** Per-tab UI configuration — copy, links, and which extras to show. */
interface CategoryConfig {
  icon: LucideIcon;
  cardTitle: string;
  cardDescription: string;
  emptyState: string;
  newAssessmentHref: string;
  newAssessmentLabel: string;
  showAttentionPanel: boolean;
  statCards: StatCardDef[];
}

/** Default stat cards — used by every non-pre-employment tab. */
const DEFAULT_STAT_CARDS: StatCardDef[] = [
  { label: "Total", description: "All time", match: () => true, icon: Users, color: "blue" },
  { label: "Sent", description: "Awaiting completion", match: a => a.status === "sent", icon: Send, color: "yellow" },
  { label: "Completed", description: "Questionnaire submitted", match: a => a.status === "completed", icon: CheckCircle, color: "green" },
  { label: "In Progress", description: "Questionnaire received", match: a => a.status === "in_progress", icon: Clock, color: "orange" },
];

/** Pre-Employment stat cards — oriented around the clearance workflow. */
const PRE_EMPLOYMENT_STAT_CARDS: StatCardDef[] = [
  { label: "Total Assessments", description: "All time", match: () => true, icon: Users, color: "blue" },
  { label: "Awaiting Action", description: "Pending or awaiting approval", match: a => ["created", "sent", "pending", "in_progress"].includes(a.status), icon: Clock, color: "yellow" },
  { label: "Completed", description: "Questionnaire submitted", match: a => a.status === "completed", icon: CheckCircle, color: "green" },
  { label: "Cleared for Work", description: "Ready to start", match: a => (a.clearanceLevel ?? "").toUpperCase().replace(/-/g, "_").startsWith("CLEARED"), icon: Shield, color: "green" },
];

const CATEGORY_CONFIG: Record<CheckCategory, CategoryConfig> = {
  pre_employment: {
    icon: UserPlus,
    cardTitle: "Pre-Employment Health Assessments",
    cardDescription: "Candidate health screening and clearance management",
    emptyState: "No assessments yet. Create one to get started.",
    newAssessmentHref: "/assessments/new?type=pre_employment",
    newAssessmentLabel: "New Assessment",
    showAttentionPanel: true,
    statCards: PRE_EMPLOYMENT_STAT_CARDS,
  },
  prevention: {
    icon: Shield,
    cardTitle: "Prevention & Safety Checks",
    cardDescription: "Proactive health monitoring and injury prevention",
    emptyState: "No prevention checks yet. Create one to get started.",
    newAssessmentHref: "/assessments/new?type=prevention",
    newAssessmentLabel: "New Assessment",
    showAttentionPanel: false,
    statCards: DEFAULT_STAT_CARDS,
  },
  injury: {
    icon: Activity,
    cardTitle: "Injury Assessments",
    cardDescription: "Workplace injury tracking and return-to-work coordination",
    emptyState: "No injury assessments yet. Create one to get started.",
    newAssessmentHref: "/assessments/new?type=injury",
    newAssessmentLabel: "New Injury Assessment",
    showAttentionPanel: false,
    statCards: DEFAULT_STAT_CARDS,
  },
  wellness: {
    icon: Heart,
    cardTitle: "General Wellness Assessments",
    cardDescription: "Comprehensive employee wellness monitoring",
    emptyState: "No wellness assessments yet. Create one to get started.",
    newAssessmentHref: "/assessments/new?type=wellness",
    newAssessmentLabel: "New Wellness Assessment",
    showAttentionPanel: false,
    statCards: DEFAULT_STAT_CARDS,
  },
  mental_health: {
    icon: Brain,
    cardTitle: "Mental Health Assessments",
    cardDescription: "Employee mental health and wellbeing services",
    emptyState: "No mental health assessments yet. Create one to get started.",
    newAssessmentHref: "/assessments/new?type=mental_health",
    newAssessmentLabel: "New MH Assessment",
    showAttentionPanel: false,
    statCards: DEFAULT_STAT_CARDS,
  },
  exit: {
    icon: LogOut,
    cardTitle: "Exit Health Checks",
    cardDescription: "Final health assessments and liability closure",
    emptyState: "No exit checks yet. Create one to get started.",
    newAssessmentHref: "/assessments/new?type=exit",
    newAssessmentLabel: "New Exit Health Check",
    showAttentionPanel: false,
    statCards: DEFAULT_STAT_CARDS,
  },
};

const TAB_ORDER: CheckCategory[] = [
  "pre_employment",
  "prevention",
  "injury",
  "wellness",
  "mental_health",
  "exit",
];

const TAB_LABELS: Record<CheckCategory, string> = {
  pre_employment: "Pre-Employment",
  prevention: "Prevention",
  injury: "Injury",
  wellness: "Wellness",
  mental_health: "Mental Health",
  exit: "Exit",
};

function clearanceBadgeClass(level?: string | null): string {
  if (!level) return "bg-gray-100 text-gray-700 border-gray-200";
  const l = level.toUpperCase().replace(/-/g, "_");
  if (l === "CLEARED" || l === "CLEARED_UNCONDITIONAL") return "bg-green-100 text-green-800 border-green-200";
  if (l === "CLEARED_CONDITIONAL") return "bg-teal-100 text-teal-800 border-teal-200";
  if (l === "CLEARED_WITH_RESTRICTIONS") return "bg-orange-100 text-orange-800 border-orange-200";
  if (l === "NOT_CLEARED") return "bg-red-100 text-red-800 border-red-200";
  if (l === "REQUIRES_REVIEW" || l === "PENDING_REVIEW") return "bg-yellow-100 text-yellow-800 border-yellow-200";
  return "bg-gray-100 text-gray-700 border-gray-200";
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "completed": return "bg-green-100 text-green-800 border-green-200";
    case "sent": return "bg-blue-100 text-blue-800 border-blue-200";
    case "created": return "bg-yellow-100 text-yellow-800 border-yellow-200";
    default: return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

function statusLabel(status: string): string {
  return status === "in_progress" ? "Questionnaire Received" : status;
}

function formatDate(s?: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

interface StatCardProps {
  title: string;
  value: string | number;
  description: string;
  icon: LucideIcon;
  color: string;
}

function StatCard({ title, value, description, icon: Icon, color }: StatCardProps): React.ReactElement {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={`h-4 w-4 text-${color}-600`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-slate-600">{description}</p>
      </CardContent>
    </Card>
  );
}

interface AssessmentListProps {
  category: CheckCategory;
  onViewReport: (assessment: Assessment) => void;
}

/**
 * DB-backed assessment list for a single check category. Fetches only that
 * category's assessments, renders real stat cards, a search box, and the
 * full list (newest first).
 */
function AssessmentList({ category, onViewReport }: AssessmentListProps): React.ReactElement {
  const config = CATEGORY_CONFIG[category];
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<{ assessments: Assessment[] }>({
    queryKey: ["assessments", category],
    queryFn: () =>
      fetch(`/api/assessments?category=${category}`, { credentials: "include" }).then(r => r.json()),
  });

  const assessments = (data?.assessments ?? [])
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const filtered = search
    ? assessments.filter(a =>
        a.candidateName.toLowerCase().includes(search.toLowerCase()) ||
        a.positionTitle.toLowerCase().includes(search.toLowerCase())
      )
    : assessments;

  function statValue(def: StatCardDef): number {
    return assessments.filter(def.match).length;
  }

  return (
    <>
      <div className="grid gap-4 md:grid-cols-4">
        {config.statCards.map(def => (
          <StatCard
            key={def.label}
            title={def.label}
            value={isLoading ? "…" : statValue(def)}
            description={def.description}
            icon={def.icon}
            color={def.color}
          />
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{config.cardTitle}</CardTitle>
              <CardDescription>{config.cardDescription}</CardDescription>
            </div>
            <Button asChild>
              <Link to={config.newAssessmentHref}>{config.newAssessmentLabel}</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-slate-600 py-4">Loading assessments…</p>
          ) : assessments.length === 0 ? (
            <div className="text-center py-8 text-slate-600">
              <config.icon className="w-10 h-10 mx-auto mb-3 text-gray-300" />
              <p className="text-sm">{config.emptyState}</p>
            </div>
          ) : (
            <div className="divide-y">
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name or position..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {filtered.map(a => (
                <div key={a.id} className="py-3 flex items-start justify-between gap-4 border-b last:border-0">
                  <Link
                    to={a.workerId ? `/workers/${a.workerId}` : `/assessments/${a.id}`}
                    className="min-w-0 flex-1 hover:opacity-75 transition-opacity"
                  >
                    <p className="font-medium text-sm truncate">{a.candidateName}</p>
                    <p className="text-xs text-slate-600 truncate">{a.positionTitle}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {a.sentAt ? `Sent ${formatDate(a.sentAt)}` : `Created ${formatDate(a.createdAt)}`}
                    </p>
                  </Link>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <Badge className={`text-xs border ${statusBadgeClass(a.status)}`}>
                      {statusLabel(a.status)}
                    </Badge>
                    {a.clearanceLevel && (
                      <Badge className={`text-xs border ${clearanceBadgeClass(a.clearanceLevel)}`}>
                        {a.clearanceLevel === "cleared_conditional" ? "⏳ Awaiting Approval"
                          : a.clearanceLevel === "cleared_unconditional" ? "✓ Approved"
                          : a.clearanceLevel === "not_cleared" ? "✗ Not Cleared"
                          : a.clearanceLevel.replace(/_/g, " ")}
                      </Badge>
                    )}
                    {a.reportJson && a.status !== "completed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs text-blue-700 border-blue-300 hover:bg-blue-50 mt-0.5"
                        onClick={() => onViewReport(a)}
                      >
                        <FileText className="w-3 h-3 mr-1" />
                        View Report
                      </Button>
                    )}
                    {a.status === "completed" && a.reportJson && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-slate-500"
                        onClick={() => onViewReport(a)}
                      >
                        <FileText className="w-3 h-3 mr-1" />
                        View Report
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {filtered.length === 0 && search && (
                <p className="text-xs text-slate-600 pt-3 text-center">No results for "{search}"</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/**
 * Amber panel listing workers whose recheck is overdue or due soon.
 * Pre-employment only — driven by /api/workers, not the assessments list.
 */
function AttentionPanel(): React.ReactElement | null {
  const { data } = useQuery<{ workers: WorkerSummary[] }>({
    queryKey: ["workers-summary"],
    queryFn: () => fetch("/api/workers", { credentials: "include" }).then(r => r.json()),
  });

  const workers = data?.workers ?? [];
  const overdueWorkers = workers.filter(w => w.recheckUrgency === "overdue");
  const dueSoonWorkers = workers.filter(w => w.recheckUrgency === "due_soon");
  const attentionCount = overdueWorkers.length + dueSoonWorkers.length;

  if (attentionCount === 0) return null;

  const rows = [
    ...overdueWorkers.map(w => ({ ...w, urgencyLabel: "OVERDUE", urgencyClass: "bg-red-100 text-red-800 border-red-200" })),
    ...dueSoonWorkers.map(w => ({ ...w, urgencyLabel: "Due soon", urgencyClass: "bg-amber-100 text-amber-800 border-amber-200" })),
  ];

  return (
    <Card className="border-amber-300 bg-amber-50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 text-amber-900">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Attention Required ({attentionCount})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="divide-y divide-amber-200">
          {rows.map(w => (
            <div key={w.id} className="py-2.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <Link to={`/workers/${w.id}`} className="font-medium text-sm text-amber-900 hover:underline">
                  {w.name}
                </Link>
                <p className="text-xs text-amber-700">{w.latestPositionTitle ?? "—"}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Badge className={`text-xs border ${w.urgencyClass}`}>{w.urgencyLabel}</Badge>
                <Button size="sm" variant="outline" className="h-7 text-xs" asChild>
                  <Link to="/assessments/new">Schedule</Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function ChecksPage(): React.ReactElement {
  const [activeTab, setActiveTab] = useState<CheckCategory>("pre_employment");
  const [reportModal, setReportModal] = useState<Assessment | null>(null);
  const [selectedExit, setSelectedExit] = useState<TelehealthBookingDB | null>(null);
  const queryClient = useQueryClient();

  function invalidateAssessments(): void {
    queryClient.invalidateQueries({ queryKey: ["assessments"] });
  }

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetchWithCsrf(`/api/pre-employment/assessments/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", clearanceLevel: "cleared_unconditional" }),
      });
      if (!r.ok) throw new Error("Failed to approve");
      return r.json();
    },
    onSuccess: () => { invalidateAssessments(); setReportModal(null); },
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetchWithCsrf(`/api/pre-employment/assessments/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed", clearanceLevel: "not_cleared" }),
      });
      if (!r.ok) throw new Error("Failed to reject");
      return r.json();
    },
    onSuccess: () => { invalidateAssessments(); setReportModal(null); },
  });

  // Exit tab is driven by real telehealth bookings filtered by serviceType="exit",
  // not by the DB-backed AssessmentList used by the other five tabs.
  const { data: bookingsData } = useQuery<{ bookings: TelehealthBookingDB[] }>({
    queryKey: ["/api/bookings"],
    queryFn: () => fetch("/api/bookings", { credentials: "include" }).then(r => r.json()),
  });

  const exitBookings = (bookingsData?.bookings ?? []).filter(b => b.serviceType === "exit");

  const exitStats = {
    total: exitBookings.length,
    pending: exitBookings.filter(b => b.status === "pending").length,
    completed: exitBookings.filter(b => b.status === "completed").length,
    clearanceReady: exitBookings.filter(b => b.status === "confirmed").length,
  };

  return (
    <PageLayout title="Health Checks" subtitle="Comprehensive employee health monitoring across all lifecycle stages">
      <div className="space-y-6">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as CheckCategory)} className="w-full">
          <TabsList className="grid w-full grid-cols-6">
            {TAB_ORDER.map(category => {
              const Icon = CATEGORY_CONFIG[category].icon;
              return (
                <TabsTrigger key={category} value={category} className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  {TAB_LABELS[category]}
                </TabsTrigger>
              );
            })}
          </TabsList>

          {TAB_ORDER.map(category => (
            <TabsContent key={category} value={category} className="space-y-4">
              {category === "exit" ? (
                <>
                  {/* EXIT CHECKS — driven by telehealth bookings, not AssessmentList */}
                  <div className="grid gap-4 md:grid-cols-4">
                    <StatCard
                      title="Active Exits"
                      value={exitStats.total}
                      description="In progress"
                      icon={LogOut}
                      color="gray"
                    />
                    <StatCard
                      title="Pending Checks"
                      value={exitStats.pending}
                      description="Health assessments"
                      icon={Clock}
                      color="orange"
                    />
                    <StatCard
                      title="Completed"
                      value={exitStats.completed}
                      description="Fully processed"
                      icon={CheckCircle}
                      color="green"
                    />
                    <StatCard
                      title="Ready for Clearance"
                      value={exitStats.clearanceReady}
                      description="Final approval"
                      icon={Shield}
                      color="blue"
                    />
                  </div>

                  {/* Active exit interviews — clickable list, each row opens responses */}
                  {exitBookings.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-base">Exit Interviews</CardTitle>
                        <CardDescription>Click a row to view the worker's exit-interview responses</CardDescription>
                      </CardHeader>
                      <CardContent className="p-0">
                        <div className="divide-y divide-border">
                          {exitBookings.map(b => (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => setSelectedExit(b)}
                              className="w-full flex items-center gap-4 px-4 py-3 hover:bg-muted/50 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">{b.workerName}</p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {b.employerName ?? "—"}
                                  {b.appointmentType ? ` · ${b.appointmentType.replace(/_/g, " ")}` : ""}
                                </p>
                              </div>
                              <Badge className="text-xs shrink-0 capitalize">{b.status}</Badge>
                              <div className="hidden sm:block w-20 text-xs text-muted-foreground text-right shrink-0">
                                {b.createdAt ? new Date(b.createdAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" }) : "—"}
                              </div>
                            </button>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              ) : (
                <>
                  {CATEGORY_CONFIG[category].showAttentionPanel && <AttentionPanel />}
                  <AssessmentList category={category} onViewReport={setReportModal} />
                </>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </div>

      {/* Report Modal */}
      {reportModal && (
        <Dialog open={!!reportModal} onOpenChange={(open) => !open && setReportModal(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl">{CHECK_LABELS[activeTab]} Report</DialogTitle>
              <DialogDescription>{reportModal.candidateName} — {reportModal.positionTitle}</DialogDescription>
            </DialogHeader>
            {reportModal.reportJson ? (
              <div className="space-y-5 py-2">
                {/* Clearance banner */}
                <div className={`rounded-lg p-4 border-2 ${clearanceBadgeClass(reportModal.reportJson.clearanceRecommendation)}`}>
                  <div className="flex items-center gap-2">
                    {reportModal.reportJson.clearanceRecommendation === "not_cleared"
                      ? <XCircle className="w-5 h-5 text-red-700" />
                      : <CheckCircle className="w-5 h-5 text-green-700" />}
                    <span className="font-semibold text-sm uppercase tracking-wide">
                      AI Recommendation: {reportModal.reportJson.clearanceRecommendation.replace(/_/g, " ")}
                    </span>
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900 mb-2">Summary</h3>
                  <p className="text-sm text-gray-700 leading-relaxed">{reportModal.reportJson.executiveSummary}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Health Status</p>
                    <p className="text-sm text-gray-800">{reportModal.reportJson.healthStatus}</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Fitness Assessment</p>
                    <p className="text-sm text-gray-800">{reportModal.reportJson.fitnessAssessment}</p>
                  </div>
                </div>
                {reportModal.reportJson.flags?.length > 0 ? (
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-2 flex items-center gap-1">
                      <AlertTriangle className="w-4 h-4 text-orange-500" /> Flags / Concerns
                    </h3>
                    <ul className="space-y-1">
                      {reportModal.reportJson.flags.map((flag, i) => (
                        <li key={i} className="text-sm text-orange-800 bg-orange-50 rounded px-3 py-2">• {flag}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="text-sm text-green-700 bg-green-50 rounded px-3 py-2">✓ No health flags or concerns identified</div>
                )}
                {reportModal.reportJson.conditions && (
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">Conditions / Restrictions</h3>
                    <p className="text-sm text-gray-700 bg-yellow-50 rounded px-3 py-2">{reportModal.reportJson.conditions}</p>
                  </div>
                )}
                {reportModal.reportJson.notes && (
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-1">Notes</h3>
                    <p className="text-sm text-gray-600">{reportModal.reportJson.notes}</p>
                  </div>
                )}
                {/* Final approval buttons */}
                {reportModal.status !== "completed" && (
                  <div className="border-t pt-4 flex gap-3">
                    <Button
                      className="flex-1 bg-green-600 hover:bg-green-700"
                      onClick={() => approveMutation.mutate(reportModal.id)}
                      disabled={approveMutation.isPending || rejectMutation.isPending}
                    >
                      <CheckCircle className="w-4 h-4 mr-2" />
                      {approveMutation.isPending ? "Approving..." : "Approve — Cleared to Start"}
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 border-red-300 text-red-700 hover:bg-red-50"
                      onClick={() => rejectMutation.mutate(reportModal.id)}
                      disabled={approveMutation.isPending || rejectMutation.isPending}
                    >
                      <XCircle className="w-4 h-4 mr-2" />
                      {rejectMutation.isPending ? "Rejecting..." : "Reject — Not Cleared"}
                    </Button>
                  </div>
                )}
                {reportModal.status === "completed" && (
                  <div className={`border-t pt-4 text-center text-sm font-medium ${reportModal.clearanceLevel === "not_cleared" ? "text-red-600" : "text-green-600"}`}>
                    {reportModal.clearanceLevel === "not_cleared" ? "✗ This candidate was not cleared" : "✓ This candidate has been approved"}
                  </div>
                )}
              </div>
            ) : (
              <div className="py-8 text-center text-gray-500">
                <FileText className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                <p>Report not yet generated</p>
                <p className="text-xs mt-1">Generated automatically when the candidate submits their questionnaire</p>
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}

      {/* Exit interview detail modal — shows questionnaireResponses if populated */}
      <Dialog open={!!selectedExit} onOpenChange={(open) => { if (!open) setSelectedExit(null); }}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Exit Interview</DialogTitle>
            <DialogDescription>
              {selectedExit?.workerName}
              {selectedExit?.appointmentType ? ` · ${selectedExit.appointmentType.replace(/_/g, " ")}` : ""}
            </DialogDescription>
          </DialogHeader>
          {selectedExit && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground col-span-1">Email</span>
                <span className="col-span-2">{selectedExit.workerEmail ?? "—"}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground col-span-1">Employer</span>
                <span className="col-span-2">{selectedExit.employerName ?? "—"}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground col-span-1">Status</span>
                <span className="col-span-2 capitalize">{selectedExit.status}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground col-span-1">Requested</span>
                <span className="col-span-2">
                  {selectedExit.createdAt ? new Date(selectedExit.createdAt).toLocaleString("en-AU") : "—"}
                </span>
              </div>
              {selectedExit.employerNotes && (
                <div>
                  <p className="text-muted-foreground mb-1">Notes</p>
                  <p className="bg-muted/50 rounded p-2 whitespace-pre-wrap">{selectedExit.employerNotes}</p>
                </div>
              )}

              {/* Responses */}
              {selectedExit.questionnaireResponses && Object.keys(selectedExit.questionnaireResponses).length > 0 ? (
                <div className="pt-2">
                  <h4 className="font-semibold text-sm mb-2">Responses</h4>
                  <dl className="space-y-2">
                    {Object.entries(selectedExit.questionnaireResponses as Record<string, unknown>).map(([k, v]) => (
                      <div key={k} className="grid grid-cols-3 gap-2">
                        <dt className="text-muted-foreground col-span-1 capitalize">
                          {k.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim()}
                        </dt>
                        <dd className="col-span-2 break-words">
                          {typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : (
                <div className="pt-2 text-muted-foreground italic">No questionnaire responses recorded.</div>
              )}

              <div className="flex justify-end pt-2">
                <Button variant="outline" onClick={() => setSelectedExit(null)}>Close</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
