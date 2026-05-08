import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2, LogOut, Plus, Pencil, Layers } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClientSetupForm } from "@/components/partner/ClientSetupForm";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface ClientOrg {
  id: string;
  name: string;
  logoUrl: string | null;
  openCaseCount: number;
}

interface PartnerOrgInfo {
  id: string;
  name: string;
  logoUrl: string | null;
  kind: "employer" | "partner";
}

interface CaseRow {
  id: string;
  organizationId: string;
  organizationName: string;
  workerId: string | null;
  workerName: string;
  company: string;
  riskLevel: string;
  workStatus: string;
  /** Injury / case-type description shown as column 3 of the cases table. */
  summary: string;
  currentStatus: string;
  nextStep: string;
  dueDate: string;
  caseStatus: string;
}

const ALL_CLIENTS = "__all__";

export default function PartnerWorkspace() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const [selectedOrgId, setSelectedOrgId] = useState<string>(ALL_CLIENTS);
  const [formOpen, setFormOpen] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | undefined>(undefined);
  const [openingCaseId, setOpeningCaseId] = useState<string | null>(null);
  const [openingWorkerId, setOpeningWorkerId] = useState<string | null>(null);

  /**
   * Open a case from the partner workspace by reusing the rich employer
   * detail page. Partners' JWT activeOrganizationId is the partner org;
   * the employer page expects it to match the case's company. So we POST
   * /api/partner/active-org first to mint a fresh JWT scoped to the
   * case's organization, then navigate.
   */
  async function openCase(caseRow: CaseRow): Promise<void> {
    if (openingCaseId) return; // ignore double-clicks while a swap is in flight
    setOpeningCaseId(caseRow.id);
    try {
      await apiRequest("POST", "/api/partner/active-org", {
        organizationId: caseRow.organizationId,
      });
      // After the swap the cached cases list is for the previous org.
      // Invalidate so /employer/case/:id refetches against the new org.
      await queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      navigate(`/employer/case/${caseRow.id}`);
    } catch (err) {
      console.error("[partner] failed to open case", err);
      setOpeningCaseId(null);
    }
  }

  /**
   * Open a worker profile from the partner workspace. Same JWT-swap pattern
   * as openCase: the worker profile + timeline endpoints are scoped to the
   * active organization, so we mint a fresh JWT for the case's org first,
   * invalidate worker-scoped caches, then navigate to /workers/:workerId.
   */
  async function openWorkerProfile(caseRow: CaseRow): Promise<void> {
    if (!caseRow.workerId) return;
    if (openingWorkerId === caseRow.workerId) return; // ignore double-clicks
    setOpeningWorkerId(caseRow.workerId);
    try {
      await apiRequest("POST", "/api/partner/active-org", {
        organizationId: caseRow.organizationId,
      });
      // Invalidate worker-scoped query caches so the profile/timeline pages
      // refetch against the new active org.
      queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      queryClient.invalidateQueries({ queryKey: ["worker-profile"] });
      queryClient.invalidateQueries({ queryKey: ["worker-timeline"] });
      navigate(`/workers/${caseRow.workerId}`);
    } catch (err) {
      console.error("[partner] failed to open worker profile", err);
    } finally {
      setOpeningWorkerId(null);
    }
  }

  useEffect(() => {
    if (user && user.role !== "partner") {
      navigate("/", { replace: true });
    }
  }, [user, navigate]);

  const meQuery = useQuery<{ partnerOrg: PartnerOrgInfo | null; activeOrg: unknown }>({
    queryKey: ["partner", "me"],
    queryFn: async () => {
      const res = await fetch("/api/partner/me", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load partner context");
      return res.json();
    },
    enabled: user?.role === "partner",
  });

  const clientsQuery = useQuery<{ clients: ClientOrg[] }>({
    queryKey: ["partner", "clients"],
    queryFn: async () => {
      const res = await fetch("/api/partner/clients", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load clients");
      return res.json();
    },
    enabled: user?.role === "partner",
  });

  const casesQuery = useQuery<{ cases: CaseRow[] }>({
    queryKey: ["partner", "cases", selectedOrgId],
    queryFn: async () => {
      const url =
        selectedOrgId === ALL_CLIENTS
          ? "/api/partner/cases"
          : `/api/partner/cases?organizationId=${encodeURIComponent(selectedOrgId)}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load cases");
      return res.json();
    },
    enabled: user?.role === "partner",
  });

  const partnerName = meQuery.data?.partnerOrg?.name ?? "Partner";
  const partnerLogoUrl = meQuery.data?.partnerOrg?.logoUrl ?? null;
  const clients = clientsQuery.data?.clients ?? [];
  const cases = casesQuery.data?.cases ?? [];

  const totalOpen = useMemo(
    () => clients.reduce((acc, c) => acc + c.openCaseCount, 0),
    [clients],
  );

  const headerTitle =
    selectedOrgId === ALL_CLIENTS
      ? "All cases"
      : (clients.find((c) => c.id === selectedOrgId)?.name ?? "Client") + " — cases";

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b bg-card">
        <div className="flex items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            {partnerLogoUrl ? (
              <img
                src={partnerLogoUrl}
                alt={`${partnerName} logo`}
                className="h-9 w-9 rounded object-contain"
              />
            ) : (
              <div className="flex h-9 w-9 items-center justify-center rounded bg-primary text-primary-foreground">
                <Building2 className="h-5 w-5" />
              </div>
            )}
            <div>
              <p className="text-sm font-semibold leading-tight">{partnerName}</p>
              <p className="text-xs text-muted-foreground">Partner workspace</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user?.email}
            </span>
            <Button variant="ghost" size="sm" onClick={() => logout()} data-testid="sign-out">
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="flex w-72 flex-shrink-0 flex-col border-r bg-card">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Clients
            </h2>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => {
                setEditingClientId(undefined);
                setFormOpen(true);
              }}
              data-testid="add-client-button"
            >
              <Plus className="h-3.5 w-3.5" />
              Add
            </Button>
          </div>

          <nav className="flex-1 overflow-y-auto py-2">
            <button
              type="button"
              onClick={() => setSelectedOrgId(ALL_CLIENTS)}
              className={cn(
                "flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm transition hover:bg-muted",
                selectedOrgId === ALL_CLIENTS && "bg-muted font-medium",
              )}
              data-testid="sidebar-all-clients"
            >
              <span className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-muted-foreground" />
                All clients
              </span>
              <Badge variant="secondary" className="text-xs">
                {totalOpen}
              </Badge>
            </button>

            <div className="my-2 border-t" />

            {clientsQuery.isLoading ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : clients.length === 0 ? (
              <p className="px-4 py-4 text-xs text-muted-foreground">
                No clients yet. Click <span className="font-medium">Add</span> to create one.
              </p>
            ) : (
              clients.map((c) => {
                const isActive = selectedOrgId === c.id;
                return (
                  <div
                    key={c.id}
                    className={cn(
                      "group flex items-center gap-2 px-4 py-2 transition hover:bg-muted",
                      isActive && "bg-muted",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedOrgId(c.id)}
                      className="flex flex-1 items-center gap-2 text-left text-sm"
                      data-testid={`sidebar-client-${c.id}`}
                    >
                      {c.logoUrl ? (
                        <img
                          src={c.logoUrl}
                          alt=""
                          className="h-5 w-5 flex-shrink-0 rounded object-contain"
                        />
                      ) : (
                        <Building2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                      )}
                      <span className={cn("truncate", isActive && "font-medium")}>
                        {c.name}
                      </span>
                    </button>
                    <Badge variant="secondary" className="text-xs">
                      {c.openCaseCount}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 opacity-0 transition group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingClientId(c.id);
                        setFormOpen(true);
                      }}
                      data-testid={`edit-client-${c.id}`}
                      aria-label={`Edit ${c.name}`}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                );
              })
            )}
          </nav>
        </aside>

        <main className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b px-6 py-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">{headerTitle}</h1>
              <p className="text-sm text-muted-foreground">
                Sorted by next action priority — open cases first, highest risk, soonest due.
              </p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {casesQuery.isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : cases.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
                <Layers className="mb-3 h-8 w-8" />
                <p className="text-sm">No cases for this view.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 border-b bg-card">
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-6 py-3 font-medium">Worker</th>
                    {selectedOrgId === ALL_CLIENTS && (
                      <th className="px-3 py-3 font-medium">Client</th>
                    )}
                    <th className="px-3 py-3 font-medium">Injury</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="px-3 py-3 font-medium">Next step</th>
                    <th className="px-3 py-3 font-medium">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {cases.map((c) => (
                    <tr
                      key={c.id}
                      className={cn(
                        "cursor-pointer border-b transition hover:bg-muted",
                        // Subtle left-border tint preserves risk signal without a column.
                        c.riskLevel === "High"
                          ? "border-l-4 border-l-destructive"
                          : c.riskLevel === "Medium"
                            ? "border-l-4 border-l-amber-500"
                            : "border-l-4 border-l-transparent",
                      )}
                      onClick={() => openCase(c)}
                      aria-busy={openingCaseId === c.id}
                      data-testid={`case-row-${c.id}`}
                    >
                      <td className="px-6 py-3 font-medium">
                        <div className="flex items-center gap-2">
                          {c.workerId ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openWorkerProfile(c);
                              }}
                              className="hover:underline focus:underline focus:outline-none text-left"
                              disabled={openingWorkerId === c.workerId}
                              data-testid={`worker-link-${c.id}`}
                            >
                              {c.workerName}
                            </button>
                          ) : (
                            <span title="Worker profile unavailable">{c.workerName}</span>
                          )}
                          <Badge
                            variant={
                              c.riskLevel === "High"
                                ? "destructive"
                                : c.riskLevel === "Medium"
                                  ? "default"
                                  : "secondary"
                            }
                            className="px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide"
                          >
                            {c.riskLevel}
                          </Badge>
                        </div>
                      </td>
                      {selectedOrgId === ALL_CLIENTS && (
                        <td className="px-3 py-3 text-muted-foreground">
                          {c.organizationName}
                        </td>
                      )}
                      <td className="px-3 py-3">{c.summary}</td>
                      <td className="px-3 py-3 text-muted-foreground">{c.currentStatus}</td>
                      <td className="px-3 py-3 text-muted-foreground">{c.nextStep}</td>
                      <td className="px-3 py-3 text-muted-foreground">{c.dueDate}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </main>
      </div>

      <ClientSetupForm
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o);
          if (!o) setEditingClientId(undefined);
        }}
        clientId={editingClientId}
      />
    </div>
  );
}
