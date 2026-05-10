import { PageLayout } from "@/components/PageLayout";
import { useState, useEffect, type KeyboardEvent } from 'react';
import { useAuth } from "@/hooks/useAuth";
import { FirstTimeTour } from "@/components/FirstTimeTour";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { PageSpinner } from '@/components/typography';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Users,
  AlertTriangle,
  Clock,
  CheckCircle,
  ArrowRight,
} from 'lucide-react';
import type { PaginatedCasesResponse } from '@shared/schema';

/**
 * Spread onto a clickable <div> to make it keyboard-operable.
 * Activates on Enter or Space, like a real button.
 */
function clickableRowProps(onActivate: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
  };
}

interface CaseStatistics {
  totalCases: number;
  atWork: number;
  offWork: number;
  criticalActions: number;
  urgentActions: number;
  routineActions: number;
  expiredCertificates: number;
  overdueReviews: number;
}

interface PriorityAction {
  id: string;
  workerName: string;
  action: string;
  priority: 'critical' | 'urgent' | 'routine';
  daysOverdue?: number;
  type: 'certificate' | 'review' | 'rtw_plan' | 'medical' | 'compliance';
  caseId: string;
}

interface DashboardData {
  statistics: CaseStatistics;
  priorityActions: PriorityAction[];
  organizationName: string;
}

