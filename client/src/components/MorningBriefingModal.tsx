import { useEffect, useState } from "react";
import { X, AlertCircle, Stethoscope, ShieldAlert, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

type AlertSeverity = "high" | "medium" | "low";
type AlertCategory = "gp_escalation" | "compliance";

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

function getTodayKey(userId: string): string {
  const today = new Date().toISOString().split("T")[0];
  return `alex_briefing_shown_${userId}_${today}`;
}

const SEVERITY_STYLES: Record<AlertSeverity, string> = {
  high: "bg-red-50 border-red-200 text-red-900",
  medium: "bg-orange-50 border-orange-200 text-orange-900",
  low: "bg-yellow-50 border-yellow-200 text-yellow-900",
};

const CATEGORY_ICON: Record<AlertCategory, typeof Stethoscope> = {
  gp_escalation: Stethoscope,
  compliance: ShieldAlert,
};

const SEVERITY_ICON_COLOR: Record<AlertSeverity, string> = {
  high: "text-red-500",
  medium: "text-orange-500",
  low: "text-yellow-500",
};

export function MorningBriefingModal() {
  const { user, isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const [briefing, setBriefing] = useState<BriefingData | null>(null);
  const [, setLoading] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !user) return;

    const key = getTodayKey(user.id);
    const alreadyShown = sessionStorage.getItem(key);
    if (alreadyShown) return;

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
    if (user) {
      sessionStorage.setItem(getTodayKey(user.id), "1");
    }
    setOpen(false);
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
                  <div
                    key={alert.id}
                    className={cn(
                      "flex items-start gap-3 rounded-xl border px-4 py-3",
                      SEVERITY_STYLES[alert.severity],
                    )}
                    data-testid={`briefing-alert-${alert.category}-${alert.caseId}`}
                  >
                    <Icon className={cn("w-4 h-4 mt-0.5 shrink-0", SEVERITY_ICON_COLOR[alert.severity])} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{alert.title}</p>
                      <p className="text-xs opacity-80 mt-0.5">{alert.detail}</p>
                      <p className="text-xs italic opacity-70 mt-1.5">
                        ↳ {alert.suggestedAction}
                      </p>
                    </div>
                  </div>
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
