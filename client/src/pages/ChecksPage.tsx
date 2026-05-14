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
  Calendar,
  FileText,
  TrendingUp,
  Search,
  XCircle
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

function formatDate(s?: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export default function ChecksPage() {
  const [activeTab, setActiveTab] = useState("pre-employment");
  const [reportModal, setReportModal] = useState<Assessment | null>(null);
  const queryClient = useQueryClient();

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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["assessments"] }); setReportModal(null); },
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["assessments"] }); setReportModal(null); },
  });

  const { data: assessmentsData, isLoading: assessmentsLoading } = useQuery<{ assessments: Assessment[] }>({
    queryKey: ["assessments"],
    queryFn: () => fetch("/api/assessments", { credentials: "include" }).then(r => r.json()),
  });

  const { data: workersData } = useQuery<{ workers: WorkerSummary[] }>({
    queryKey: ["workers-summary"],
    queryFn: () => fetch("/api/workers", { credentials: "include" }).then(r => r.json()),
  });

  const { data: bookingsData } = useQuery<{ bookings: TelehealthBookingDB[] }>({
    queryKey: ["/api/bookings"],
    queryFn: () => fetch("/api/bookings", { credentials: "include" }).then(r => r.json()),
  });

  const exitBookings = (bookingsData?.bookings ?? []).filter(b => b.serviceType === "exit");
  const [selectedExit, setSelectedExit] = useState<TelehealthBookingDB | null>(null);

  const [assessmentSearch, setAssessmentSearch] = useState("");
  const assessments = assessmentsData?.assessments ?? [];
  const workers = workersData?.workers ?? [];

  // Only show assessments that still need action (exclude fully cleared/completed ones)
  const activeAssessments = assessments
    .filter(a => !(a.status === "completed" && a.clearanceLevel === "cleared_unconditional"))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);

  const filteredAssessments = assessmentSearch
    ? activeAssessments.filter(a =>
        a.candidateName.toLowerCase().includes(assessmentSearch.toLowerCase()) ||
        a.positionTitle.toLowerCase().includes(assessmentSearch.toLowerCase())
      )
    : activeAssessments;

  const overdueWorkers = workers.filter(w => w.recheckUrgency === "overdue");
  const dueSoonWorkers = workers.filter(w => w.recheckUrgency === "due_soon");
  const attentionCount = overdueWorkers.length + dueSoonWorkers.length;

  const peStats = {
    total: assessments.length,
    pending: assessments.filter(a => a.status === "created" || a.status === "sent" || a.status === "pending" || a.status === "in_progress").length,
    completed: assessments.filter(a => a.status === "completed").length,
    cleared: assessments.filter(a => {
      const l = (a.clearanceLevel ?? "").toUpperCase().replace(/-/g, "_");
      return l.startsWith("CLEARED"); // includes conditional + with_restrictions
    }).length,
  };

  // Exit stats are derived from real telehealth bookings filtered by serviceType="exit".
  // Pre-employment and other categories remain mocked until their APIs are wired.
  const exitStats = {
    total: exitBookings.length,
    pending: exitBookings.filter(b => b.status === "pending").length,
    completed: exitBookings.filter(b => b.status === "completed").length,
    clearanceReady: exitBookings.filter(b => b.status === "confirmed").length,
  };
  const checkStats = {
    prevention: { total: 45, due: 7, completed: 38, overdue: 2 },
    injury: { total: 8, active: 3, resolved: 5, critical: 1 },
    wellness: { total: 67, scheduled: 12, completed: 55, flagged: 3 },
    mentalHealth: { total: 23, active: 5, scheduled: 8, completed: 18 },
    exit: exitStats,
  };

  const StatCard = ({ title, value, description, icon: Icon, color = "blue" }: any) => (
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

  return (
    <PageLayout title="Health Checks" subtitle="Comprehensive employee health monitoring across all lifecycle stages">
      <div className="space-y-6">

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-6">
            <TabsTrigger value="pre-employment" className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Pre-Employment
            </TabsTrigger>
            <TabsTrigger value="prevention" className="flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Prevention
            </TabsTrigger>
            <TabsTrigger value="injury" className="flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Injury
            </TabsTrigger>
            <TabsTrigger value="wellness" className="flex items-center gap-2">
              <Heart className="h-4 w-4" />
              Wellness
            </TabsTrigger>
            <TabsTrigger value="mental-health" className="flex items-center gap-2">
              <Brain className="h-4 w-4" />
              Mental Health
            </TabsTrigger>
            <TabsTrigger value="exit" className="flex items-center gap-2">
              <LogOut className="h-4 w-4" />
              Exit
            </TabsTrigger>
          </TabsList>

          {/* PRE-EMPLOYMENT CHECKS */}
          <TabsContent value="pre-employment" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-4">
              <StatCard
                title="Total Assessments"
                value={assessmentsLoading ? "…" : peStats.total}
                description="All time"
                icon={Users}
                color="blue"
              />
              <StatCard
                title="Awaiting Action"
                value={assessmentsLoading ? "…" : peStats.pending}
                description="Pending or awaiting approval"
                icon={Clock}
                color="yellow"
              />
              <StatCard
                title="Completed"
                value={assessmentsLoading ? "…" : peStats.completed}
                description="Questionnaire submitted"
                icon={CheckCircle}
                color="green"
              />
              <StatCard
                title="Cleared for Work"
                value={assessmentsLoading ? "…" : peStats.cleared}
                description="Ready to start"
                icon={Shield}
                color="green"
              />
            </div>

            {/* Attention Required — overdue / due soon */}
            {attentionCount > 0 && (
              <Card className="border-amber-300 bg-amber-50">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-amber-900">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    Attention Required ({attentionCount})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="divide-y divide-amber-200">
                    {[...overdueWorkers.map(w => ({ ...w, urgencyLabel: "OVERDUE", urgencyClass: "bg-red-100 text-red-800 border-red-200" })),
                      ...dueSoonWorkers.map(w => ({ ...w, urgencyLabel: "Due soon", urgencyClass: "bg-amber-100 text-amber-800 border-amber-200" }))
                    ].map((w) => (
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
            )}

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Pre-Employment Health Assessments</CardTitle>
                    <CardDescription>Candidate health screening and clearance management</CardDescription>
                  </div>
                  <Button asChild>
                    <Link to="/assessments/new">New Assessment</Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {assessmentsLoading ? (
                  <p className="text-sm text-slate-600 py-4">Loading assessments…</p>
                ) : assessments.length === 0 ? (
                  <div className="text-center py-8 text-slate-600">
                    <UserPlus className="w-10 h-10 mx-auto mb-3 text-gray-300" />
                    <p className="text-sm">No assessments yet. Create one to get started.</p>
                  </div>
                ) : (
                  <div className="divide-y">
                    <div className="relative mb-3">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search by name or position..."
                        value={assessmentSearch}
                        onChange={e => setAssessmentSearch(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    {filteredAssessments.map((a) => (
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
                            {a.status === "in_progress" ? "Questionnaire Received" : a.status}
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
                              onClick={() => setReportModal(a)}
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
                              onClick={() => setReportModal(a)}
                            >
                              <FileText className="w-3 h-3 mr-1" />
                              View Report
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                    {filteredAssessments.length === 0 && assessmentSearch && (
                      <p className="text-xs text-slate-600 pt-3 text-center">No results for "{assessmentSearch}"</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* PREVENTION CHECKS */}
          <TabsContent value="prevention" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-4">
              <StatCard
                title="Active Programs"
                value={checkStats.prevention.total}
                description="Prevention initiatives"
                icon={Shield}
                color="blue"
              />
              <StatCard
                title="Due This Week"
                value={checkStats.prevention.due}
                description="Scheduled checks"
                icon={Calendar}
                color="orange"
              />
              <StatCard
                title="Completed"
                value={checkStats.prevention.completed}
                description="This quarter"
                icon={CheckCircle}
                color="green"
              />
              <StatCard
                title="Overdue"
                value={checkStats.prevention.overdue}
                description="Requires attention"
                icon={AlertTriangle}
                color="red"
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Prevention & Wellness Programs</CardTitle>
                <CardDescription>Proactive health monitoring and injury prevention</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-slate-600">
                  • Regular health screenings<br/>
                  • Workplace safety assessments<br/>
                  • Ergonomic evaluations<br/>
                  • Health and safety training compliance
                </div>
                <div className="mt-4 flex gap-2">
                  <Button variant="outline">Manage Programs</Button>
                  <Button asChild>
                    <Link to="/assessments/new?type=prevention">New Assessment</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* INJURY CHECKS */}
          <TabsContent value="injury" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-4">
              <StatCard
                title="Active Cases"
                value={checkStats.injury.active}
                description="Currently managing"
                icon={Activity}
                color="red"
              />
              <StatCard
                title="Total Cases"
                value={checkStats.injury.total}
                description="This year"
                icon={FileText}
                color="blue"
              />
              <StatCard
                title="Resolved"
                value={checkStats.injury.resolved}
                description="Successfully closed"
                icon={CheckCircle}
                color="green"
              />
              <StatCard
                title="Critical"
                value={checkStats.injury.critical}
                description="Requiring urgent attention"
                icon={AlertTriangle}
                color="red"
              />
            </div>

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Injury Management</CardTitle>
                    <CardDescription>Workplace injury tracking and return-to-work coordination</CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" asChild>
                      <Link to="/cases">View All Cases</Link>
                    </Button>
                    <Button asChild>
                      <Link to="/assessments/new?type=injury">New Injury Assessment</Link>
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-slate-600">
                  • Incident reporting and documentation<br/>
                  • Medical certificate management<br/>
                  • Return-to-work planning<br/>
                  • Recovery timeline tracking
                </div>
                <div className="mt-4">
                  <Button variant="outline" asChild>
                    <Link to="/comprehensive-rtw-form">New RTW Assessment</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* WELLNESS CHECKS */}
          <TabsContent value="wellness" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-4">
              <StatCard
                title="Enrolled"
                value={checkStats.wellness.total}
                description="In wellness programs"
                icon={Heart}
                color="pink"
              />
              <StatCard
                title="Scheduled"
                value={checkStats.wellness.scheduled}
                description="Upcoming checks"
                icon={Calendar}
                color="blue"
              />
              <StatCard
                title="Completed"
                value={checkStats.wellness.completed}
                description="This year"
                icon={CheckCircle}
                color="green"
              />
              <StatCard
                title="Health Flags"
                value={checkStats.wellness.flagged}
                description="Require follow-up"
                icon={AlertTriangle}
                color="orange"
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>General Health & Wellbeing</CardTitle>
                <CardDescription>Comprehensive employee wellness monitoring</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-slate-600">
                  • Annual health screenings<br/>
                  • Biometric monitoring<br/>
                  • Fitness assessments<br/>
                  • Health education programs
                </div>
                <div className="mt-4 flex gap-2">
                  <Button variant="outline">Wellness Dashboard</Button>
                  <Button asChild>
                    <Link to="/assessments/new?type=wellness">New Wellness Assessment</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* MENTAL HEALTH CHECKS */}
          <TabsContent value="mental-health" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-4">
              <StatCard
                title="Active Support"
                value={checkStats.mentalHealth.active}
                description="Currently supported"
                icon={Brain}
                color="purple"
              />
              <StatCard
                title="Total Enrolled"
                value={checkStats.mentalHealth.total}
                description="In MH programs"
                icon={Users}
                color="blue"
              />
              <StatCard
                title="Scheduled"
                value={checkStats.mentalHealth.scheduled}
                description="Upcoming sessions"
                icon={Calendar}
                color="orange"
              />
              <StatCard
                title="Completed"
                value={checkStats.mentalHealth.completed}
                description="Sessions this quarter"
                icon={CheckCircle}
                color="green"
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Mental Health Support</CardTitle>
                <CardDescription>Employee mental health and wellbeing services</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-slate-600">
                  • Psychological assessments<br/>
                  • Counseling and therapy coordination<br/>
                  • Stress and anxiety management<br/>
                  • Mental health first aid training
                </div>
                <div className="mt-4 flex gap-2">
                  <Button variant="outline">Mental Health Dashboard</Button>
                  <Button asChild>
                    <Link to="/assessments/new?type=mental_health">New MH Assessment</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* EXIT CHECKS */}
          <TabsContent value="exit" className="space-y-4">
            <div className="grid gap-4 md:grid-cols-4">
              <StatCard
                title="Active Exits"
                value={checkStats.exit.total}
                description="In progress"
                icon={LogOut}
                color="gray"
              />
              <StatCard
                title="Pending Checks"
                value={checkStats.exit.pending}
                description="Health assessments"
                icon={Clock}
                color="orange"
              />
              <StatCard
                title="Completed"
                value={checkStats.exit.completed}
                description="Fully processed"
                icon={CheckCircle}
                color="green"
              />
              <StatCard
                title="Ready for Clearance"
                value={checkStats.exit.clearanceReady}
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

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Exit Processing</CardTitle>
                    <CardDescription>Final health assessments and liability closure</CardDescription>
                  </div>
                  <Button variant="outline" asChild>
                    <Link to="/exit-processing">View Exit Cases</Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-slate-600">
                  • Final health assessments<br/>
                  • Exit documentation completion<br/>
                  • Liability and insurance closure<br/>
                  • Health record archival
                </div>
                <div className="mt-4">
                  <Button asChild>
                    <Link to="/assessments/new?type=exit">New Exit Health Check</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

      </div>

      {/* Report Modal */}
      {reportModal && (
        <Dialog open={!!reportModal} onOpenChange={(open) => !open && setReportModal(null)}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl">Pre-Employment Health Report</DialogTitle>
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