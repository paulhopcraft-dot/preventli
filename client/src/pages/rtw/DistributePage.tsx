/**
 * DistributePage
 * Route: /rtw/plans/:planId/distribute
 *
 * Phase 4 of RTW multi-party distribution (spec
 * agent-specs/rtw-plan-multi-party-distribution.md req 4).
 *
 * Loads the per-recipient preview from POST /api/rtw-plans/:planId/distribute/preview,
 * lets the practitioner edit each envelope and toggle include-in-send, then
 * fires POST /api/rtw-plans/:planId/distribute/send and renders per-recipient
 * send status (with retry semantics for partial failures).
 *
 * Full-page (4-5 recipients is too many for a modal). Per-recipient cards are
 * stacked rather than tabbed so partial-failure status is visible at a glance.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Send,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type RecipientRole = "worker" | "manager" | "doctor" | "physio" | "insurer";

interface PreviewRecipient {
  role: RecipientRole;
  contactId: string | null;
  name: string;
  to: string;
  subject: string;
  body: string;
  isGating: boolean;
}

interface PreviewResponse {
  success: boolean;
  data: {
    planStatus: string;
    distributionStatus: string;
    recipients: PreviewRecipient[];
  };
}

interface SendResultRecipient {
  contactId: string | null;
  role: string;
  to: string;
  success: boolean;
  messageId: string | null;
  error: string | null;
}

interface SendResponse {
  success: boolean;
  data: {
    planId: string;
    distributionStatus: string;
    recipients: SendResultRecipient[];
  };
}

interface EditableRecipient extends PreviewRecipient {
  include: boolean;
  sendStatus: "idle" | "sending" | "sent" | "failed";
  sendError: string | null;
}

const ROLE_LABELS: Record<RecipientRole, string> = {
  worker: "Worker",
  manager: "Manager",
  doctor: "Treating Doctor",
  physio: "Physiotherapist",
  insurer: "Insurer Case Manager",
};

const ROLE_TAG_CLASS: Record<RecipientRole, string> = {
  worker: "bg-blue-100 text-blue-800",
  manager: "bg-purple-100 text-purple-800",
  doctor: "bg-emerald-100 text-emerald-800",
  physio: "bg-amber-100 text-amber-800",
  insurer: "bg-slate-100 text-slate-700",
};

function recipientKey(r: { role: string; contactId: string | null }): string {
  return `${r.role}:${r.contactId ?? "_worker_"}`;
}

export default function DistributePage(): React.JSX.Element {
  const { planId } = useParams<{ planId: string }>();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ message: string; code?: string } | null>(null);
  const [recipients, setRecipients] = useState<EditableRecipient[]>([]);
  const [distributionStatus, setDistributionStatus] = useState<string>("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!planId) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      try {
        const res = await apiRequest("POST", `/api/rtw-plans/${planId}/distribute/preview`, {});
        const json = (await res.json()) as PreviewResponse;
        if (cancelled) return;
        const editable: EditableRecipient[] = json.data.recipients.map((r) => ({
          ...r,
          include: true,
          sendStatus: "idle",
          sendError: null,
        }));
        setRecipients(editable);
        setDistributionStatus(json.data.distributionStatus);
      } catch (err) {
        if (cancelled) return;
        let message = "Failed to load distribution preview";
        let code: string | undefined;
        if (err instanceof Error) {
          // apiRequest throws with "STATUS: body" — try to parse JSON body
          const match = err.message.match(/^\d+:\s*(.+)$/);
          const body = match?.[1] ?? err.message;
          try {
            const parsed = JSON.parse(body) as { error?: string; code?: string };
            message = parsed.error ?? message;
            code = parsed.code;
          } catch {
            message = body;
          }
        }
        setLoadError({ message, code });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planId]);

  const enabledCount = useMemo(
    () => recipients.filter((r) => r.include).length,
    [recipients],
  );

  function updateRecipient(key: string, patch: Partial<EditableRecipient>): void {
    setRecipients((prev) =>
      prev.map((r) => (recipientKey(r) === key ? { ...r, ...patch } : r)),
    );
  }

  async function handleSendAll(): Promise<void> {
    if (!planId || enabledCount === 0) return;
    setSending(true);
    // Mark every enabled recipient as 'sending' so the UI reflects the
    // in-flight state. Disabled recipients stay 'idle'.
    setRecipients((prev) =>
      prev.map((r) =>
        r.include
          ? { ...r, sendStatus: "sending", sendError: null }
          : r,
      ),
    );
    try {
      const payload = {
        recipients: recipients.map((r) => ({
          contactId: r.contactId,
          role: r.role,
          to: r.to,
          subject: r.subject,
          body: r.body,
          include: r.include,
        })),
      };
      const res = await apiRequest("POST", `/api/rtw-plans/${planId}/distribute/send`, payload);
      const json = (await res.json()) as SendResponse;

      // Merge per-recipient results back into state. Match on (role, contactId).
      const resultByKey = new Map<string, SendResultRecipient>();
      for (const r of json.data.recipients) {
        resultByKey.set(recipientKey(r), r);
      }
      setRecipients((prev) =>
        prev.map((r) => {
          if (!r.include) return r;
          const result = resultByKey.get(recipientKey(r));
          if (!result) return r;
          return {
            ...r,
            sendStatus: result.success ? "sent" : "failed",
            sendError: result.error,
          };
        }),
      );
      setDistributionStatus(json.data.distributionStatus);

      const successCount = json.data.recipients.filter((r) => r.success).length;
      const failedCount = json.data.recipients.length - successCount;
      if (failedCount === 0) {
        toast({
          title: "Plan distributed",
          description: `Sent to ${successCount} recipient${successCount === 1 ? "" : "s"}.`,
        });
      } else {
        toast({
          title: "Partial send",
          description: `${successCount} sent, ${failedCount} failed — review per-recipient errors and retry.`,
          variant: "destructive",
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Send failed";
      // Mark every in-flight recipient as failed since we have no per-recipient breakdown.
      setRecipients((prev) =>
        prev.map((r) =>
          r.sendStatus === "sending"
            ? { ...r, sendStatus: "failed", sendError: message }
            : r,
        ),
      );
      toast({
        title: "Send failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  }

  // Retry: re-include only the failed ones and resend.
  function retryFailedOnly(): void {
    setRecipients((prev) =>
      prev.map((r) => ({
        ...r,
        include: r.sendStatus === "failed",
      })),
    );
  }

  if (!planId) {
    return (
      <div className="container mx-auto py-6 max-w-5xl">
        <div className="text-center text-muted-foreground">Plan ID required</div>
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 max-w-5xl">
      <div className="flex items-center gap-4 mb-6 flex-wrap">
        <Button variant="ghost" size="sm" asChild>
          <Link to={`/rtw/plans/${planId}`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to plan
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Distribute plan to care team</h1>
          {distributionStatus && (
            <p className="text-sm text-muted-foreground">
              Status: <span className="font-medium">{distributionStatus.replace(/_/g, " ")}</span>
            </p>
          )}
        </div>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading distribution preview…</span>
        </div>
      )}

      {!loading && loadError && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-800">
              <AlertCircle className="h-5 w-5" />
              Can't build distribution
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-red-900">
            <p>{loadError.message}</p>
            {loadError.code && loadError.code.startsWith("MISSING_") && (
              <p className="text-sm">
                Add the missing contact on the case-contacts page, then return here to distribute.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {!loading && !loadError && recipients.length > 0 && (
        <div className="space-y-4">
          {recipients.map((r) => {
            const key = recipientKey(r);
            const tagClass = ROLE_TAG_CLASS[r.role] ?? "bg-slate-100 text-slate-700";
            return (
              <Card key={key} data-testid={`distribute-recipient-${r.role}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${tagClass}`}>
                          {ROLE_LABELS[r.role]}
                        </span>
                        {!r.isGating && (
                          <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">
                            Courtesy (not gating)
                          </span>
                        )}
                        {r.sendStatus === "sent" && (
                          <span className="flex items-center gap-1 text-xs text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Sent
                          </span>
                        )}
                        {r.sendStatus === "failed" && (
                          <span className="flex items-center gap-1 text-xs text-red-700">
                            <XCircle className="h-3.5 w-3.5" />
                            Failed
                          </span>
                        )}
                        {r.sendStatus === "sending" && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Sending…
                          </span>
                        )}
                      </div>
                      <CardTitle className="text-base">{r.name}</CardTitle>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Label htmlFor={`include-${key}`} className="text-xs text-muted-foreground">
                        Include
                      </Label>
                      <Switch
                        id={`include-${key}`}
                        checked={r.include}
                        onCheckedChange={(checked) =>
                          updateRecipient(key, { include: checked })
                        }
                        disabled={sending}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className={`space-y-3 ${r.include ? "" : "opacity-50"}`}>
                  <div className="space-y-1">
                    <Label htmlFor={`to-${key}`} className="text-xs">To</Label>
                    <Input
                      id={`to-${key}`}
                      type="email"
                      value={r.to}
                      onChange={(e) => updateRecipient(key, { to: e.target.value })}
                      disabled={!r.include || sending}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`subject-${key}`} className="text-xs">Subject</Label>
                    <Input
                      id={`subject-${key}`}
                      value={r.subject}
                      onChange={(e) => updateRecipient(key, { subject: e.target.value })}
                      disabled={!r.include || sending}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`body-${key}`} className="text-xs">Body</Label>
                    <Textarea
                      id={`body-${key}`}
                      value={r.body}
                      onChange={(e) => updateRecipient(key, { body: e.target.value })}
                      disabled={!r.include || sending}
                      rows={10}
                      className="font-mono text-sm"
                    />
                  </div>
                  {r.sendError && (
                    <p className="text-xs text-red-700">{r.sendError}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}

          <div className="flex items-center justify-between pt-2 sticky bottom-0 bg-background/95 backdrop-blur py-3 border-t">
            <div className="text-sm text-muted-foreground">
              {enabledCount} of {recipients.length} recipient{recipients.length === 1 ? "" : "s"} will be sent.
            </div>
            <div className="flex items-center gap-2">
              {recipients.some((r) => r.sendStatus === "failed") && !sending && (
                <Button variant="outline" onClick={retryFailedOnly} data-testid="distribute-retry-failed">
                  Re-select failed only
                </Button>
              )}
              <Button
                onClick={handleSendAll}
                disabled={sending || enabledCount === 0}
                data-testid="distribute-send-all"
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send to all ({enabledCount})
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
