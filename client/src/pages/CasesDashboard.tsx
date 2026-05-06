import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { CompanyNav } from "@/components/CompanyNav";
import { SearchBar } from "@/components/SearchBar";
import { CasesTable } from "@/components/CasesTable";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DashboardStats, type StatFilter } from "@/components/dashboard-stats";
import { ActionQueueCard } from "@/components/ActionQueueCard";
import { ComponentErrorBoundary } from "@/components/ErrorBoundary";
import { ContextualHelpSystem } from "@/components/unified-case-management/ContextualHelpSystem";
import { FirstTimeTour } from "@/components/FirstTimeTour";
import { ComplianceDashboardWidget } from "@/components/ComplianceDashboardWidget";
import { GettingStartedChecklist } from "@/components/GettingStartedChecklist";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { queryClient, fetchWithCsrf } from "@/lib/queryClient";
import type { WorkerCase, PaginatedCasesResponse } from "@shared/schema";
import { isLegitimateCase, getSurname } from "@shared/schema";

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

const CLEARANCE_BADGE: Record<string, string> = {
  cleared_unconditional: "bg-green-100 text-green-800",
  cleared_conditional: "bg-teal-100 text-teal-800",
  cleared_with_restrictions: "bg-orange-100 text-orange-800",
  not_cleared: "bg-red-100 text-red-800",
  requires_review: "bg-yellow-100 text-yellow-800",
};

