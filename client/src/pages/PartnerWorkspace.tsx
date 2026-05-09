import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Loader2,
  LogOut,
  Plus,
  Pencil,
  Layers,
  ChevronRight,
  ChevronDown,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
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

type ViewTab =
  | "cases"
  | "risk"
  | "rtw"
  | "checks"
  | "checkins"
  | "financials"
  | "predictions"
  | "audit";

interface TabDef {
  id: ViewTab;
  label: string;
  description: string;
  /**
   * Tabs whose content is "drill into a single client" link to a route in
   * the existing employer view (after a JWT swap). `null` means the tab
   * renders its content inline (Cases / Risk / RTW).
   */
  deepLink: string | null;
}

const TAB_DEFS: TabDef[] = [
  {
    id: "cases",
    label: "Cases",
    description: "All open cases — sorted by next action priority.",
    deepLink: null,
  },
  {
    id: "risk",
    label: "Risk",
    description: "High and medium-risk cases that need attention now.",
    deepLink: null,
  },
  {
    id: "rtw",
    label: "RTW",
    description: "Cases with an active return-to-work plan.",
    deepLink: null,
  },
  {
    id: "checks",
    label: "Checks",
    description: "Health checks — pre-employment, wellness, mental health, exit.",
    deepLink: "/checks",
  },
  {
    id: "checkins",
    label: "Check-ins",
    description: "Upcoming and recent worker check-ins.",
    deepLink: "/checkins",
  },
  {
    id: "financials",
    label: "Financials",
    description: "Cost analysis and financial overview.",
    deepLink: "/financials",
  },
  {
    id: "predictions",
    label: "Predictions",
    description: "Predicted risks and recovery trajectories.",
    deepLink: "/predictions",
  },
  {
    id: "audit",
    label: "Audit",
    description: "System activity and change history.",
    deepLink: "/audit",
  },
];

interface NewAction {
  id: "case" | "check" | "rtw";
  label: string;
  /** Path inside the chosen client's employer view. */
  path: string;
}

