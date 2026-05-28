/**
 * DistributionResponsesPanel
 *
 * Phase 6 of RTW multi-party distribution (spec
 * agent-specs/rtw-plan-multi-party-distribution.md §6).
 *
 * Renders on the case-detail page beneath the current RTW plan card. Shows
 * each recipient that received the active plan's distribution, their status
 * (`Sent · awaiting reply` / `Replied YYYY-MM-DD`), and — for not-yet-replied
 * recipients — a textarea + "Mark responded" button so the practitioner can
 * v1-manual-paste the reply text. v2 will swap manual paste for inbound-email
 * parsing; the UI shape stays the same.
 *
 * Data sources:
 *  - `GET /api/rtw-plans?caseId=…` for the latest plan's planId +
 *    distributionStatus (terminal-aware: if it's `finalised`, render
 *    read-only).
 *  - `GET /api/cases/:caseId/contacts` for each contact's tracking columns
 *    (lastDistributedAt, respondedAt, responseText) plus role/name.
 *
 * Mutation:
 *  - `POST /api/rtw-plans/:planId/responses/:contactId/mark` with
 *    `{ responseText }`. On 2xx, invalidates both queries so the panel re-
 *    renders with the new respondedAt + distributionStatus.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Mail, MessageSquare, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

// Mirrors server/services/rtwPlanDistribution.ts RTWRecipientRole, plus the
// raw `case_contacts.role` values that aren't part of the distribution flow
// (e.g. case_manager, host_employer, gpnet — we just ignore those rows).
type DistributionRole = "worker" | "employer_primary" | "treating_gp" | "physiotherapist" | "insurer";

interface CaseContact {
  id: string;
  role: string;
  name: string;
  email: string | null;
  lastDistributedAt: string | null;
  respondedAt: string | null;
  responseText: string | null;
}

interface PlanResponse {
  success: boolean;
  data: {
    plan: {
      id: string;
      status: string;
      distributionStatus: "not_distributed" | "awaiting_responses" | "all_responded" | "finalised";
    };
  };
}

interface ContactsResponse {
  success: boolean;
  data: CaseContact[];
}

const DISTRIBUTION_ROLES = new Set<string>([
  "worker",
  "employer_primary",
  "treating_gp",
  "physiotherapist",
  "insurer",
]);

const ROLE_LABEL: Record<string, string> = {
  worker: "Worker",
  employer_primary: "Manager",
  treating_gp: "Treating doctor",
  physiotherapist: "Physiotherapist",
  insurer: "Insurer (courtesy)",
};

const STATUS_LABEL: Record<string, string> = {
  not_distributed: "Not distributed",
  awaiting_responses: "Awaiting responses",
  all_responded: "All responded — ready to approve",
  finalised: "Finalised",
};

interface Props {
  caseId: string;
}

export function DistributionResponsesPanel({ caseId }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingText, setPendingText] = useState<Record<string, string>>({});

  const planQuery = useQuery<PlanResponse>({
    queryKey: [`/api/rtw-plans?caseId=${caseId}`],
    enabled: !!caseId,
    retry: false,
  });

  const contactsQuery = useQuery<ContactsResponse>({
    queryKey: [`/api/cases/${caseId}/contacts`],
    enabled: !!caseId,
  });

  const markMutation = useMutation({
    mutationFn: async (args: { contactId: string; responseText: string }) => {
      const planId = planQuery.data?.data.plan.id;
      if (!planId) throw new Error("Plan not loaded");
      const res = await apiRequest(
        "POST",
        `/api/rtw-plans/${planId}/responses/${args.contactId}/mark`,
        { responseText: args.responseText },
      );
      return res.json();
    },
    onSuccess: (_, vars) => {
      toast({ title: "Response recorded", description: "Distribution status refreshed." });
      setPendingText((prev) => {
        const next = { ...prev };
        delete next[vars.contactId];
        return next;
      });
      // Both queries inform the panel; invalidate both so the row re-renders
      // with respondedAt and the header reflects the new distributionStatus.
      queryClient.invalidateQueries({ queryKey: [`/api/rtw-plans?caseId=${caseId}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/cases/${caseId}/contacts`] });
    },
    onError: (err: Error) => {
      toast({
        title: "Failed to record response",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // Render-stage guards — fail quietly. No active plan = no panel; some cases
  // legitimately have no plan yet. Same for the contacts query.
  if (planQuery.isLoading || contactsQuery.isLoading) {
    return null;
  }
  if (planQuery.isError || !planQuery.data) {
    return null; // 404 from /api/rtw-plans means no plan exists; nothing to show.
  }
  if (contactsQuery.isError || !contactsQuery.data) {
    return null;
  }

  const { plan } = planQuery.data.data;
  const allContacts = contactsQuery.data.data;
  // Only show contacts in the distribution role set AND that have actually
  // received a send. If a case has a manager contact but the plan was never
  // distributed, the row would be confusing here — DistributePage is the
  // place to start a send.
  const distributedContacts = allContacts.filter(
    (c) => DISTRIBUTION_ROLES.has(c.role) && c.lastDistributedAt !== null,
  );

  if (distributedContacts.length === 0) {
    return null;
  }

  const isFinalised = plan.distributionStatus === "finalised";

  return (
    <Card data-testid="distribution-responses-panel">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Distribution responses
          </span>
          <Badge
            variant={plan.distributionStatus === "all_responded" ? "default" : "secondary"}
            data-testid={`distribution-status-${plan.distributionStatus}`}
          >
            {STATUS_LABEL[plan.distributionStatus] ?? plan.distributionStatus}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {distributedContacts.map((contact) => {
          const responded = !!contact.respondedAt;
          const draft = pendingText[contact.id] ?? "";
          const isSubmitting = markMutation.isPending && markMutation.variables?.contactId === contact.id;

          return (
            <div
              key={contact.id}
              className="border rounded-md p-4"
              data-testid={`response-row-${contact.role}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="font-medium">
                    {ROLE_LABEL[contact.role] ?? contact.role} — {contact.name}
                  </div>
                  {contact.email && (
                    <div className="text-xs text-muted-foreground">{contact.email}</div>
                  )}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  {responded ? (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                      Replied {format(new Date(contact.respondedAt!), "yyyy-MM-dd")}
                    </>
                  ) : (
                    <>
                      <Clock className="h-3.5 w-3.5" />
                      Sent {format(new Date(contact.lastDistributedAt!), "yyyy-MM-dd")} · awaiting reply
                    </>
                  )}
                </div>
              </div>

              {responded && contact.responseText && (
                <div className="bg-muted/40 rounded p-3 text-sm whitespace-pre-wrap">
                  <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground mb-1">
                    <MessageSquare className="h-3 w-3" />
                    Response
                  </div>
                  {contact.responseText}
                </div>
              )}

              {!responded && !isFinalised && (
                <div className="space-y-2">
                  <Textarea
                    placeholder="Paste the recipient's reply here…"
                    value={draft}
                    onChange={(e) =>
                      setPendingText((prev) => ({ ...prev, [contact.id]: e.target.value }))
                    }
                    rows={3}
                    data-testid={`response-textarea-${contact.role}`}
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      disabled={!draft.trim() || isSubmitting}
                      onClick={() =>
                        markMutation.mutate({
                          contactId: contact.id,
                          responseText: draft.trim(),
                        })
                      }
                      data-testid={`mark-responded-${contact.role}`}
                    >
                      <Send className="h-3.5 w-3.5 mr-1" />
                      {isSubmitting ? "Recording…" : "Mark responded"}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default DistributionResponsesPanel;
