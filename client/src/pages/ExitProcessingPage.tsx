import React from "react";
import { useQuery } from "@tanstack/react-query";
import { PageLayout } from "@/components/PageLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Heart,
  Shield,
  CheckCircle,
  Clock,
  AlertTriangle,
  Users,
  Calendar
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface ExitCase {
  id: string;
  employeeName: string;
  department: string;
  exitDate: string | null;
  status: "pending_health_check" | "health_check_complete" | "pending_final_review";
  reason: string;
  finalHealthCheckRequired: boolean;
  documentsCompleted: number;
  totalDocuments: number;
}

interface ExitSummary {
  totalCases: number;
  healthChecksPending: number;
  healthChecksRequired: number;
  documentsCompleted: number;
  totalDocuments: number;
  liabilityReadyForClosure: number;
  lastUpdated: string;
}

async function fetchExitCases(): Promise<{ cases: ExitCase[] }> {
  const res = await fetch("/api/exit-processing/cases", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch exit processing cases");
  return res.json();
}

async function fetchExitSummary(): Promise<{ summary: ExitSummary }> {
  const res = await fetch("/api/exit-processing/summary", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch exit processing summary");
  return res.json();
}

export default function ExitProcessingPage() {
  const { data: casesData, isLoading: casesLoading, error: casesError } = useQuery({
    queryKey: ["exit-processing", "cases"],
    queryFn: fetchExitCases,
  });

  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ["exit-processing", "summary"],
    queryFn: fetchExitSummary,
  });

  const exitCases = casesData?.cases ?? [];
  const summary = summaryData?.summary;

  const docPct = summary && summary.totalDocuments > 0
    ? Math.round((summary.documentsCompleted / summary.totalDocuments) * 100)
    : 0;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending_health_check":
        return (
          <Badge variant="outline" className="bg-yellow-50 text-yellow-800 border-yellow-300">
            <Clock className="h-3 w-3 mr-1" />
            Health Check Pending
          </Badge>
        );
      case "health_check_complete":
        return (
          <Badge variant="outline" className="bg-green-50 text-green-800 border-green-300">
            <CheckCircle className="h-3 w-3 mr-1" />
            Health Check Complete
          </Badge>
        );
      case "pending_final_review":
        return (
          <Badge variant="outline" className="bg-blue-50 text-blue-800 border-blue-300">
            <Shield className="h-3 w-3 mr-1" />
            Final Review Pending
          </Badge>
        );
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const getReasonBadge = (reason: string) => {
    const colors: Record<string, string> = {
      resignation: "bg-blue-100 text-blue-800",
      redundancy: "bg-orange-100 text-orange-800",
      retirement: "bg-purple-100 text-purple-800",
      termination: "bg-red-100 text-red-800",
    };
    return (
      <Badge
        variant="secondary"
        className={colors[reason] ?? "bg-gray-100 text-gray-800"}
      >
        {reason.charAt(0).toUpperCase() + reason.slice(1)}
      </Badge>
    );
  };

  // Action items: health checks pending + docs incomplete
  const healthCheckActions = exitCases.filter((c) => c.status === "pending_health_check");
  const docsIncompleteActions = exitCases.filter(
    (c) => c.documentsCompleted < c.totalDocuments
  );

  return (
    <PageLayout title="Exit Processing" subtitle="Employee departure health and compliance management">
      <div className="space-y-6">

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Exit Cases</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{summary?.totalCases ?? 0}</div>
                  <p className="text-xs text-muted-foreground">
                    {summary?.healthChecksRequired ?? 0} requiring health checks
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Health Checks Pending</CardTitle>
              <Heart className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{summary?.healthChecksPending ?? 0}</div>
                  <p className="text-xs text-muted-foreground">Awaiting completion</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Documentation Complete</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{docPct}%</div>
                  <p className="text-xs text-muted-foreground">
                    {summary?.documentsCompleted ?? 0} of {summary?.totalDocuments ?? 0} documents
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Liability Closure</CardTitle>
              <Shield className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {summaryLoading ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{summary?.liabilityReadyForClosure ?? 0}</div>
                  <p className="text-xs text-muted-foreground">Ready for closure</p>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Exit Cases Table */}
        <Card>
          <CardHeader>
            <CardTitle>Exit Processing Cases</CardTitle>
            <CardDescription>
              Track employee departures, final health assessments, and compliance documentation
            </CardDescription>
          </CardHeader>
          <CardContent>
            {casesLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : casesError ? (
              <div className="flex items-center gap-2 p-4 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                <p>Failed to load exit processing cases. Please refresh and try again.</p>
              </div>
            ) : exitCases.length === 0 ? (
              <div className="py-8 text-center text-muted-foreground">
                No closed cases found for exit processing.
              </div>
            ) : (
              <div className="space-y-4">
                {exitCases.map((exitCase) => (
                  <div key={exitCase.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex-1">
                      <div className="flex items-center gap-4 mb-2">
                        <h3 className="font-semibold">{exitCase.employeeName}</h3>
                        <span className="text-sm text-muted-foreground">{exitCase.department}</span>
                        {getStatusBadge(exitCase.status)}
                        {getReasonBadge(exitCase.reason)}
                      </div>

                      <div className="flex items-center gap-6 text-sm text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Calendar className="h-4 w-4" />
                          Exit Date: {exitCase.exitDate ?? "Not set"}
                        </div>

                        <div className="flex items-center gap-1">
                          <FileText className="h-4 w-4" />
                          Documents: {exitCase.documentsCompleted}/{exitCase.totalDocuments}
                        </div>

                        {exitCase.finalHealthCheckRequired && (
                          <div className="flex items-center gap-1">
                            <Heart className="h-4 w-4" />
                            Health Check Required
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button variant="outline" size="sm">
                        View Details
                      </Button>
                      {exitCase.status === "pending_final_review" && (
                        <Button size="sm">Complete Exit</Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Action Items */}
        {!casesLoading && (healthCheckActions.length > 0 || docsIncompleteActions.length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle>Action Items</CardTitle>
              <CardDescription>Tasks requiring immediate attention</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {healthCheckActions.map((c) => (
                  <div
                    key={`hc-${c.id}`}
                    className="flex items-center gap-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg"
                  >
                    <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="font-medium">Final health check required for {c.employeeName}</p>
                      <p className="text-sm text-muted-foreground">
                        Exit date: {c.exitDate ?? "TBD"}
                      </p>
                    </div>
                    <Button size="sm" variant="outline">
                      Schedule
                    </Button>
                  </div>
                ))}

                {docsIncompleteActions
                  .filter((c) => c.status !== "pending_health_check")
                  .map((c) => (
                    <div
                      key={`doc-${c.id}`}
                      className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg"
                    >
                      <FileText className="h-5 w-5 text-blue-600 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="font-medium">Complete exit documentation for {c.employeeName}</p>
                        <p className="text-sm text-muted-foreground">
                          {c.totalDocuments - c.documentsCompleted} document
                          {c.totalDocuments - c.documentsCompleted !== 1 ? "s" : ""} remaining
                        </p>
                      </div>
                      <Button size="sm" variant="outline">
                        Complete
                      </Button>
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
