import type {
  WorkerCase,
  CompanyName,
  ComplianceIndicator,
  WorkStatus,
  CaseCompliance,
  MedicalCertificateInput,
  WorkCapacity,
  InsertCaseDiscussionNote,
} from "@shared/schema";
import { isValidCompany, isLegitimateCase } from "@shared/schema";
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { logger } from "../lib/logger";
import { validateInjuryDate, type DateValidationResult } from "../lib/dateValidation";
import { InjuryDateExtractionService, type InjuryDateExtractionResult } from "./injuryDateExtraction";

export interface FreshdeskAttachment {
  id: number;
  name: string;
  content_type: string;
  size: number;
  attachment_url: string;
  created_at: string;
  updated_at: string;
}

interface FreshdeskConversation {
  id: number;
  body: string;
  body_text: string;
  incoming: boolean;
  private: boolean;
  user_id: number;
  created_at: string;
  updated_at: string;
}

interface FreshdeskTicket {
  id: number;
  subject: string;
  description_text: string;
  status: number;
  priority: number;
  custom_fields: Record<string, any>;
  tags: string[];
  created_at: string;
  updated_at: string;
  due_by?: string;
  responder_id?: number;
  company_id?: number;
  attachments?: FreshdeskAttachment[];
}

interface FreshdeskCompany {
  id: number;
  name: string;
}

interface FreshdeskContact {
  id: number;
  name: string;
  email: string;
}

// Enable dayjs UTC plugin
dayjs.extend(utc);

export class FreshdeskService {
  private domain: string;
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    let domain = process.env.FRESHDESK_DOMAIN;
    const apiKey = process.env.FRESHDESK_API_KEY;

    if (!domain || !apiKey) {
      throw new Error("FRESHDESK_DOMAIN and FRESHDESK_API_KEY must be set");
    }

    // Clean up domain - remove protocol and .freshdesk.com suffix if present
    domain = domain.replace(/^https?:\/\//, '');
    domain = domain.replace(/\.freshdesk\.com.*$/, '');

    this.domain = domain;
    this.apiKey = apiKey;
    this.baseUrl = `https://${domain}.freshdesk.com/api/v2`;
    
    logger.freshdesk.info(`Service initialized`, { domain: this.domain });
  }

  private getAuthHeader(): string {
    return 'Basic ' + Buffer.from(`${this.apiKey}:X`).toString('base64');
  }

