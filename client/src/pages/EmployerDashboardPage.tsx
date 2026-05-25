import { PageLayout } from "@/components/PageLayout";
import type { KeyboardEvent } from 'react';
import { useAuth } from "@/hooks/useAuth";
import { FirstTimeTour } from "@/components/FirstTimeTour";
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { PageSpinner } from '@/components/typography';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PaginatedCasesResponse } from '@shared/schema';

interface DashboardData {
  organizationName: string;
}

function keyboardRowProps(onActivate: () => void) {
  return {
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

function EmployerDashboardContent() {
  const navigate = useNavigate();

  const { data: allCasesData, isLoading, error } = useQuery<PaginatedCasesResponse>({
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

  const cases = allCasesData?.cases ?? [];
  const pendingApprovals = cases.filter(c => c.rtwPlanStatus === 'pending_employer_review');
  const sortedCases = [...cases].sort((a, b) => {
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

      {sortedCases.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <Layers className="mb-3 h-8 w-8" />
          <p className="text-sm">No cases for this view.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b bg-card">
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-6 py-3 font-medium">Worker</th>
                <th className="px-3 py-3 font-medium">Injury</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Next step</th>
                <th className="px-3 py-3 font-medium">Due</th>
              </tr>
            </thead>
            <tbody>
              {sortedCases.map(c => {
                const risk = (c.riskLevel || '').toLowerCase();
                const borderClass =
                  risk === 'high' ? 'border-l-4 border-l-destructive'
                  : risk === 'medium' ? 'border-l-4 border-l-amber-500'
                  : 'border-l-4 border-l-transparent';
                const badgeVariant: 'destructive' | 'default' | 'secondary' =
                  risk === 'high' ? 'destructive'
                  : risk === 'medium' ? 'default'
                  : 'secondary';
                const dueLabel = c.dueDate
                  ? new Date(c.dueDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
                  : '—';
                return (
                  <tr
                    key={c.id}
                    className={cn(
                      'cursor-pointer border-b transition hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      borderClass,
                    )}
                    aria-label={`Open case for ${c.workerName}`}
                    data-testid={`case-row-${c.id}`}
                    {...keyboardRowProps(() => navigate(`/employer/case/${c.id}`))}
                  >
                    <td className="px-6 py-3 font-medium">
                      <div className="flex items-center gap-2">
                        <span>{c.workerName}</span>
                        <Badge
                          variant={badgeVariant}
                          className="px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide"
                        >
                          {c.riskLevel || 'Unknown'}
                        </Badge>
                      </div>
                    </td>
                    <td className="px-3 py-3">{c.injuryDescription || '—'}</td>
                    <td className="px-3 py-3 text-muted-foreground">{c.currentStatus || '—'}</td>
                    <td className="px-3 py-3 text-muted-foreground">{c.nextStep || '—'}</td>
                    <td className="px-3 py-3 text-muted-foreground">{dueLabel}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
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
