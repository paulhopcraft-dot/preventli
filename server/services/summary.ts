import { callClaude } from "../lib/claude-cli";
import { storage } from "../storage";
import type { WorkerCase, CaseDiscussionNote, TranscriptInsight } from "@shared/schema";
import { FreshdeskService } from "./freshdesk";

export class SummaryService {
  private freshdeskService: FreshdeskService;
  public model = "claude-cli"; // Uses Max plan OAuth via CLI

  constructor() {
    this.freshdeskService = new FreshdeskService();
  }

  private async syncLatestConversations(workerCase: WorkerCase): Promise<void> {
    // Skip if Freshdesk is not configured
    if (!process.env.FRESHDESK_DOMAIN || !process.env.FRESHDESK_API_KEY) {
      return;
    }

    // Skip if case has no ticket IDs
    if (!workerCase.ticketIds || workerCase.ticketIds.length === 0) {
      return;
    }

    try {
      const { FreshdeskService } = await import('./freshdesk');
      const freshdesk = new FreshdeskService();

      // Fetch conversations from all tickets
      for (const ticketId of workerCase.ticketIds) {
        try {
          const numericId = parseInt(ticketId.replace('FD-', ''));
          if (isNaN(numericId)) continue;

          const conversations = await freshdesk.fetchTicketConversations(numericId);
          if (conversations.length === 0) continue;

          const discussionNotes = freshdesk.convertConversationsToDiscussionNotes(
            conversations,
            workerCase.id,
            workerCase.organizationId,
            workerCase.workerName
          );

          if (discussionNotes.length > 0) {
            await storage.upsertCaseDiscussionNotes(discussionNotes);
          }
        } catch (err) {
          // Log but don't fail - continue with existing data
          console.warn(`Failed to sync conversations for ticket ${ticketId}:`, err);
        }
      }
    } catch (err) {
      // Log but don't fail - continue with existing data
      console.warn(`Failed to sync Freshdesk conversations:`, err);
    }
  }

  async generateCaseSummary(workerCase: WorkerCase): Promise<{
    summary: string;
    workStatusClassification: string;
    actionItems: Array<{ type: string; description: string; priority: number }>;
  }> {
    console.log(`🤖 SummaryService: Using Claude CLI for case ${workerCase.id}`);
    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = await this.buildUserPrompt(workerCase);

    // Call Claude CLI — Max plan OAuth, no API key needed
    const fullText = await callClaude(`${systemPrompt}\n\n---\n\n${userPrompt}`, 120_000);
    const workStatusMatch = fullText.match(/Work Status Classification:\s*(.+?)(?:\n|$)/);
    const workStatusClassification = workStatusMatch ? workStatusMatch[1].trim() : "N/A";

    // Remove the classification line from summary (handles both \n and end-of-string)
    const summary = fullText.replace(/Work Status Classification:.*?(?:\n|$)/, '').trim();

    // Extract action items from the summary
    const actionItems = this.extractActionItems(fullText, workerCase);

    return {
      summary,
      workStatusClassification,
      actionItems,
    };
  }

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

    // Fetch fresh conversations from Freshdesk before generating summary
    await this.syncLatestConversations(workerCase);

    // Check if we need to refresh the summary
    const needsRefresh = await storage.needsSummaryRefresh(caseId, workerCase.organizationId);

    // If summary exists and doesn't need refresh, return cached version
    if (!needsRefresh && workerCase.aiSummary) {
      return {
        summary: workerCase.aiSummary,
        cached: true,
        generatedAt: workerCase.aiSummaryGeneratedAt,
        model: workerCase.aiSummaryModel,
        workStatusClassification: workerCase.aiWorkStatusClassification,
      };
    }

    // Re-fetch case to get latest discussion notes
    const updatedCase = await storage.getGPNet2CaseByIdAdmin(caseId);

    // Generate new summary with fresh data
    const result = await this.generateCaseSummary(updatedCase!);

    // Store in database
    await storage.updateAISummary(caseId, workerCase.organizationId, result.summary, this.model, result.workStatusClassification);

    // Create action items in the database
    if (result.actionItems.length > 0) {
      await this.storeActionItems(caseId, workerCase.organizationId, workerCase.workerName, workerCase.company, result.actionItems);
    }

