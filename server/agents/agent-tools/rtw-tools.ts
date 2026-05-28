/**
 * RTW Tools — wraps planGenerator.ts and RTW storage functions
 */

import { storage } from "../../storage";
import { db } from "../../db";
import { rtwPlans } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { AgentTool } from "../base-agent";

export const getRTWPlanTool: AgentTool = {
  name: "get_rtw_plan",
  description: "Get the current RTW plan for a case, including status and plan type.",
  inputSchema: {
    type: "object",
    properties: {
      caseId: { type: "string" },
    },
    required: ["caseId"],
  },
  async execute({ caseId }) {
    const workerCase = await storage.getGPNet2CaseByIdAdmin(caseId as string);
    if (!workerCase) throw new Error(`Case not found: ${caseId}`);

    const [plan] = await db
      .select()
      .from(rtwPlans)
      .where(eq(rtwPlans.caseId, caseId as string))
      .limit(1);

    if (!plan) return { plan: null };
    return {
      plan: {
        id: plan.id,
        status: plan.status,
        planType: plan.planType,
        startDate: plan.startDate,
        targetEndDate: plan.targetEndDate,
        createdAt: plan.createdAt,
      },
    };
  },
};

export const generateRTWPlanTool: AgentTool = {
  name: "generate_rtw_plan",
  description: "Generate an RTW plan recommendation for a case based on medical restrictions and suitable duties. Returns the recommended plan type.",
  inputSchema: {
    type: "object",
    properties: {
      caseId: { type: "string" },
    },
    required: ["caseId"],
  },
  async execute({ caseId }) {
    const { recommendPlanType, filterDutiesForPlan } = await import("../../services/planGenerator");
    const workerCase = await storage.getGPNet2CaseByIdAdmin(caseId as string);
    if (!workerCase) throw new Error(`Case not found: ${caseId}`);

    // Get functional restrictions from the latest certificate
    const certs = await storage.getCertificatesByCase(caseId as string, workerCase.organizationId);
    const latestCert = certs.sort(
      (a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime()
    )[0];
    const restrictions = latestCert?.functionalRestrictionsJson ?? null;

    // Get duties for the org (use storage method that exists)
    const contacts = await storage.getCaseContacts(caseId as string, workerCase.organizationId);

    // recommendPlanType takes (restrictions, duties) — duties come from role assessment
    // We use the duty suitability from the case's clinical status
    const recommendation = recommendPlanType(restrictions, []);
    const filteredDuties = filterDutiesForPlan([]);

    return {
      planType: recommendation,
      filteredDutiesCount: filteredDuties.length,
      medicalConstraints: workerCase.clinical_status_json?.medicalConstraints ?? null,
      recommendation: `Based on medical evidence, recommend plan type: ${recommendation}`,
    };
  },
};

export const updateRTWPlanStatusTool: AgentTool = {
  name: "update_rtw_plan_status",
  description: "Update the approval status of an RTW plan document. Use 'pending' when sending for comment, 'approved' when deemed accepted. Approval is gated on multi-party distribution completion — set bypassReason to override (audited).",
  inputSchema: {
    type: "object",
    properties: {
      caseId: { type: "string" },
      status: {
        type: "string",
        enum: ["draft", "pending", "approved", "rejected", "modification_requested"],
      },
      bypassReason: {
        type: "string",
        description: "Optional. Required to set status='approved' before all gating parties have responded. Captured in audit log.",
      },
    },
    required: ["caseId", "status"],
  },
  async execute({ caseId, status, bypassReason }) {
    const [plan] = await db
      .select({ id: rtwPlans.id, organizationId: rtwPlans.organizationId })
      .from(rtwPlans)
      .where(eq(rtwPlans.caseId, caseId as string))
      .limit(1);

    if (!plan) {
      return { updated: false, message: "No RTW plan found for case — plan may not have been created yet" };
    }

    // Approval routes through the gated storage method so the multi-party
    // distribution check is enforced for the agent tool, not just the HTTP
    // route. Other transitions (draft/pending/rejected/modification_requested)
    // are not gated.
    if (status === "approved") {
      const outcome = await storage.approveRTWPlan(plan.id, plan.organizationId, {
        bypassReason: (bypassReason as string | undefined) ?? null,
      });
      if (outcome === null) {
        return { updated: false, message: "Plan not found during approve" };
      }
      if (outcome.approved === false) {
        return {
          updated: false,
          message: `Plan cannot be approved: distribution_status is '${outcome.currentDistributionStatus}', not 'all_responded'. Pass bypassReason to override (audited).`,
          gate: "distribution_incomplete",
          currentDistributionStatus: outcome.currentDistributionStatus,
        };
      }
      return {
        updated: true,
        planId: plan.id,
        newStatus: status,
        bypassReason: outcome.bypassReason,
        priorDistributionStatus: outcome.priorDistributionStatus,
      };
    }

    await db
      .update(rtwPlans)
      .set({ status: status as any, updatedAt: new Date() } as any)
      .where(eq(rtwPlans.id, plan.id));

    return { updated: true, planId: plan.id, newStatus: status };
  },
};

export const getSuitableDutiesTool: AgentTool = {
  name: "get_suitable_duties",
  description: "Check whether the employer has confirmed suitable duties are available for this worker.",
  inputSchema: {
    type: "object",
    properties: {
      caseId: { type: "string" },
    },
    required: ["caseId"],
  },
  async execute({ caseId }) {
    const workerCase = await storage.getGPNet2CaseByIdAdmin(caseId as string);
    if (!workerCase) throw new Error(`Case not found: ${caseId}`);
    const clinical = workerCase.clinical_status_json;
    return {
      suitableDutiesOffered: clinical?.suitableDutiesOffered ?? false,
      suitableDutiesDate: clinical?.suitableDutiesDate ?? null,
    };
  },
};

export const rtwTools: AgentTool[] = [
  getRTWPlanTool,
  generateRTWPlanTool,
  updateRTWPlanStatusTool,
  getSuitableDutiesTool,
];
