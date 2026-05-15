/**
 * GettingStartedChecklist
 *
 * Shown on the dashboard when a new organisation has 0 WorkCover cases.
 * Guides users through four onboarding steps. Persists completion state in
 * localStorage per user. Disappears when all steps are marked done or the
 * user explicitly dismisses it.
 */

import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Users,
  ClipboardList,
  UserCheck,
  ShieldCheck,
  CheckCircle2,
  Circle,
  ChevronRight,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { Progress } from "./ui/progress";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChecklistStep {
  id: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  Icon: React.ElementType;
}

interface GettingStartedChecklistProps {
  userId: string;
}

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEPS: ChecklistStep[] = [
  {
    id: "invite",
    title: "Invite your team",
    description:
      "Add your HR manager, supervisors, or return-to-work coordinators so everyone can collaborate.",
    href: "/settings",
    cta: "Go to Settings",
    Icon: Users,
  },
  {
    id: "case",
    title: "Add your first WorkCover case",
    description:
      "Create a claim, attach medical certificates, and let AI generate a return-to-work plan.",
    href: "/employer/new-case",
    cta: "Create Case",
    Icon: ClipboardList,
  },
  {
    id: "preemploy",
    title: "Run a pre-employment health check",
    description:
      "Screen a new starter before they begin work — generate a clearance report in minutes.",
    href: "/pre-employment-form",
    cta: "Start Assessment",
    Icon: UserCheck,
  },
  {
    id: "compliance",
    title: "Review your compliance dashboard",
    description:
      "Check outstanding WHS obligations, upcoming certificate expiries, and overdue actions.",
    href: "/",
    cta: "View Dashboard",
    Icon: ShieldCheck,
  },
];

const STORAGE_PREFIX = "preventli_checklist_";
const DISMISSED_PREFIX = "preventli_checklist_dismissed_";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadCompleted(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + userId);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch {
    return new Set();
  }
}

function saveCompleted(userId: string, completed: Set<string>): void {
  try {
    localStorage.setItem(
      STORAGE_PREFIX + userId,
      JSON.stringify(Array.from(completed))
    );
  } catch {
    // localStorage unavailable — silently ignore
  }
}

function isDismissed(userId: string): boolean {
  try {
    return localStorage.getItem(DISMISSED_PREFIX + userId) === "1";
  } catch {
    return false;
  }
}

function setDismissed(userId: string): void {
  try {
    localStorage.setItem(DISMISSED_PREFIX + userId, "1");
  } catch {
    // ignore
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GettingStartedChecklist({
  userId,
}: GettingStartedChecklistProps) {
  const [completed, setCompleted] = useState<Set<string>>(() =>
    loadCompleted(userId)
  );
  const [dismissed, setDismissedState] = useState(() => isDismissed(userId));

  // Persist completed set whenever it changes
  useEffect(() => {
    saveCompleted(userId, completed);
  }, [userId, completed]);

  const toggleStep = useCallback((stepId: string) => {
    setCompleted((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(userId);
    setDismissedState(true);
  }, [userId]);

  // Don't render if dismissed or all steps done
  if (dismissed || completed.size === STEPS.length) return null;

  const progress = Math.round((completed.size / STEPS.length) * 100);

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden mb-4">
      {/* Header */}
      <div
        className="px-5 py-4 flex items-start justify-between gap-4"
        style={{
          background: "linear-gradient(135deg, #0A1628 0%, #0f766e 100%)",
        }}
      >
        <div className="flex-1 min-w-0">
          <h2 className="text-white font-semibold text-base leading-snug">
            Welcome to Preventli — let's get you set up
          </h2>
          <p className="text-white/70 text-sm mt-0.5">
            {completed.size} of {STEPS.length} steps complete
          </p>
          <Progress
            value={progress}
            className="mt-2 h-1.5 bg-white/20"
          />
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss getting started checklist"
          className="text-white/50 hover:text-white transition-colors mt-0.5 shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      {/* Steps */}
      <div className="divide-y divide-border">
        {STEPS.map((step) => {
          const done = completed.has(step.id);
          return (
            <div
              key={step.id}
              className={`flex items-start gap-4 px-5 py-4 transition-colors ${
                done ? "bg-muted/40" : "hover:bg-muted/20"
              }`}
            >
              {/* Checkbox toggle */}
              <button
                onClick={() => toggleStep(step.id)}
                aria-label={
                  done ? `Mark "${step.title}" incomplete` : `Mark "${step.title}" complete`
                }
                className="mt-0.5 shrink-0 focus:outline-none"
              >
                {done ? (
                  <CheckCircle2
                    size={20}
                    className="text-primary"
                  />
                ) : (
                  <Circle
                    size={20}
                    className="text-muted-foreground/40"
                  />
                )}
              </button>

              {/* Icon */}
              <div
                className={`shrink-0 mt-0.5 rounded-md p-1.5 ${
                  done
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <step.Icon size={16} />
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <p
                  className={`font-medium text-sm leading-snug ${
                    done
                      ? "line-through text-muted-foreground"
                      : "text-foreground"
                  }`}
                >
                  {step.title}
                </p>
                {!done && (
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {step.description}
                  </p>
                )}
              </div>

              {/* CTA */}
              {!done && (
                <Link
                  to={step.href}
                  className="shrink-0 mt-0.5"
                >
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1 border-primary/30 text-primary hover:bg-primary/10 hover:border-primary"
                  >
                    {step.cta}
                    <ChevronRight size={12} />
                  </Button>
                </Link>
              )}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="px-5 py-2.5 bg-muted/30 border-t border-border flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Check each step off as you go — or click the action to go there now.
        </p>
        <button
          onClick={dismiss}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
        >
          Skip setup
        </button>
      </div>
    </div>
  );
}
