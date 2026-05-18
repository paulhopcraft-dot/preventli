import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";

// Derive a friendly first name from an email address.
// "ellen.murphy@workbetter.com.au" → "Ellen"
function getFirstName(email: string): string {
  const local = email.split("@")[0];
  const part = local.split(/[._-]/)[0];
  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
}

export interface BriefingAction {
  id: string;
  workerName: string;
  caseId: string;
  type: "certificate" | "review" | "rtw_plan" | "medical" | "compliance";
  priority: "critical" | "urgent" | "routine";
  daysOverdue?: number;
}

interface BriefingItem {
  id: string;
  workerName: string;
  caseId: string;
  message: string;
  actionLabel: string;
  tone: "urgent" | "action" | "good";
}

interface Props {
  actions?: BriefingAction[];
}

// Build Alex's natural-language sentence for a given action.
function buildMessage(action: BriefingAction): { message: string; actionLabel: string; tone: BriefingItem["tone"] } {
  const { workerName, type, daysOverdue = 0, priority } = action;
  const days = daysOverdue;

  switch (type) {
    case "certificate":
      return {
        tone: priority === "critical" ? "urgent" : "action",
        actionLabel: "View case",
        message:
          days > 0
            ? `${workerName}'s medical certificate expired ${days} day${days === 1 ? "" : "s"} ago and I haven't received an updated one. I sent a reminder email last night but still no response — you might need to give ${workerName.split(" ")[0]} a call.`
            : `${workerName}'s medical certificate is due today. I've sent a reminder but haven't heard back yet — I'll keep an eye on it.`,
      };

    case "rtw_plan":
      if (days === 0) {
        return {
          tone: "action",
          actionLabel: "Approve RTW plan",
          message: `${workerName}'s return to work plan is ready and waiting for your approval. Once you sign off, I'll send it through to the supervisor and get things moving.`,
        };
      }
      return {
        tone: priority === "critical" ? "urgent" : "action",
        actionLabel: "Review case",
        message: `${workerName} has been off work for ${Math.round(days / 7)} weeks without a formal RTW plan. I've flagged this — WorkSafe expects one in place by now. Worth reviewing today.`,
      };

    case "review":
      return {
        tone: "action",
        actionLabel: "Review case",
        message: `${workerName} is due for a progress review — it's been ${Math.round(days / 7) + 8} weeks since the injury. I've pulled together a summary of where things stand so it won't take long.`,
      };

    case "medical":
      return {
        tone: priority === "critical" ? "urgent" : "action",
        actionLabel: "View case",
        message: `There's a medical action overdue on ${workerName}'s case${days > 0 ? ` — it's been ${days} days` : ""}. I'd recommend following up with the treating provider this week.`,
      };

    case "compliance":
    default:
      return {
        tone: priority === "critical" ? "urgent" : "action",
        actionLabel: "View case",
        message: `${workerName}'s case has a compliance item that needs attention${days > 0 ? ` — ${days} days overdue` : ""}. I've flagged the details in the case file.`,
      };
  }
}

// Pick the top 3 most interesting actions for Alex to brief on.
// Prefers critical > urgent > routine, and avoids repeating the same worker.
function selectTopActions(actions: BriefingAction[]): BriefingAction[] {
  const priorityOrder: Record<string, number> = { critical: 0, urgent: 1, routine: 2 };
  const sorted = [...actions].sort((a, b) => {
    const pd = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pd !== 0) return pd;
    return (b.daysOverdue || 0) - (a.daysOverdue || 0);
  });

  const seen = new Set<string>();
  const picked: BriefingAction[] = [];
  for (const a of sorted) {
    if (seen.has(a.caseId)) continue;
    seen.add(a.caseId);
    picked.push(a);
    if (picked.length === 3) break;
  }
  return picked;
}

const TONE_BORDER: Record<BriefingItem["tone"], string> = {
  urgent: "border-l-destructive",
  action: "border-l-amber-500",
  good:   "border-l-emerald-500",
};

export function AlexMorningBriefing({ actions = [] }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();

  if (!user) return null;

  const firstName = getFirstName(user.email);

  const briefingTime = new Date();
  briefingTime.setHours(7, 48, 0, 0);
  const timeStr = briefingTime.toLocaleTimeString("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  // Build display items from real actions, falling back to a quiet state.
  const topActions = selectTopActions(actions);
  const items: BriefingItem[] = topActions.map((a) => {
    const { message, actionLabel, tone } = buildMessage(a);
    return { id: a.id, workerName: a.workerName, caseId: a.caseId, message, actionLabel, tone };
  });

  const hasItems = items.length > 0;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border bg-muted/30">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold shrink-0">
          A
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">Alex</p>
          <p className="text-xs text-muted-foreground">Your AI case manager · briefed at {timeStr}</p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          <span>Preventli AI</span>
        </div>
      </div>

      {/* Opening line */}
      <div className="px-5 pt-5 pb-2">
        <p className="text-sm text-foreground">
          {hasItems
            ? `Morning ${firstName} 👋 Quick update on your active claims before you start your day.`
            : `Morning ${firstName} 👋 All clear — no urgent actions on your claims today. I'll keep watching.`}
        </p>
      </div>

      {/* Case updates */}
      {hasItems && (
        <div className="px-5 pb-5 space-y-3 mt-3">
          {items.map((item) => (
            <div
              key={item.id}
              className={`rounded-lg border border-border border-l-4 ${TONE_BORDER[item.tone]} bg-background p-4`}
            >
              <p className="text-sm text-foreground leading-relaxed">
                {item.message}
              </p>
              <div className="mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/employer/case/${item.caseId}`)}
                  className="text-xs h-7 px-3"
                >
                  {item.actionLabel}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="px-5 pb-4">
        <p className="text-xs text-muted-foreground">
          {hasItems
            ? "Alex reviewed your active claims overnight. The items above are the only things that need you today."
            : "Alex reviewed your active claims overnight and found nothing urgent."}
        </p>
      </div>
    </div>
  );
}
