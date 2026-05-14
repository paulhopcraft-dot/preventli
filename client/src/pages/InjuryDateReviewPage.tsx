import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageLayout } from "@/components/PageLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface InjuryDateReviewItem {
  id: string;
  caseId: string;
  workerName: string;
  company: string;
  currentDate: Date;
  confidence: "high" | "medium" | "low";
  source: "verified" | "extracted" | "ai_extracted" | "fallback" | "unknown";
  extractionMethod: "custom_field" | "regex" | "ai_nlp" | "fallback";
  sourceText?: string;
  aiReasoning?: string;
  ticketUrl?: string;
  createdAt: Date;
}

interface ReviewFormData {
  newDate: string;
  reason: string;
}

const CONFIDENCE_VALUES: Record<string, number> = { high: 0.9, medium: 0.7, low: 0.3 };

const SOURCE_LABELS: Record<string, string> = {
  verified: "Custom Field",
  extracted: "Text Extraction",
  ai_extracted: "AI Analysis",
  fallback: "Ticket Date",
};

const METHOD_LABELS: Record<string, string> = {
  custom_field: "Field",
  regex: "Regex",
  ai_nlp: "AI",
  fallback: "Fallback",
};

function formatDate(date: string | Date | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().split("T")[0];
}

function formatDisplayDate(date: string | Date | null | undefined): string {
  if (!date) return "Not set";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
}

function getConfidenceBadge(confidence: "high" | "medium" | "low") {
  const styles: Record<string, string> = {
    high: "bg-emerald-100 text-emerald-800",
    medium: "bg-amber-100 text-amber-800",
    low: "bg-red-100 text-red-800",
  };
  const labels: Record<string, string> = { high: "High Confidence", medium: "Medium Confidence", low: "Low Confidence" };
  return <Badge className={styles[confidence]}>{labels[confidence]}</Badge>;
}

function getSourceBadge(source: string, method: string) {
  return (
    <Badge variant="outline" className="text-xs">
      {SOURCE_LABELS[source] || source} ({METHOD_LABELS[method] || method})
    </Badge>
  );
}

function calcAvgConfidence(cases: InjuryDateReviewItem[]): string {
  if (cases.length === 0) return "N/A";
  const avg = cases.reduce((acc, c) => acc + (CONFIDENCE_VALUES[c.confidence] ?? 0.3), 0) / cases.length;
  return Math.round(avg * 100) + "%";
}

