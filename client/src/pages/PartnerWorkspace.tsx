import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2, LogOut, Plus, Pencil, Layers } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

type ViewTab = "cases" | "risk" | "rtw";

const TAB_DEFS: { id: ViewTab; label: string; description: string }[] = [
  { id: "cases", label: "Cases", description: "All open cases — sorted by next action priority." },
  { id: "risk", label: "Risk", description: "High and medium-risk cases that need attention now." },
  { id: "rtw", label: "RTW", description: "Cases with an active return-to-work plan." },
];

/**
 * A case is "in RTW" when its workStatus indicates the worker is actively
 * progressing back to work — i.e. anything other than fully off / not started.
 * Keeps the rule deterministic so the demo behaves predictably.
 */
function isRtwCase(workStatus: string): boolean {
  const s = (workStatus ?? "").toLowerCase();
  if (!s) return false;
  // Off-work / pre-RTW states are excluded.
  if (s.includes("not started") || s.includes("off work") || s === "off") return false;
  return /rtw|return|graduated|suitable|modified|partial|reduced|light/.test(s);
}

export default function PartnerWorkspace() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const [selectedOrgId, setSelectedOrgId] = useState<string>(ALL_CLIENTS);
  const [activeTab, setActiveTab] = useState<ViewTab>("cases");
  const [formOpen, setFormOpen] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | undefined>(undefined);
  const [openingCaseId, setOpeningCaseId] = useState<string | null>(null);

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

  // Per-tab counts shown in the tab pills, computed from the same case list
  // the API already filtered by selected client.
  const tabCounts = useMemo(() => {
    return {
      cases: cases.length,
      risk: cases.filter((c) => c.riskLevel === "High" || c.riskLevel === "Medium").length,
      rtw: cases.filter((c) => isRtwCase(c.workStatus)).length,
    };
  }, [cases]);

  // Tab filter applied client-side over the same dataset.
  const visibleCases = useMemo(() => {
    if (activeTab === "risk") {
      return cases.filter((c) => c.riskLevel === "High" || c.riskLevel === "Medium");
    }
    if (activeTab === "rtw") return cases.filter((c) => isRtwCase(c.workStatus));
    return cases;
  }, [cases, activeTab]);

  const clientLabel =
    selectedOrgId === ALL_CLIENTS
      ? "All clients"
      : clients.find((c) => c.id === selectedOrgId)?.name ?? "Client";
  const tabSubtitle = TAB_DEFS.find((t) => t.id === activeTab)?.description ?? "";

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
          <div className="border-b px-6 pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {clientLabel}
            </p>
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as ViewTab)}
              className="mt-2"
            >
              <TabsList className="bg-transparent p-0">
                {TAB_DEFS.map((t) => (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                    className="gap-2 rounded-none border-b-2 border-transparent bg-transparent px-4 py-2 text-base data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                    data-testid={`tab-${t.id}`}
                  >
                    {t.label}
                    <Badge variant="secondary" className="text-xs">
                      {tabCounts[t.id]}
                    </Badge>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <p className="pb-3 pt-2 text-sm text-muted-foreground">{tabSubtitle}</p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {casesQuery.isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : visibleCases.length === 0 ? (
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
                  {visibleCases.map((c) => (
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
                          <span>{c.workerName}</span>
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
