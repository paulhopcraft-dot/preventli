/**
 * PlanPage
 * Route: /rtw/plans/:planId
 * Full plan display with two views — internal working view and WorkSafe
 * Victoria template format. Both share the same plan data; the WorkSafe Vic
 * view is intended for print / sign-off.
 */

import React, { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlanPrintView } from "@/components/rtw/PlanPrintView";
import { PlanDetailView } from "@/components/rtw/PlanDetailView";
import { WorkSafeVicTemplateView } from "@/components/rtw/WorkSafeVicTemplateView";

type ViewMode = "internal" | "worksafe-vic";

export default function PlanPage(): React.JSX.Element {
  const { planId } = useParams<{ planId: string }>();
  const [view, setView] = useState<ViewMode>("internal");

  if (!planId) {
    return (
      <div className="container mx-auto py-6 max-w-5xl">
        <div className="text-center text-muted-foreground">Plan ID required</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 max-w-5xl">
      {/* Header with back button + view toggle */}
      <div className="flex items-center gap-4 mb-6 print:hidden flex-wrap">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/rtw-planner">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to RTW Planner
          </Link>
        </Button>
        <h1 className="text-2xl font-bold flex-1">Return to Work Plan</h1>

        <div className="inline-flex items-center rounded-md border bg-background p-0.5" data-testid="rtw-plan-view-toggle">
          <button
            type="button"
            onClick={() => setView("internal")}
            data-testid="rtw-plan-view-internal"
            className={`px-3 py-1.5 text-xs font-medium rounded ${
              view === "internal"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Internal view
          </button>
          <button
            type="button"
            onClick={() => setView("worksafe-vic")}
            data-testid="rtw-plan-view-worksafe"
            className={`px-3 py-1.5 text-xs font-medium rounded ${
              view === "worksafe-vic"
                ? "bg-cyan-700 text-white shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            WorkSafe Vic format
          </button>
        </div>

        {view === "worksafe-vic" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            data-testid="rtw-plan-print-worksafe"
          >
            <Printer className="h-4 w-4 mr-1.5" />
            Print / Save as PDF
          </Button>
        )}
      </div>

      {view === "internal" ? (
        <PlanPrintView planId={planId}>
          <PlanDetailView planId={planId} showEmailSection={true} />
        </PlanPrintView>
      ) : (
        <WorkSafeVicTemplateView planId={planId} />
      )}
    </div>
  );
}