function fmtDate(s: string | null | undefined) {
  if (!s) return null;
  return new Date(s).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

export default function CasesDashboard() {
  const { logout, user } = useAuth();
  const navigate = useNavigate();
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statFilter, setStatFilter] = useState<StatFilter>('all');
  const { toast } = useToast();

  const { data: paginatedData, isLoading } = useQuery<PaginatedCasesResponse>({
    queryKey: ["/api/cases?limit=200"],
    refetchInterval: 120_000,
    staleTime: 60_000,
  });
  const cases = paginatedData?.cases ?? [];

  const { data: workersData } = useQuery<{ workers: WorkerSummary[] }>({
    queryKey: ["workers-summary"],
    queryFn: () => fetch("/api/workers", { credentials: "include" }).then(r => r.json()),
    staleTime: 60_000,
  });


  const syncMutation = useMutation({
    mutationFn: async () => {
      const response = await fetchWithCsrf("/api/freshdesk/sync", {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Failed to sync with Freshdesk");
      }
      return await response.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      // Only show toast if Freshdesk is configured or if manually triggered
      if (data.configured === false) {
        // Silently skip notification for unconfigured Freshdesk on initial load
        return;
      }
      toast({
        title: "Sync Complete",
        description: `Successfully synced ${data.synced} cases from Freshdesk`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Sync Failed",
        description: error.message || "Failed to sync with Freshdesk",
        variant: "destructive",
      });
    },
  });

  const sendCertificateAlertsMutation = useMutation({
    mutationFn: async () => {
      const response = await fetchWithCsrf("/api/notifications/send-certificate-alerts", {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error("Failed to send certificate alerts");
      }
      return await response.json();
    },
    onSuccess: (data: { sent: number; failed: number }) => {
      toast({
        title: "Certificate Alerts Sent",
        description: `Sent ${data.sent} worker email alerts${data.failed > 0 ? `, ${data.failed} failed` : ''}`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Alert Failed",
        description: error.message || "Failed to send certificate alerts",
        variant: "destructive",
      });
    },
  });

  // Freshdesk sync is now manual-only (via Sync button) to avoid blocking dashboard load

  const filteredCases = useMemo(() => {
    const filtered = cases.filter((c) => {
      // Filter out non-legitimate cases (generic emails, etc.) - defense in depth
      if (!isLegitimateCase(c)) {
        return false;
      }
      const matchesCompany = !selectedCompany || c.company === selectedCompany;
      const matchesSearch =
        !searchQuery ||
        c.workerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.company.toLowerCase().includes(searchQuery.toLowerCase());

      // Apply stat filter
      let matchesStatFilter = true;
      if (statFilter === 'off-work') {
        matchesStatFilter = c.workStatus === 'Off work';
      } else if (statFilter === 'at-work') {
        matchesStatFilter = c.workStatus === 'At work';
      } else if (statFilter === 'high-risk') {
        matchesStatFilter = c.complianceIndicator === 'High';
      } else if (statFilter === 'rtw-expiring') {
        // RTW expiring filter - check if case has active RTW plan that might be expiring
        const hasActivePlan = c.rtwPlanStatus === 'in_progress' || c.rtwPlanStatus === 'working_well';
        if (!hasActivePlan) {
          matchesStatFilter = false;
        } else {
          // Simplified check - in full implementation would use RTW compliance service
          const treatmentPlan = c.clinical_status_json?.treatmentPlan;
          if (treatmentPlan?.expectedDurationWeeks) {
            const planGeneratedAt = new Date(treatmentPlan.generatedAt);
            const planDurationMs = treatmentPlan.expectedDurationWeeks * 7 * 24 * 60 * 60 * 1000;
            const planEndDate = new Date(planGeneratedAt.getTime() + planDurationMs);
            const now = new Date();
            const daysUntilEnd = Math.ceil((planEndDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
            matchesStatFilter = daysUntilEnd >= 0 && daysUntilEnd <= 14;
          } else {
            matchesStatFilter = false;
          }
        }
      }

      return matchesCompany && matchesSearch && matchesStatFilter;
    });

    // Sort by surname (last name) within each company
    return filtered.sort((a, b) => {
      const surnameA = getSurname(a.workerName);
      const surnameB = getSurname(b.workerName);
      return surnameA.localeCompare(surnameB);
    });
  }, [cases, selectedCompany, searchQuery, statFilter]);

  const allWorkers = workersData?.workers ?? [];

  // Show workers when: search matches them, OR they are overdue/due_soon (always visible)
  const filteredWorkers = useMemo(() => {
    const overdueDueSoon = allWorkers.filter(
      w => w.recheckUrgency === "overdue" || w.recheckUrgency === "due_soon"
    );
    if (!searchQuery) return overdueDueSoon;
    const q = searchQuery.toLowerCase();
    const matched = allWorkers.filter(
      w => w.name.toLowerCase().includes(q) ||
           w.email?.toLowerCase().includes(q) ||
           w.latestPositionTitle?.toLowerCase().includes(q)
    );
    // Union: search matches + always-show overdue (deduped)
    const ids = new Set(matched.map(w => w.id));
    for (const w of overdueDueSoon) if (!ids.has(w.id)) matched.push(w);
    return matched;
  }, [allWorkers, searchQuery]);

  const availableCompanies = useMemo(() => {
    const companySet = new Set(
      cases
        .filter((c) => isLegitimateCase(c))
        .map((c) => c.company)
    );
    return Array.from(companySet).sort();
  }, [cases]);

  // Navigate to full case detail page when clicking a case
  const handleCaseClick = (caseId: string) => {
    navigate(`/summary/${caseId}`);
  };

  if (isLoading) {
    return (
      <div className="flex h-screen" aria-label="Loading dashboard" role="status">
        <aside className="hidden lg:flex lg:flex-col w-64 flex-shrink-0 bg-sidebar p-4 border-r border-sidebar-border">
          <Skeleton className="h-8 w-32 mb-8" />
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full mb-2" />
          ))}
        </aside>
        <main className="flex-1 p-6 space-y-4 overflow-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-10 w-full" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen">

      <aside className="hidden lg:flex lg:flex-col w-64 flex-shrink-0 bg-sidebar p-4 border-r border-sidebar-border">
        <div className="mb-8">
          <div className="flex items-center gap-3">
            <div className="bg-primary/20 rounded-full size-10 flex items-center justify-center">
              <span className="material-symbols-outlined text-primary">corporate_fare</span>
            </div>
            <h1 className="text-sidebar-foreground text-xl font-bold">Preventli</h1>
          </div>
          <div className="mt-1 ml-13 text-xs text-sidebar-foreground/60">
            v2024.11.05 • {cases.length} cases loaded
          </div>
        </div>

        {/* Quick Links */}
        <div className="mb-4 pb-4 border-b border-sidebar-border">
          <Link
            to="/reports"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
          >
            <span className="material-symbols-outlined text-lg">analytics</span>
            Reports & Analytics
          </Link>
          <Link
            to="/audit"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
          >
            <span className="material-symbols-outlined text-lg">history</span>
            Audit Log
          </Link>
        </div>

        <CompanyNav companies={availableCompanies} selectedCompany={selectedCompany} onSelectCompany={setSelectedCompany} />

        {/* Logout Button */}
        <div className="mt-auto pt-4 border-t border-sidebar-border">
          <Button
            variant="ghost"
            onClick={logout}
            className="w-full justify-start gap-2 text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <span className="material-symbols-outlined text-lg">logout</span>
            Log Out
          </Button>
        </div>
      </aside>

      <main className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col p-3 sm:p-4 overflow-y-auto">
          {/* Mobile Header */}
          <div className="lg:hidden mb-3 pb-2 border-b border-border">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="bg-primary/20 rounded-full size-8 flex items-center justify-center">
                  <span className="material-symbols-outlined text-primary text-lg">corporate_fare</span>
                </div>
                <div>
                  <h1 className="text-lg font-bold">Preventli</h1>
                  <div className="text-xs text-muted-foreground">
                    {cases.length} cases loaded
                  </div>
                </div>
              </div>
              <ThemeToggle />
            </div>
          </div>

          {/* Dashboard Stats - Full width overview */}
          <div className="mb-4">
            <DashboardStats
              cases={cases.filter(c => isLegitimateCase(c))}
              activeFilter={statFilter}
              onFilterChange={setStatFilter}
            />
          </div>

          {/* Compliance Overview */}
          <div className="mb-4">
            <ComplianceDashboardWidget className="col-span-1" />
          </div>

          {/* Search and Sync Row - Full width */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 mb-4">
            <SearchBar value={searchQuery} onChange={setSearchQuery} />
            <div className="flex items-center gap-2">
              <Button
                onClick={() => sendCertificateAlertsMutation.mutate()}
                disabled={sendCertificateAlertsMutation.isPending}
                data-testid="button-send-certificate-alerts"
                size="sm"
                variant="outline"
              >
                <span className="material-symbols-outlined text-base">
                  {sendCertificateAlertsMutation.isPending ? "sync" : "notification_important"}
                </span>
                <span className="font-bold hidden sm:inline">
                  {sendCertificateAlertsMutation.isPending ? "Sending..." : "Send Cert Alerts"}
                </span>
              </Button>
              <Button
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                data-testid="button-sync-freshdesk"
                size="sm"
              >
                <span className="material-symbols-outlined text-base">
                  {syncMutation.isPending ? "sync" : "refresh"}
                </span>
                <span className="font-bold hidden sm:inline">
                  {syncMutation.isPending ? "Syncing..." : "Sync Freshdesk"}
                </span>
              </Button>
              <ThemeToggle className="hidden lg:block" />
            </div>
          </div>

          {/* New Starters / Pre-Employment — shown when search matches workers or overdue */}
          {filteredWorkers.length > 0 && (
            <div className="mb-3 rounded-xl border border-border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-muted border-b border-border">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  New Starters · Pre-Employment ({filteredWorkers.length})
                </span>
                <Link to="/workers-list" className="text-xs text-primary hover:underline">View all</Link>
              </div>
              <div className="divide-y divide-border">
                {filteredWorkers.map(w => {
                  const urgency = w.recheckUrgency;
                  const urgBadge =
                    urgency === "overdue" ? "bg-red-100 text-red-800" :
                    urgency === "due_soon" ? "bg-amber-100 text-amber-800" : null;
                  return (
                    <Link
                      key={w.id}
                      to={`/workers/${w.id}`}
                      className="flex items-center gap-4 px-4 py-2.5 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-sm">{w.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">{w.latestPositionTitle ?? "—"}</span>
                      </div>
                      {w.latestClearanceLevel && (
                        <Badge className={`text-xs shrink-0 ${CLEARANCE_BADGE[w.latestClearanceLevel] ?? "bg-gray-100 text-gray-600"}`}>
                          {w.latestClearanceLevel.replace(/_/g, " ")}
                        </Badge>
                      )}
                      {urgBadge && w.nextCheckDue && (
                        <Badge className={`text-xs shrink-0 ${urgBadge}`}>
                          {urgency === "overdue" ? "OVERDUE" : "due " + fmtDate(w.nextCheckDue)}
                        </Badge>
                      )}
                      {!w.latestClearanceLevel && (
                        <span className="text-xs text-muted-foreground shrink-0">no check yet</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* Getting Started — shown only when org has no cases yet */}
          {cases.length === 0 && !isLoading && user && (
            <GettingStartedChecklist userId={user.id} />
          )}

          {/* Main Content: Cases Table + Action Queue Sidebar */}
          <div className="flex-1 flex gap-4 min-h-0">
            {/* Cases Table - Takes most of the space */}
            <div className="flex-1 min-w-0">
              <CasesTable
                cases={filteredCases}
                onCaseClick={handleCaseClick}
              />
            </div>

            {/* Action Queue Sidebar - Fixed width on larger screens */}
            <div className="hidden xl:block w-80 flex-shrink-0">
              <ComponentErrorBoundary label="Action Queue">
                <ActionQueueCard onCaseClick={handleCaseClick} limit={8} />
              </ComponentErrorBoundary>
            </div>
          </div>

        </div>
      </main>
      
      <ContextualHelpSystem mode="floating" showTips={true} userRole="case_manager" />
      {user && <FirstTimeTour userRole={user.role} userId={user.id} />}
    </div>
  );
}
