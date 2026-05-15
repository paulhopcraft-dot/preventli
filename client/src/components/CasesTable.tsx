import type { WorkerCase, CaseLifecycleStage } from "@shared/schema";
import { LIFECYCLE_STAGE_LABELS } from "@shared/schema";
import { RiskBadge } from "./RiskBadge";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useState, useMemo, useCallback, memo } from "react";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Search,
  Stethoscope,
  User,
} from "lucide-react";
import { MilestoneBadge } from "./MilestoneBadge";

const LIFECYCLE_COLORS: Record<CaseLifecycleStage, string> = {
  intake: "bg-slate-100 text-slate-700 border-slate-300",
  assessment: "bg-blue-100 text-blue-700 border-blue-300",
  active_treatment: "bg-amber-100 text-amber-700 border-amber-300",
  rtw_transition: "bg-purple-100 text-purple-700 border-purple-300",
  maintenance: "bg-teal-100 text-teal-700 border-teal-300",
  closed_rtw: "bg-green-100 text-green-700 border-green-300",
  closed_medical_retirement: "bg-gray-100 text-gray-700 border-gray-300",
  closed_terminated: "bg-red-100 text-red-700 border-red-300",
  closed_claim_denied: "bg-orange-100 text-orange-700 border-orange-300",
  closed_other: "bg-gray-100 text-gray-700 border-gray-300",
};

type SortField = "urgency" | "daysOffWork" | "lifecycle" | "dueDate" | "workerName";
type SortDir = "asc" | "desc";

interface Filters {
  search: string;
  lifecycleStages: CaseLifecycleStage[];
  riskLevels: string[];
  complianceStatuses: string[];
  rtwStatuses: string[];
  employer: string;
}

interface CasesTableProps {
  cases: WorkerCase[];
  selectedCaseId?: string | null;
  onCaseClick?: (caseId: string) => void;
  currentUserId?: string;
  currentUserName?: string;
}

function daysOffWork(c: WorkerCase): number {
  if (!c.dateOfInjury) return 0;
  return Math.floor((Date.now() - new Date(c.dateOfInjury).getTime()) / 86_400_000);
}

/** Extract XGBoost probability score from the AI summary text field.
 *  Returns a 0–1 float or null if not present. */
function extractXGBoostScore(aiSummaryText: string | null | undefined): number | null {
  if (!aiSummaryText) return null;
  const match = aiSummaryText.match(/xgboost\s+risk\s+([\d.]+)/i);
  if (!match || !match[1]) return null;
  const val = parseFloat(match[1]);
  return isNaN(val) ? null : val;
}

/** Derive effective risk level — XGBoost overrides the stored value when it signals higher risk. */
function effectiveRiskLevel(c: WorkerCase): "High" | "Medium" | "Low" {
  const stored: "High" | "Medium" | "Low" = c.riskLevel ?? "Medium";
  const xgb = extractXGBoostScore(c.aiSummary);
  if (xgb === null) return stored;
  if (xgb >= 0.8) return "High";
  if (xgb >= 0.6) return stored === "Low" ? "Medium" : stored;
  return stored;
}

function urgencyScore(c: WorkerCase): number {
  // Higher = more urgent. Overdue red flag cases get highest score.
  const compliance = c.complianceIndicator?.toLowerCase() ?? "";
  const risk = effectiveRiskLevel(c).toLowerCase();
  let score = 0;
  if (compliance === "low" || compliance === "very low") score += 100;
  else if (compliance === "medium") score += 50;
  if (risk === "high") score += 40;
  else if (risk === "medium") score += 20;
  score += Math.min(daysOffWork(c) / 10, 50);
  return score;
}

const ACTIVE_STAGES = new Set<CaseLifecycleStage>([
  "intake", "assessment", "active_treatment", "rtw_transition", "maintenance",
]);

interface CaseRowProps {
  c: WorkerCase;
  isSelected: boolean;
  onCaseClick?: (id: string) => void;
}

