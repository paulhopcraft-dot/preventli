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
import { updatePartnerSelfSchema } from "@shared/partnerSelf";
import { auStateCodes } from "@shared/schema";

interface PartnerOrgRow {
  id: string;
  name: string;
  logoUrl: string | null;
  kind: "employer" | "partner";
  addressLine1: string | null;
  addressLine2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
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
  notes: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FormValues = {
  name: string;
  logoUrl: string;
  addressLine1: string;
  addressLine2: string;
  suburb: string;
  state: string;
  postcode: string;
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
  notes: string;
};

const EMPTY: FormValues = {
  name: "",
  logoUrl: "",
  addressLine1: "",
  addressLine2: "",
  suburb: "",
  state: "",
  postcode: "",
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
  notes: "",
};

function rowToFormValues(row: PartnerOrgRow): FormValues {
  return {
    name: row.name,
    logoUrl: row.logoUrl ?? "",
    addressLine1: row.addressLine1 ?? "",
    addressLine2: row.addressLine2 ?? "",
    suburb: row.suburb ?? "",
    state: row.state ?? "",
    postcode: row.postcode ?? "",
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
    notes: row.notes ?? "",
  };
}

export function PartnerSelfSetupForm({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const meQuery = useQuery<{ partnerOrg: PartnerOrgRow | null }>({
    queryKey: ["partner", "me"],
    queryFn: async () => {
      const res = await fetch("/api/partner/me", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load partner context");
      return res.json();
    },
    enabled: open,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(updatePartnerSelfSchema) as never,
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    if (meQuery.data?.partnerOrg) {
      form.reset(rowToFormValues(meQuery.data.partnerOrg));
    }
  }, [open, meQuery.data, form]);

  const submitMutation = useMutation({
    mutationFn: async (values: FormValues) => {
      // Send only fields the user actually touched. Empty-string for a
      // dirty field is a deliberate "clear" — the server's
      // updatePartnerSelfSchema turns "" into undefined and the PATCH
      // handler writes that as null. Untouched empties (the form's
      // initial state) must stay out of the payload so we don't nuke
      // fields the user never opened.
      const dirty = form.formState.dirtyFields as Record<string, boolean | undefined>;
      const payload: Record<string, string> = {};
      for (const [k, v] of Object.entries(values)) {
        if (dirty[k]) payload[k] = v ?? "";
      }
      const res = await fetchWithCsrf("/api/partner/me", {
        method: "PATCH",
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
    onSuccess: (data: { partnerOrg?: PartnerOrgRow }) => {
      // Immediately patch the cached query so header + sidebar reflect the
      // new name without waiting for a background refetch to complete.
      if (data?.partnerOrg) {
        queryClient.setQueryData<{ partnerOrg: PartnerOrgRow | null; activeOrg: unknown }>(
          ["partner", "me"],
          (old) => (old ? { ...old, partnerOrg: data.partnerOrg ?? null } : old)
        );
      }
      queryClient.invalidateQueries({ queryKey: ["partner", "me"] });
      toast({
        title: "Organisation updated",
        description: "Your details have been saved.",
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
        description: err.body?.message ?? "Could not save organisation details.",
      });
    },
  });

  const onSubmit = (values: FormValues) => submitMutation.mutate(values);

  const isLoading = meQuery.isLoading;
  const isSubmitting = submitMutation.isPending;
  const errors = form.formState.errors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Organisation details</DialogTitle>
          <DialogDescription>
            Your partner organisation's contact details, address, and notification
            routing. Only the name is required.
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
            data-testid="partner-self-form"
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
                <div className="sm:col-span-2">
                  <Label htmlFor="logoUrl">Logo URL</Label>
                  <Input
                    id="logoUrl"
                    placeholder="https://..."
                    {...form.register("logoUrl")}
                  />
                  {errors.logoUrl && (
                    <p className="mt-1 text-xs text-destructive">{errors.logoUrl.message}</p>
                  )}
                </div>
              </div>
            </section>

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

            {/* 3. Primary contact */}
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

            {/* 4. RTW coordinator */}
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

            {/* 5. HR contact */}
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

            {/* 6. Notification emails */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Notification emails
              </h3>
              <div>
                <Label htmlFor="notificationEmails">Notification emails</Label>
                <Input
                  id="notificationEmails"
                  {...form.register("notificationEmails")}
                  data-testid="field-notification-emails"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Shared mailboxes at your organisation (e.g. ops@, alerts@).
                  Comma-separated, up to 10 addresses.
                </p>
                {errors.notificationEmails && (
                  <p className="mt-1 text-xs text-destructive">
                    {errors.notificationEmails.message}
                  </p>
                )}
              </div>
            </section>

            {/* 7. Notes */}
            <section className="space-y-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Notes
              </h3>
              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea id="notes" rows={4} {...form.register("notes")} />
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
              <Button
                type="submit"
                disabled={isSubmitting}
                data-testid="submit-partner-self"
              >
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save changes
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
