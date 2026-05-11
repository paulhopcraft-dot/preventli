import type { WorkerCase } from "@shared/schema";
import { storage } from "../storage";
import { format, formatDistance } from "date-fns";

export class TemplateSummaryService {
  /**
   * Generate case summary using structured data templates (no AI required)
   */
  async getCachedOrGenerateSummary(caseId: string): Promise<{
    summary: string;
    cached: boolean;
    generatedAt?: string;
    model?: string;
    workStatusClassification?: string;
  }> {
    // Use admin method as summary service operates across organizations
    const workerCase = await storage.getGPNet2CaseByIdAdmin(caseId);

    if (!workerCase) {
      throw new Error(`Case ${caseId} not found`);
    }

    // Check if we need to refresh the summary
    const needsRefresh = await storage.needsSummaryRefresh(caseId, workerCase.organizationId);

    // If summary exists and doesn't need refresh, return cached version
    if (!needsRefresh && workerCase.aiSummary) {
      return {
        summary: workerCase.aiSummary,
        cached: true,
        generatedAt: workerCase.aiSummaryGeneratedAt,
        model: workerCase.aiSummaryModel || "template-v1",
        workStatusClassification: workerCase.aiWorkStatusClassification,
      };
    }

    // Generate new template-based summary
    const templateSummary = this.generateTemplateSummary(workerCase);

    // Store in database
    await storage.updateAISummary(
      caseId,
      workerCase.organizationId,
      templateSummary.summary,
      "template-v1",
      templateSummary.workStatusClassification
    );

    return {
      summary: templateSummary.summary,
      cached: false,
      generatedAt: new Date().toISOString(),
      model: "template-v1",
      workStatusClassification: templateSummary.workStatusClassification,
    };
  }

