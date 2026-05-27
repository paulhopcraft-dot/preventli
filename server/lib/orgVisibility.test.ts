import { describe, it, expect } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { workerCases } from "@shared/schema";
import {
  shouldExcludeGpnetOnlyOrgs,
  isGpnetSideAdmin,
  gpnetOnlyExclusionPredicate,
  type Viewer,
} from "./orgVisibility";

const baseViewer = {
  userId: "u-1",
  organizationId: "org-1",
  homeOrgId: "org-1",
};

const lisa: Viewer = {
  ...baseViewer,
  userId: "u-lisa",
  role: "admin",
  homeOrgIsGpnetOnly: false,
};

const paul: Viewer = {
  ...baseViewer,
  userId: "u-paul",
  organizationId: "org-gpnet",
  homeOrgId: "org-gpnet",
  role: "admin",
  homeOrgIsGpnetOnly: true,
};

const tenantEmployer: Viewer = {
  ...baseViewer,
  userId: "u-emp",
  role: "employer",
  homeOrgIsGpnetOnly: false,
};

const employerInGpnetOrg: Viewer = {
  ...baseViewer,
  userId: "u-emp-g",
  role: "employer",
  homeOrgIsGpnetOnly: true,
};

const partner: Viewer = {
  ...baseViewer,
  userId: "u-partner",
  role: "partner",
  homeOrgIsGpnetOnly: false,
};

describe("shouldExcludeGpnetOnlyOrgs", () => {
  it("returns true for Lisa (admin, non-gpnet home org) — the one-way curtain", () => {
    expect(shouldExcludeGpnetOnlyOrgs(lisa)).toBe(true);
  });

  it("returns false for Paul (admin, gpnet-side home org)", () => {
    expect(shouldExcludeGpnetOnlyOrgs(paul)).toBe(false);
  });

  it("returns false for non-admin role in a non-gpnet org (already tenant-scoped)", () => {
    expect(shouldExcludeGpnetOnlyOrgs(tenantEmployer)).toBe(false);
  });

  it("returns false for non-admin role even if home org happens to be gpnetOnly", () => {
    expect(shouldExcludeGpnetOnlyOrgs(employerInGpnetOrg)).toBe(false);
  });

  it("returns false for partner role (active-client scoping handles isolation)", () => {
    expect(shouldExcludeGpnetOnlyOrgs(partner)).toBe(false);
  });
});

describe("isGpnetSideAdmin", () => {
  it("identifies Paul (admin + gpnetOnly home org)", () => {
    expect(isGpnetSideAdmin(paul)).toBe(true);
  });

  it("rejects Lisa (admin but non-gpnet home org) — prevents self-promotion", () => {
    expect(isGpnetSideAdmin(lisa)).toBe(false);
  });

  it("rejects non-admin even with gpnetOnly home org", () => {
    expect(isGpnetSideAdmin(employerInGpnetOrg)).toBe(false);
  });
});

describe("gpnetOnlyExclusionPredicate", () => {
  it("returns undefined for Paul (no filter needed)", () => {
    const predicate = gpnetOnlyExclusionPredicate(paul, workerCases.organizationId);
    expect(predicate).toBeUndefined();
  });

  it("returns undefined for tenant-scoped users (no filter needed)", () => {
    expect(gpnetOnlyExclusionPredicate(tenantEmployer, workerCases.organizationId)).toBeUndefined();
    expect(gpnetOnlyExclusionPredicate(partner, workerCases.organizationId)).toBeUndefined();
  });

  it("returns a real SQL fragment for Lisa", () => {
    const predicate = gpnetOnlyExclusionPredicate(lisa, workerCases.organizationId);
    expect(predicate).toBeDefined();
    // Run the fragment through the pg dialect so the assertions check the
    // SQL the database actually receives — not the JS object shape.
    const compiled = new PgDialect().sqlToQuery(predicate!);
    const lower = compiled.sql.toLowerCase();
    expect(lower).toContain("not exists");
    expect(lower).toContain("gpnet_only");
    expect(compiled.sql).toContain("organization_id");
  });
});
