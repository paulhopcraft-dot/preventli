import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import { LogoUpload } from "@/components/LogoUpload";

const companySchema = z.object({
  name: z.string().min(1, "Company name is required"),
  slug: z
    .string()
    .min(1, "Slug is required")
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers, and hyphens only"),
  contactName: z.string().optional(),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email("Invalid email").optional().or(z.literal("")),
  insurerId: z.string().optional(),
  isActive: z.boolean().optional().transform((v) => v ?? true),
  gpnetOnly: z.boolean().optional().transform((v) => v ?? false),
});

type CompanyFormData = {
  name: string;
  slug: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  insurerId?: string;
  isActive: boolean;
  gpnetOnly: boolean;
};

interface Organization {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  insurerId: string | null;
  isActive: boolean;
  gpnetOnly: boolean;
}

interface Insurer {
  id: string;
  name: string;
  code: string | null;
  isActive: boolean;
}

export default function CompanyForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isEditing = Boolean(id);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const { data: orgData, isLoading: orgLoading } = useQuery<{ data: Organization }>({
    queryKey: ["/api/admin/organizations", id],
    enabled: isEditing,
  });

  const { data: insurersData } = useQuery<{ data: Insurer[] }>({
    queryKey: ["/api/admin/insurers"],
  });

  const insurers = insurersData?.data?.filter((i) => i.isActive) || [];

  const form = useForm<CompanyFormData>({
    resolver: zodResolver(companySchema) as any,
    defaultValues: {
      name: "",
      slug: "",
      contactName: "",
      contactPhone: "",
      contactEmail: "",
      insurerId: "",
      isActive: true,
      gpnetOnly: false,
    },
  });

  // Only GPNet-side admins (admin user whose home org has gpnetOnly=true) can
  // see/use the gpnetOnly toggle. Server is the real gate; this is UX hiding.
  const { data: meData } = useQuery<{ data: { user: { role: string; homeOrgIsGpnetOnly: boolean } } }>({
    queryKey: ["/api/auth/me"],
  });
  const canEditGpnetOnly = Boolean(meData?.data?.user?.homeOrgIsGpnetOnly);

  // Populate form when editing
  useEffect(() => {
    if (orgData?.data) {
      const org = orgData.data;
      form.reset({
        name: org.name,
        slug: org.slug,
        contactName: org.contactName || "",
        contactPhone: org.contactPhone || "",
        contactEmail: org.contactEmail || "",
        insurerId: org.insurerId || "",
        isActive: org.isActive,
        gpnetOnly: org.gpnetOnly ?? false,
      });
      setLogoUrl(org.logoUrl);
    }
  }, [orgData, form]);

  // Auto-generate slug from name
  const watchName = form.watch("name");
  useEffect(() => {
    if (!isEditing && watchName) {
      const slug = watchName
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
      form.setValue("slug", slug);
    }
  }, [watchName, isEditing, form]);

  const createMutation = useMutation({
    mutationFn: async (data: CompanyFormData) => {
      const response = await fetch("/api/admin/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to create company");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Company created successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/organizations"] });
      navigate("/admin/companies");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (data: CompanyFormData) => {
      const response = await fetch(`/api/admin/organizations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || "Failed to update company");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Company updated successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/organizations"] });
      navigate("/admin/companies");
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: CompanyFormData) => {
    // Clean up empty strings
    const cleanData = {
      ...data,
      contactName: data.contactName || null,
      contactPhone: data.contactPhone || null,
      contactEmail: data.contactEmail || null,
      insurerId: data.insurerId || null,
    };

    if (isEditing) {
      updateMutation.mutate(cleanData as CompanyFormData);
    } else {
      createMutation.mutate(cleanData as CompanyFormData);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  if (isEditing && orgLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl">
      <Button
        variant="ghost"
        className="mb-4"
        onClick={() => navigate("/admin/companies")}
      >
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Companies
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>{isEditing ? "Edit Company" : "Add New Company"}</CardTitle>
          <CardDescription>
            {isEditing
              ? "Update company details and settings"
              : "Create a new organization account"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit(onSubmit as any)} className="space-y-6">
            {/* Logo Upload - only when editing */}
            {isEditing && (
              <div className="space-y-2">
                <Label>Company Logo</Label>
                <LogoUpload
                  currentLogoUrl={logoUrl}
                  organizationName={form.watch("name")}
                  uploadUrl={`/api/admin/organizations/${id}/logo`}
                  onUploadSuccess={(newLogoUrl) => {
                    setLogoUrl(newLogoUrl);
                    toast({ title: "Logo uploaded successfully" });
                  }}
                  onUploadError={(error) => {
                    toast({
                      title: "Upload failed",
                      description: error,
                      variant: "destructive",
                    });
                  }}
                  size="lg"
                />
              </div>
            )}

            {/* Company Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Company Name *</Label>
              <Input
                id="name"
                {...form.register("name")}
                placeholder="Enter company name"
              />
              {form.formState.errors.name && (
                <p className="text-sm text-red-500">
                  {form.formState.errors.name.message}
                </p>
              )}
            </div>

            {/* Slug */}
            <div className="space-y-2">
              <Label htmlFor="slug">Slug *</Label>
              <Input
                id="slug"
                {...form.register("slug")}
                placeholder="company-slug"
              />
              <p className="text-xs text-muted-foreground">
                Used in URLs and for identification. Auto-generated from name.
              </p>
              {form.formState.errors.slug && (
                <p className="text-sm text-red-500">
                  {form.formState.errors.slug.message}
                </p>
              )}
            </div>

            {/* Insurer */}
            <div className="space-y-2">
              <Label htmlFor="insurerId">Workers Compensation Insurer</Label>
              <Select
                value={form.watch("insurerId") || ""}
                onValueChange={(value) =>
                  form.setValue("insurerId", value === "none" ? "" : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select an insurer" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No insurer assigned</SelectItem>
                  {insurers.map((insurer) => (
                    <SelectItem key={insurer.id} value={insurer.id}>
                      {insurer.name}
                      {insurer.code && ` (${insurer.code})`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Contact Information */}
            <div className="border-t pt-6">
              <h3 className="font-medium mb-4">Contact Information</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="contactName">Contact Name</Label>
                  <Input
                    id="contactName"
                    {...form.register("contactName")}
                    placeholder="John Smith"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="contactPhone">Phone Number</Label>
                  <Input
                    id="contactPhone"
                    {...form.register("contactPhone")}
                    placeholder="03 9555 1234"
                  />
                </div>
              </div>

              <div className="space-y-2 mt-4">
                <Label htmlFor="contactEmail">Email Address</Label>
                <Input
                  id="contactEmail"
                  type="email"
                  {...form.register("contactEmail")}
                  placeholder="contact@company.com"
                />
                {form.formState.errors.contactEmail && (
                  <p className="text-sm text-red-500">
                    {form.formState.errors.contactEmail.message}
                  </p>
                )}
              </div>
            </div>

            {/* Active Status */}
            <div className="flex items-center justify-between border-t pt-6">
              <div>
                <Label htmlFor="isActive">Active Status</Label>
                <p className="text-sm text-muted-foreground">
                  Inactive companies cannot access the system
                </p>
              </div>
              <Switch
                id="isActive"
                checked={form.watch("isActive")}
                onCheckedChange={(checked) => form.setValue("isActive", checked)}
              />
            </div>

            {/* GPNet-only visibility flag — only visible to GPNet-side admins.
                Backend rejects the field for everyone else (403). */}
            {canEditGpnetOnly && (
              <div className="flex items-center justify-between border-t pt-6">
                <div>
                  <Label htmlFor="gpnetOnly">GPNet-Only Visibility</Label>
                  <p className="text-sm text-muted-foreground">
                    When enabled, this organisation and all its cases are hidden from Preventli-side admins.
                  </p>
                </div>
                <Switch
                  id="gpnetOnly"
                  checked={form.watch("gpnetOnly")}
                  onCheckedChange={(checked) => form.setValue("gpnetOnly", checked)}
                />
              </div>
            )}

            {/* Submit */}
            <div className="flex gap-3 pt-4 border-t">
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    {isEditing ? "Save Changes" : "Create Company"}
                  </>
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate("/admin/companies")}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
