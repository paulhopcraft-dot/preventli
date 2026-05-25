import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Building2, Shield, Users, FileText, Mail } from "lucide-react";
import { Link } from "react-router-dom";

interface Organization {
  id: string;
  name: string;
  slug: string;
  contactName: string | null;
  isActive: boolean;
}

interface Insurer {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
}

export default function AdminDashboard() {
  const { data: orgsData } = useQuery<{ data: Organization[] }>({
    queryKey: ["/api/admin/organizations"],
  });

  const { data: insurersData } = useQuery<{ data: Insurer[] }>({
    queryKey: ["/api/admin/insurers"],
  });

  const organizations = orgsData?.data || [];
  const insurers = insurersData?.data || [];

  const stats = [
    {
      title: "Total Companies",
      value: organizations.length,
      icon: Building2,
      href: "/admin/companies",
      color: "text-blue-600",
      bgColor: "bg-blue-100",
    },
    {
      title: "Active Companies",
      value: organizations.filter((o) => o.isActive).length,
      icon: Building2,
      href: "/admin/companies",
      color: "text-green-600",
      bgColor: "bg-green-100",
    },
    {
      title: "Insurers",
      value: insurers.length,
      icon: Shield,
      href: "/admin/insurers",
      color: "text-purple-600",
      bgColor: "bg-purple-100",
    },
    {
      title: "Active Cases",
      value: "-",
      icon: FileText,
      href: "/",
      color: "text-orange-600",
      bgColor: "bg-orange-100",
    },
    {
      title: "Email Triage",
      value: "View",
      icon: Mail,
      href: "/admin/inbound-emails",
      color: "text-amber-600",
      bgColor: "bg-amber-100",
    },
  ];

  return (
    <div className="p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground">
          System overview and quick access to management tools
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {stats.map((stat) => (
          <Link key={stat.title} to={stat.href}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{stat.title}</p>
                    <p className="text-2xl font-bold">{stat.value}</p>
                  </div>
                  <div className={`p-3 rounded-full ${stat.bgColor}`}>
                    <stat.icon className={`h-6 w-6 ${stat.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Companies</CardTitle>
          </CardHeader>
          <CardContent>
            {organizations.length === 0 ? (
              <p className="text-muted-foreground text-sm">No companies yet</p>
            ) : (
              <ul className="space-y-3">
                {organizations.slice(0, 5).map((org) => (
                  <li
                    key={org.id}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="bg-slate-100 rounded-full p-2">
                        <Building2 className="h-4 w-4 text-slate-600" />
                      </div>
                      <div>
                        <p className="font-medium">{org.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {org.contactName || "No contact"}
                        </p>
                      </div>
                    </div>
                    <Link
                      to={`/admin/companies/${org.id}`}
                      className="text-sm text-primary hover:underline"
                    >
                      Edit
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link
              to="/admin/companies"
              className="block mt-4 text-sm text-primary hover:underline"
            >
              View all companies
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Insurers</CardTitle>
          </CardHeader>
          <CardContent>
            {insurers.length === 0 ? (
              <p className="text-muted-foreground text-sm">No insurers configured</p>
            ) : (
              <ul className="space-y-3">
                {insurers.map((insurer) => (
                  <li
                    key={insurer.id}
                    className="flex items-center justify-between py-2 border-b last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="bg-purple-100 rounded-full p-2">
                        <Shield className="h-4 w-4 text-purple-600" />
                      </div>
                      <div>
                        <p className="font-medium">{insurer.name}</p>
                        <p className="text-sm text-muted-foreground">
                          Code: {insurer.code || "N/A"}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`text-xs px-2 py-1 rounded-full ${
                        insurer.isActive
                          ? "bg-green-100 text-green-700"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {insurer.isActive ? "Active" : "Inactive"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              to="/admin/insurers"
              className="block mt-4 text-sm text-primary hover:underline"
            >
              Manage insurers
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
