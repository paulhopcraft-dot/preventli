import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { fetchWithCsrf } from "@/lib/queryClient";
import {
  createPartnerClientSchema,
  type CreatePartnerClientInput,
} from "@shared/partnerClient";
import { auStateCodes, employeeCountBands } from "@shared/schema";

interface Insurer {
  id: string;
  name: string;
  code: string | null;
}

interface ClientRow {
  id: string;
  name: string;
  abn: string | null;
  worksafeState: string | null;
  policyNumber: string | null;
  wicCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  insurerId: string | null;
  insurerClaimContactEmail: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  rtwCoordinatorName: string | null;
  rtwCoordinatorEmail: string | null;
  rtwCoordinatorPhone: string | null;
  hrContactName: string | null;
  hrContactEmail: string | null;
  hrContactPhone: string | null;
  notificationEmails: string | null;
  employeeCount: string | null;
  notes: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the form opens in edit mode and pre-fills via GET /clients/:id. */
  clientId?: string;
}

type FormValues = {
  name: string;
  abn: string;
  worksafeState: string;
  policyNumber: string;
  wicCode: string;
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  state: string;
  postcode: string;
  insurerId: string;
  insurerClaimContactEmail: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  rtwCoordinatorName: string;
  rtwCoordinatorEmail: string;
  rtwCoordinatorPhone: string;
  hrContactName: string;
  hrContactEmail: string;
  hrContactPhone: string;
  notificationEmails: string;
  employeeCount: string;
  notes: string;
};

const EMPTY: FormValues = {
  name: "",
  abn: "",
  worksafeState: "",
  policyNumber: "",
  wicCode: "",
  addressLine1: "",
  addressLine2: "",
  suburb: "",
  state: "",
  postcode: "",
  insurerId: "",
  insurerClaimContactEmail: "",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  rtwCoordinatorName: "",
  rtwCoordinatorEmail: "",
  rtwCoordinatorPhone: "",
  hrContactName: "",
  hrContactEmail: "",
  hrContactPhone: "",
  notificationEmails: "",
  employeeCount: "",
  notes: "",
};

function rowToFormValues(row: ClientRow): FormValues {
  return {
    name: row.name,
    abn: row.abn ?? "",
    worksafeState: row.worksafeState ?? "",
    policyNumber: row.policyNumber ?? "",
    wicCode: row.wicCode ?? "",
    addressLine1: row.addressLine1 ?? "",
    addressLine2: row.addressLine2 ?? "",
    suburb: row.suburb ?? "",
    state: row.state ?? "",
    postcode: row.postcode ?? "",
    insurerId: row.insurerId ?? "",
    insurerClaimContactEmail: row.insurerClaimContactEmail ?? "",
    contactName: row.contactName ?? "",
    contactEmail: row.contactEmail ?? "",
    contactPhone: row.contactPhone ?? "",
    rtwCoordinatorName: row.rtwCoordinatorName ?? "",
    rtwCoordinatorEmail: row.rtwCoordinatorEmail ?? "",
    rtwCoordinatorPhone: row.rtwCoordinatorPhone ?? "",
    hrContactName: row.hrContactName ?? "",
    hrContactEmail: row.hrContactEmail ?? "",
    hrContactPhone: row.hrContactPhone ?? "",
    notificationEmails: row.notificationEmails ?? "",
    employeeCount: row.employeeCount ?? "",
    notes: row.notes ?? "",
  };
}

