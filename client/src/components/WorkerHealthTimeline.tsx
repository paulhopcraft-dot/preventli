import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Calendar } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { TimelineNode } from "@/components/TimelineNode";
import type {
  WorkerHealthTimelineEvent,
  WorkerHealthTimelineBadgeTone,
} from "@shared/types/timeline";

interface WorkerHealthTimelineResponse {
  events: WorkerHealthTimelineEvent[];
}

const TONE_DOT: Record<WorkerHealthTimelineBadgeTone, string> = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  blue: "bg-blue-500",
  gray: "bg-gray-400",
};

const TONE_BADGE: Record<WorkerHealthTimelineBadgeTone, string> = {
  green: "bg-green-100 text-green-800 border-green-200",
  amber: "bg-amber-100 text-amber-800 border-amber-200",
  red: "bg-red-100 text-red-800 border-red-200",
  blue: "bg-blue-100 text-blue-800 border-blue-200",
  gray: "bg-gray-100 text-gray-700 border-gray-200",
};

function formatDate(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export function WorkerHealthTimeline({ workerId }: { workerId: string }): JSX.Element {
  const navigate = useNavigate();

  const { data, isLoading, error } = useQuery<WorkerHealthTimelineResponse>({
    queryKey: ["worker-timeline", workerId],
    queryFn: () =>
      fetch(`/api/workers/${workerId}/health-timeline`, { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error("Failed to load health timeline");
        return r.json();
      }),
    enabled: Boolean(workerId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-sm text-muted-foreground">
        Could not load health history.
      </div>
    );
  }

  const events = data?.events ?? [];

  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <Calendar className="h-10 w-10 mx-auto mb-3 text-gray-300" />
        <p className="text-sm">No health events recorded for this worker.</p>
      </div>
    );
  }

  return (
    <div className="pt-1">
      {events.map((event, i) => {
        const isLast = i === events.length - 1;
        const tone: WorkerHealthTimelineBadgeTone = event.badge?.tone ?? "gray";
        const dotClass = TONE_DOT[tone];

        return (
          <div
            key={event.id}
            role="button"
            tabIndex={0}
            onClick={() => navigate(event.deepLink)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                navigate(event.deepLink);
              }
            }}
            className="cursor-pointer hover:bg-gray-50 rounded-md -mx-2 px-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
          >
            <TimelineNode
              date={formatDate(event.date)}
              isLast={isLast}
              dotClass={dotClass}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{event.title}</p>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                  {event.badge && (
                    <Badge className={`text-xs border ${TONE_BADGE[event.badge.tone]}`}>
                      {event.badge.label}
                    </Badge>
                  )}
                  {event.subtitle && (
                    <span className="text-xs text-muted-foreground">{event.subtitle}</span>
                  )}
                </div>
              </div>
            </TimelineNode>
          </div>
        );
      })}
    </div>
  );
}
