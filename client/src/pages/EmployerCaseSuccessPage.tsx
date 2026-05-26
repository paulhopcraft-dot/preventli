import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageLayout } from "@/components/PageLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { CheckCircle, Eye, Mail, Home, Loader2 } from "lucide-react";
import { useState } from "react";
import { fetchWithCsrf } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CaseData {
  id: string;
  workerName: string;
  company: string;
  workStatus: string;
  dateOfInjury: string;
  summary: string;
}

interface InjuryCheckState {
  workerName: string;
  workerEmail: string;
  injuryCheckSentAt: string | null;
}

interface InjuryCheckDraft {
  to: string;
  subject: string;
  body: string;
}

type ModalState = "idle" | "generating" | "ready" | "sending";

export default function EmployerCaseSuccessPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Local state — survives modal interactions but resets on navigation.
  // Server-side `injuryCheckSentAt` is the source of truth across reloads.
  const [modalOpen, setModalOpen] = useState(false);
  const [modalState, setModalState] = useState<ModalState>("idle");
  const [draft, setDraft] = useState<InjuryCheckDraft>({ to: "", subject: "", body: "" });
  const [localSent, setLocalSent] = useState<{ to: string; at: string } | null>(null);

  const { data: caseData, isLoading } = useQuery<CaseData>({
    queryKey: ["case", id],
    queryFn: async () => {
      const res = await fetch(`/api/cases/${id}`);
      if (!res.ok) throw new Error("Failed to fetch case");
      return res.json();
    },
  });

  // Injury-check state — `injuryCheckSentAt` is loaded once on page mount so
  // the success card persists across page reloads, not just modal lifecycle.
  const { data: injuryState } = useQuery<InjuryCheckState>({
    queryKey: ["injury-check-state", id],
    queryFn: async () => {
      const res = await fetch(`/api/employer/cases/${id}/injury-check-state`);
      if (!res.ok) throw new Error("Failed to fetch injury-check state");
      return res.json();
    },
  });

  // Effective "already sent" state: server flag (survives reload) OR local
  // post-send state (the user just clicked Send a moment ago).
  const sentAt = localSent?.at ?? injuryState?.injuryCheckSentAt ?? null;
  const sentTo = localSent?.to ?? injuryState?.workerEmail ?? null;

  async function openDraftModal() {
    setModalOpen(true);
    setModalState("generating");
    try {
      const res = await fetchWithCsrf(`/api/employer/cases/${id}/injury-check/draft`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`Draft request failed: ${res.status}`);
      const data = (await res.json()) as InjuryCheckDraft;
      setDraft({ to: data.to, subject: data.subject, body: data.body });
      setModalState("ready");
    } catch (err) {
      toast({
        title: "Couldn't generate draft",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      setModalOpen(false);
      setModalState("idle");
    }
  }

  async function sendDraft() {
    setModalState("sending");
    try {
      const res = await fetchWithCsrf(`/api/employer/cases/${id}/injury-check/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { details?: string; error?: string };
        throw new Error(errBody.details || errBody.error || `Send failed: ${res.status}`);
      }
      const data = (await res.json()) as { sentTo: string; sentAt: string };
      setLocalSent({ to: data.sentTo, at: data.sentAt });
      setModalOpen(false);
      setModalState("idle");
    } catch (err) {
      toast({
        title: "Failed to send",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
      setModalState("ready");
    }
  }

  function cancelModal() {
    if (modalState === "sending") return; // ignore close requests while sending
    setModalOpen(false);
    setModalState("idle");
  }

  if (isLoading) {
    return (
      <PageLayout title="Case Created" subtitle="Success">
        <div className="flex items-center justify-center min-h-96">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout title="Case Created" subtitle="Success">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Success message */}
        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-green-100 rounded-full">
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-green-800">
                  Case Created Successfully
                </h2>
                <p className="text-green-700 mt-1">
                  The case for <span className="font-semibold">{caseData?.workerName}</span> has been submitted and is now being processed.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary info */}
        <Card>
          <CardHeader>
            <CardTitle>Case Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Worker:</span>
                <span className="ml-2 font-medium">{caseData?.workerName}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Status:</span>
                <span className="ml-2 font-medium">{caseData?.workStatus}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Date of Injury:</span>
                <span className="ml-2 font-medium">
                  {caseData?.dateOfInjury
                    ? new Date(caseData.dateOfInjury).toLocaleDateString()
                    : "N/A"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Company:</span>
                <span className="ml-2 font-medium">{caseData?.company}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action options */}
        <Card>
          <CardHeader>
            <CardTitle>What would you like to do next?</CardTitle>
            <CardDescription>
              Choose from the options below to continue.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Option 1: View Case */}
            <Button
              className="w-full justify-start h-auto py-4"
              onClick={() => navigate(`/employer/case/${id}`)}
            >
              <Eye className="w-5 h-5 mr-3" />
              <div className="text-left">
                <div className="font-semibold">View Case Details</div>
                <div className="text-sm text-primary-foreground/80">
                  Review the full case information and AI-generated summary
                </div>
              </div>
            </Button>

            {/* Option 2: Send Injury Check — persistent confirmation when sent */}
            {sentAt ? (
              <div
                className="w-full rounded-md border border-green-200 bg-green-50 p-4 flex items-start gap-3"
                data-testid="injury-check-sent-card"
              >
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <div className="text-sm">
                  <div className="font-semibold text-green-800">
                    Injury check sent
                    {sentTo ? <> to <span className="font-mono">{sentTo}</span></> : null}
                    {" "}at {new Date(sentAt).toLocaleString()}.
                  </div>
                  <div className="text-green-700 mt-1">
                    Reminder auto-sent in 24h if no response.
                  </div>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full justify-start h-auto py-4"
                onClick={openDraftModal}
                data-testid="open-injury-check-modal"
              >
                <Mail className="w-5 h-5 mr-3" />
                <div className="text-left">
                  <div className="font-semibold">Send Injury Check Email</div>
                  <div className="text-sm text-muted-foreground">
                    AI-drafted — you review before sending
                  </div>
                </div>
              </Button>
            )}

            {/* Option 3: Return to Dashboard */}
            <Button
              variant="secondary"
              className="w-full justify-start h-auto py-4"
              onClick={() => navigate("/")}
            >
              <Home className="w-5 h-5 mr-3" />
              <div className="text-left">
                <div className="font-semibold">Return to Dashboard</div>
                <div className="text-sm text-muted-foreground">
                  Go back to the main employer dashboard
                </div>
              </div>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Edit-before-send modal */}
      <Dialog open={modalOpen} onOpenChange={(open) => { if (!open) cancelModal(); }}>
        <DialogContent className="sm:max-w-2xl" data-testid="injury-check-modal">
          <DialogHeader>
            <DialogTitle>Review Injury Check Email</DialogTitle>
            <DialogDescription>
              AI-drafted based on the case details. Review and edit before sending.
            </DialogDescription>
          </DialogHeader>

          {modalState === "generating" ? (
            <div className="flex items-center justify-center py-10 gap-3 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>Generating draft…</span>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="injury-check-to">To</Label>
                <Input
                  id="injury-check-to"
                  type="email"
                  value={draft.to}
                  onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                  placeholder="worker@example.com"
                  disabled={modalState === "sending"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="injury-check-subject">Subject</Label>
                <Input
                  id="injury-check-subject"
                  value={draft.subject}
                  onChange={(e) => setDraft((d) => ({ ...d, subject: e.target.value }))}
                  disabled={modalState === "sending"}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="injury-check-body">Body</Label>
                <Textarea
                  id="injury-check-body"
                  value={draft.body}
                  onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                  rows={10}
                  disabled={modalState === "sending"}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={cancelModal}
              disabled={modalState === "sending"}
            >
              Cancel
            </Button>
            <Button
              onClick={sendDraft}
              disabled={modalState !== "ready" || !draft.to || !draft.subject || !draft.body}
              data-testid="injury-check-send-button"
            >
              {modalState === "sending" ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sending…
                </>
              ) : (
                "Send"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageLayout>
  );
}