export function ClientSetupForm({ open, onOpenChange, clientId }: Props) {
  const isEditing = Boolean(clientId);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const insurersQuery = useQuery<{ insurers: Insurer[] }>({
    queryKey: ["partner", "insurers"],
    queryFn: async () => {
      const res = await fetch("/api/partner/insurers", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load insurers");
      return res.json();
    },
    enabled: open,
  });

  const clientQuery = useQuery<{ client: ClientRow }>({
    queryKey: ["partner", "clients", clientId],
    queryFn: async () => {
      const res = await fetch(`/api/partner/clients/${clientId}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load client");
      return res.json();
    },
    enabled: open && Boolean(clientId),
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(createPartnerClientSchema) as never,
    defaultValues: EMPTY,
  });

  // Reset form whenever the dialog opens or the loaded client changes.
  useEffect(() => {
    if (!open) return;
    if (isEditing && clientQuery.data?.client) {
      form.reset(rowToFormValues(clientQuery.data.client));
    } else if (!isEditing) {
      form.reset(EMPTY);
    }
  }, [open, isEditing, clientQuery.data, form]);

  const submitMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      // Strip empty strings — the server schema treats "" as undefined for
      // optional fields, but PATCH treats undefined as "don't touch".
      const payload: Record<string, string> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v !== "" && v !== undefined) payload[k] = v;
      }
      const url = isEditing
        ? `/api/partner/clients/${clientId}`
        : "/api/partner/clients";
      const method = isEditing ? "PATCH" : "POST";
      const res = await fetchWithCsrf(url, {
        method,
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw { status: res.status, body: err };
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["partner", "clients"] });
      toast({
        title: isEditing ? "Client updated" : "Client created",
        description: isEditing
          ? "Changes saved."
          : "New client added to your picker.",
      });
      onOpenChange(false);
    },
    onError: (err: { status?: number; body?: { message?: string; details?: { fieldErrors?: Record<string, string[]> } } }) => {
      const fieldErrors = err.body?.details?.fieldErrors;
      if (fieldErrors) {
        for (const [field, msgs] of Object.entries(fieldErrors)) {
          if (msgs?.[0]) {
            form.setError(field as keyof FormValues, {
              type: "server",
              message: msgs[0],
            });
          }
        }
      }
      toast({
        variant: "destructive",
        title: "Save failed",
        description: err.body?.message ?? "Could not save client.",
      });
    },
  });

  const onSubmit = (values: FormValues) => submitMutation.mutate(values);

  const insurers = insurersQuery.data?.insurers ?? [];
  const isLoading = isEditing && clientQuery.isLoading;
  const isSubmitting = submitMutation.isPending;
  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit client" : "Add client"}</DialogTitle>
          <DialogDescription>
            Capture the details we need to run cases for this client. Only the
            client name is required — fill the rest as you have it.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-8"
            data-testid="client-setup-form"
          >
            {/* 1. Identity */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Identity
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="name">
                    Name <span className="text-destructive">*</span>
                  </Label>
                  <Input id="name" {...form.register("name")} data-testid="field-name" />
                  {errors.name && (
                    <p className="mt-1 text-xs text-destructive">{errors.name.message}</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="employeeCount">Employee count</Label>
                  <Select
                    value={form.watch("employeeCount")}
                    onValueChange={(v) => form.setValue("employeeCount", v)}
                  >
                    <SelectTrigger id="employeeCount" data-testid="field-employee-count">
                      <SelectValue placeholder="Select range" />
                    </SelectTrigger>
                    <SelectContent>
                      {employeeCountBands.map((b) => (
                        <SelectItem key={b} value={b}>
                          {b}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              Everything below is <span className="font-medium">optional</span> — fill in what you have, you can edit the rest later.
            </div>

            {/* 2. Address */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Address
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="addressLine1">Address line 1</Label>
                  <Input id="addressLine1" {...form.register("addressLine1")} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="addressLine2">Address line 2</Label>
                  <Input id="addressLine2" {...form.register("addressLine2")} />
                </div>
                <div>
                  <Label htmlFor="suburb">Suburb</Label>
                  <Input id="suburb" {...form.register("suburb")} />
                </div>
                <div>
                  <Label htmlFor="state">State</Label>
                  <Select
                    value={form.watch("state")}
                    onValueChange={(v) => form.setValue("state", v)}
                  >
                    <SelectTrigger id="state">
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      {auStateCodes.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="postcode">Postcode</Label>
                  <Input
                    id="postcode"
                    placeholder="4 digits"
                    {...form.register("postcode")}
                  />
                  {errors.postcode && (
                    <p className="mt-1 text-xs text-destructive">{errors.postcode.message}</p>
                  )}
                </div>
              </div>
            </section>

            {/* 3. Insurer & policy */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Insurer &amp; policy
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="insurerId">Insurer</Label>
                  <Select
                    value={form.watch("insurerId")}
                    onValueChange={(v) => form.setValue("insurerId", v)}
                  >
                    <SelectTrigger id="insurerId" data-testid="field-insurer">
                      <SelectValue placeholder="Select insurer" />
                    </SelectTrigger>
                    <SelectContent>
                      {insurers.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="worksafeState">WorkSafe state</Label>
                  <Select
                    value={form.watch("worksafeState")}
                    onValueChange={(v) => form.setValue("worksafeState", v)}
                  >
                    <SelectTrigger id="worksafeState">
                      <SelectValue placeholder="Select state" />
                    </SelectTrigger>
                    <SelectContent>
                      {auStateCodes.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="policyNumber">Policy number</Label>
                  <Input
                    id="policyNumber"
                    {...form.register("policyNumber")}
                    data-testid="field-policy-number"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Used later when lodging WorkSafe claims for this client.
                  </p>
                </div>
                <div>
                  <Label htmlFor="wicCode">WIC code</Label>
                  <Input id="wicCode" {...form.register("wicCode")} />
                  <p className="mt-1 text-xs text-muted-foreground">
                    WorkSafe Industry Classification.
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="insurerClaimContactEmail">Claim contact email</Label>
                  <Input
                    id="insurerClaimContactEmail"
                    type="email"
                    {...form.register("insurerClaimContactEmail")}
                  />
                  {errors.insurerClaimContactEmail && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.insurerClaimContactEmail.message}
                    </p>
                  )}
                </div>
              </div>
            </section>

            {/* 4. Primary contact */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Primary contact
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="contactName">Name</Label>
                  <Input id="contactName" {...form.register("contactName")} />
                </div>
                <div>
                  <Label htmlFor="contactEmail">Email</Label>
                  <Input
                    id="contactEmail"
                    type="email"
                    {...form.register("contactEmail")}
                  />
                  {errors.contactEmail && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.contactEmail.message}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="contactPhone">Phone</Label>
                  <Input id="contactPhone" {...form.register("contactPhone")} />
                </div>
              </div>
            </section>

            {/* 5. RTW coordinator */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                RTW coordinator
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="rtwCoordinatorName">Name</Label>
                  <Input id="rtwCoordinatorName" {...form.register("rtwCoordinatorName")} />
                </div>
                <div>
                  <Label htmlFor="rtwCoordinatorEmail">Email</Label>
                  <Input
                    id="rtwCoordinatorEmail"
                    type="email"
                    {...form.register("rtwCoordinatorEmail")}
                  />
                  {errors.rtwCoordinatorEmail && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.rtwCoordinatorEmail.message}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="rtwCoordinatorPhone">Phone</Label>
                  <Input id="rtwCoordinatorPhone" {...form.register("rtwCoordinatorPhone")} />
                </div>
              </div>
            </section>

            {/* 6. HR contact */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                HR contact
              </h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="hrContactName">Name</Label>
                  <Input id="hrContactName" {...form.register("hrContactName")} />
                </div>
                <div>
                  <Label htmlFor="hrContactEmail">Email</Label>
                  <Input
                    id="hrContactEmail"
                    type="email"
                    {...form.register("hrContactEmail")}
                  />
                  {errors.hrContactEmail && (
                    <p className="mt-1 text-xs text-destructive">
                      {errors.hrContactEmail.message}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="hrContactPhone">Phone</Label>
                  <Input id="hrContactPhone" {...form.register("hrContactPhone")} />
                </div>
              </div>
            </section>

            {/* 7. Notifications */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Notifications
              </h3>
              <div>
                <Label htmlFor="notificationEmails">Notification emails</Label>
                <Input
                  id="notificationEmails"
                  {...form.register("notificationEmails")}
                  data-testid="field-notification-emails"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Shared mailboxes at the client (e.g. safety@, hr@, whs@). Comma-separated, up to 10 addresses.
                </p>
                {errors.notificationEmails && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.notificationEmails.message}
                  </p>
                )}
              </div>
            </section>

            {/* 8. Notes */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Notes
              </h3>
              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  rows={4}
                  {...form.register("notes")}
                />
              </div>
            </section>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} data-testid="submit-client">
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {isEditing ? "Save changes" : "Create client"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