export default function InjuryDateReviewPage() {
  const [selectedCase, setSelectedCase] = useState<InjuryDateReviewItem | null>(null);
  const [formData, setFormData] = useState<ReviewFormData>({ newDate: "", reason: "" });
  const [reviewAction, setReviewAction] = useState<"accept" | "correct" | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: response, isLoading } = useQuery<{ success: boolean; data: InjuryDateReviewItem[] }>({
    queryKey: ["/api/injury-dates/review-queue"],
  });

  const cases = response?.data || [];

  const invalidateQueue = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/injury-dates/review-queue"] });

  const acceptMutation = useMutation({
    mutationFn: (caseId: string) => apiRequest("POST", `/api/injury-dates/${caseId}/accept`),
    onSuccess: () => {
      toast({ title: "Date accepted", description: "The extracted date has been approved." });
      invalidateQueue();
      setSelectedCase(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to accept date", description: error.message, variant: "destructive" });
    },
  });

  const correctMutation = useMutation({
    mutationFn: ({ caseId, newDate, reason }: { caseId: string; newDate: string; reason: string }) =>
      apiRequest("POST", `/api/injury-dates/${caseId}/correct`, { newDate, reason }),
    onSuccess: () => {
      toast({ title: "Date corrected", description: "The injury date has been updated successfully." });
      invalidateQueue();
      setSelectedCase(null);
      setFormData({ newDate: "", reason: "" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to correct date", description: error.message, variant: "destructive" });
    },
  });

  const openReviewDialog = (reviewCase: InjuryDateReviewItem, action: "accept" | "correct") => {
    setSelectedCase(reviewCase);
    setReviewAction(action);
    if (action === "correct") {
      setFormData({ newDate: formatDate(reviewCase.currentDate), reason: "" });
    }
  };

  const handleSubmit = async () => {
    if (!selectedCase) return;

    if (reviewAction === "accept") {
      await acceptMutation.mutateAsync(selectedCase.caseId);
      return;
    }

    if (!formData.newDate) {
      toast({ title: "Date required", description: "Please enter a new injury date.", variant: "destructive" });
      return;
    }
    if (!formData.reason.trim()) {
      toast({ title: "Reason required", description: "Please provide a reason for the correction.", variant: "destructive" });
      return;
    }

    await correctMutation.mutateAsync({
      caseId: selectedCase.caseId,
      newDate: formData.newDate,
      reason: formData.reason,
    });
  };

  if (isLoading) {
    return (
      <PageLayout title="Injury Date Review" subtitle="Loading...">
        <div className="flex items-center justify-center h-64">
          <span className="material-symbols-outlined animate-spin text-4xl text-primary">
            progress_activity
          </span>
        </div>
      </PageLayout>
    );
  }

  const isPending = acceptMutation.isPending || correctMutation.isPending;

  return (
    <PageLayout title="Injury Date Review" subtitle="Review injury dates with uncertain extraction confidence">
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Pending Review</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">{cases.length}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Avg Confidence</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{calcAvgConfidence(cases)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Review Queue Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-emerald-600">
                {cases.length === 0 ? "Clear" : "Active"}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">event</span>
              Injury Dates Requiring Review
            </CardTitle>
            <CardDescription>
              These injury dates were extracted with uncertain confidence and need manual verification
            </CardDescription>
          </CardHeader>
          <CardContent>
            {cases.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <span className="material-symbols-outlined text-4xl mb-4">verified</span>
                <p>No injury dates pending review. All extractions have been verified.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {cases.map((reviewCase) => (
                  <div
                    key={reviewCase.id}
                    className="flex items-start gap-4 p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                  >
                    <div className="flex-shrink-0 w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                      <span className="material-symbols-outlined text-amber-600 text-lg">event</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{reviewCase.workerName}</span>
                        <span className="text-muted-foreground">•</span>
                        <span className="text-muted-foreground">{reviewCase.company}</span>
                        {getConfidenceBadge(reviewCase.confidence)}
                        {getSourceBadge(reviewCase.source, reviewCase.extractionMethod)}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2 text-sm">
                        <div>
                          <span className="font-medium text-muted-foreground">Current Date:</span>{" "}
                          <span className="font-medium">{formatDisplayDate(reviewCase.currentDate)}</span>
                        </div>
                        <div>
                          <span className="font-medium text-muted-foreground">Case ID:</span>{" "}
                          <span className="text-muted-foreground">{reviewCase.caseId.substring(0, 8)}...</span>
                        </div>
                      </div>
                      {reviewCase.sourceText && (
                        <div className="mt-2">
                          <span className="font-medium text-muted-foreground text-xs">Source Text:</span>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2 bg-muted/30 p-2 rounded text-xs">
                            {reviewCase.sourceText}
                          </p>
                        </div>
                      )}
                      {reviewCase.aiReasoning && (
                        <div className="mt-2">
                          <span className="font-medium text-muted-foreground text-xs">AI Analysis:</span>
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-2 bg-blue-50 p-2 rounded text-xs">
                            {reviewCase.aiReasoning}
                          </p>
                        </div>
                      )}
                      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                        <span>Case created: {formatDisplayDate(reviewCase.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => openReviewDialog(reviewCase, "accept")}>
                        Accept
                      </Button>
                      <Button size="sm" onClick={() => openReviewDialog(reviewCase, "correct")}>
                        Correct
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!selectedCase} onOpenChange={(open) => !open && setSelectedCase(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {reviewAction === "accept" ? "Accept Injury Date" : "Correct Injury Date"}
            </DialogTitle>
            <DialogDescription>
              {reviewAction === "accept"
                ? "Confirm that the extracted injury date is correct."
                : "Update the injury date with the correct information."}
            </DialogDescription>
          </DialogHeader>

          {selectedCase && (
            <div className="space-y-4 py-4">
              <div className="bg-muted/30 p-4 rounded-lg">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="font-medium">Worker:</span> {selectedCase.workerName}</div>
                  <div><span className="font-medium">Company:</span> {selectedCase.company}</div>
                  <div><span className="font-medium">Current Date:</span> {formatDisplayDate(selectedCase.currentDate)}</div>
                  <div><span className="font-medium">Confidence:</span> {selectedCase.confidence}</div>
                </div>
                {selectedCase.sourceText && (
                  <div className="mt-3">
                    <span className="font-medium text-sm">Source Text:</span>
                    <p className="text-sm text-muted-foreground mt-1 bg-white p-2 rounded border">
                      {selectedCase.sourceText}
                    </p>
                  </div>
                )}
                {selectedCase.aiReasoning && (
                  <div className="mt-3">
                    <span className="font-medium text-sm">AI Analysis:</span>
                    <p className="text-sm text-muted-foreground mt-1 bg-blue-50 p-2 rounded border">
                      {selectedCase.aiReasoning}
                    </p>
                  </div>
                )}
              </div>

              {reviewAction === "correct" && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="newDate">Correct Injury Date</Label>
                    <Input
                      id="newDate"
                      type="date"
                      value={formData.newDate}
                      onChange={(e) => setFormData({ ...formData, newDate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reason">Reason for Correction</Label>
                    <Textarea
                      id="reason"
                      placeholder="Explain why this date is correct (e.g., 'Found actual injury date in email attachment', 'Worker confirmed date during phone call')"
                      value={formData.reason}
                      onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                      rows={3}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedCase(null)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={isPending}>
              {isPending && (
                <span className="material-symbols-outlined animate-spin text-sm mr-1">
                  progress_activity
                </span>
              )}
              {reviewAction === "accept" ? "Accept Date" : "Save Correction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}