function EmployerDashboardContent() {
  const navigate = useNavigate();

  const { data: dashboardData, isLoading, error } = useQuery<DashboardData>({
    queryKey: ['employer-dashboard'],
    queryFn: () => fetch('/api/employer/dashboard').then(r => r.json()),
    refetchInterval: 120_000,
    staleTime: 60_000,
  });

  const { data: allCasesData } = useQuery<PaginatedCasesResponse>({
    queryKey: ['/api/cases'],
    staleTime: 60_000,
  });

  if (isLoading) {
    return <PageSpinner label="Loading your dashboard..." />;
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <Card className="w-full max-w-md">
          <CardContent className="text-center p-6">
            <AlertTriangle className="w-12 h-12 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-bold text-foreground mb-2">Dashboard Unavailable</h2>
            <p className="text-muted-foreground">Unable to load dashboard data. Please try again.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const stats = dashboardData?.statistics;
  const pendingApprovals = allCasesData?.cases.filter(c => c.rtwPlanStatus === 'pending_employer_review') ?? [];
  const highRiskCount = (allCasesData?.cases ?? []).filter(c => (c.riskLevel || '').toLowerCase() === 'high').length;
  const sortedCases = [...(allCasesData?.cases ?? [])].sort((a, b) => {
    const riskOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const aRisk = riskOrder[(a.riskLevel || '').toLowerCase()] ?? 2;
    const bRisk = riskOrder[(b.riskLevel || '').toLowerCase()] ?? 2;
    if (aRisk !== bRisk) return aRisk - bRisk;
    const aPending = a.rtwPlanStatus === 'pending_employer_review' ? 0 : 1;
    const bPending = b.rtwPlanStatus === 'pending_employer_review' ? 0 : 1;
    if (aPending !== bPending) return aPending - bPending;
    if (a.workStatus !== b.workStatus) return a.workStatus === 'Off work' ? -1 : 1;
    return new Date(a.dateOfInjury).getTime() - new Date(b.dateOfInjury).getTime();
  });

  return (
    <div className="space-y-6">
      {/* RTW Approval Banner — only shown when employer action is needed */}
      {pendingApprovals.length > 0 && (
        <Alert variant="warning" className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div className="flex-1 ml-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <AlertTitle>
                {pendingApprovals.length === 1
                  ? `Return to Work plan requires your approval — ${pendingApprovals[0].workerName}`
                  : `${pendingApprovals.length} Return to Work plans awaiting your approval`}
              </AlertTitle>
              <AlertDescription>
                Your sign-off is required before the plan can proceed.
              </AlertDescription>
            </div>
            <Button
              size="sm"
              variant="warning"
              className="shrink-0"
              onClick={() => navigate(`/employer/case/${pendingApprovals[0].id}`)}
            >
              Review now
            </Button>
          </div>
        </Alert>
      )}

      {/* Statistics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="bg-card shadow-lg border-0 hover:shadow-xl transition-all duration-300">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Total Cases</p>
                <p className="text-3xl font-bold text-foreground">{stats?.totalCases || 0}</p>
              </div>
              <div className="p-3 bg-blue-100 rounded-xl">
                <Users className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-lg border-0 hover:shadow-xl transition-all duration-300">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">At Work</p>
                <p className="text-3xl font-bold text-green-700">{stats?.atWork || 0}</p>
                <p className="text-xs text-green-600 mt-1">
                  {stats?.totalCases ? Math.round((stats.atWork / stats.totalCases) * 100) : 0}% active
                </p>
              </div>
              <div className="p-3 bg-green-100 rounded-xl">
                <CheckCircle className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-lg border-0 hover:shadow-xl transition-all duration-300">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-1">Off Work</p>
                <p className="text-3xl font-bold text-amber-700">{stats?.offWork || 0}</p>
                <p className="text-xs text-amber-600 mt-1">Requiring support</p>
              </div>
              <div className="p-3 bg-amber-100 rounded-xl">
                <Clock className="w-6 h-6 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card shadow-lg border-0 hover:shadow-xl transition-all duration-300">
          <CardContent className="p-6">
            {(() => {
              const activePlans = (allCasesData?.cases ?? []).filter(c => c.rtwPlanStatus === "in_progress" || c.rtwPlanStatus === "working_well").length;
              const hasCritical = criticalActions.length > 0;
              return activePlans > 0 ? (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">RTW Plans Active</p>
                    <p className="text-3xl font-bold text-emerald-700">{activePlans}</p>
                    <p className="text-xs text-emerald-600 mt-1">{hasCritical ? `${criticalActions.length} critical action${criticalActions.length !== 1 ? "s" : ""} pending` : "No critical actions"}</p>
                  </div>
                  <div className="p-3 bg-emerald-100 rounded-xl">
                    <CheckCircle className="w-6 h-6 text-emerald-600" />
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">Critical Actions</p>
                    <p className="text-3xl font-bold text-red-700">{criticalActions.length}</p>
                    <p className="text-xs text-red-600 mt-1">Immediate attention</p>
                  </div>
                  <div className="p-3 bg-red-100 rounded-xl">
                    <AlertTriangle className="w-6 h-6 text-red-600" />
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* Priority Actions — flat sorted list (critical → urgent → routine, then by days overdue) */}
      <Card className="bg-card shadow-lg border-0">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-muted-foreground" />
            Priority Actions
            {actions.length > 0 && (
              <Badge variant="secondary" className="ml-1">{actions.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {actions.length === 0 ? (
            <div className="py-12 text-center">
              <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
              <p className="font-medium text-foreground">All clear</p>
              <p className="text-sm text-muted-foreground mt-1">No actions require attention right now.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {actions.map((action) => (
                <div
                  key={action.id}
                  className="flex items-center gap-3 px-5 py-3.5 hover:bg-accent/40 transition-colors cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  {...clickableRowProps(() => navigate(`/employer/case/${action.caseId}`))}
                >
                  {/* Priority badge */}
                  <Badge className={`shrink-0 capitalize w-16 justify-center ${getPriorityColor(action.priority)}`}>
                    {action.priority}
                  </Badge>
                  {/* Type icon */}
                  <span className="shrink-0 text-muted-foreground">{getPriorityIcon(action.type)}</span>
                  {/* Worker + action description */}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground truncate leading-snug">{action.workerName}</p>
                    <p className="text-sm text-muted-foreground truncate">{action.action}</p>
                  </div>
                  {/* Days overdue pill */}
                  {!!action.daysOverdue && (
                    <Badge
                      variant={action.priority === 'critical' ? 'destructive' : 'warning'}
                      className="shrink-0 whitespace-nowrap"
                    >
                      {action.daysOverdue}d overdue
                    </Badge>
                  )}
                  <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 group-hover:translate-x-0.5 transition-transform" />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* All Workers Roster */}
      {allCasesData && allCasesData.cases.length > 0 && (
        <Card className="bg-card shadow-lg border-0">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="w-5 h-5 text-muted-foreground" />
              All Workers
              <Badge variant="secondary" className="ml-1">{allCasesData.cases.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {[...allCasesData.cases]
                .sort((a, b) => {
                  // RTW approval needed first, then Off work (longest first), then At work
                  const aPending = a.rtwPlanStatus === "pending_employer_review";
                  const bPending = b.rtwPlanStatus === "pending_employer_review";
                  if (aPending !== bPending) return aPending ? -1 : 1;
                  if (a.workStatus !== b.workStatus) return a.workStatus === "Off work" ? -1 : 1;
                  return new Date(a.dateOfInjury).getTime() - new Date(b.dateOfInjury).getTime();
                })
                .map(c => {
                  const weeksOff = Math.max(0, Math.floor((Date.now() - new Date(c.dateOfInjury).getTime()) / (7 * 24 * 60 * 60 * 1000)));
                  const needsApproval = c.rtwPlanStatus === "pending_employer_review";
                  const planActive = c.rtwPlanStatus === "in_progress" || c.rtwPlanStatus === "working_well";
                  return (
                    <div
                      key={c.id}
                      className={`flex items-center justify-between px-4 py-3 hover:bg-muted/50 cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring${needsApproval ? " bg-yellow-50 dark:bg-yellow-950/20 border-l-4 border-l-yellow-400" : planActive ? " bg-emerald-50/40 dark:bg-emerald-950/20 border-l-4 border-l-emerald-400" : ""}`}
                      aria-label={`Open case for ${c.workerName}`}
                      {...clickableRowProps(() => navigate(`/employer/case/${c.id}`))}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${needsApproval ? "bg-yellow-200 text-yellow-800" : planActive ? "bg-emerald-200 text-emerald-800" : "bg-muted text-muted-foreground"}`}>
                          {c.workerName.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground group-hover:text-blue-700">{c.workerName}</p>
                          <p className="text-xs text-muted-foreground">
                            {c.workStatus === "Off work" ? `Week ${weeksOff} off work` : `Week ${weeksOff} post-injury · At work`}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {needsApproval && (
                          <Badge variant="warning" className="text-xs">RTW approval needed</Badge>
                        )}
                        {planActive && (
                          <Badge variant="success" className="text-xs">✓ RTW plan active</Badge>
                        )}
                        <Badge
                          variant={c.workStatus === "Off work" ? "warning" : "success"}
                          className="text-xs"
                        >{c.workStatus}</Badge>
                        <Badge
                          variant={
                            (c.riskLevel || "").toLowerCase() === "high"
                              ? "critical"
                              : (c.riskLevel || "").toLowerCase() === "medium"
                              ? "warning"
                              : "success"
                          }
                          className="text-xs"
                        >{c.riskLevel || "Unknown"}</Badge>
                        <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-blue-500" />
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* All Cases — flat list sorted by risk level */}
      <Card className="bg-card shadow-lg border-0">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="w-5 h-5 text-muted-foreground" />
            All Cases
            <Badge variant="secondary" className="ml-1">{sortedCases.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {sortedCases.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">No cases found.</div>
          ) : (
            <div className="divide-y divide-border">
              {sortedCases.map(c => {
                const risk = (c.riskLevel || '').toLowerCase();
                const borderClass = risk === 'high'
                  ? 'border-l-4 border-l-destructive'
                  : risk === 'medium'
                  ? 'border-l-4 border-l-amber-500'
                  : 'border-l-4 border-l-transparent';
                const needsApproval = c.rtwPlanStatus === 'pending_employer_review';
                return (
                  <div
                    key={c.id}
                    className={`flex items-center gap-4 px-4 py-3 hover:bg-muted/50 cursor-pointer group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${borderClass}`}
                    aria-label={`Open case for ${c.workerName}`}
                    {...clickableRowProps(() => navigate(`/employer/case/${c.id}`))}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground group-hover:text-primary truncate">{c.workerName}</p>
                        {needsApproval && (
                          <Badge variant="warning" className="text-xs shrink-0">Approval needed</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">{c.injuryDescription || '—'}</p>
                    </div>
                    <Badge
                      variant={c.workStatus === 'Off work' ? 'warning' : 'success'}
                      className="text-xs shrink-0"
                    >
                      {c.workStatus}
                    </Badge>
                    <div className="hidden md:block flex-1 min-w-0 max-w-xs">
                      <p className="text-xs text-muted-foreground truncate">{c.nextStep || c.currentStatus || '—'}</p>
                    </div>
                    <div className="hidden sm:block w-20 text-xs text-muted-foreground text-right shrink-0">
                      {c.dueDate ? new Date(c.dueDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—'}
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0" />
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>


    </div>
  );
}

export function EmployerDashboardPage() {
  const { data: dashboardData } = useQuery<DashboardData>({
    queryKey: ['employer-dashboard'],
    queryFn: () => fetch('/api/employer/dashboard').then(r => r.json()),
    staleTime: 60_000,
  });
  const organizationName = dashboardData?.organizationName ?? 'Dashboard';
  const { user } = useAuth();

  return (
    <PageLayout
      title={`${organizationName} Dashboard`}
      subtitle="Case Management Portal"
    >
      <EmployerDashboardContent />
      {user && <FirstTimeTour userRole={user.role} userId={user.id} />}
    </PageLayout>
  );
}

export default EmployerDashboardPage;