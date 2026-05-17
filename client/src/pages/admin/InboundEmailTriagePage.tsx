import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";

interface EmailRow {
  id: string;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  receivedAt: string | null;
  processingStatus: string;
  matchMethod: string | null;
}

export default function InboundEmailTriagePage(): JSX.Element {
  const { toast } = useToast();
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [caseIdInput, setCaseIdInput] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery<{ data: EmailRow[]; total: number }>({
    queryKey: ["/api/admin/inbound-emails"],
  });

  const emails = data?.data ?? [];

  const assignMutation = useMutation({
    mutationFn: async ({ emailId, caseId }: { emailId: string; caseId: string }) => {
      const res = await apiRequest("POST", `/api/admin/inbound-emails/${emailId}/assign`, { caseId });
      return res.json();
    },
    onSuccess: (_result, { emailId }) => {
      toast({ title: "Email assigned", description: "The email has been linked to the case." });
      setAssigningId(null);
      setCaseIdInput((prev) => {
        const next = { ...prev };
        delete next[emailId];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/inbound-emails"] });
    },
    onError: () => {
      toast({
        title: "Assignment failed",
        description: "Could not assign the email. Check the case ID and try again.",
        variant: "destructive",
      });
    },
  });

  function handleAssignSubmit(emailId: string): void {
    const caseId = (caseIdInput[emailId] ?? "").trim();
    if (!caseId) {
      toast({ title: "Case ID required", variant: "destructive" });
      return;
    }
    assignMutation.mutate({ emailId, caseId });
  }

  function formatDate(value: string | null): string {
    if (!value) return "—";
    return new Date(value).toLocaleString();
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Inbound Email Triage</h1>
        <p className="text-muted-foreground">
          Unmatched emails needing manual case assignment
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-amber-500" />
            Unmatched Emails
          </CardTitle>
          <CardDescription>
            {isLoading ? "Loading…" : `${emails.length} email${emails.length === 1 ? "" : "s"} awaiting assignment`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              Loading emails…
            </div>
          ) : emails.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-3">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <p className="text-base font-medium">No unmatched emails — great job!</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 pr-4 font-medium text-muted-foreground">From</th>
                    <th className="pb-3 pr-4 font-medium text-muted-foreground">Subject</th>
                    <th className="pb-3 pr-4 font-medium text-muted-foreground">Received</th>
                    <th className="pb-3 font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {emails.map((email) => (
                    <tr key={email.id} className="align-top">
                      <td className="py-4 pr-4">
                        <p className="font-medium">{email.fromName ?? email.fromEmail}</p>
                        {email.fromName && (
                          <p className="text-xs text-muted-foreground">{email.fromEmail}</p>
                        )}
                        <Badge variant="outline" className="mt-1 text-xs text-amber-600 border-amber-300">
                          {email.processingStatus}
                        </Badge>
                      </td>
                      <td className="py-4 pr-4 max-w-xs">
                        <p className="truncate">{email.subject || "(no subject)"}</p>
                      </td>
                      <td className="py-4 pr-4 whitespace-nowrap text-muted-foreground text-xs">
                        {formatDate(email.receivedAt)}
                      </td>
                      <td className="py-4">
                        {assigningId === email.id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              className="h-8 w-48 text-sm"
                              placeholder="Case ID"
                              value={caseIdInput[email.id] ?? ""}
                              onChange={(e) =>
                                setCaseIdInput((prev) => ({ ...prev, [email.id]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleAssignSubmit(email.id);
                                if (e.key === "Escape") setAssigningId(null);
                              }}
                              autoFocus
                            />
                            <Button
                              size="sm"
                              onClick={() => handleAssignSubmit(email.id)}
                              disabled={assignMutation.isPending}
                            >
                              {assignMutation.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                "Assign"
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setAssigningId(null)}
                              disabled={assignMutation.isPending}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setAssigningId(email.id)}
                          >
                            Assign to Case
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
