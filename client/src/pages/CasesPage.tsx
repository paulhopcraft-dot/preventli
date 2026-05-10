import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { PageLayout } from "@/components/PageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { WorkerCase, PaginatedCasesResponse } from "@shared/schema";
import { isLegitimateCase } from "@shared/schema";

export default function CasesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: paginatedData, isLoading } = useQuery<PaginatedCasesResponse>({
    queryKey: ["/api/cases"],
  });
  const cases = paginatedData?.cases ?? [];

  const isOpenCase = (c: WorkerCase) => c.caseStatus !== "closed";

  const filteredCases = useMemo(() => {
    return cases.filter((c) => {
      if (!isLegitimateCase(c)) return false;
      if (!isOpenCase(c)) return false;

      const matchesSearch =
        !searchQuery ||
        c.workerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.company.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "at-work" && c.workStatus === "At work") ||
        (statusFilter === "off-work" && c.workStatus === "Off work");

      return matchesSearch && matchesStatus;
    });
  }, [cases, searchQuery, statusFilter]);

  const stats = useMemo(() => {
    const active = cases.filter((c) => isLegitimateCase(c) && isOpenCase(c));
    return {
      total: active.length,
      atWork: active.filter((c) => c.workStatus === "At work").length,
      offWork: active.filter((c) => c.workStatus === "Off work").length,
      highRisk: active.filter((c) => c.riskLevel === "High").length,
    };
  }, [cases]);

  const riskBadgeColor = (level: string) => {
    switch (level) {
      case "High":
        return "bg-red-100 text-red-800";
      case "Medium":
        return "bg-amber-100 text-amber-800";
      default:
        return "bg-emerald-100 text-emerald-800";
    }
  };

  if (isLoading) {
    return (
      <PageLayout title="Cases" subtitle="Loading...">
        <div className="flex items-center justify-center h-64">
          <span className="material-symbols-outlined animate-spin text-4xl text-primary">
            progress_activity
          </span>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Cases" subtitle="Manage all worker compensation cases">
      <div className="space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">
                Total Cases
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">
                At Work
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">{stats.atWork}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">
                Off Work
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{stats.offWork}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-600">
                High Risk
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{stats.highRisk}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <Input
            placeholder="Search by worker name or company..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-sm"
          />
          <div className="flex gap-2">
            <Button
              variant={statusFilter === "all" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("all")}
            >
              All
            </Button>
            <Button
              variant={statusFilter === "at-work" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("at-work")}
            >
              At Work
            </Button>
            <Button
              variant={statusFilter === "off-work" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("off-work")}
            >
              Off Work
            </Button>
          </div>
        </div>

        {/* Cases Table */}
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Worker Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Date of Injury</TableHead>
                  <TableHead>Work Status</TableHead>
                  <TableHead>Risk Level</TableHead>
                  <TableHead>Next Step</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCases.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-slate-600">
                      No cases found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCases.map((workerCase) => (
                    <TableRow
                      key={workerCase.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => {
                        const id = workerCase.id;
                        if (user?.role === "employer") navigate(`/employer/case/${id}`);
                        else if (user?.role === "partner") navigate(`/partner/cases/${id}`);
                        else navigate(`/summary/${id}`);
                      }}
                    >
                      <TableCell className="font-medium">{workerCase.workerName}</TableCell>
                      <TableCell>{workerCase.company}</TableCell>
                      <TableCell>{workerCase.dateOfInjury}</TableCell>
                      <TableCell>
                        <Badge variant={workerCase.workStatus === "At work" ? "default" : "secondary"}>
                          {workerCase.workStatus}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={riskBadgeColor(workerCase.riskLevel)}>
                          {workerCase.riskLevel}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {workerCase.nextStep}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link to={user?.role === "employer" ? `/employer/case/${workerCase.id}` : user?.role === "partner" ? `/partner/cases/${workerCase.id}` : `/summary/${workerCase.id}`}>
                          <Button variant="ghost" size="sm">
                            <span className="material-symbols-outlined text-sm">visibility</span>
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </PageLayout>
  );
}
