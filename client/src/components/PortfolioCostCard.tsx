import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

interface PortfolioCostSummaryResponse {
  orgId: string;
  caseCount: number;
  totalEstimatedCostDollars: number;
  avgPerCaseDollars: number;
  trendVsPriorMonth: number;
  disclaimer: string;
}

interface PortfolioCostCardProps {
  className?: string;
}

const aud = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
});

export default function PortfolioCostCard({ className }: PortfolioCostCardProps): JSX.Element {
  const { data, isLoading, isError } = useQuery<PortfolioCostSummaryResponse>({
    queryKey: ["/api/cases/portfolio-cost-summary"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/cases/portfolio-cost-summary");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <Card className={cn(className)}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <DollarSign className="w-4 h-4 text-primary" />
            Estimated cost across open cases
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-56" />
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
            Estimated cost across open cases
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">Portfolio cost estimate unavailable.</p>
          <p className="text-xs text-muted-foreground">{DISCLAIMER}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={cn(className)}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <DollarSign className="w-4 h-4 text-primary" />
          Estimated cost across open cases
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
          {aud.format(data.totalEstimatedCostDollars)}
        </p>

        {/* Sub-line */}
        <p className="text-sm text-muted-foreground">
          Across {data.caseCount} {data.caseCount === 1 ? "case" : "cases"}
          {data.avgPerCaseDollars > 0 && (
            <> &bull; avg {aud.format(data.avgPerCaseDollars)} per case</>
          )}
        </p>

        {/* Footer disclaimer */}
        <p className="text-xs text-muted-foreground leading-snug">{DISCLAIMER}</p>
      </CardContent>
    </Card>
  );
}