  /**
   * Extract date from text using regex patterns
   * Handles formats like: "3 or 4 months ago", "15/03/2025", "March 18, 2025", etc.
   */
  private extractDateFromText(text: string): Date | null {
    if (!text) return null;

    const lowerText = text.toLowerCase();

    // Handle "X months ago"
    const monthsAgoMatch = lowerText.match(/(\d+)\s*(?:or\s*\d+\s*)?months?\s*ago/);
    if (monthsAgoMatch) {
      const months = parseInt(monthsAgoMatch[1]);
      const date = dayjs().subtract(months, 'month');
      return date.toDate();
    }

    // Handle "X weeks ago"
    const weeksAgoMatch = lowerText.match(/(\d+)\s*weeks?\s*ago/);
    if (weeksAgoMatch) {
      const weeks = parseInt(weeksAgoMatch[1]);
      const date = dayjs().subtract(weeks, 'week');
      return date.toDate();
    }

    // Handle common date formats: DD/MM/YYYY, DD-MM-YYYY
    const ddmmyyyyMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (ddmmyyyyMatch) {
      const day = parseInt(ddmmyyyyMatch[1]);
      const month = parseInt(ddmmyyyyMatch[2]) - 1; // JS months are 0-indexed
      let year = parseInt(ddmmyyyyMatch[3]);
      if (year < 100) year += 2000; // Handle 2-digit years

      const date = new Date(year, month, day);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    // Handle ISO format: YYYY-MM-DD
    const isoMatch = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const date = new Date(isoMatch[0]);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    return null;
  }

  /**
   * Validate an injury date to ensure it's reasonable
   */
  private validateInjuryDate(date: Date, ticketCreatedDate: Date): DateValidationResult {
    return validateInjuryDate(date, ticketCreatedDate);
  }

  async fetchTickets(): Promise<FreshdeskTicket[]> {
    try {
      // Fetch tickets from the past 6 months (includes both open and closed)
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const dateFilter = sixMonthsAgo.toISOString();
      
      let allTickets: FreshdeskTicket[] = [];
      let page = 1;
      const perPage = 100;
      
      logger.freshdesk.debug(`Fetching tickets`, { since: dateFilter });
      
      while (true) {
        const response = await fetch(
          `${this.baseUrl}/tickets?per_page=${perPage}&page=${page}&include=description&updated_since=${dateFilter}`, 
          {
            headers: {
              'Authorization': this.getAuthHeader(),
              'Content-Type': 'application/json'
            }
          }
        );

        if (!response.ok) {
          throw new Error(`Freshdesk API error: ${response.status} ${response.statusText}`);
        }

        const tickets = await response.json() as FreshdeskTicket[];
        
        if (tickets.length === 0) {
          break; // No more tickets
        }
        
        allTickets.push(...tickets);
        logger.freshdesk.debug(`Fetched page`, { page, count: tickets.length, total: allTickets.length });
        
        if (tickets.length < perPage) {
          break; // Last page
        }
        
        page++;
      }
      
      logger.freshdesk.info(`Total tickets fetched`, { count: allTickets.length });
      return allTickets;
    } catch (error) {
      logger.freshdesk.error('Error fetching tickets', {}, error);
      throw error;
    }
  }

  async fetchCompany(companyId: number): Promise<FreshdeskCompany | null> {
    try {
      const response = await fetch(`${this.baseUrl}/companies/${companyId}`, {
        headers: {
          'Authorization': this.getAuthHeader(),
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        return null;
      }

      return await response.json() as FreshdeskCompany;
    } catch (error) {
      logger.freshdesk.error(`Error fetching company`, { companyId }, error);
      return null;
    }
  }

  async fetchContact(contactId: number): Promise<FreshdeskContact | null> {
    try {
      const response = await fetch(`${this.baseUrl}/contacts/${contactId}`, {
        headers: {
          'Authorization': this.getAuthHeader(),
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        return null;
      }

      return await response.json() as FreshdeskContact;
    } catch (error) {
      logger.freshdesk.error(`Error fetching contact`, { contactId }, error);
      return null;
    }
  }

  async fetchTicketConversations(ticketId: number): Promise<FreshdeskConversation[]> {
    try {
      const response = await fetch(`${this.baseUrl}/tickets/${ticketId}/conversations`, {
        headers: {
          'Authorization': this.getAuthHeader(),
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        logger.freshdesk.warn(`Could not fetch conversations for ticket`, { ticketId, status: response.status });
        return [];
      }

      const conversations = await response.json() as FreshdeskConversation[];
      // Include ALL conversations (emails + private notes) for full case context
      // This gives AI the complete communication history
      return conversations;
    } catch (error) {
      logger.freshdesk.error(`Error fetching ticket conversations`, { ticketId }, error);
      return [];
    }
  }

  private mapStatusToWorkStatus(status: number): WorkStatus {
    // Freshdesk status codes: 2=Open, 3=Pending, 4=Resolved, 5=Closed
    switch (status) {
      case 4: // Resolved
      case 5: // Closed
        return "At work";
      default:
        return "Off work";
    }
  }

  private mapPriorityToRiskLevel(priority: number): "High" | "Medium" | "Low" {
    // Freshdesk priority: 1=Low, 2=Medium, 3=High, 4=Urgent
    switch (priority) {
      case 4:
      case 3:
        return "High";
      case 2:
        return "Medium";
      default:
        return "Low";
    }
  }

  /**
   * Compliance rules:
   * - Resolved/closed tickets are automatically Very High.
   * - Default to High when there are no overdue deadlines.
   * - Medium when a follow-up/certificate is due within 7 days, there is no
   *   current certificate, or the case has gone stale (>30 days without updates).
   * - Low when a clear deadline is overdue by up to 1 week.
   * - Very Low when a deadline is overdue by more than 1 week.
   */
  private calculateComplianceIndicator(ticket: FreshdeskTicket): CaseCompliance {
    const now = dayjs().utc();
    const today = now.startOf("day");
    const dueDate = ticket.due_by ? dayjs(ticket.due_by).utc() : null;
    const nextCertificate = ticket.custom_fields?.cf_valid_until
      ? dayjs(ticket.custom_fields.cf_valid_until).utc()
      : null;
    const lastCertificate = ticket.custom_fields?.cf_full_medical_report_date
      ? dayjs(ticket.custom_fields.cf_full_medical_report_date).utc()
      : null;
    const hasCurrentCertificate =
      Boolean(ticket.custom_fields?.cf_latest_medical_certificate) ||
      ticket.tags?.includes("has_certificate") ||
      false;
    const lastUpdated = ticket.updated_at ? dayjs(ticket.updated_at).utc() : null;

    const deadlines = [
      dueDate
        ? { kind: "followUp" as const, label: "Case follow-up", date: dueDate }
        : null,
      nextCertificate
        ? { kind: "certificate" as const, label: "Medical certificate", date: nextCertificate }
        : null,
    ].filter(Boolean) as Array<{
      kind: "followUp" | "certificate";
      label: string;
      date: dayjs.Dayjs;
    }>;

    const diffInDays = (date: dayjs.Dayjs) => date.startOf("day").diff(today, "day");
    const formatDays = (days: number) => (days === 1 ? "1 day" : `${days} days`);
    const lastChecked = new Date().toISOString();

    if (ticket.status === 4 || ticket.status === 5) {
      return {
        indicator: "Very High",
        reason: "Ticket resolved or closed - no outstanding deadlines",
        source: "freshdesk",
        lastChecked,
      };
    }

    const annotatedDeadlines = deadlines.map((deadline) => ({
      ...deadline,
      diff: diffInDays(deadline.date),
    }));

    const overdueDeadlines = annotatedDeadlines
      .filter((deadline) => deadline.diff < 0)
      .sort((a, b) => a.diff - b.diff);

    if (overdueDeadlines.length > 0) {
      const worst = overdueDeadlines[0];
      const overdueDays = Math.abs(worst.diff);
      const indicator: ComplianceIndicator = overdueDays > 7 ? "Very Low" : "Low";
      return {
        indicator,
        reason: `${worst.label} overdue by ${formatDays(overdueDays)}`,
        source: "freshdesk",
        lastChecked,
      };
    }

    const upcomingDeadlines = annotatedDeadlines
      .filter((deadline) => deadline.diff >= 0)
      .sort((a, b) => a.diff - b.diff);

    if (upcomingDeadlines.length > 0) {
      const next = upcomingDeadlines[0];
      const diff = next.diff;
      let indicator: ComplianceIndicator = "High";
      let reason: string;

      if (diff <= 2) {
        indicator = "Medium";
        reason = `${next.label} due ${diff === 0 ? "today" : `in ${formatDays(diff)}`}`;
      } else if (diff <= 7) {
        indicator = "Medium";
        reason = `${next.label} coming up in ${formatDays(diff)}`;
      } else if (diff >= 14) {
        indicator = "Very High";
        reason = `${next.label} not due for ${formatDays(diff)}`;
      } else {
        indicator = "High";
        reason = `${next.label} due in ${formatDays(diff)}`;
      }

      return {
        indicator,
        reason,
        source: "freshdesk",
        lastChecked,
      };
    }

    if (!hasCurrentCertificate) {
      return {
        indicator: "Medium",
        reason: "No current medical certificate on file",
        source: "freshdesk",
        lastChecked,
      };
    }

    if (lastCertificate) {
      const age = today.diff(lastCertificate.startOf("day"), "day");
      if (age > 35) {
        return {
          indicator: "Medium",
          reason: `Latest certificate is ${formatDays(age)} old`,
          source: "freshdesk",
          lastChecked,
        };
      }
    }

    if (lastUpdated) {
      const idleDays = now.diff(lastUpdated, "day");
      if (idleDays > 30) {
        return {
          indicator: "Medium",
          reason: `No ticket updates in ${formatDays(idleDays)} - follow up recommended`,
          source: "freshdesk",
          lastChecked,
        };
      }
    }

    return {
      indicator: "High",
      reason: "No deadlines recorded and certificate details current",
      source: "freshdesk",
      lastChecked,
    };
  }

  private determineNextStep(ticket: FreshdeskTicket, workStatus: WorkStatus): string {
    // If there's a custom action plan, use that
    if (ticket.custom_fields?.cf_injury_and_action_plan?.trim()) {
      return ticket.custom_fields.cf_injury_and_action_plan.trim();
    }

    // Determine next step based on ticket status and context
    const status = ticket.status;
    const priority = ticket.priority;
    const hasCertificate = !!ticket.custom_fields?.cf_latest_medical_certificate;

    // Status codes: 2=Open, 3=Pending, 4=Resolved, 5=Closed
    switch (status) {
      case 2: // Open
        if (priority >= 3) {
          return "Urgent: Contact worker and obtain medical certificate";
        }
        if (!hasCertificate) {
          return "Request updated medical certificate from worker";
        }
        return "Contact worker to assess current status";

      case 3: // Pending
        if (!hasCertificate) {
          return "Follow up with worker for medical documentation";
        }
        return "Awaiting worker response - follow up if no reply within 48 hours";

      case 4: // Resolved
      case 5: // Closed
        if (workStatus === "At work") {
          return "Monitor return to work progress";
        }
        return "Case resolved - archive documentation";

      default:
        return "Review case and determine appropriate action";
    }
  }

  private deriveCapacityFromTicket(
    ticket: FreshdeskTicket,
    fallbackWorkStatus: WorkStatus,
  ): WorkCapacity {
    const haystack = [
      ticket.custom_fields?.cf_check_status,
      ticket.description_text,
      ticket.subject,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (/fit for full|full dut(y|ies)|100% capacity|cleared full duty/.test(haystack)) {
      return "fit";
    }
    if (/(modified dut|partial capacity|light dut|reduced capacity)/.test(haystack)) {
      return "partial";
    }
    if (/(no capacity|unfit|not fit|0% capacity|completely unfit)/.test(haystack)) {
      return "unfit";
    }

    // Fall back to case work status
    if (fallbackWorkStatus === "At work") {
      return "partial";
    }
    if (fallbackWorkStatus === "Off work") {
      return "unfit";
    }

    return "unknown";
  }

  private extractCertificateFromTicket(
    ticket: FreshdeskTicket,
    fallbackWorkStatus: WorkStatus,
  ): MedicalCertificateInput | null {
    const issueDateRaw =
      ticket.custom_fields?.cf_full_medical_report_date ||
      ticket.custom_fields?.cf_valid_until ||
      ticket.updated_at ||
      ticket.created_at;

    if (!issueDateRaw) {
      return null;
    }

    const issue = dayjs(issueDateRaw);
    if (!issue.isValid()) {
      return null;
    }

    const startRaw = ticket.custom_fields?.cf_full_medical_report_date || issueDateRaw;
    const endRaw = ticket.custom_fields?.cf_valid_until || startRaw;
    const start = dayjs(startRaw);
    const end = dayjs(endRaw);

    if (!start.isValid() || !end.isValid()) {
      return null;
    }

    // 🔧 FIX: Prevent future certificate dates (max 30 days from now)
    const now = dayjs();
    const maxFutureDate = now.add(30, 'day');

    if (start.isAfter(maxFutureDate) || end.isAfter(maxFutureDate)) {
      logger.freshdesk.warn(`Certificate date validation failed - future date detected`, {
        ticketId: ticket.id,
        startDate: start.format('YYYY-MM-DD'),
        endDate: end.format('YYYY-MM-DD'),
        maxAllowed: maxFutureDate.format('YYYY-MM-DD')
      });

      // Use ticket creation date as fallback for invalid future dates
      const fallbackStart = dayjs(ticket.created_at);
      const fallbackEnd = fallbackStart.add(30, 'day');

      logger.freshdesk.info(`Using fallback dates based on ticket creation`, {
        ticketId: ticket.id,
        fallbackStart: fallbackStart.format('YYYY-MM-DD'),
        fallbackEnd: fallbackEnd.format('YYYY-MM-DD')
      });

      start.set('year', fallbackStart.year())
           .set('month', fallbackStart.month())
           .set('date', fallbackStart.date());

      end.set('year', fallbackEnd.year())
         .set('month', fallbackEnd.month())
         .set('date', fallbackEnd.date());
    }

    const capacity = this.deriveCapacityFromTicket(ticket, fallbackWorkStatus);

    // Extract document URL from custom fields or attachments
    let documentUrl: string | undefined =
      ticket.custom_fields?.cf_latest_medical_certificate ||
      ticket.custom_fields?.cf_url ||
      undefined;

    // If no custom field URL, check ticket attachments for certificate documents
    if (!documentUrl && ticket.attachments && ticket.attachments.length > 0) {
      // Look for PDF or image files that might be certificates
      const certificateAttachment = ticket.attachments.find((att) => {
        const name = att.name.toLowerCase();
        const contentType = att.content_type.toLowerCase();
        // Match common certificate file patterns
        return (
          contentType.includes("pdf") ||
          contentType.includes("image/") ||
          name.includes("certificate") ||
          name.includes("cert") ||
          name.includes("medical") ||
          name.includes("worksafe") ||
          name.includes("capacity")
        );
      });
      // If no specific match, use the first PDF or image attachment
      const fallbackAttachment = certificateAttachment || ticket.attachments.find((att) => {
        const contentType = att.content_type.toLowerCase();
        return contentType.includes("pdf") || contentType.includes("image/");
      });
      if (fallbackAttachment) {
        documentUrl = fallbackAttachment.attachment_url;
      }
    }

    return {
      issueDate: issue.toISOString(),
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      capacity,
      notes: ticket.custom_fields?.cf_check_status || undefined,
      source: "freshdesk",
      documentUrl,
      sourceReference: ticket.id ? `ticket:${ticket.id}` : undefined,
    };
  }

  private extractCertificateHistory(
    tickets: FreshdeskTicket[],
    caseDefaultWorkStatus: WorkStatus,
  ): MedicalCertificateInput[] {
    const deduped = new Map<string, MedicalCertificateInput>();

    for (const ticket of tickets) {
      const perTicketStatus = this.mapStatusToWorkStatus(ticket.status);
      const certificate = this.extractCertificateFromTicket(
        ticket,
        perTicketStatus || caseDefaultWorkStatus,
      );
      if (!certificate) {
        continue;
      }
      const key = `${certificate.startDate}-${certificate.endDate}-${certificate.capacity}`;
      if (!deduped.has(key)) {
        deduped.set(key, certificate);
      }
    }

    return Array.from(deduped.values()).sort(
      (a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
    );
  }

  private normalizeWorkerName(name: string): string {
    // Remove common prefixes/noise
    let normalized = name.toLowerCase().trim();
    
    // Remove FW:, RE: prefixes
    normalized = normalized.replace(/^(fw|re):\s*/i, '');
    
    // Extract name from patterns like "MARIO SIKETA, Primary Claim - 09250033555"
    const claimPattern = /^([a-z\s]+),\s*primary\s+claim/i;
    const claimMatch = normalized.match(claimPattern);
    if (claimMatch) {
      normalized = claimMatch[1].trim();
    }
    
    // Special handling for known workers
    if ((normalized.includes('jacob') || normalized.includes('pat')) && normalized.includes('gunn')) {
      return 'jacob gunn';
    }
    
    if (normalized === 'gunn' || normalized.match(/^gunn\s*$/)) {
      return 'jacob gunn';
    }
    
    if (normalized.includes('siketa')) {
      if (normalized.includes('mario') || normalized === 'siketa') {
        return 'mario siketa';
      }
    }
    
    // Remove middle names and extra spaces (keep first and last name only)
    const words = normalized.split(/\s+/).filter(w => w.length > 0 && w.length > 1);
    if (words.length > 2) {
      // Keep first and last word only
      return `${words[0]} ${words[words.length - 1]}`;
    }
    
    return words.join(' ');
  }

  private extractCompanyFromDescription(descriptionText: string, knownCompanies: CompanyName[]): string | null {
    if (!descriptionText) {
      return null;
    }

    const text = descriptionText.toLowerCase();

    // Layer 1: Structured form patterns (with permissive character classes including apostrophes)
    const structuredPatterns = [
      /company\s*name[:\s]*([a-z0-9\s&\/.\-()'+]+?)(?:\s*(?:age|date|email|phone|address|abn|acn|contact|\n|$))/i,
      /company:\s*([a-z0-9\s&\/.\-()'+]+?)(?:\s*(?:age|date|email|phone|address|abn|acn|contact|\n|,|$))/i,
      /employer:\s*([a-z0-9\s&\/.\-()'+]+?)(?:\s*(?:age|date|email|phone|address|abn|acn|contact|\n|,|$))/i,
    ];

    for (const pattern of structuredPatterns) {
      const match = descriptionText.match(pattern);
      if (match) {
        const extracted = match[1].trim();
        const normalized = this.normalizeCompanyName(extracted, knownCompanies);
        if (normalized) return normalized;
      }
    }

    // Layer 2: Narrative phrase detectors (case-insensitive keywords, requires capitalized company names)
    const narrativePatterns = [
      /(?:[Ii]nsurer|[Pp]rovider|[Ww]orkcover)\s+(?:for|on behalf of)\s+([A-Z][a-zA-Z0-9\s&\/.\-()'+]+?)(?:\s*(?:[Pp]\/[Ll]|[Pp]ty|[Gg]roup|[Ll]imited|[Ll]td|,|\.|to conduct|$))/,
    ];

    for (const pattern of narrativePatterns) {
      const match = descriptionText.match(pattern);
      if (match) {
        const extracted = match[1].trim();
        const normalized = this.normalizeCompanyName(extracted, knownCompanies);
        if (normalized) return normalized;
      }
    }

    // Layer 3: Direct substring matching against known companies
    for (const company of knownCompanies) {
      const companyLower = company.toLowerCase();
      if (text.includes(companyLower)) {
        return company;
      }
    }

    return null;
  }

  private normalizeCompanyName(extractedName: string, knownCompanies: CompanyName[]): string | null {
    if (!extractedName) {
      return null;
    }

    // Clean and normalize: lowercase, trim, strip punctuation and common suffixes
    const cleaned = extractedName
      .toLowerCase()
      .trim()
      .replace(/\s+(p\/l|pty|ltd|limited|group|human resources|hr|inc|corp|corporation|llc).*$/i, '')
      .replace(/[\/\-()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // Map to canonical company names (fuzzy match after normalization)
    for (const company of knownCompanies) {
      const companyNormalized = company
        .toLowerCase()
        .replace(/[\/\-()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      if (cleaned.includes(companyNormalized) || companyNormalized.includes(cleaned)) {
        return company;
      }
    }

    // If no canonical match but we have a reasonable company name, return the cleaned version
    // with proper title casing
    if (cleaned.length > 2) {
      return extractedName
        .replace(/\s+(p\/l|pty|ltd|limited|group|human resources|hr|inc|corp|corporation|llc).*$/i, '')
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
        .trim();
    }

    return null;
  }

  async transformTicketsToWorkerCases(tickets: FreshdeskTicket[]): Promise<Partial<WorkerCase>[]> {
    const companyCache = new Map<number, FreshdeskCompany | null>();
    const validCompanies: CompanyName[] = ["Symmetry", "Allied Health", "Apex Labour", "SafeWorks", "Core Industrial"];

    // Batch fetch all unique company IDs in parallel
    const uniqueCompanyIds = Array.from(new Set(tickets.map(t => t.company_id).filter(id => id != null))) as number[];
    await Promise.all(
      uniqueCompanyIds.map(async (companyId) => {
        const company = await this.fetchCompany(companyId);
        companyCache.set(companyId, company);
      })
    );

    // Group tickets by worker name
    const workerTicketsMap = new Map<string, FreshdeskTicket[]>();

    for (const ticket of tickets) {
      // Skip webhook error messages and system notifications
      if (ticket.subject?.includes('webhook settings') || 
          ticket.subject?.includes('Please recheck') ||
          ticket.description_text?.includes('Automation rule you configured')) {
        continue;
      }

      let companyName: CompanyName | string = "Unknown Company";
      
      if (ticket.company_id) {
        const company = companyCache.get(ticket.company_id);
        if (company) {
          // Use actual company name if it matches our valid companies, otherwise preserve the actual name
          if (validCompanies.includes(company.name as CompanyName)) {
            companyName = company.name as CompanyName;
          } else {
            // For companies outside the predefined list, still preserve the actual name
            companyName = company.name;
          }
        }
      }
      
      // Try to extract company from description if not set via company_id
      if (companyName === "Unknown Company" && ticket.description_text) {
        const extracted = this.extractCompanyFromDescription(ticket.description_text, validCompanies);
        if (extracted) {
          companyName = extracted;
        }
      }

      // Extract worker name from various sources
      // Combine first and last name if both are present
      let workerName = '';
      if (ticket.custom_fields?.cf_worker_first_name && ticket.custom_fields?.cf_workers_name) {
        workerName = `${ticket.custom_fields.cf_worker_first_name} ${ticket.custom_fields.cf_workers_name}`;
      } else if (ticket.custom_fields?.cf_workers_name) {
        workerName = ticket.custom_fields.cf_workers_name;
      } else if (ticket.custom_fields?.cf_worker_first_name) {
        workerName = ticket.custom_fields.cf_worker_first_name;
      }
      
      // Try to extract from description for form submissions
      if (!workerName && ticket.description_text) {
        const fullNameMatch = ticket.description_text.match(/Full Name\s*([A-Za-z\s]+?)(?:Your email|$)/i);
        const basicNameMatch = ticket.description_text.match(/name:\s*([A-Za-z\s]+?)(?:\n|$)/i);
        
        if (fullNameMatch) {
          workerName = fullNameMatch[1].trim();
        } else if (basicNameMatch) {
          workerName = basicNameMatch[1].trim();
        }
      }
      
      // Try to extract from subject line (e.g., "Cobild-New Starter Check-Oliver Smith")
      if (!workerName && ticket.subject) {
        // Special case: Extract name from IME/DXC appointment notifications
        const imeMatch = ticket.subject.match(/re\s+([A-Z\s]+),\s+Primary/i);
        if (imeMatch) {
          workerName = imeMatch[1].trim();
        } else {
          const subjectParts = ticket.subject.split('-');
          if (subjectParts.length >= 3) {
            workerName = subjectParts[subjectParts.length - 1].trim();
          } else if (ticket.subject.toLowerCase().includes('gunn')) {
            workerName = 'Jacob Gunn';
          } else if (ticket.subject.toLowerCase().includes('barclay')) {
            workerName = 'Stuart Barclay';
          } else if (ticket.subject.toLowerCase().includes('siketa')) {
            workerName = 'Mario Siketa';
          }
        }
      }
      
      // Fallback to subject
      if (!workerName) {
        workerName = ticket.subject || `Worker #${ticket.id}`;
      }

      // Group tickets by worker name with smart normalization
      const normalizedWorkerName = this.normalizeWorkerName(workerName);
      if (!workerTicketsMap.has(normalizedWorkerName)) {
        workerTicketsMap.set(normalizedWorkerName, []);
      }
      workerTicketsMap.get(normalizedWorkerName)!.push(ticket);
    }

    // Now merge tickets for each worker into a single case
    const workerCases: Partial<WorkerCase>[] = [];
    
    for (const [normalizedName, ticketGroup] of Array.from(workerTicketsMap.entries())) {
      // Sort tickets by updated_at to get the most recent one first
      const sortedTickets = ticketGroup.sort((a: FreshdeskTicket, b: FreshdeskTicket) => 
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      
      const primaryTicket = sortedTickets[0]; // Most recent ticket
      const ticketIds = sortedTickets.map((t: FreshdeskTicket) => `FD-${t.id}`);
      
      // Get company name (prefer from most recent ticket)
      let companyName: CompanyName | string = "Unknown Company";
      if (primaryTicket.company_id) {
        const company = companyCache.get(primaryTicket.company_id);
        if (company) {
          if (validCompanies.includes(company.name as CompanyName)) {
            companyName = company.name as CompanyName;
          } else {
            companyName = company.name;
          }
        }
      }
      
      if (companyName === "Unknown Company" && primaryTicket.description_text) {
        const extracted = this.extractCompanyFromDescription(primaryTicket.description_text, validCompanies);
        if (extracted) {
          companyName = extracted;
        }
      }

      // Extract worker name from primary ticket (combine first and last name)
      let workerName = '';
      if (primaryTicket.custom_fields?.cf_worker_first_name && primaryTicket.custom_fields?.cf_workers_name) {
        workerName = `${primaryTicket.custom_fields.cf_worker_first_name} ${primaryTicket.custom_fields.cf_workers_name}`;
      } else if (primaryTicket.custom_fields?.cf_workers_name) {
        workerName = primaryTicket.custom_fields.cf_workers_name;
      } else if (primaryTicket.custom_fields?.cf_worker_first_name) {
        workerName = primaryTicket.custom_fields.cf_worker_first_name;
      }
      
      if (!workerName && primaryTicket.description_text) {
        const fullNameMatch = primaryTicket.description_text.match(/Full Name\s*([A-Za-z\s]+?)(?:Your email|$)/i);
        const basicNameMatch = primaryTicket.description_text.match(/name:\s*([A-Za-z\s]+?)(?:\n|$)/i);
        
        if (fullNameMatch) {
          workerName = fullNameMatch[1].trim();
        } else if (basicNameMatch) {
          workerName = basicNameMatch[1].trim();
        }
      }
      
      if (!workerName && primaryTicket.subject) {
        // Special case: Extract name from IME/DXC appointment notifications
        const imeMatch = primaryTicket.subject.match(/re\s+([A-Z\s]+),\s+Primary/i);
        if (imeMatch) {
          workerName = imeMatch[1].trim();
        } else {
          const subjectParts = primaryTicket.subject.split('-');
          if (subjectParts.length >= 3) {
            workerName = subjectParts[subjectParts.length - 1].trim();
          } else if (primaryTicket.subject.toLowerCase().includes('gunn')) {
            workerName = 'Jacob Gunn';
          } else if (primaryTicket.subject.toLowerCase().includes('barclay')) {
            workerName = 'Stuart Barclay';
          } else if (primaryTicket.subject.toLowerCase().includes('siketa')) {
            workerName = 'Mario Siketa';
          }
        }
      }
      
      if (!workerName) {
        workerName = primaryTicket.subject || `Worker #${primaryTicket.id}`;
      }

      // Clean up the worker name for display (proper capitalization)
      const normalizedName = this.normalizeWorkerName(workerName);
      const displayName = normalizedName
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      // Enhanced injury date extraction with AI support
      const ticketCreatedDate = new Date(primaryTicket.created_at);

      // Fetch conversations for enhanced context
      let conversationTexts: string[] = [];
      try {
        const conversations = await this.fetchTicketConversations(primaryTicket.id);
        conversationTexts = conversations
          .map(conv => conv.body_text || '')
          .filter(text => text.length > 10); // Filter out very short conversations
      } catch (error) {
        logger.freshdesk.warn('Failed to fetch conversations for extraction', {
          ticketId: `FD-${primaryTicket.id}`,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      // TODO: Extract attachment texts (placeholder for future enhancement)
      const attachmentTexts: string[] = [];

      // Create ticket context for enhanced extraction
      const ticketContext = {
        id: primaryTicket.id,
        subject: primaryTicket.subject,
        description_text: primaryTicket.description_text,
        custom_fields: primaryTicket.custom_fields,
        created_at: primaryTicket.created_at,
        workerName: displayName,
        company: companyName
      };

      // Use enhanced extraction service
      const extractionService = new InjuryDateExtractionService();
      const extractionResult: InjuryDateExtractionResult = await extractionService.extractInjuryDate(
        ticketContext,
        conversationTexts,
        attachmentTexts
      );

      // Map extraction result to case data
      const dateOfInjury = extractionResult.date || ticketCreatedDate;
      const dateSource = extractionResult.source;
      const dateConfidence = extractionResult.confidence;
      const dateOfInjuryRequiresReview = extractionResult.requiresReview;
      const dateOfInjuryExtractionMethod = extractionResult.extractionMethod;
      const dateOfInjurySourceText = extractionResult.sourceText;
      const dateOfInjuryAiReasoning = extractionResult.aiReasoning;

      logger.freshdesk.info(`Enhanced injury date extraction completed`, {
        ticketId: `FD-${primaryTicket.id}`,
        worker: displayName,
        date: dateOfInjury.toISOString().split('T')[0],
        source: dateSource,
        confidence: dateConfidence,
        method: dateOfInjuryExtractionMethod,
        requiresReview: dateOfInjuryRequiresReview,
        hasConversations: conversationTexts.length > 0
      });

      // Validate due date
      let dueDate = "TBD";
      if (primaryTicket.due_by) {
        const dueDateObj = new Date(primaryTicket.due_by);
        if (!isNaN(dueDateObj.getTime())) {
          dueDate = dueDateObj.toLocaleDateString();
        }
      }

      // Calculate full compliance object
      const compliance = this.calculateComplianceIndicator(primaryTicket);

      // Create combined summary mentioning multiple tickets if applicable
      let summary = primaryTicket.subject;
      if (ticketIds.length > 1) {
        summary = `${primaryTicket.subject} (${ticketIds.length} related tickets)`;
      }

      // Get the most recent updated_at timestamp from all merged tickets (already sorted by updated_at)
      const ticketLastUpdatedAt = primaryTicket.updated_at;

      // Determine work status first so we can use it in next step determination
      const workStatus = this.mapStatusToWorkStatus(primaryTicket.status);
      const certificateHistory = this.extractCertificateHistory(sortedTickets, workStatus);
      const latestCertificate = certificateHistory[certificateHistory.length - 1];
      const hasCertificateFlag =
        !!primaryTicket.custom_fields?.cf_latest_medical_certificate ||
        primaryTicket.tags?.includes('has_certificate') ||
        certificateHistory.length > 0 ||
        false;
      const certificateUrl =
        latestCertificate?.documentUrl ||
        primaryTicket.custom_fields?.cf_latest_medical_certificate ||
        primaryTicket.custom_fields?.cf_url ||
        undefined;

      // Build the case object first so we can validate it
      const caseData = {
        id: ticketIds[0], // Use first (most recent) ticket ID as primary ID
        workerName: displayName,
        company: companyName,
        dateOfInjury: dateOfInjury.toISOString().split('T')[0],
        dateOfInjurySource: dateSource,
        dateOfInjuryConfidence: dateConfidence,
        dateOfInjuryRequiresReview: dateOfInjuryRequiresReview,
        dateOfInjuryExtractionMethod: dateOfInjuryExtractionMethod,
        dateOfInjurySourceText: dateOfInjurySourceText,
        dateOfInjuryAiReasoning: dateOfInjuryAiReasoning,
        riskLevel: this.mapPriorityToRiskLevel(primaryTicket.priority),
        workStatus,
        hasCertificate: hasCertificateFlag,
        certificateUrl,
        complianceIndicator: compliance.indicator, // Legacy field - extract from compliance object
        compliance, // New structured compliance object
        currentStatus: primaryTicket.custom_fields?.cf_check_status || primaryTicket.description_text || "Pending review",
        nextStep: this.determineNextStep(primaryTicket, workStatus),
        owner: primaryTicket.custom_fields?.cf_case_manager_name || primaryTicket.custom_fields?.cf_consultant || "CLC Team",
        dueDate,
        summary,
        ticketIds,
        ticketCount: ticketIds.length,
        ticketLastUpdatedAt,
        clcLastFollowUp: primaryTicket.custom_fields?.cf_full_medical_report_date || undefined,
        clcNextFollowUp: primaryTicket.custom_fields?.cf_valid_until || undefined,
        certificateHistory,
      };

      // Skip if not a legitimate worker injury case (filters out generic emails, claims without names, etc.)
      if (!isLegitimateCase(caseData)) {
        logger.freshdesk.warn(`Skipping non-case email`, { ticketId: ticketIds[0], worker: displayName, company: companyName });
        continue;
      }

      workerCases.push(caseData);
    }

    return workerCases;
  }

  /**
   * Convert Freshdesk private notes to discussion notes
   */
  convertConversationsToDiscussionNotes(
    conversations: FreshdeskConversation[],
    caseId: string,
    organizationId: string,
    workerName: string
  ): InsertCaseDiscussionNote[] {
    const discussionNotes: InsertCaseDiscussionNote[] = [];

    for (const conversation of conversations) {
      // Skip if note is too short to be meaningful
      if (!conversation.body_text || conversation.body_text.trim().length < 10) {
        continue;
      }

      // Create a unique ID for this note (simple hash alternative)
      const noteId = `freshdesk-${conversation.id}-${Date.now()}`;

      // Extract summary (first 200 chars or first paragraph)
      const fullText = conversation.body_text.trim();
      const firstParagraph = fullText.split('\n\n')[0];

      // Add conversation type prefix to summary for clarity
      let typePrefix = '';
      if (conversation.incoming) {
        typePrefix = '[Email from Worker/Employer] ';
      } else if (conversation.private) {
        typePrefix = '[Internal Note] ';
      } else {
        typePrefix = '[Team Response] ';
      }

      const rawSummary = firstParagraph.length > 200
        ? firstParagraph.substring(0, 200) + '...'
        : firstParagraph;
      const summary = typePrefix + rawSummary;

      // Simple keyword-based risk flag detection
      const riskFlags: string[] = [];
      const lowerText = fullText.toLowerCase();

      if (lowerText.includes('no show') || lowerText.includes('did not attend') || lowerText.includes('unresponsive')) {
        riskFlags.push('Worker engagement risk');
      }
      if (lowerText.includes('urgent') || lowerText.includes('critical') || lowerText.includes('high priority')) {
        riskFlags.push('High priority case');
      }
      if (lowerText.includes('compliance') || lowerText.includes('overdue') || lowerText.includes('violation')) {
        riskFlags.push('Compliance issue');
      }

      // Extract next steps (lines starting with common action markers)
      const nextSteps: string[] = [];
      const lines = fullText.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.match(/^[-•*]\s/)) {
          nextSteps.push(trimmed.replace(/^[-•*]\s/, ''));
        } else if (trimmed.match(/^(next step|action|todo|follow.?up):/i)) {
          nextSteps.push(trimmed.replace(/^[^:]+:\s*/, ''));
        }
      }

      discussionNotes.push({
        id: noteId,
        organizationId,
        caseId,
        workerName,
        timestamp: new Date(conversation.created_at),
        rawText: fullText,
        summary,
        nextSteps: nextSteps.length > 0 ? nextSteps : null,
        riskFlags: riskFlags.length > 0 ? riskFlags : null,
        updatesCompliance: lowerText.includes('compliance') || lowerText.includes('certificate'),
        updatesRecoveryTimeline: lowerText.includes('recovery') || lowerText.includes('timeline') || lowerText.includes('rtw'),
      } as any);
    }

    return discussionNotes;
  }

  /**
   * Close a Freshdesk ticket
   * Freshdesk ticket statuses:
   * 2 = Open, 3 = Pending, 4 = Resolved, 5 = Closed
   */
  async closeTicket(ticketId: number): Promise<void> {
    try {
      const response = await fetch(
        `${this.baseUrl}/tickets/${ticketId}`,
        {
          method: 'PUT',
          headers: {
            'Authorization': this.getAuthHeader(),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            status: 5, // 5 = Closed in Freshdesk
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to close Freshdesk ticket ${ticketId}: ${response.status} ${errorText}`);
      }

      logger.freshdesk.info(`Closed ticket`, { ticketId });
    } catch (error) {
      logger.freshdesk.error(`Error closing ticket`, { ticketId }, error);
      throw error;
    }
  }
}
