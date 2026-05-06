import { ReactNode, useState } from "react";
import { PreventliLogo } from "@/components/PreventliLogo";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { ThemeToggle } from "./theme-toggle";
import { BookingModal } from "./BookingModal";
import { NotificationBell } from "./NotificationBell";
import { Button } from "./ui/button";
import { Phone, LogOut, HelpCircle, KeyRound, ArrowLeftRight, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { SupportModal } from "./SupportModal";
import { fetchWithCsrf } from "@/lib/queryClient";

interface PageLayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
}

const navItems = [
  { path: "/", label: "Dashboard", icon: "dashboard" },

  // Health Checks - All 6 check types in one section
  { path: "/checks", label: "🩺 Checks", icon: "health_and_safety" },

  // Case Management
  { path: "/cases", label: "Cases", icon: "folder_open" },

  // Supporting Tools
  { path: "/claims/new", label: "New Claim", icon: "add_circle", employerPath: "/employer/new-case", employerLabel: "New Case" },
  { path: "/rtw-planner", label: "RTW Planner", icon: "event_available" },
  { path: "/checkins", label: "Check-ins", icon: "task_alt" },
  { path: "/financials", label: "Financials", icon: "payments" },
  { path: "/predictions", label: "Predictions", icon: "analytics" },
  { path: "/risk", label: "Risk", icon: "warning" },
  { path: "/audit", label: "Audit Log", icon: "history" },
  { path: "/agents", label: "Agents", icon: "smart_toy" },
  { path: "/help", label: "Help", icon: "help" },
];

export function PageLayout({ children, title, subtitle }: PageLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, logout, refreshAuth } = useAuth();
  const [bookingOpen, setBookingOpen] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);

  // Partner-tier: fetch partner-org + active-client info for the header.
  // Only runs for partner-role users; no-op for everyone else.
  const isPartner = user?.role === "partner";
  const partnerContextQuery = useQuery<{
    partnerOrg: { id: string; name: string; logoUrl: string | null } | null;
    activeOrg: { id: string; name: string; logoUrl: string | null } | null;
  }>({
    queryKey: ["partner", "me"],
    queryFn: async () => {
      const res = await fetch("/api/partner/me", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load partner context");
      return res.json();
    },
    enabled: isPartner,
  });
  const partnerName = partnerContextQuery.data?.partnerOrg?.name ?? "";
  const activeClientName = partnerContextQuery.data?.activeOrg?.name ?? "";

  // Partner-tier: clear active client and bounce back to picker.
  const switchClientMutation = useMutation({
    mutationFn: async () => {
      const res = await fetchWithCsrf("/api/partner/active-org", {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to switch client");
      return res.json();
    },
    onSuccess: async () => {
      await refreshAuth();
      queryClient.invalidateQueries({ queryKey: ["partner"] });
      navigate("/partner/clients");
    },
  });

  // Extract caseId or workerId from current URL for context-aware chat
  // Match /cases/:id, /summary/:id, and /employer/case/:id
  const caseIdMatch = location.pathname.match(/\/(?:cases|summary|employer\/case)\/([^/]+)/);
  const workerIdMatch = location.pathname.match(/\/workers\/([^/]+)/);
  const caseContext = caseIdMatch
    ? { caseId: caseIdMatch[1] }
    : workerIdMatch
    ? { workerId: workerIdMatch[1] }
    : undefined;

  // Filter navigation items based on user role and transform for employers
  const getNavItems = () => {
    const isEmployer = user?.role === "employer";
    let items = navItems;

    if (isEmployer) {
      // Hide Audit Log for employers and transform paths/labels
      items = navItems
        .filter(item => item.path !== "/audit" && item.path !== "/agents")
        .map(item => ({
          ...item,
          path: item.employerPath || item.path,
          label: item.employerLabel || item.label,
        }));
    }
    return items;
  };

  const filteredNavItems = getNavItems();

  return (
    <div className="flex h-screen">
      <aside className="hidden lg:block w-64 flex-shrink-0 bg-sidebar p-4 border-r border-sidebar-border">
        <div className="mb-8">
          <Link to="/">
            <PreventliLogo className="h-10 w-auto text-sidebar-foreground" />
          </Link>
        </div>
        <nav className="space-y-1">
          {filteredNavItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                location.pathname === item.path
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <span className="material-symbols-outlined text-lg">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto pt-4 border-t border-sidebar-border">
          <div className="px-3 py-2 text-xs text-sidebar-foreground/60 truncate">{user?.email}</div>
          <Link
            to="/change-password"
            className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/50 transition-colors"
          >
            <KeyRound className="w-4 h-4" />
            Change password
          </Link>
          <button
            onClick={() => setSupportOpen(true)}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/50 transition-colors"
          >
            <HelpCircle className="w-4 h-4" />
            Contact Support
          </button>
          <button
            onClick={logout}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent/50 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden">
        <header className="flex items-center justify-between p-4 border-b border-border bg-card">
          <div className="flex items-center gap-3">
            <Link to="/" className="lg:hidden" aria-label="Preventli home">
              <PreventliLogo className="h-7 w-auto text-card-foreground" />
            </Link>
            <div>
              {isPartner && (partnerName || activeClientName) && (
                <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground" data-testid="partner-context">
                  <Building2 className="h-3 w-3" />
                  <span>{partnerName}</span>
                  {activeClientName && (
                    <>
                      <span className="text-muted-foreground/50">|</span>
                      <span className="text-foreground">{activeClientName}</span>
                    </>
                  )}
                </p>
              )}
              <h1 className="text-xl font-bold text-card-foreground">{title}</h1>
              {subtitle && (
                <p className="text-sm text-muted-foreground">{subtitle}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {isPartner && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => switchClientMutation.mutate()}
                disabled={switchClientMutation.isPending}
                data-testid="switch-client"
              >
                <ArrowLeftRight className="w-4 h-4 mr-2" />
                Switch client
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setBookingOpen(true)}>
              <Phone className="w-4 h-4 mr-2" />
              Book Telehealth
            </Button>
            <NotificationBell />
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={logout} title="Log out" className="lg:hidden">
              <LogOut className="w-4 h-4" />
            </Button>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-6">
          {children}
        </div>
      </main>

      {/* Telehealth Booking Modal */}
      <BookingModal
        open={bookingOpen}
        onClose={() => setBookingOpen(false)}
        caseContext={caseContext}
      />

      {/* Floating Health Assistant Chat Widget mounted globally in App.tsx */}

      {/* Support Contact Modal */}
      <SupportModal open={supportOpen} onClose={() => setSupportOpen(false)} />
    </div>
  );
}
