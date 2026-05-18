import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DollarSign, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

const DISCLAIMER =
  "Estimated claim cost — for implication only. Actual premium impact is determined by WorkSafe Victoria.";

interface CostComponent {
  [key: string]: number;
}

interface CostEstimateResponse {
  caseId: string;
  estimatedCostDollars: number;
  baselineDollars: number;
  components: CostComponent;
  formulaVersion: string;
  baselineSource: "client_history" | "industry_baseline";
  calculatedAt: string;
  disclaimer: string;
}

interface ClaimCostCardProps {
  caseId: string;
  className?: string;
}

const aud = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

function camelToLabel(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

export default function ClaimCostCard({
  caseId,
  className,
}: ClaimCostCardProps): JSX.Element {
  const { data, isLoading, isError } = useQuery<CostEstimateResponse>({
    queryKey: ["/api/cases", caseId, "cost-estimate"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/cases/${caseId}/cost-estimate`
      );
      return res.json();
    },
    enabled: !!caseId,
  });

  if (isLoading) {
    return (
      <Card className={cn(className)}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <DollarSign className="w-4 h-4 text-primary" />
            Estimated claim cost
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card className={cn(className)}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <DollarSign className="w-4 h-4 text-primary" />
            Estimated claim cost
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">Cost estimate unavailable.</p>
          <p className="text-xs text-muted-foreground">{DISCLAIMER}</p>
        </CardContent>
      </Card>
    );
  }

  const showBaseline =
    data.baselineDollars > 0 &&
    data.baselineDollars !== data.estimatedCostDollars;

  const componentEntries = Object.entries(data.components ?? {}) as [
    string,
    number,
  ][];

  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <DollarSign className="w-4 h-4 text-primary" />
          Estimated claim cost
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="w-3.5 h-3.5 text-muted-foreground cursor-default ml-auto" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-xs">{DISCLAIMER}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Big number */}
        <p className="text-3xl font-bold tracking-tight">
          {aud.format(data.estimatedCostDollars)}
        </p>

        {/* Baseline sub-line */}
        {showBaseline && (
          <p className="text-sm text-muted-foreground">
            Baseline (peak): {aud.format(data.baselineDollars)}
          </p>
        )}

        {/* Component chips */}
        {componentEntries.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {componentEntries.map(([key, value]) => (
              <span
                key={key}
                className="inline-flex items-center rounded-full border bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {camelToLabel(key)}: {aud.format(value)}
              </span>
            ))}
          </div>
        )}

        {/* Source badge */}
        {data.baselineSource === "client_history" ? (
          <Badge className="bg-blue-100 text-blue-800 border border-blue-300 hover:bg-blue-100 text-xs">
            Based on your org&apos;s case history
          </Badge>
        ) : (
          <Badge className="bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-100 text-xs">
            Cold-start: industry baseline (your case history will refine this)
          </Badge>
        )}

        {/* Footer disclaimer */}
        <p className="text-xs text-muted-foreground leading-snug">{DISCLAIMER}</p>
      </CardContent>
    </Card>
  );
}
