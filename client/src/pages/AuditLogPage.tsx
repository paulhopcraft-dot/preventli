import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageLayout } from "@/components/PageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AuditEntry {
  id: string;
  timestamp: string;
  action: string;
  user: string;
  caseId: string;
  workerName: string;
  details: string;
  category: string;
}

interface AuditResponse {
  entries: AuditEntry[];
  total: number;
}

/**
 * Convert a dateRange shorthand ("1d", "7d", "30d", "90d", "all") to an ISO
 * date string suitable for the ?dateFrom query parameter, or undefined for "all".
 */
function dateFromRange(range: string): string | undefined {
  const daysMap: Record<string, number> = {
    "1d": 1,
    "7d": 7,
    "30d": 30,
    "90d": 90,
  };
  const days = daysMap[range];
  if (!days) return undefined;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

async function fetchAuditEvents(
  category: string,
  dateRange: string,
  search: string
): Promise<AuditResponse> {
  const params = new URLSearchParams();
  if (category !== "all") params.set("category", category);
  const dateFrom = dateFromRange(dateRange);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (search.trim()) params.set("search", search.trim());
  params.set("limit", "200");

  const res = await fetch(`/api/audit-events?${params.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch audit events");
  return res.json();
}

export default function AuditLogPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [dateRange, setDateRange] = useState("7d");

  const { data, isLoading, error } = useQuery<AuditResponse>({
    queryKey: ["/api/audit-events", categoryFilter, dateRange, searchQuery],
    queryFn: () => fetchAuditEvents(categoryFilter, dateRange, searchQuery),
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;

  const caseCount = entries.filter((e) => e.category === "case").length;
  const aiCount = entries.filter((e) => e.category === "ai").length;
  const complianceCount = entries.filter((e) => e.category === "compliance").length;

  const categoryColor = (category: string): string => {
    switch (category) {
      case "case":
        return "bg-blue-100 text-blue-800";
      case "status":
        return "bg-amber-100 text-amber-800";
      case "ai":
        return "bg-purple-100 text-purple-800";
      case "compliance":
        return "bg-emerald-100 text-emerald-800";
      default:
        return "bg-slate-100 text-slate-800";
    }
  };

  const categoryIcon = (category: string): string => {
    switch (category) {
      case "case":
        return "folder";
      case "status":
        return "sync";
      case "ai":
        return "psychology";
      case "compliance":
        return "verified";
      default:
        return "history";
    }
  };

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleString("en-AU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  if (isLoading) {
    return (
      <PageLayout title="Audit Log" subtitle="Loading...">
        <div className="flex items-center justify-center h-64">
          <span className="material-symbols-outlined animate-spin text-4xl text-primary">
            progress_activity
          </span>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Audit Log" subtitle="System activity and change history">
      <div className="space-y-6">
        {/* Filters */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <Input
                placeholder="Search by action, resource, or details..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-sm"
              />
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="case">Case</SelectItem>
                  <SelectItem value="status">Status</SelectItem>
                  <SelectItem value="ai">AI</SelectItem>
                  <SelectItem value="compliance">Compliance</SelectItem>
                </SelectContent>
              </Select>
              <Select value={dateRange} onValueChange={setDateRange}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Date range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1d">Last 24 hours</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="90d">Last 90 days</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                onClick={() => {
                  setSearchQuery("");
                  setCategoryFilter("all");
                  setDateRange("7d");
                }}
              >
                Reset Filters
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Entries
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{total}</div>
              {entries.length < total && (
                <p className="text-xs text-muted-foreground">
                  showing {entries.length}
                </p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Case Events
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{caseCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                AI Actions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-purple-600">{aiCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Compliance Checks
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">
                {complianceCount}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Audit Log Entries */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">history</span>
              Activity Log
            </CardTitle>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="text-center py-12 text-destructive">
                <span className="material-symbols-outlined text-4xl mb-4">
                  error
                </span>
                <p>Failed to load audit events. Please try again.</p>
              </div>
            ) : entries.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <span className="material-symbols-outlined text-4xl mb-4">
                  search_off
                </span>
                <p>No audit entries found matching your filters.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-start gap-4 p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex-shrink-0 w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
                      <span className="material-symbols-outlined text-primary text-lg">
                        {categoryIcon(entry.category)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{entry.action}</span>
                        <Badge className={categoryColor(entry.category)}>
                          {entry.category}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {entry.details}
                      </p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                        {entry.workerName && (
                          <span>Worker: {entry.workerName}</span>
                        )}
                        <span>By: {entry.user}</span>
                        <span>{formatTimestamp(entry.timestamp)}</span>
                      </div>
                    </div>
                  </div>
                ))}
                {total > entries.length && (
                  <p className="text-center text-sm text-muted-foreground pt-4">
                    Showing {entries.length} of {total} entries. Refine your
                    filters to see more specific results.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
