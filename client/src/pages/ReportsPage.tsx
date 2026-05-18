import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import type { WorkerCase, PaginatedCasesResponse } from "@shared/schema";
import { isLegitimateCase } from "@shared/schema";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Link } from "react-router-dom";
import PortfolioCostCard from "@/components/PortfolioCostCard";

const COLORS = {
  compliance: {
    "Very High": "#10b981",
    "High": "#22c55e",
    "Medium": "#f59e0b",
    "Low": "#f97316",
    "Very Low": "#ef4444",
  },
  workStatus: {
    "At work": "#10b981",
    "Off work": "#f59e0b",
  },
};

export default function ReportsPage() {
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  const { data: paginatedData, isLoading } = useQuery<PaginatedCasesResponse>({
    queryKey: ["/api/cases"],
  });
  const cases = paginatedData?.cases ?? [];

  const legitimateCases = useMemo(() => {
    return cases.filter(isLegitimateCase);
  }, [cases]);

  const filteredCases = useMemo(() => {
    if (!selectedCompany) return legitimateCases;
    return legitimateCases.filter((c) => c.company === selectedCompany);
  }, [legitimateCases, selectedCompany]);

  const companies = useMemo(() => {
    const companySet = new Set(legitimateCases.map((c) => c.company));
    return Array.from(companySet).sort();
  }, [legitimateCases]);

  // Compliance distribution
  const complianceData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredCases.forEach((c) => {
      const level = c.complianceIndicator || "Unknown";
      counts[level] = (counts[level] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filteredCases]);

  // Work status distribution
  const workStatusData = useMemo(() => {
    const counts: Record<string, number> = {};
    filteredCases.forEach((c) => {
      const status = c.workStatus || "Unknown";
      counts[status] = (counts[status] || 0) + 1;
    });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filteredCases]);

  // Cases by company
  const companyData = useMemo(() => {
    const counts: Record<string, { total: number; atWork: number; offWork: number }> = {};
    legitimateCases.forEach((c) => {
      if (!counts[c.company]) {
        counts[c.company] = { total: 0, atWork: 0, offWork: 0 };
      }
      counts[c.company].total++;
      if (c.workStatus === "At work") {
        counts[c.company].atWork++;
      } else {
        counts[c.company].offWork++;
      }
    });
    return Object.entries(counts)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [legitimateCases]);

  // Certificate status
  const certificateStats = useMemo(() => {
    const stats = {
      withCert: 0,
      withoutCert: 0,
      expiringSoon: 0,
    };
    filteredCases.forEach((c) => {
      if (c.hasCertificate) {
        stats.withCert++;
      } else {
        stats.withoutCert++;
      }
    });
    return stats;
  }, [filteredCases]);

  // Cases needing attention
  const attentionCases = useMemo(() => {
    return filteredCases.filter(
      (c) =>
        c.complianceIndicator === "Low" ||
        c.complianceIndicator === "Very Low" ||
        !c.hasCertificate
    );
  }, [filteredCases]);

  // Average days since injury
  const avgDaysSinceInjury = useMemo(() => {
    if (filteredCases.length === 0) return 0;
    const totalDays = filteredCases.reduce((sum, c) => {
      if (c.dateOfInjury) {
        const injuryDate = new Date(c.dateOfInjury);
        const now = new Date();
        const days = Math.floor((now.getTime() - injuryDate.getTime()) / (1000 * 60 * 60 * 24));
        return sum + days;
      }
      return sum;
    }, 0);
    return Math.round(totalDays / filteredCases.length);
  }, [filteredCases]);

  // Spec 5.4 — CSV export
  function exportCasesCSV() {
    const headers = [
      "Case ID", "Worker", "Company", "Date of Injury", "Work Status",
      "Risk Level", "Compliance", "Has Certificate", "RTW Plan Status",
      "Lifecycle Stage", "Owner", "Due Date",
    ];
    const rows = filteredCases.map((c) => [
      c.id,
      c.workerName,
      c.company,
      c.dateOfInjury,
      c.workStatus,
      c.riskLevel,
      c.complianceIndicator,
      c.hasCertificate ? "Yes" : "No",
      c.rtwPlanStatus || "",
      c.lifecycleStage || "",
      c.owner,
      c.dueDate,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cases-report-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-lg">Loading reports...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link to="/" className="text-muted-foreground hover:text-foreground">
                <span className="material-symbols-outlined">arrow_back</span>
              </Link>
              <div>
                <h1 className="text-2xl font-bold">Reports & Analytics</h1>
                <p className="text-sm text-muted-foreground">
                  Overview of cases and compliance metrics
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <select
                className="px-3 py-2 border rounded-md bg-background text-sm"
                value={selectedCompany || ""}
                onChange={(e) => setSelectedCompany(e.target.value || null)}
              >
                <option value="">All Companies</option>
                {companies.map((company) => (
                  <option key={company} value={company}>
                    {company}
                  </option>
                ))}
              </select>
              <Button variant="outline" size="sm" onClick={exportCasesCSV} className="gap-2">
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6">
        {/* Portfolio cost estimate — org-wide aggregate (funding-bundle 2.5) */}
        <PortfolioCostCard className="mb-6" />

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-6">
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{filteredCases.length}</div>
              <div className="text-xs text-muted-foreground">Total Cases</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-emerald-600">
                {filteredCases.filter((c) => c.workStatus === "At work").length}
              </div>
              <div className="text-xs text-muted-foreground">At Work</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-amber-600">
                {filteredCases.filter((c) => c.workStatus === "Off work").length}
              </div>
              <div className="text-xs text-muted-foreground">Off Work</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold text-red-600">
                {attentionCases.length}
              </div>
              <div className="text-xs text-muted-foreground">Need Attention</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{certificateStats.withCert}</div>
              <div className="text-xs text-muted-foreground">With Certificate</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-2xl font-bold">{avgDaysSinceInjury}</div>
              <div className="text-xs text-muted-foreground">Avg Days Since Injury</div>
            </CardContent>
          </Card>
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Compliance Distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Compliance Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={complianceData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={({ name, percent }) =>
                        `${name}: ${(percent * 100).toFixed(0)}%`
                      }
                    >
                      {complianceData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            COLORS.compliance[entry.name as keyof typeof COLORS.compliance] ||
                            "#94a3b8"
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Work Status Distribution */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Work Status Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={workStatusData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={({ name, value }) => `${name}: ${value}`}
                    >
                      {workStatusData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            COLORS.workStatus[entry.name as keyof typeof COLORS.workStatus] ||
                            "#94a3b8"
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Cases by Company Chart */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Cases by Company (Top 10)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={companyData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis
                    dataKey="name"
                    type="category"
                    width={150}
                    tick={{ fontSize: 12 }}
                  />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="atWork" name="At Work" fill="#10b981" stackId="a" />
                  <Bar dataKey="offWork" name="Off Work" fill="#f59e0b" stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Cases Needing Attention */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <span className="material-symbols-outlined text-red-500">warning</span>
              Cases Needing Attention ({attentionCases.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {attentionCases.length === 0 ? (
              <div className="text-center py-4 text-muted-foreground">
                No cases currently need attention
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {attentionCases.slice(0, 20).map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50"
                  >
                    <div>
                      <div className="font-medium">{c.workerName}</div>
                      <div className="text-xs text-muted-foreground">{c.company}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        className={
                          c.complianceIndicator === "Low" ||
                          c.complianceIndicator === "Very Low"
                            ? "bg-red-100 text-red-800"
                            : "bg-slate-100 text-slate-800"
                        }
                      >
                        {c.complianceIndicator}
                      </Badge>
                      {!c.hasCertificate && (
                        <Badge variant="destructive" className="text-xs">
                          No Cert
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
                {attentionCases.length > 20 && (
                  <div className="text-center text-sm text-muted-foreground py-2">
                    And {attentionCases.length - 20} more...
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