const CaseRow = memo(function CaseRow({ c, isSelected, onCaseClick }: CaseRowProps) {
  const stage = (c.lifecycleStage ?? "intake") as CaseLifecycleStage;
  const days = daysOffWork(c);
  const complianceLow = ["Low", "Very Low"].includes(c.complianceIndicator ?? "");
  const score = urgencyScore(c);
  const urgencyLabel = score >= 100 ? "Critical" : score >= 60 ? "High" : score >= 30 ? "Medium" : "Low";
  const urgencyCls = score >= 100 ? "text-red-600 font-semibold" : score >= 60 ? "text-amber-600" : "text-muted-foreground";

  return (
    <tr
      key={c.id}
      onClick={() => onCaseClick?.(c.id)}
      className={cn(
        "cursor-pointer transition-colors",
        isSelected ? "bg-primary/10 dark:bg-primary/20" : "hover:bg-muted/50"
      )}
      data-testid={`row-case-${c.id}`}
    >
      <td className="px-4 py-3">
        <div className="font-medium text-card-foreground">{c.workerName}</div>
        <div className="text-xs text-muted-foreground">{c.company}</div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-1">
          <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium border", LIFECYCLE_COLORS[stage])}>
            {LIFECYCLE_STAGE_LABELS[stage]}
          </span>
          {c.rtwPlanStatus === "pending_employer_review" && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium border bg-yellow-50 text-yellow-700 border-yellow-300 w-fit">
              ⏳ Awaiting employer
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col gap-0.5">
          <span className={cn("text-sm font-medium", days > 90 ? "text-red-600" : days > 30 ? "text-amber-600" : "text-muted-foreground")}>
            Day {days}
          </span>
          {c.workStatus === "Off work" && c.dateOfInjury && (
            <MilestoneBadge dateOfInjury={c.dateOfInjury as string} />
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <RiskBadge level={effectiveRiskLevel(c)} type="risk" explanation={c.compliance?.reason} />
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1 flex-wrap">
          {complianceLow && <AlertTriangle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />}
          <RiskBadge level={c.complianceIndicator} type="compliance" compliance={c.compliance} />
          {c.gpEscalation?.escalated && (
            <span
              title={`GP cert expired ${c.gpEscalation.daysOverdue} days ago — chase GP or trigger IME`}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium border bg-orange-50 text-orange-700 border-orange-300"
              data-testid={`badge-gp-escalation-${c.id}`}
            >
              <Stethoscope className="h-3 w-3" />
              GP {c.gpEscalation.daysOverdue}d
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3">
        <span className={cn("text-xs", urgencyCls)}>{urgencyLabel}</span>
      </td>
      <td className="px-4 py-3">
        {c.caseManagerName ? (
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium text-primary">
              {c.caseManagerName.charAt(0).toUpperCase()}
            </div>
            <span className="text-xs text-muted-foreground truncate max-w-[80px]">{c.caseManagerName}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-xs text-muted-foreground/50">
            <User className="h-3.5 w-3.5" />
            <span>Unassigned</span>
          </div>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{c.dueDate}</td>
    </tr>
  );
});

export function CasesTable({ cases, selectedCaseId, onCaseClick, currentUserId, currentUserName }: CasesTableProps) {
  const [myCasesOnly, setMyCasesOnly] = useState(false);
  const [gpEscalationOnly, setGpEscalationOnly] = useState(false);
  const [sortField, setSortField] = useState<SortField>("urgency");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filters, setFilters] = useState<Filters>({
    search: "",
    lifecycleStages: [],
    riskLevels: [],
    complianceStatuses: [],
    rtwStatuses: [],
    employer: "",
  });
  const [showFilters, setShowFilters] = useState(false);

  const employers = useMemo(() => {
    const set = new Set(cases.map(c => c.company));
    return Array.from(set).sort();
  }, [cases]);

  const activeStages = useMemo(
    () => Array.from(new Set(cases.map(c => c.lifecycleStage ?? "intake"))) as CaseLifecycleStage[],
    [cases]
  );

  const filteredSorted = useMemo(() => {
    let result = cases.filter(c => {
      if (myCasesOnly && currentUserId && c.caseManagerId !== currentUserId) return false;
      if (gpEscalationOnly && !c.gpEscalation?.escalated) return false;

      const q = filters.search.toLowerCase();
      if (q && !c.workerName.toLowerCase().includes(q) && !c.id.toLowerCase().includes(q)) return false;

      if (filters.lifecycleStages.length > 0) {
        const stage = (c.lifecycleStage ?? "intake") as CaseLifecycleStage;
        if (!filters.lifecycleStages.includes(stage)) return false;
      }

      if (filters.riskLevels.length > 0 && !filters.riskLevels.includes(c.riskLevel)) return false;

      if (filters.employer && c.company !== filters.employer) return false;

      return true;
    });

    result = [...result].sort((a, b) => {
      let diff = 0;
      if (sortField === "urgency") diff = urgencyScore(b) - urgencyScore(a);
      else if (sortField === "daysOffWork") diff = daysOffWork(b) - daysOffWork(a);
      else if (sortField === "workerName") diff = a.workerName.localeCompare(b.workerName);
      else if (sortField === "dueDate") diff = (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
      else if (sortField === "lifecycle") {
        const order: CaseLifecycleStage[] = ["intake", "assessment", "active_treatment", "rtw_transition", "maintenance", "closed_rtw", "closed_medical_retirement", "closed_terminated", "closed_claim_denied", "closed_other"];
        diff = order.indexOf((a.lifecycleStage ?? "intake") as CaseLifecycleStage) - order.indexOf((b.lifecycleStage ?? "intake") as CaseLifecycleStage);
      }
      return sortDir === "asc" ? diff : -diff;
    });

    return result;
  }, [cases, myCasesOnly, gpEscalationOnly, currentUserId, filters, sortField, sortDir]);

  const gpEscalationCount = useMemo(() => cases.filter(c => c.gpEscalation?.escalated).length, [cases]);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  }

  function toggleFilter<K extends keyof Filters>(key: K, value: string) {
    setFilters(prev => {
      const arr = prev[key] as string[];
      const next = arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value];
      return { ...prev, [key]: next };
    });
  }

  const handleCaseClick = useCallback((id: string) => {
    onCaseClick?.(id);
  }, [onCaseClick]);

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronsUpDown className="h-3 w-3 opacity-40" />;
    return sortDir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />;
  }

  const hasActiveFilters = filters.lifecycleStages.length > 0 || filters.riskLevels.length > 0 || filters.employer || myCasesOnly || gpEscalationOnly;

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* My Cases toggle */}
        <div className="flex rounded-md border border-border overflow-hidden text-sm">
          <button
            onClick={() => setMyCasesOnly(false)}
            className={cn("px-3 py-1.5 transition-colors", !myCasesOnly ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted text-muted-foreground")}
          >
            All Cases
          </button>
          <button
            onClick={() => setMyCasesOnly(true)}
            className={cn("px-3 py-1.5 transition-colors border-l border-border", myCasesOnly ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted text-muted-foreground")}
          >
            My Cases
          </button>
        </div>

        {/* GP Escalation toggle */}
        {gpEscalationCount > 0 && (
          <button
            onClick={() => setGpEscalationOnly(v => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm transition-colors",
              gpEscalationOnly
                ? "bg-orange-600 text-white border-orange-600"
                : "bg-card text-muted-foreground border-border hover:bg-orange-50 hover:text-orange-700 hover:border-orange-300"
            )}
            data-testid="filter-gp-escalation"
            title="Filter to cases where the GP cert is overdue"
          >
            <Stethoscope className="h-3.5 w-3.5" />
            GP escalation
            <span className={cn(
              "px-1.5 py-0.5 rounded-full text-[10px] font-semibold",
              gpEscalationOnly ? "bg-white/20" : "bg-orange-100 text-orange-700"
            )}>{gpEscalationCount}</span>
          </button>
        )}

        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search worker or case ID..."
            value={filters.search}
            onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            className="pl-8 h-8 text-sm"
          />
        </div>

        <Button
          variant={showFilters ? "default" : "outline"}
          size="sm"
          onClick={() => setShowFilters(f => !f)}
          className="h-8"
        >
          Filters {hasActiveFilters && <span className="ml-1.5 bg-primary-foreground text-primary rounded-full w-4 h-4 text-xs flex items-center justify-center">{[filters.lifecycleStages.length, filters.riskLevels.length, filters.employer ? 1 : 0, myCasesOnly ? 1 : 0].reduce((a, b) => a + b, 0)}</span>}
        </Button>

        <span className="text-sm text-muted-foreground ml-auto">
          {filteredSorted.length} of {cases.length} cases
        </span>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3 text-sm">
          {/* Lifecycle stage chips */}
          <div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Lifecycle Stage</span>
            <div className="flex flex-wrap gap-1.5">
              {activeStages.filter(s => ACTIVE_STAGES.has(s)).map(stage => (
                <button
                  key={stage}
                  onClick={() => toggleFilter("lifecycleStages", stage)}
                  className={cn(
                    "px-2.5 py-0.5 rounded-full border text-xs font-medium transition-all",
                    filters.lifecycleStages.includes(stage)
                      ? LIFECYCLE_COLORS[stage] + " ring-2 ring-offset-1 ring-current"
                      : "bg-card border-border text-muted-foreground hover:border-current " + LIFECYCLE_COLORS[stage]
                  )}
                >
                  {LIFECYCLE_STAGE_LABELS[stage]}
                </button>
              ))}
            </div>
          </div>

          {/* Risk level chips */}
          <div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Risk Level</span>
            <div className="flex gap-1.5">
              {["High", "Medium", "Low"].map(r => (
                <button
                  key={r}
                  onClick={() => toggleFilter("riskLevels", r)}
                  className={cn(
                    "px-2.5 py-0.5 rounded-full border text-xs font-medium transition-all",
                    filters.riskLevels.includes(r)
                      ? r === "High" ? "bg-red-100 text-red-700 border-red-300 ring-2 ring-offset-1 ring-red-400"
                        : r === "Medium" ? "bg-amber-100 text-amber-700 border-amber-300 ring-2 ring-offset-1 ring-amber-400"
                        : "bg-green-100 text-green-700 border-green-300 ring-2 ring-offset-1 ring-green-400"
                      : "bg-card border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  {r}
                </button>
              ))}
            </div>
          </div>

          {/* Employer */}
          <div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide block mb-1.5">Employer</span>
            <select
              value={filters.employer}
              onChange={e => setFilters(f => ({ ...f, employer: e.target.value }))}
              className="h-7 text-xs rounded border border-border bg-card px-2"
            >
              <option value="">All employers</option>
              {employers.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>

          {hasActiveFilters && (
            <button
              onClick={() => { setFilters({ search: "", lifecycleStages: [], riskLevels: [], complianceStatuses: [], rtwStatuses: [], employer: "" }); setMyCasesOnly(false); setGpEscalationOnly(false); }}
              className="text-xs text-primary hover:underline"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-auto bg-card rounded-xl border border-border">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted border-b border-border sticky top-0 z-10">
            <tr>
              <th className="px-4 py-3 font-medium text-muted-foreground">
                <button onClick={() => toggleSort("workerName")} className="flex items-center gap-1 hover:text-foreground">
                  Worker <SortIcon field="workerName" />
                </button>
              </th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Stage</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">
                <button onClick={() => toggleSort("daysOffWork")} className="flex items-center gap-1 hover:text-foreground">
                  Days Off <SortIcon field="daysOffWork" />
                </button>
              </th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Risk</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Compliance</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">
                <button onClick={() => toggleSort("urgency")} className="flex items-center gap-1 hover:text-foreground">
                  Urgency <SortIcon field="urgency" />
                </button>
              </th>
              <th className="px-4 py-3 font-medium text-muted-foreground">Assigned</th>
              <th className="px-4 py-3 font-medium text-muted-foreground">
                <button onClick={() => toggleSort("dueDate")} className="flex items-center gap-1 hover:text-foreground">
                  Due <SortIcon field="dueDate" />
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredSorted.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                  {hasActiveFilters ? "No cases match the current filters." : "No cases found."}
                </td>
              </tr>
            ) : (
              filteredSorted.map((c) => (
                <CaseRow
                  key={c.id}
                  c={c}
                  isSelected={selectedCaseId === c.id}
                  onCaseClick={handleCaseClick}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