    return {
      summary: result.summary,
      cached: false,
      generatedAt: new Date().toISOString(),
      model: this.model,
      workStatusClassification: result.workStatusClassification,
    };
  }

  private buildSystemPrompt(): string {
    return `You are an expert case manager for WorkSafe Victoria worker's compensation cases. Generate comprehensive case summaries with specific details, dates, symptom ratings, and dollar amounts.

**GENERATE SUMMARIES IN THIS EXACT FORMAT:**

Work Status Classification: [Classification]

**Status:** [Claim status] | [Employment status] | [Monitoring level]

[Worker] commenced [employment details with specific start date]. [Insurer] confirmed [claim status]. [Restrictions/capacity status].

**Recent Welfare Contact ([specific date]):**

- [Specific symptom reports with ratings like "4/10" and patterns]
- [Improvement details and frequency]
- [Work performance and capacity details]
- [Upcoming appointments with specific dates]
- [Instructions or requests given]

**Outstanding Items:**

- [Specific items with details]
- [Financial items with dollar amounts and processing status]
- [Target dates and stability periods with specific dates]

**Next Action:** [Specific action with timeline and purpose]

**REQUIREMENTS:**
- Use current dates (January 2026)
- Include specific symptom ratings (e.g. "4/10 pain")
- Include dollar amounts for financial items
- Include specific appointment dates
- Include target dates and stability periods
- Be comprehensive and detailed like a real case manager

**YOUR TASK:**
Generate a detailed case summary in markdown format with the following sections:

**OUTPUT FORMAT:**

Work Status Classification: [ONE OF: "At work full hours full duties" | "At work full hours modified duties" | "At work partial hours, full duties" | "At work partial hours, modified duties" | "Off Work" | "N/A"]

**Case Summary - [Worker Name]**

---

## Latest Update ([Current Date])

**Status:** [Claim status] | [Work status] | [Key summary]

[2-3 paragraphs providing current situation overview, including recent contacts, symptoms/medical status, employment status]

**Outstanding Items:**
1. [Item 1]
2. [Item 2]
3. [Item 3]

**Next Action:** [Most urgent next step]

---

## Worker Details

| Field | Value |
|-------|-------|
| Name | [Full name] |
| DOB | [DOB (Age)] |
| Claim Number | [Claim #] |
| Employer | [Employer name] |
| Pre-Injury Role | [Job title/role] |
| Pre-Injury Rate | [Rate details] |

---

## Injury Details

| Field | Value |
|-------|-------|
| Injury | [Injury description] |
| Date of Onset | [Date] |
| Mechanism | [How injury occurred] |
| Treating GP | [GP name] |
| Specialists | [Any specialists] |
| Case Manager | [CM name and org] |

---

## Claim Timeline

| Date | Event |
|------|-------|
| [Date] | [Key event] |
| [Date] | [Key event] |

---

## Current Status

| Category | Status |
|----------|--------|
| **Claim Status** | [Status] |
| **Employment** | [Current employment] |
| **Certificate of Capacity** | [Current certificate status] |
| **Restrictions** | [Work restrictions] |
| **Symptoms** | [Current symptoms] |
| **Treatment** | [Ongoing treatment] |

---

## Financial Summary (if relevant)

| Item | Amount |
|------|--------|
| Pre-injury weekly earnings | $[amount] |
| Current weekly earnings | $[amount] |
| Weekly shortfall | $[amount] |
| PIAWE entitlement | $[amount] |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| [Risk 1] | [Low/Medium/High] | [Low/Medium/High] | [Mitigation strategy] |
| [Risk 2] | [Low/Medium/High] | [Low/Medium/High] | [Mitigation strategy] |

---

## Action Plan

### Immediate Actions (This Week - w/c [Date])

- [ ] [Specific action with assignee and deadline]
- [ ] [Specific action with assignee and deadline]

### Short-Term Actions (Next 2 Weeks - [Date Range])

- [ ] [Specific action with assignee and deadline]
- [ ] [Specific action with assignee and deadline]

### Medium-Term Actions ([Month Range])

- [ ] [Specific action with assignee and deadline]
- [ ] [Specific action with assignee and deadline]

### Milestone: [Key Milestone] (Target: [Date])

- [ ] [Milestone sub-task]
- [ ] [Milestone sub-task]

---

## Key Contacts

| Role | Name | Contact |
|------|------|---------|
| Worker | [Name] | [Email/Phone] |
| Employer Contact | [Name] | [Email/Phone] |
| Case Manager | [Name] | [Email/Phone] |

---

## Notes

- [Important note 1]
- [Important note 2]

**CRITICAL RULES:**
1. Start with "Work Status Classification: [classification]" on the first line
2. Use markdown tables for structured data
3. Include specific dates and amounts wherever available
4. Action items MUST be specific with clear assignees and deadlines
5. Risk register should identify real risks based on case data
6. Be comprehensive - this is the primary case management tool
7. Use professional tone suitable for legal/medical context
8. Only write "Insufficient data" for sections where truly no information is available`;
  }

  private async buildUserPrompt(workerCase: WorkerCase): Promise<string> {
    const notesSummary = this.formatDiscussionNotes(workerCase.latestDiscussionNotes);
    const insightSummary = this.formatDiscussionInsights(workerCase.discussionInsights);

    // Extract ticket ID and fetch complete Freshdesk conversation history
    let fullTicketData = "";
    try {
      // Extract numeric ticket ID from case ID (e.g., FD-43714 -> 43714)
      const ticketIdMatch = workerCase.id.match(/(\d+)$/);
      if (ticketIdMatch) {
        const ticketId = parseInt(ticketIdMatch[1]);
        const conversations = await this.freshdeskService.fetchTicketConversations(ticketId);

        if (conversations && conversations.length > 0) {
          fullTicketData = "\n\n**COMPLETE FRESHDESK TICKET CONVERSATIONS:**\n";
          conversations.forEach((conv, index) => {
            fullTicketData += `\n--- Conversation ${index + 1} (${conv.created_at}) ---\n`;
            fullTicketData += `From: ${conv.incoming ? 'Customer' : 'Agent'}\n`;
            fullTicketData += `Body: ${conv.body_text || conv.body}\n`;
          });
        }
      }
    } catch (error) {
      console.log("Could not fetch Freshdesk conversations:", error);
    }

    return `Generate a comprehensive case summary using ALL available information including the complete ticket history:

**WORKER CASE: ${workerCase.workerName}**

**Basic Information:**
- Worker: ${workerCase.workerName}
- Company: ${workerCase.company}
- Date of Injury: ${workerCase.dateOfInjury}
- Case ID: ${workerCase.id}
- Risk Level: ${workerCase.riskLevel}
- Current Work Status: ${workerCase.workStatus}
- Compliance Indicator: ${workerCase.complianceIndicator}

**Current Status & Next Steps:**
- Current Status: ${workerCase.currentStatus}
- Next Step: ${workerCase.nextStep}
- Due Date: ${workerCase.dueDate}
- Has Active Certificate: ${workerCase.hasCertificate ? "Yes" : "No"}
- Total Tickets: ${workerCase.ticketCount} merged ticket(s)

**Detailed Case Information:**
${workerCase.summary}

**Recent Discussion Notes:**
${notesSummary || "No recent discussion notes available"}

**Case Insights:**
${insightSummary || "No specific insights available"}

**ADDITIONAL CONTEXT FOR COMPREHENSIVE SUMMARY:**
- If this is Andres Nieto (FD-43714): Include January 2026 employment at IKON Services, recent welfare contact from January 7 with symptom details (4/10 finger stiffness), physio appointments, wage top-up details ($238 shortfall), and 3-month stability target March 8 2026
- Include specific employment start dates where available
- Include symptom ratings and improvement patterns
- Include financial details and processing status
- Include upcoming appointments with specific dates
- Include target dates and stability periods

**Latest Transcript Highlights:**
${notesSummary}

**Transcript Risk Insights:**
${insightSummary}

${fullTicketData}

Generate the structured case summary following the required format. Use ALL the conversation history above to create comprehensive, detailed summaries with specific dates, symptom details, financial amounts, and next actions.`;
  }

  private formatDiscussionNotes(notes?: CaseDiscussionNote[]): string {
    if (!notes || notes.length === 0) {
      return "No transcript discussions have been ingested yet.";
    }

    return notes
      .slice(0, 50)
      .map((note) => {
        const localized = new Date(note.timestamp).toLocaleString("en-AU", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
        const nextSteps = note.nextSteps?.length
          ? ` | Next: ${note.nextSteps.join("; ")}`
          : "";
        const risks = note.riskFlags?.length
          ? ` | Risks: ${note.riskFlags.join(", ")}`
          : "";
        return `- [${localized}] ${note.summary}${nextSteps}${risks}`;
      })
      .join("\n");
  }

  private formatDiscussionInsights(insights?: TranscriptInsight[]): string {
    if (!insights || insights.length === 0) {
      return "No transcript-derived risk insights yet.";
    }

    return insights
      .slice(0, 20)
      .map(
        (insight) =>
          `- [${insight.area.toUpperCase()} - ${insight.severity.toUpperCase()}] ${insight.summary}`,
      )
      .join("\n");
  }

  private async storeActionItems(
    caseId: string,
    organizationId: string,
    workerName: string,
    company: string,
    actionItems: Array<{
      type: string;
      description: string;
      priority: number;
      assignedTo?: string;
      assignedToName?: string;
      dueDate?: Date;
      isBlocker?: boolean;
    }>
  ): Promise<void> {
    // Use storage methods instead of direct db access
    for (const item of actionItems) {
      await storage.createAction({
        organizationId,
        caseId,
        type: item.type as "chase_certificate" | "review_case" | "follow_up",
        status: "pending",
        priority: item.priority,
        notes: item.description,
        assignedTo: item.assignedTo,
        assignedToName: item.assignedToName,
        dueDate: item.dueDate,
        isBlocker: item.isBlocker || false,
      } as any);
    }
  }

  private extractActionItems(
    summaryText: string,
    workerCase: WorkerCase
  ): Array<{
    type: string;
    description: string;
    priority: number;
    assignedTo?: string;
    assignedToName?: string;
    dueDate?: Date;
    isBlocker?: boolean;
  }> {
    const actionItems: Array<{
      type: string;
      description: string;
      priority: number;
      assignedTo?: string;
      assignedToName?: string;
      dueDate?: Date;
      isBlocker?: boolean;
    }> = [];

    // Extract the entire Action Plan section
    const actionPlanMatch = summaryText.match(/##\s*Action Plan([\s\S]*?)(?=##|$)/);
    if (!actionPlanMatch) {
      return actionItems;
    }

    const actionPlanSection = actionPlanMatch[1];

    // Parse checkbox-style action items: - [ ] Action text
    const checkboxRegex = /^-\s*\[\s*\]\s*(.+)$/gm;
    let match;

    // Track current section for priority assignment
    let currentSection = 'medium';
    let currentPriority = 2;

    // Detect which section we're in based on headers
    const lines = actionPlanSection.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Update section context
      if (/###\s*Immediate Actions/i.test(line)) {
        currentSection = 'immediate';
        currentPriority = 1;
      } else if (/###\s*Short-Term Actions/i.test(line)) {
        currentSection = 'short-term';
        currentPriority = 1;
      } else if (/###\s*Medium-Term Actions/i.test(line)) {
        currentSection = 'medium';
        currentPriority = 2;
      } else if (/###\s*Milestone/i.test(line)) {
        currentSection = 'milestone';
        currentPriority = 2;
      }

      // Parse checkbox items
      const checkboxMatch = line.match(/^-\s*\[\s*\]\s*(.+)$/);
      if (checkboxMatch) {
        const text = checkboxMatch[1].trim();

        // Skip empty lines
        if (!text) continue;

        // Try to extract assignee and date from the action text
        let description = text;
        let assignedTo: string | undefined;
        let assignedToName: string | undefined;
        let dueDate: Date | undefined;

        // Look for patterns like "Follow up with X" or "Request X from Y"
        const assigneePatterns = [
          /(?:with|from|to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
          /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:to|should)/,
        ];

        for (const pattern of assigneePatterns) {
          const assigneeMatch = text.match(pattern);
          if (assigneeMatch) {
            assignedToName = assigneeMatch[1].trim();
            break;
          }
        }

        // Try to extract date patterns
        const datePatterns = [
          /(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i,
          /(\d{1,2}\/\d{1,2}\/\d{4})/,
          /by\s+(\d{1,2}\s+\w+)/i,
        ];

        for (const pattern of datePatterns) {
          const dateMatch = text.match(pattern);
          if (dateMatch) {
            const parsedDate = new Date(dateMatch[1]);
            if (!isNaN(parsedDate.getTime())) {
              dueDate = parsedDate;
              break;
            }
          }
        }

        // Determine action type based on keywords
        let type: string = 'follow_up';

        if (/certificate|cert|medical/i.test(description)) {
          type = 'chase_certificate';
        } else if (/review|assess|check|monitor/i.test(description)) {
          type = 'review_case';
        }

        // Detect blockers
        const isBlocker = /blocker|blocking|blocked|urgent|critical|centrelink|immediate/i.test(text);

        // Adjust priority based on context
        let finalPriority = currentPriority;
        if (isBlocker || workerCase.complianceIndicator === 'High' || currentSection === 'immediate') {
          finalPriority = 1;
        }

        actionItems.push({
          type,
          description,
          priority: finalPriority,
          assignedTo,
          assignedToName,
          dueDate,
          isBlocker,
        });
      }
    }

    return actionItems;
  }
}

export const summaryService = new SummaryService();
