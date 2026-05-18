import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Activity, TrendingUp, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface EngagementScoreComponents {
  [key: string]: number;
}

interface EngagementScoreResponse {
  workerId: string;
  score: number | null;
  components: EngagementScoreComponents;
  calculatedAt: string | null;
  noData: boolean;
  thresholdAtTrigger: number;
  canEscalate: boolean;
}

interface EngagementScoreBadgeProps {
  workerId: string;
  className?: string;
}

function relativeTime(isoString: string | null): string {
  if (!isoString) return "unknown";
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function componentLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

export default function EngagementScoreBadge({
  workerId,
  className,
}: EngagementScoreBadgeProps): JSX.Element | null {
  const { data, isLoading } = useQuery<EngagementScoreResponse>({
    queryKey: ["/api/workers", workerId, "engagement-score"],
    queryFn: async () => {
      const res = await fetch(`/api/workers/${workerId}/engagement-score`);
      if (!res.ok) throw new Error("Failed to fetch engagement score");
      return res.json();
    },
    enabled: !!workerId,
  });

  if (isLoading || !data) return null;

  // No data yet — muted pending badge
  if (data.noData || data.score === null) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "gap-1.5 cursor-default select-none text-muted-foreground",
          className
        )}
      >
        <Activity className="w-3 h-3" />
        Engagement: pending
      </Badge>
    );
  }

  const score = data.score;

  // Determine tier
  const isEngaged = score >= 70;
  const isWatching = score >= 40 && score < 70;
  const isAtRisk = score < 40;

  const badgeClasses = isEngaged
    ? "bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-100"
    : isWatching
    ? "bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-100"
    : "bg-red-100 text-red-800 border border-red-300 hover:bg-red-100";

  const label = isEngaged
    ? `Engaged ${score}`
    : isWatching
    ? `Watching ${score}`
    : `At risk ${score}`;

  const Icon = isEngaged ? TrendingUp : isWatching ? Activity : AlertCircle;

  const componentEntries = Object.entries(data.components ?? {});

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            className={cn("gap-1.5 cursor-default select-none", badgeClasses, className)}
          >
            <Icon className="w-3 h-3" />
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs space-y-1">
          {componentEntries.length > 0 && (
            <div className="space-y-0.5">
              {componentEntries.map(([key, value]) => (
                <p key={key} className="text-xs">
                  {componentLabel(key)}: {Math.round(Number(value) * 100)}%
                </p>
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Last updated: {relativeTime(data.calculatedAt)}
          </p>
          <p className="text-xs text-muted-foreground">
            Threshold for escalation: &lt; {data.thresholdAtTrigger}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