const NEW_ACTIONS: NewAction[] = [
  { id: "case", label: "New case", path: "/employer/new-case" },
  { id: "check", label: "Send a check", path: "/checks" },
  { id: "rtw", label: "New RTW plan", path: "/rtw-planner" },
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
  const [openingWorkerId, setOpeningWorkerId] = useState<string | null>(null);
  /** When set, opens the client-picker dialog before navigating to `path`. */
  const [pendingNav, setPendingNav] = useState<{ path: string; label: string } | null>(null);
  const [navigatingToClient, setNavigatingToClient] = useState<string | null>(null);

  /**
   * JWT-swap into the given client org and navigate to a path inside the
   * existing employer view. Used for the deep-link tabs (Checks, Check-ins,
   * Financials, Predictions, Audit) and the "+ New" actions, which all reuse
   * existing employer-side pages rather than rebuilding cross-client UIs.
   */
  async function swapAndNavigate(orgId: string, path: string): Promise<void> {
    if (navigatingToClient) return;
    setNavigatingToClient(orgId);
    try {
      await apiRequest("POST", "/api/partner/active-org", { organizationId: orgId });
      await queryClient.invalidateQueries({ queryKey: ["/api/cases"] });
      navigate(path);
    } catch (err) {
      console.error("[partner] failed to swap+navigate", err);
      setNavigatingToClient(null);
    }
  }

  /**
   * Resolve a tab/action click that needs a chosen client. If a specific
   * client is already selected on the left rail, jump straight in. Otherwise
   * open the client-picker dialog.
   */
  function requestNav(path: string, label: string): void {
    if (selectedOrgId !== ALL_CLIENTS) {
      void swapAndNavigate(selectedOrgId, path);
      return;
    }
    setPendingNav({ path, label });
  }

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

  // Per-tab counts shown in the tab pills. `null` = no badge for that tab
  // (used for deep-link tabs where we don't have cross-client counts).
  const tabCounts = useMemo<Record<ViewTab, number | null>>(() => {
    return {
      cases: cases.length,
      risk: cases.filter((c) => c.riskLevel === "High" || c.riskLevel === "Medium").length,
      rtw: cases.filter((c) => isRtwCase(c.workStatus)).length,
      checks: null,
      checkins: null,
      financials: null,
      predictions: null,
      audit: null,
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

  const activeDef = TAB_DEFS.find((t) => t.id === activeTab) ?? TAB_DEFS[0];
  const showsCaseTable = activeDef.deepLink === null;
  const selectedClient =
    selectedOrgId === ALL_CLIENTS ? null : clients.find((c) => c.id === selectedOrgId) ?? null;
  const clientLabel = selectedClient?.name ?? "All clients";
  const tabSubtitle = activeDef.description;

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
            <div className="flex items-start justify-between gap-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {clientLabel}
              </p>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" className="h-8 gap-1" data-testid="new-action-button">
                    <Plus className="h-4 w-4" />
                    New
                    <ChevronDown className="h-3 w-3 opacity-70" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {NEW_ACTIONS.map((a) => (
                    <DropdownMenuItem
                      key={a.id}
                      onClick={() => requestNav(a.path, a.label)}
                      data-testid={`new-action-${a.id}`}
                    >
                      {a.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as ViewTab)}
              className="mt-2"
            >
              <TabsList className="h-auto flex-wrap justify-start bg-transparent p-0">
                {TAB_DEFS.map((t) => (
                  <TabsTrigger
                    key={t.id}
                    value={t.id}
                    className="gap-2 rounded-none border-b-2 border-transparent bg-transparent px-4 py-2 text-base data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
                    data-testid={`tab-${t.id}`}
                  >
                    {t.label}
                    {tabCounts[t.id] !== null && (
                      <Badge variant="secondary" className="text-xs">
                        {tabCounts[t.id]}
                      </Badge>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <p className="pb-3 pt-2 text-sm text-muted-foreground">{tabSubtitle}</p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {!showsCaseTable ? (
              <DeepLinkPanel
                tab={activeDef}
                clients={clients}
                selectedClient={selectedClient}
                onPickClient={(orgId) => swapAndNavigate(orgId, activeDef.deepLink as string)}
                navigatingTo={navigatingToClient}
              />
            ) : casesQuery.isLoading ? (
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
                          {c.workerId ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openCase(c);
                              }}
                              className="hover:underline focus:underline focus:outline-none text-left"
                              disabled={openingCaseId === c.id}
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

      <Dialog
        open={pendingNav !== null}
        onOpenChange={(o) => {
          if (!o) setPendingNav(null);
        }}
      >
        <DialogContent className="max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Pick a client</DialogTitle>
            <DialogDescription>
              {pendingNav?.label ?? "Action"} — choose which client this is for.
            </DialogDescription>
          </DialogHeader>
          <div className="-mx-1 max-h-[60vh] overflow-y-auto px-1">
            {clients.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No clients yet — add one from the sidebar first.
              </p>
            ) : (
              <ul className="divide-y">
                {clients.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center justify-between gap-3 px-2 py-2 text-left text-sm transition hover:bg-muted",
                        navigatingToClient === c.id && "opacity-50",
                      )}
                      onClick={() => {
                        if (!pendingNav) return;
                        const path = pendingNav.path;
                        setPendingNav(null);
                        void swapAndNavigate(c.id, path);
                      }}
                      data-testid={`client-picker-${c.id}`}
                    >
                      <span className="flex items-center gap-2">
                        {c.logoUrl ? (
                          <img
                            src={c.logoUrl}
                            alt=""
                            className="h-6 w-6 flex-shrink-0 rounded object-contain"
                          />
                        ) : (
                          <Building2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                        )}
                        <span className="truncate">{c.name}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface DeepLinkPanelProps {
  tab: TabDef;
  clients: ClientOrg[];
  selectedClient: ClientOrg | null;
  onPickClient: (orgId: string) => void;
  navigatingTo: string | null;
}

/**
 * Content for the deep-link tabs (Checks / Check-ins / Financials /
 * Predictions / Audit). When a client is selected on the left rail, we show
 * a single big "View [Client]'s [Tab]" CTA that JWT-swaps. When "All clients"
 * is selected, we show a per-client grid so the partner can drill in directly.
 */
function DeepLinkPanel({
  tab,
  clients,
  selectedClient,
  onPickClient,
  navigatingTo,
}: DeepLinkPanelProps): JSX.Element {
  if (selectedClient) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mx-auto max-w-md space-y-4">
          <h2 className="text-xl font-semibold">
            {selectedClient.name} — {tab.label}
          </h2>
          <p className="text-sm text-muted-foreground">{tab.description}</p>
          <Button
            size="lg"
            className="gap-2"
            onClick={() => onPickClient(selectedClient.id)}
            disabled={navigatingTo !== null}
            data-testid={`open-deeplink-${tab.id}`}
          >
            {navigatingTo === selectedClient.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            Open {tab.label}
          </Button>
        </div>
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
        <Layers className="mb-3 h-8 w-8" />
        <p className="text-sm">No clients yet — add one from the sidebar first.</p>
      </div>
    );
  }

  return (
    <div className="px-6 py-6">
      <p className="mb-4 text-sm text-muted-foreground">
        Pick a client to view their {tab.label.toLowerCase()}:
      </p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-md border bg-card px-3 py-3 text-left text-sm transition hover:bg-muted",
                navigatingTo === c.id && "opacity-50",
              )}
              onClick={() => onPickClient(c.id)}
              disabled={navigatingTo !== null}
              data-testid={`deeplink-client-${c.id}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                {c.logoUrl ? (
                  <img
                    src={c.logoUrl}
                    alt=""
                    className="h-6 w-6 flex-shrink-0 rounded object-contain"
                  />
                ) : (
                  <Building2 className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                )}
                <span className="truncate font-medium">{c.name}</span>
              </span>
              <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
