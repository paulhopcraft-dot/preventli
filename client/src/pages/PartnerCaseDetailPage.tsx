import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { CaseAction } from "@shared/schema";
import { CaseActionPlanCard } from "@/components/CaseActionPlanCard";
import { fetchWithCsrf } from "@/lib/queryClient";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  Circle,
  AlertCircle,
  Briefcase,
  Activity,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface TimelineEvent {
  date: string;
  label: string;
  detail: string;
  kind: "milestone" | "completed" | "upcoming" | "overdue";
}

interface CaseDetail {
  case: {
    id: string;
    organizationId: string;
    organizationName: string;
    workerName: string;
    company: string;
    riskLevel: string;
    workStatus: string;
    summary: string;
    currentStatus: string;
    nextStep: string;
    dueDate: string;
    caseStatus: string;
    dateOfInjury: string;
    claimNumber: string | null;
  };
  recovery: {
    weeks: number;
    isInjury: boolean;
    daysSinceInjury: number;
    expectedReturnDate: string;
    progressPct: number;
  };
  timeline: TimelineEvent[];
}

function formatDate(iso: string): string {
  // Plain ISO yyyy-mm-dd → "Mon 5 May" style. Au-friendly, short.
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function riskBadgeVariant(risk: string): "destructive" | "default" | "secondary" {
  if (risk === "High") return "destructive";
  if (risk === "Medium") return "default";
  return "secondary";
}

export default function PartnerCaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  useEffect(() => {
    if (user && user.role !== "partner") {
      navigate("/", { replace: true });
    }
  }, [user, navigate]);

  const detailQuery = useQuery<CaseDetail>({
    queryKey: ["partner", "case", id],
    queryFn: async () => {
      const res = await fetch(`/api/partner/cases/${id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load case");
      return res.json();
    },
    enabled: !!id && user?.role === "partner",
  });

  const { data: pendingActionsData, refetch: refetchActionsPartner } = useQuery<{ data: CaseAction[] }>({
    queryKey: [`/api/actions/pending`, id],
    queryFn: async () => {
      const response = await fetchWithCsrf(`/api/actions/pending?limit=100`);
      if (!response.ok) throw new Error("Failed to fetch actions");
      return response.json();
    },
    enabled: !!id && user?.role === "partner",
  });
  const caseActions = pendingActionsData?.data?.filter((action: CaseAction) =>
    action.caseId === id && action.status === "pending"
  ) ?? [];

  if (detailQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <p className="text-sm text-muted-foreground">
            We couldn't load this case.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="mt-3"
            onClick={() => navigate("/")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to workspace
          </Button>
        </div>
      </div>
    );
  }

  const { case: c, recovery, timeline } = detailQuery.data;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-6 py-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate("/")}
            data-testid="back-to-workspace"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Workspace
          </Button>
          <div className="flex-1" />
          <Badge variant={riskBadgeVariant(c.riskLevel)} className="uppercase tracking-wide">
            {c.riskLevel} risk
          </Badge>
          <Badge variant="outline">{c.workStatus}</Badge>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        {/* Header */}
        <div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Building2 className="h-4 w-4" />
            <span>{c.organizationName}</span>
            {c.claimNumber ? (
              <>
                <span>•</span>
                <span className="font-mono">{c.claimNumber}</span>
              </>
            ) : null}
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">{c.workerName}</h1>
          <p className="mt-1 text-base text-muted-foreground">{c.summary}</p>
        </div>

        {/* Injury / case overview */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-muted-foreground" />
              {recovery.isInjury ? "Injury overview" : "Case overview"}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {recovery.isInjury ? "Date of injury" : "Case opened"}
              </p>
              <p className="mt-1 font-medium">{formatDate(c.dateOfInjury)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {recovery.isInjury ? "Days since injury" : "Days open"}
              </p>
              <p className="mt-1 font-medium">{recovery.daysSinceInjury} days</p>
            </div>
            {recovery.isInjury ? (
              <>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Expected recovery
                  </p>
                  <p className="mt-1 font-medium">{recovery.weeks} weeks</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Target return
                  </p>
                  <p className="mt-1 font-medium">{formatDate(recovery.expectedReturnDate)}</p>
                </div>
              </>
            ) : (
              <>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Track
                  </p>
                  <p className="mt-1 font-medium">Preventative</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Target close
                  </p>
                  <p className="mt-1 font-medium">{formatDate(recovery.expectedReturnDate)}</p>
                </div>
              </>
            )}
          </CardContent>
          {recovery.isInjury ? (
            <CardContent className="pt-0">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Recovery progress</span>
                <span>{recovery.progressPct}%</span>
              </div>
              <Progress value={recovery.progressPct} className="mt-1 h-2" />
            </CardContent>
          ) : null}
        </Card>

        {/* Recovery timeline */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              Recovery timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-4">
              {timeline.map((ev, idx) => {
                const Icon =
                  ev.kind === "completed"
                    ? CheckCircle2
                    : ev.kind === "overdue"
                      ? AlertCircle
                      : Circle;
                const iconColor =
                  ev.kind === "completed"
                    ? "text-emerald-600"
                    : ev.kind === "overdue"
                      ? "text-destructive"
                      : ev.kind === "milestone"
                        ? "text-primary"
                        : "text-muted-foreground";
                return (
                  <li key={idx} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <Icon className={cn("h-5 w-5", iconColor)} />
                      {idx < timeline.length - 1 ? (
                        <div className="my-1 w-px flex-1 bg-border" />
                      ) : null}
                    </div>
                    <div className="flex-1 pb-2">
                      <div className="flex items-baseline gap-3">
                        <p className="text-sm font-medium">{ev.label}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(ev.date)}</p>
                      </div>
                      <p className="mt-0.5 text-sm text-muted-foreground">{ev.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>

        {/* Current action */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Briefcase className="h-4 w-4 text-muted-foreground" />
              Current action
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Status</p>
              <p className="mt-1 text-sm">{c.currentStatus}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Next step</p>
              <p className="mt-1 text-sm">{c.nextStep}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Due</p>
              <p className="mt-1 text-sm">{formatDate(c.dueDate)}</p>
            </div>
          </CardContent>
        </Card>

        <CaseActionPlanCard
          caseId={id!}
          actions={caseActions}
          workerName={c.workerName}
          onActionUpdate={() => refetchActionsPartner()}
        />
      </main>
    </div>
  );
}
