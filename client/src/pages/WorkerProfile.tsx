import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageLayout } from "@/components/PageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Clock, CheckCircle, Calendar, UserPlus, ArrowRight, TrendingUp } from "lucide-react";
import { TimelineNode } from "@/components/TimelineNode";

interface Assessment {
  id: string;
  positionTitle: string;
  status: string;
  clearanceLevel: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string | null;
}

interface WorkerProfileData {
  worker: {
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    organizationId: string | null;
    createdAt: string;
  };
  assessments: Assessment[];
  bookings: Array<{
    id: string;
    serviceType: string | null;
    appointmentType: string;
    status: string;
    createdAt: string;
  }>;
  nextCheckDue: string | null;
  recheckUrgency: "overdue" | "due_soon" | "upcoming" | "pending" | "not_applicable" | null;
  lastClearanceLevel: string | null;
  lastCompletedAt: string | null;
}

// Months between checks per clearance level
const RECHECK_MONTHS: Record<string, number> = {
  cleared_unconditional: 12,
  cleared_conditional: 12,
  cleared_with_restrictions: 6,
};

const CLEARANCE_LABEL: Record<string, string> = {
  cleared_unconditional: "Cleared",
  cleared_conditional: "Cleared (Conditional)",
  cleared_with_restrictions: "Cleared with Restrictions",
  not_cleared: "Not Cleared",
  requires_review: "Requires Review",
};

const CLEARANCE_STYLE: Record<string, { dot: string; badge: string }> = {
  cleared_unconditional:    { dot: "bg-green-500",  badge: "bg-green-100 text-green-800 border-green-200" },
  cleared_conditional:      { dot: "bg-teal-500",   badge: "bg-teal-100 text-teal-800 border-teal-200" },
  cleared_with_restrictions:{ dot: "bg-orange-500", badge: "bg-orange-100 text-orange-800 border-orange-200" },
  not_cleared:              { dot: "bg-red-500",     badge: "bg-red-100 text-red-800 border-red-200" },
  requires_review:          { dot: "bg-yellow-500",  badge: "bg-yellow-100 text-yellow-800 border-yellow-200" },
};