  /**
   * Generate structured summary from case data
   */
  private generateTemplateSummary(workerCase: WorkerCase): {
    summary: string;
    workStatusClassification: string;
  } {
    const injuryDate = new Date(workerCase.dateOfInjury);
    const daysOffWork = formatDistance(injuryDate, new Date(), { addSuffix: false });

    const sections = [];

    // Header
    sections.push(`## Case Summary - ${workerCase.workerName}`);
    sections.push(`**Company:** ${workerCase.company}`);
    sections.push(`**Injury Date:** ${format(injuryDate, 'dd MMM yyyy')} (${daysOffWork} ago)`);
    sections.push("");

    // Current Status
    sections.push("### Current Status");
    sections.push(`**Work Status:** ${workerCase.workStatus}`);
    sections.push(`**Risk Level:** ${workerCase.riskLevel}`);
    if (workerCase.currentStatus) {
      sections.push(`**Current Status:** ${workerCase.currentStatus}`);
    }
    if (workerCase.nextStep) {
      sections.push(`**Next Step:** ${workerCase.nextStep}`);
    }
    sections.push("");

    // Medical Certificate Status
    sections.push("### Medical Certificate");
    if (workerCase.hasCertificate && workerCase.latestCertificate) {
      const cert = workerCase.latestCertificate;
      sections.push(`✅ **Certificate On File**`);
      if (cert.startDate && cert.endDate) {
        sections.push(`**Period:** ${format(new Date(cert.startDate), 'dd MMM yyyy')} - ${format(new Date(cert.endDate), 'dd MMM yyyy')}`);
      }
      if (cert.capacity) {
        sections.push(`**Work Capacity:** ${cert.capacity}`);
      }
      if (cert.restrictions && cert.restrictions.length > 0) {
        sections.push(`**Restrictions:** ${cert.restrictions.join(', ')}`);
      }
    } else {
      sections.push(`⚠️ **No Certificate on File**`);
    }
    sections.push("");

    // Compliance Status
    sections.push("### Compliance");
    const complianceIcon = this.getComplianceIcon(workerCase.complianceIndicator);
    sections.push(`**Status:** ${complianceIcon} ${workerCase.complianceIndicator}`);

    if (workerCase.compliance) {
      const comp = workerCase.compliance;
      sections.push(`**Reason:** ${comp.reason}`);
      sections.push(`**Source:** ${comp.source}`);
      if (comp.lastChecked) {
        sections.push(`**Last Checked:** ${format(new Date(comp.lastChecked), 'dd MMM yyyy')}`);
      }
    }
    sections.push("");

    // Return to Work Planning
    if (workerCase.rtwPlanStatus) {
      sections.push("### Return to Work");
      sections.push(`**Plan Status:** ${workerCase.rtwPlanStatus}`);
      // RTW plan targetDate and planType live in the rtwPlans table, not on WorkerCase directly.
      // Access via workerCase.clinical_status_json?.rtwPlanTargetEndDate if populated.
      if ((workerCase.clinical_status_json as any)?.rtwPlanTargetEndDate) {
        sections.push(`**Target End Date:** ${format(new Date((workerCase.clinical_status_json as any).rtwPlanTargetEndDate), 'dd MMM yyyy')}`);
      }
      sections.push("");
    }

    // Case Management
    sections.push("### Case Management");
    sections.push(`**Owner:** ${workerCase.owner}`);
    if (workerCase.dueDate) {
      sections.push(`**Due Date:** ${format(new Date(workerCase.dueDate), 'dd MMM yyyy')}`);
    }

    // Add case summary if available
    if (workerCase.summary && workerCase.summary.trim()) {
      sections.push("");
      sections.push("### Case Notes");
      sections.push(workerCase.summary);
    }

    // Recent Discussion
    if (workerCase.latestDiscussionNotes && workerCase.latestDiscussionNotes.length > 0) {
      sections.push("");
      sections.push("### Recent Discussion");
      const recentNotes = workerCase.latestDiscussionNotes.slice(0, 3);
      recentNotes.forEach(note => {
        const noteDate = format(new Date(note.timestamp), 'dd MMM yyyy');
        sections.push(`**${noteDate}:** ${note.rawText.substring(0, 150)}${note.rawText.length > 150 ? '...' : ''}`);
      });
    }

    // Key Actions Needed
    const actionsNeeded = this.identifyKeyActions(workerCase);
    if (actionsNeeded.length > 0) {
      sections.push("");
      sections.push("### Key Actions Needed");
      actionsNeeded.forEach(action => {
        sections.push(`• ${action}`);
      });
    }

    return {
      summary: sections.join('\n'),
      workStatusClassification: workerCase.workStatus
    };
  }

  private getComplianceIcon(indicator: string): string {
    switch (indicator?.toLowerCase()) {
      case 'compliant':
      case 'green':
        return '✅';
      case 'warning':
      case 'amber':
      case 'yellow':
        return '⚠️';
      case 'non-compliant':
      case 'red':
        return '❌';
      default:
        return '❓';
    }
  }

  private identifyKeyActions(workerCase: WorkerCase): string[] {
    const actions: string[] = [];

    // Certificate actions
    if (!workerCase.hasCertificate) {
      actions.push("Obtain medical certificate");
    } else if (workerCase.latestCertificate?.endDate) {
      const certEnd = new Date(workerCase.latestCertificate.endDate);
      const today = new Date();
      const daysUntilExpiry = Math.ceil((certEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      if (daysUntilExpiry < 0) {
        actions.push("Medical certificate has expired - renew urgently");
      } else if (daysUntilExpiry <= 7) {
        actions.push(`Medical certificate expires in ${daysUntilExpiry} days`);
      }
    }

    // Follow-up actions
    if (workerCase.clcNextFollowUp) {
      const nextFollowUp = new Date(workerCase.clcNextFollowUp);
      const today = new Date();
      if (nextFollowUp <= today) {
        actions.push("Follow-up due");
      }
    }

    // RTW actions
    if (workerCase.workStatus === "Off work" && !workerCase.rtwPlanStatus) {
      actions.push("Develop return to work plan");
    }

    // Compliance actions
    if (workerCase.complianceIndicator === "Very Low" || workerCase.complianceIndicator === "Low") {
      actions.push("Address compliance issues");
    }

    return actions;
  }
}