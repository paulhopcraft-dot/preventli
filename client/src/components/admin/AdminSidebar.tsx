import type { MouseEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Building2,
  Shield,
  Users,
  Settings,
  LayoutDashboard,
  ChevronDown,
  LogOut,
  Activity,
  Kanban,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

const menuItems = [
  {
    title: "Dashboard",
    url: "/admin",
    icon: LayoutDashboard,
  },
  {
    title: "Companies",
    url: "/admin/companies",
    icon: Building2,
  },
  {
    title: "Insurers",
    url: "/admin/insurers",
    icon: Shield,
  },
  {
    title: "Users",
    url: "/admin/users",
    icon: Users,
  },
  {
    title: "Settings",
    url: "/admin/settings",
    icon: Settings,
  },
  {
    title: "Control Tower",
    url: "/admin/control-tower",
    icon: Activity,
  },
];

const DASHBOARD_URL = (import.meta.env.VITE_DASHBOARD_URL as string | undefined) ?? "https://dashboard.preventli.ai";

function BuildStatusLink() {
  const handleClick = async (e: MouseEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/dashboard/sign-in-token", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = (await res.json()) as { token: string };
        window.open(`${DASHBOARD_URL}?t=${encodeURIComponent(data.token)}`, "_blank", "noopener");
        return;
      }
    } catch {
      // fall through — open without token, dashboard will redirect to login if needed
    }
    window.open(DASHBOARD_URL, "_blank", "noopener");
  };

  return (
    <a
      href={DASHBOARD_URL}
      onClick={handleClick}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 px-3 py-2 rounded-lg text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
      data-testid="build-status-link"
    >
      <Kanban className="h-5 w-5" />
      <span>Build Status</span>
    </a>
  );
}

export function AdminSidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();

  const getInitials = (email: string) => {
    const parts = email.split("@")[0].split(".");
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return email.slice(0, 2).toUpperCase();
  };

  const initials = user ? getInitials(user.email) : "??";
  const displayName = user?.email.split("@")[0] || "User";

  return (
    <aside className="w-64 flex-shrink-0 bg-slate-900 text-white flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="bg-primary rounded-lg size-10 flex items-center justify-center">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg">Preventli Admin</h1>
            <span className="text-xs text-slate-400">System Management</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4">
        <ul className="space-y-1">
          {menuItems.map((item) => {
            const isActive =
              location.pathname === item.url ||
              (item.url !== "/admin" && location.pathname.startsWith(item.url));

            return (
              <li key={item.title}>
                <Link
                  to={item.url}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                    isActive
                      ? "bg-primary text-white"
                      : "text-slate-300 hover:bg-slate-800 hover:text-white"
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  <span>{item.title}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Separator */}
        <div className="my-4 border-t border-slate-700" />

        {/* Build Status board — opens dashboard.preventli.ai with a fresh sign-in token */}
        <BuildStatusLink />

        {/* Back to main app link */}
        <Link
          to="/"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors mt-1"
        >
          <LayoutDashboard className="h-5 w-5" />
          <span>Back to Dashboard</span>
        </Link>
      </nav>

      {/* User Footer */}
      <div className="p-4 border-t border-slate-700">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-3 w-full p-2 rounded-lg hover:bg-slate-800 transition-colors">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="bg-primary text-white text-xs">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 text-left">
                <p className="text-sm font-medium text-white">{displayName}</p>
                <p className="text-xs text-slate-400">Administrator</p>
              </div>
              <ChevronDown className="h-4 w-4 text-slate-400" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={logout}>
              <LogOut className="h-4 w-4 mr-2" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );
}
