import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, AlertCircle, Stethoscope, ShieldAlert, CalendarClock, CheckCircle2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

type AlertSeverity = "high" | "medium" | "low";
type AlertCategory = "gp_escalation" | "compliance" | "off_work";

interface BriefingAlert {
  id: string;
  severity: AlertSeverity;
  category: AlertCategory;
  title: string;
  detail: string;
  caseId: string;
  workerName: string;
  suggestedAction: string;
}

interface BriefingData {
  firstName: string;
  summary: string | null;
  generatedAt: string | null;
  alerts: BriefingAlert[];
  hasData: boolean;
}

// Single tab-scoped dismissal key. Per-day key (so a fresh briefing the next
// day can still appear), per-user via prefix, but does NOT depend on user.id
// resolving correctly at every render — the dismiss() handler writes whatever
// user.id is at click time, and we also store a generic per-day fallback so
// the re-open path is closed even if user identity hiccups.
function getTodayKey(userId: string | undefined): string {
  const today = new Date().toISOString().split("T")[0];
  const userPart = userId ?? "anon";
  return `alex_briefing_shown_${userPart}_${today}`;
}
function getDayFallbackKey(): string {
  const today = new Date().toISOString().split("T")[0];
  return `alex_briefing_shown_anyuser_${today}`;
}

const SEVERITY_STYLES: Record<AlertSeverity, string> = {
  high: "bg-red-50 border-red-200 text-red-900",
  medium: "bg-orange-50 border-orange-200 text-orange-900",
  low: "bg-yellow-50 border-yellow-200 text-yellow-900",
};

const CATEGORY_ICON: Record<AlertCategory, typeof Stethoscope> = {
  gp_escalation: Stethoscope,
  compliance: ShieldAlert,
  off_work: CalendarClock,
};

const SEVERITY_ICON_COLOR: Record<AlertSeverity, string> = {
  high: "text-red-500",
  medium: "text-orange-500",
  low: "text-yellow-500",
};

export function MorningBriefingModal() {
  const { user, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [, setLoading] = useState(false);
  // Once the user has dismissed in this tab session, never re-open until the
  // app is reloaded (or the user logs out). useRef survives React re-renders
  // and useEffect re-runs without triggering more renders itself. This is the
  // belt-and-braces guard against the modal re-popping on navigation when
  // useAuth() returns a fresh user object reference and the useEffect re-fires.
  const dismissedThisSession = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    // Multiple guards: runtime ref (strongest) + per-user sessionStorage +
    // per-day fallback sessionStorage. If any of these say "shown", bail.
    if (dismissedThisSession.current) return;
    if (sessionStorage.getItem(getTodayKey(user.id))) {
      dismissedThisSession.current = true;
      return;
    }
    if (sessionStorage.getItem(getDayFallbackKey())) {
      dismissedThisSession.current = true;
      return;
    }

    fetchBriefing();
  }, [isAuthenticated, user]);

  async function fetchBriefing() {
    setLoading(true);
    try {
      const res = await fetch("/api/morning-briefing", { credentials: "include" });
      if (!res.ok) return;
      const json = await res.json();
      if (json.success && json.data?.hasData) {
        setBriefing(json.data);
        setOpen(true);
      }
    } catch {
      // Silently fail — don't block the user if briefing is unavailable
    } finally {
      setLoading(false);
    }
  }

  function dismiss() {
    // Lock immediately — closes the door before any re-render can run useEffect.
    dismissedThisSession.current = true;
    // Persist across navigation in case useEffect re-fires (it shouldn't given
    // the ref guard above, but belt-and-braces).
    sessionStorage.setItem(getTodayKey(user?.id), "1");
    sessionStorage.setItem(getDayFallbackKey(), "1");
    setOpen(false);
  }

  function openCase(caseId: string) {
    dismiss();
    navigate(`/employer/case/${caseId}`);
  }

  if (!open || !briefing) return null;

  const hour = new Date().getHours();
  const timeOfDay = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const greeting = `${timeOfDay} ${briefing.firstName}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={dismiss}
        data-testid="briefing-backdrop"
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="bg-primary px-6 py-5 flex items-start justify-between">
          <div>
            <p className="text-primary-foreground/70 text-xs font-medium uppercase tracking-wide mb-1">
              Alex
            </p>
            <h2 className="text-primary-foreground text-xl font-semibold" data-testid="briefing-greeting">
              {greeting} 👋
            </h2>
            <p className="text-primary-foreground/80 text-sm mt-1">
              Here's what's on your plate today.
            </p>
          </div>
          <button
            onClick={dismiss}
            className="text-primary-foreground/60 hover:text-primary-foreground transition-colors mt-1"
            aria-label="Dismiss briefing"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
          {/* Alex's narrative summary (optional) */}
          {briefing.summary && (
            <div className="bg-muted/50 rounded-xl px-4 py-4">
              <p className="text-sm text-foreground leading-relaxed">
                {briefing.summary}
              </p>
              {briefing.generatedAt && (
                <p className="text-xs text-muted-foreground mt-2">
                  Reviewed at {new Date(briefing.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
            </div>
          )}

          {/* Alert cards */}
          {briefing.alerts.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {briefing.alerts.length} {briefing.alerts.length === 1 ? "case needs" : "cases need"} your attention
              </p>
              {briefing.alerts.map((alert) => {
                const Icon = CATEGORY_ICON[alert.category] ?? AlertCircle;
                return (
                  <button
                    key={alert.id}
                    type="button"
                    onClick={() => openCase(alert.caseId)}
                    className={cn(
                      "group w-full text-left flex items-start gap-3 rounded-xl border px-4 py-3 transition-colors hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-primary/40",
                      SEVERITY_STYLES[alert.severity],
                    )}
                    data-testid={`briefing-alert-${alert.category}-${alert.caseId}`}
                    aria-label={`Open case for ${alert.workerName}`}
                  >
                    <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", SEVERITY_ICON_COLOR[alert.severity])} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{alert.title}</p>
                      <p className="text-xs opacity-80 mt-0.5">{alert.detail}</p>
                      <p className="text-xs italic opacity-70 mt-1.5">
                        ↳ {alert.suggestedAction}
                      </p>
                    </div>
                    <ChevronRight className="w-4 h-4 mt-0.5 shrink-0 opacity-50 group-hover:opacity-100 transition-opacity" />
                  </button>
                );
              })}
            </div>
          )}

          {/* No alerts fallback */}
          {briefing.alerts.length === 0 && briefing.summary && (
            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
              <p className="text-sm text-green-700">No urgent cases — you're on top of it.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Ask Alex anything about your cases below
          </p>
          <button
            onClick={dismiss}
            className="text-sm font-medium text-primary hover:text-primary/80 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