function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function daysFromNow(s: string): number {
  return Math.round((new Date(s).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

// ─── Aggressive recheck banner ────────────────────────────────────────────────
function RecheckBanner({ urgency, nextCheckDue, lastClearanceLevel, workerName }: {
  urgency: WorkerProfileData["recheckUrgency"];
  nextCheckDue: string | null;
  lastClearanceLevel: string | null;
  workerName: string;
}) {
  if (!urgency || urgency === "not_applicable") return null;

  if (urgency === "pending") {
    return (
      <div className="flex items-center gap-3 p-4 rounded-lg border bg-blue-50 border-blue-200 text-blue-900">
        <Clock className="h-5 w-5 shrink-0 text-blue-600" />
        <div className="flex-1">
          <p className="font-semibold text-sm">Assessment in progress</p>
          <p className="text-xs text-blue-700 mt-0.5">Awaiting worker questionnaire response.</p>
        </div>
      </div>
    );
  }

  if (urgency === "overdue") {
    const daysLate = nextCheckDue ? Math.abs(daysFromNow(nextCheckDue)) : 0;
    return (
      <div className="rounded-lg border-2 border-red-400 bg-red-50 p-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-red-100">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-red-900 text-sm">Health check {daysLate} days overdue</p>
            <p className="text-xs text-red-700 mt-1">
              {workerName}&apos;s {lastClearanceLevel?.replace(/_/g, " ")} clearance expired {formatDate(nextCheckDue)}.
              Employer may have unverified liability. Schedule a new check immediately.
            </p>
          </div>
          <Button size="sm" className="shrink-0 bg-red-600 hover:bg-red-700 text-white" asChild>
            <Link to="/assessments/new">
              <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
              Schedule Now
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (urgency === "due_soon") {
    const days = nextCheckDue ? daysFromNow(nextCheckDue) : 0;
    return (
      <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 mt-0.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100">
              <Clock className="h-5 w-5 text-amber-600" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-amber-900 text-sm">Health check due in {days} days</p>
            <p className="text-xs text-amber-700 mt-1">
              Due {formatDate(nextCheckDue)}. Book early — checks often take 1–2 weeks to complete.
              Last result: <span className="font-medium">{lastClearanceLevel?.replace(/_/g, " ")}</span>.
            </p>
          </div>
          <Button size="sm" className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white" asChild>
            <Link to="/assessments/new">
              <Calendar className="h-3.5 w-3.5 mr-1.5" />
              Book Check
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  if (urgency === "upcoming") {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg border bg-green-50 border-green-200 text-green-900">
        <CheckCircle className="h-4 w-4 shrink-0 text-green-600" />
        <p className="text-sm flex-1">
          Next check recommended <span className="font-semibold">{formatDate(nextCheckDue)}</span>.
          <span className="text-green-700"> Book early to avoid delays.</span>
        </p>
        <Button size="sm" variant="outline" className="shrink-0 border-green-400 text-green-800 hover:bg-green-100" asChild>
          <Link to="/assessments/new">Schedule Early</Link>
        </Button>
      </div>
    );
  }

  return null;
}

// ─── Full check history timeline ───────────────────────────────────────────────
function CheckTimeline({
  assessments,
  recheckUrgency,
  nextCheckDue,
  lastClearanceLevel,
}: {
  assessments: Assessment[];
  recheckUrgency: WorkerProfileData["recheckUrgency"];
  nextCheckDue: string | null;
  lastClearanceLevel: string | null;
}) {
  const completed = assessments.filter(
    (a) => a.status === "completed" && a.clearanceLevel,
  );

  // Build timeline nodes from oldest to newest
  const checkNodes = [...completed].reverse();

  const showFutureNode =
    nextCheckDue &&
    recheckUrgency &&
    !["not_applicable", "pending"].includes(recheckUrgency);

  const hasItems = checkNodes.length > 0 || showFutureNode;

  if (!hasItems) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Calendar className="h-10 w-10 mx-auto mb-3 text-gray-300" />
        <p className="text-sm font-medium">No checks on record</p>
        <p className="text-xs mt-1">Start this worker&apos;s health check history.</p>
        <Button size="sm" className="mt-4" asChild>
          <Link to="/assessments/new">
            <UserPlus className="h-3.5 w-3.5 mr-1.5" />
            Schedule First Check
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="pt-1">
      {checkNodes.map((a, i) => {
        const isLastCompleted = i === checkNodes.length - 1;
        const isLast = isLastCompleted && !showFutureNode;
        const style = CLEARANCE_STYLE[a.clearanceLevel!] ?? { dot: "bg-gray-400", badge: "bg-gray-100 text-gray-700 border-gray-200" };
        const completedDate = a.updatedAt ?? a.createdAt;

        // Compute next check from this assessment
        const recheckMonths = RECHECK_MONTHS[a.clearanceLevel!];
        let nextDue: Date | null = null;
        if (recheckMonths) {
          nextDue = new Date(completedDate);
          nextDue.setMonth(nextDue.getMonth() + recheckMonths);
        }

        return (
          <TimelineNode
            key={a.id}
            date={formatDate(completedDate)}
            isLast={isLast}
            dotClass={style.dot}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{a.positionTitle}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  <Badge className={`text-xs border ${style.badge}`}>
                    {CLEARANCE_LABEL[a.clearanceLevel!] ?? a.clearanceLevel}
                  </Badge>
                  {nextDue && (
                    <span className="text-xs text-muted-foreground">
                      → next check {formatDate(nextDue.toISOString())}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </TimelineNode>
        );
      })}

      {/* Pending assessment node (in-progress, not completed) */}
      {assessments.filter(a => ["sent", "in_progress", "created"].includes(a.status)).map(a => (
        <TimelineNode
          key={a.id}
          date={a.sentAt ? formatDate(a.sentAt) : formatDate(a.createdAt)}
          isLast={!showFutureNode}
          dotClass="bg-blue-400 animate-pulse"
        >
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-blue-700">{a.positionTitle}</p>
            <Badge className="text-xs border bg-blue-100 text-blue-800 border-blue-200">In progress</Badge>
          </div>
        </TimelineNode>
      ))}

      {/* Future node — next check due */}
      {showFutureNode && nextCheckDue && (
        <TimelineNode
          date={formatDate(nextCheckDue)}
          isLast
          isFuture
          dotClass=""
        >
          {recheckUrgency === "overdue" ? (
            <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-red-800">
                  Next check — {Math.abs(daysFromNow(nextCheckDue))} days overdue
                </p>
                <p className="text-xs text-red-600 mt-0.5">
                  Last: {lastClearanceLevel?.replace(/_/g, " ")} · due {formatDate(nextCheckDue)}
                </p>
              </div>
              <Button size="sm" className="shrink-0 bg-red-600 hover:bg-red-700 text-white" asChild>
                <Link to="/assessments/new">
                  Schedule Now <ArrowRight className="h-3 w-3 ml-1" />
                </Link>
              </Button>
            </div>
          ) : recheckUrgency === "due_soon" ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-amber-800">
                  Next check — due in {daysFromNow(nextCheckDue)} days
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  {formatDate(nextCheckDue)} · allow 1–2 weeks for completion
                </p>
              </div>
              <Button size="sm" className="shrink-0 bg-amber-500 hover:bg-amber-600 text-white" asChild>
                <Link to="/assessments/new">
                  Book Now <ArrowRight className="h-3 w-3 ml-1" />
                </Link>
              </Button>
            </div>
          ) : (
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
              <p className="text-sm text-muted-foreground">
                Next check recommended — {formatDate(nextCheckDue)}
                {" "}({daysFromNow(nextCheckDue)} days)
              </p>
            </div>
          )}
        </TimelineNode>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function WorkerProfile() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery<WorkerProfileData>({
    queryKey: ["worker-profile", id],
    queryFn: () =>
      fetch(`/api/workers/${id}`, { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error("Failed to load worker profile");
        return r.json();
      }),
    enabled: Boolean(id),
  });

  if (isLoading) {
    return (
      <PageLayout title="Worker Profile">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </PageLayout>
    );
  }

  if (error || !data) {
    return (
      <PageLayout title="Worker Profile">
        <div className="text-center py-12 text-muted-foreground">Worker not found.</div>
      </PageLayout>
    );
  }

  const { worker, assessments, bookings, nextCheckDue, recheckUrgency, lastClearanceLevel, lastCompletedAt } = data;

  // Stat summary
  const completedCount = assessments.filter(a => a.status === "completed").length;
  const latestClearance = assessments.find(a => a.status === "completed" && a.clearanceLevel);

  return (
    <PageLayout title={worker.name} subtitle="Worker Health Profile">
      <div className="max-w-3xl space-y-4">

        {/* Top alert banner */}
        <RecheckBanner
          urgency={recheckUrgency}
          nextCheckDue={nextCheckDue}
          lastClearanceLevel={lastClearanceLevel}
          workerName={worker.name}
        />

        {/* Summary stat strip */}
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Checks completed</p>
              <p className="text-2xl font-bold mt-0.5">{completedCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Current clearance</p>
              <p className="text-sm font-semibold mt-1 leading-tight">
                {latestClearance?.clearanceLevel
                  ? CLEARANCE_LABEL[latestClearance.clearanceLevel] ?? latestClearance.clearanceLevel.replace(/_/g, " ")
                  : "No clearance"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Next check</p>
              <p className="text-sm font-semibold mt-1 leading-tight">
                {nextCheckDue ? formatDate(nextCheckDue) : "—"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Check history timeline */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">Check History</CardTitle>
              </div>
              <Button size="sm" asChild>
                <Link to="/assessments/new">
                  <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                  New Check
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <CheckTimeline
              assessments={assessments}
              recheckUrgency={recheckUrgency}
              nextCheckDue={nextCheckDue}
              lastClearanceLevel={lastClearanceLevel}
            />
          </CardContent>
        </Card>

        {/* Contact details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground text-xs">Email</p>
              <p>{worker.email ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Phone</p>
              <p>{worker.phone ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Added</p>
              <p>{formatDate(worker.createdAt)}</p>
            </div>
            {lastCompletedAt && (
              <div>
                <p className="text-muted-foreground text-xs">Last check completed</p>
                <p>{formatDate(lastCompletedAt)}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Telehealth bookings */}
        {bookings.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Telehealth Bookings ({bookings.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="divide-y">
                {bookings.map((b) => (
                  <div key={b.id} className="py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">
                        {b.serviceType?.replace(/_/g, " ") ?? "General"} · {b.appointmentType.replace(/_/g, " ")}
                      </p>
                      <p className="text-xs text-muted-foreground">{formatDate(b.createdAt)}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">{b.status}</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </PageLayout>
  );
}
