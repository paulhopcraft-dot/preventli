# GPNet3 Product Requirements Document (PRD)

**Version:** 1.0
**Last Updated:** 2025-12-19
**Status:** Draft
**Owner:** GPNet Product Team

---

## Document Navigation & Section Codes

This PRD uses a hierarchical coding system for easy reference and section-by-section development:

| Code | Section | Description |
|------|---------|-------------|
| **PRD-1** | Executive Summary & Vision | Product overview, goals, success criteria |
| **PRD-2** | Stakeholders & Personas | User types, roles, needs |
| **PRD-3** | Functional Requirements | Core features and capabilities |
| **PRD-4** | Technical Architecture | System design and infrastructure |
| **PRD-5** | Data Models | Database schema and entities |
| **PRD-6** | Non-Functional Requirements | Security, performance, accessibility |
| **PRD-7** | Integrations | External systems and APIs |
| **PRD-8** | User Journeys & Workflows | End-to-end process flows |
| **PRD-9** | AI & Intelligence Layer | ML models, avatars, predictions |
| **PRD-10** | Success Metrics & KPIs | Measurement and validation |

---

# PRD-1: Executive Summary & Vision

## PRD-1.1: Product Overview

GPNet is a B2B case management and decision-support platform designed for employers, host sites, occupational health providers, and insurers managing:

- Worker injuries and workplace incidents
- Long-term and chronic health conditions
- Mental health issues affecting work capacity
- Return-to-work (RTW) planning and coordination
- Redeployment strategies and duty matching
- Compliance with medical certificates, legislation, and policies

## PRD-1.2: Core Mission

> **"No worker lost in the system"**

GPNet ensures every injured or health-affected worker receives consistent, timely, and appropriate support throughout their case lifecycle.

## PRD-1.3: Strategic Goals

| ID | Goal | Description |
|----|------|-------------|
| PRD-1.3.1 | Earlier RTW | Enable earlier and safer return-to-work outcomes where clinically appropriate |
| PRD-1.3.2 | Reduce Admin Burden | Lower administrative overhead and eliminate email chaos for employers/insurers |
| PRD-1.3.3 | Better Documentation | Provide comprehensive documentation for regulators, insurers, and disputes |
| PRD-1.3.4 | Single Source of Truth | Create one authoritative timeline per worker and case |
| PRD-1.3.5 | AI-Powered Insights | Deliver intelligent reasoning over case timelines, not just text summarization |

## PRD-1.4: Product Surfaces

### PRD-1.4.1: Marketing Site (`gpnet.au`)
- **Purpose:** Brand awareness, sales, lead generation, product education
- **Pages:** Home, About, Contact, Insights/Blog
- **Key Element:** Prominent "Login" button linking to `portal.gpnet.au/login`

### PRD-1.4.2: Portal Application (`portal.gpnet.au`)
- **Purpose:** Secure workspace for authenticated organizational users
- **Entry Point:** `/login` → post-authentication redirect to `/app`
- **Route Structure:** All authenticated pages under `/app/*`

## PRD-1.5: Value Proposition

| Stakeholder | Value Delivered |
|-------------|-----------------|
| **Employers/Hosts** | Clear, centralized view of workers; automatic reminders; regulatory evidence |
| **Insurers** | Complete case files; early risk detection; structured summaries |
| **Workers** | Active case monitoring; reduced story repetition; consistent communication |
| **Consultants/Providers** | Clear restrictions and job demands; accurate information exchange |

---

# PRD-2: Stakeholders & Personas

## PRD-2.1: Primary Personas

### PRD-2.1.1: Employer HR / WHS / RTW Coordinator
- **Role:** Manages injured workers, liaises with host sites and insurers
- **Primary Needs:**
  - Clarity on case status and obligations
  - Clear next actions and deadlines
  - Compliance tracking and alerts
- **Portal Access:** Full case management capabilities

### PRD-2.1.2: Host Site Supervisor
- **Role:** Provides modified duties, monitors worker performance on-site
- **Primary Needs:**
  - Clear work restrictions and approved duties
  - Minimal administrative burden
  - Easy reporting on worker progress
- **Portal Access:** Limited to assigned workers and sites

### PRD-2.1.3: Insurer / Claims Manager
- **Role:** Oversees liability decisions, approvals, and payment authorization
- **Primary Needs:**
  - Comprehensive evidence and documentation
  - Compliance visibility
  - Risk indicators and progress metrics
- **Portal Access:** Read-focused with approval workflows

### PRD-2.1.4: Internal Consultant / RTW Specialist
- **Role:** Finds suitable duties, works across multiple host sites
- **Primary Needs:**
  - Structured clinical/functional information
  - Case summaries and action lists
  - Cross-site duty matching capabilities
- **Portal Access:** Multi-site case management

### PRD-2.1.5: Worker
- **Role:** The injured or health-affected individual
- **Primary Needs:**
  - To be heard and understood
  - Clear expectations and safe duties
  - Consistent communication and support
- **Portal Access:** Limited; primarily interacts via emails, forms, and avatar conversations

### PRD-2.1.6: Clinical Providers (GP/Physio/IME)
- **Role:** Provide medical information, opinions, and certificates
- **Primary Needs:**
  - Efficient information requests
  - Clear context on work demands
  - Streamlined certificate submission
- **Portal Access:** Minimal; primary interaction through document submission

## PRD-2.2: Role-Based Access Control

| Role | Code | Capabilities |
|------|------|--------------|
| Admin | PRD-2.2.1 | Full access to all features, user management, organization settings |
| Manager | PRD-2.2.2 | Case management operations, action execution, reporting |
| Viewer | PRD-2.2.3 | Read-only access to assigned cases and reports |

---

# PRD-3: Functional Requirements

## PRD-3.1: Authentication & Onboarding

### PRD-3.1.1: User Authentication
- **Login:** Email/password authentication at `/login`
- **Token Management:** Short-lived JWT with refresh token rotation
- **Session Security:** JWT invalidation on logout
- **MFA:** Optional multi-factor authentication for enhanced security

### PRD-3.1.2: Organization Onboarding Wizard
Multi-step configuration wizard capturing:

| Step | Code | Content |
|------|------|---------|
| 1 | PRD-3.1.2.1 | Organization profile (name, ABN, timezone, working days) |
| 2 | PRD-3.1.2.2 | Sites and locations setup |
| 3 | PRD-3.1.2.3 | Contact information |
| 4 | PRD-3.1.2.4 | Email and Freshdesk integration settings |
| 5 | PRD-3.1.2.5 | Automation defaults and preferences |
| 6 | PRD-3.1.2.6 | Branding customization |

## PRD-3.2: Case Management

### PRD-3.2.1: Case Creation
- **Sources:**
  - JotForm or webhook-triggered injury forms
  - Freshdesk ticket ingestion
  - Manual portal creation
- **Auto-Creation:**
  - Links or creates Worker record
  - Creates Case with type classification (injury/mental health/general)
  - Generates initial timeline events

### PRD-3.2.2: Case Types
| Type | Code | Description |
|------|------|-------------|
| Injury | PRD-3.2.2.1 | Physical workplace injury |
| Mental Health | PRD-3.2.2.2 | Psychological or mental health condition |
| General Health | PRD-3.2.2.3 | Non-injury health condition affecting work |
| Pre-Employment | PRD-3.2.2.4 | Medical assessment before employment |
| Exit Assessment | PRD-3.2.2.5 | Assessment at employment conclusion |

### PRD-3.2.3: Case Lifecycle States
```
Created → Active → Under Review → RTW Planning → RTW Active → Closed
                 ↓                              ↓
            On Hold ←←←←←←←←←←←←←←←←←←←←← Escalated
```

## PRD-3.3: Certificate Management

### PRD-3.3.1: Certificate Ingestion Pipeline
| Stage | Code | Description |
|-------|------|-------------|
| Intake | PRD-3.3.1.1 | Accept from uploads, Freshdesk, email attachments |
| OCR | PRD-3.3.1.2 | Extract text from image-based certificates |
| Classification | PRD-3.3.1.3 | Identify certificate type and structure |
| Extraction | PRD-3.3.1.4 | Parse dates, diagnosis, restrictions, capacity |
| Validation | PRD-3.3.1.5 | Verify against business rules and formats |
| Linking | PRD-3.3.1.6 | Associate with Worker and Case records |

### PRD-3.3.2: Certificate Data Fields
- Issue date, valid from, valid to, review date
- Capacity status: Fit / Restricted / Unfit
- Restrictions text and codes
- Treating practitioner details
- Diagnosis information (where provided)

### PRD-3.3.3: Expiry Tracking
- Automatic expiry monitoring
- Configurable reminder thresholds
- Compliance flag generation on expiry
- Action creation for certificate chase

## PRD-3.4: Compliance Engine

### PRD-3.4.1: Detection Rules
| Rule | Code | Trigger |
|------|------|---------|
| Certificate Expired | PRD-3.4.1.1 | Current date > certificate valid_to |
| Certificate Expiring | PRD-3.4.1.2 | Valid_to within threshold days |
| No Certificate | PRD-3.4.1.3 | Active case with no valid certificate |
| RTW Without Duties | PRD-3.4.1.4 | Cleared to work but no duties assigned |
| Missed Appointment | PRD-3.4.1.5 | Scheduled medical appointment not attended |
| Missed RTW Shift | PRD-3.4.1.6 | Scheduled work shift not completed |
| Unsafe Duties | PRD-3.4.1.7 | Assigned duties exceed medical restrictions |
| Slow Response | PRD-3.4.1.8 | Critical communication unanswered beyond threshold |

### PRD-3.4.2: Compliance Outputs
- Severity-graded compliance flags (Critical/Warning/Info)
- Recommended remediation actions
- Escalation triggers for critical items
- Audit log of all detected events

### PRD-3.4.3: Rule Configuration
- Organization-level threshold customization
- Industry-specific rule sets
- Insurance policy alignment options

## PRD-3.5: Actions & Automations

### PRD-3.5.1: Automation Modes
| Mode | Code | Behavior |
|------|------|----------|
| Suggest | PRD-3.5.1.1 | Actions recommended for case manager review (default) |
| Auto-Send | PRD-3.5.1.2 | High-confidence actions executed automatically |

### PRD-3.5.2: Action Types
| Type | Code | Description |
|------|------|-------------|
| Email | PRD-3.5.2.1 | Communications to workers, hosts, GPs, insurers |
| Internal Task | PRD-3.5.2.2 | Assignments for case managers |
| Scheduled Reminder | PRD-3.5.2.3 | Future-dated follow-up triggers |
| Escalation | PRD-3.5.2.4 | Elevation to supervisor or specialist |

### PRD-3.5.3: Template System
- Variable substitution for case-specific personalization
- Organization branding integration
- Approval workflows for sensitive communications
- Legal/regulatory language enforcement

## PRD-3.6: Timeline Engine

### PRD-3.6.1: Event Sources
| Source | Code | Event Types |
|--------|------|-------------|
| Certificates | PRD-3.6.1.1 | Submission, expiry, renewal |
| Communications | PRD-3.6.1.2 | Emails sent/received, calls logged |
| Check-ins | PRD-3.6.1.3 | Worker welfare responses |
| RTW Status | PRD-3.6.1.4 | Plan changes, milestones, issues |
| Avatar Sessions | PRD-3.6.1.5 | AI conversation summaries |
| Clinical | PRD-3.6.1.6 | Reports, assessments, IME findings |
| System | PRD-3.6.1.7 | Automated actions, compliance flags |

### PRD-3.6.2: Timeline Features
- Chronological event aggregation
- Filtering by event type, date range, party
- Drill-down to full event context
- Key transition highlighting
- Export for regulatory/legal purposes

## PRD-3.7: Weekly Check-ins & Welfare Monitoring

### PRD-3.7.1: Check-in Data Collection
- Pain/symptom levels
- Mood and stress indicators
- Functional capacity self-assessment
- Work experience feedback
- Free-text concerns

### PRD-3.7.2: Check-in Outputs
- Timeline event creation
- Risk score contribution
- Behaviour/sentiment engine input
- RTW plan adjustment triggers
- Smart summary updates

## PRD-3.8: RTW Planning & Coordination

### PRD-3.8.1: RTW Plan Components
| Component | Code | Description |
|-----------|------|-------------|
| Hours Progression | PRD-3.8.1.1 | Phased increase from reduced to full hours |
| Modified Duties | PRD-3.8.1.2 | Task restrictions and accommodations |
| Review Schedule | PRD-3.8.1.3 | Aligned with certificate validity |
| Milestones | PRD-3.8.1.4 | Target dates for progression steps |

### PRD-3.8.2: RTW Monitoring
- Unsafe duty detection
- Too-fast progression warnings
- Deterioration signal recognition
- Automatic plan adjustment recommendations

### PRD-3.8.3: Duty Matching
- Current host site duty identification
- Restriction-to-task matching
- Cross-site duty availability (future)

## PRD-3.9: Reporting & Analytics

### PRD-3.9.1: Standard Reports
| Report | Code | Description |
|--------|------|-------------|
| Active Cases | PRD-3.9.1.1 | Current case inventory and status |
| Compliance Summary | PRD-3.9.1.2 | Flags, breaches, remediation status |
| Certificate Status | PRD-3.9.1.3 | Valid, expiring, expired breakdown |
| RTW Progress | PRD-3.9.1.4 | Return-to-work pipeline and outcomes |
| Action Queue | PRD-3.9.1.5 | Pending, overdue, completed actions |

### PRD-3.9.2: Dashboard Widgets
- Cases needing action
- Expiring certificates
- Compliance risk indicators
- RTW milestone tracking
- Communication activity

---

# PRD-4: Technical Architecture

## PRD-4.1: System Components

### PRD-4.1.1: Frontend
- **Framework:** React with Vite build tooling
- **Hosting:** `portal.gpnet.au`
- **Communication:** JSON REST API calls
- **Routing:** Authenticated pages under `/app/*`

### PRD-4.1.2: Backend
- **Framework:** Node.js with Express
- **API Structure:** RESTful endpoints under `/api/*`
- **Authentication:** JWT-based with refresh rotation
- **Database:** PostgreSQL with strong referential integrity

### PRD-4.1.3: AI Layer
- **LLM Integration:** Summary generation, avatar conversations, RTW suggestions
- **Vector Storage:** Pinecone or pgvector for semantic search
- **Predictive Models:** XGBoost for outcome forecasting

### PRD-4.1.4: Background Jobs
- Email sending and ingestion
- Content summarization
- OCR processing
- Predictive analytics computation
- Compliance rule evaluation

## PRD-4.2: Infrastructure

### PRD-4.2.1: Environments
| Environment | Code | Purpose |
|-------------|------|---------|
| Development | PRD-4.2.1.1 | Local developer machines, feature development |
| Staging | PRD-4.2.1.2 | UAT, performance validation, pre-prod verification |
| Production | PRD-4.2.1.3 | Live customer operations |

### PRD-4.2.2: Observability
- Structured logging for events, errors, audits
- Metrics collection and dashboards
- `/health` and `/metrics` endpoints
- Automated alerting for critical issues

### PRD-4.2.3: External Services
- Freshdesk for email/ticket management
- SMTP/IMAP for email ingestion
- S3-compatible storage for documents
- LLM API providers (Anthropic, OpenAI)

---

# PRD-5: Data Models

## PRD-5.1: Core Entities

### PRD-5.1.1: Organizational Entities
| Entity | Code | Description |
|--------|------|-------------|
| Organisation | PRD-5.1.1.1 | Top-level tenant container |
| Site | PRD-5.1.1.2 | Physical location within organization |
| User | PRD-5.1.1.3 | Authenticated portal user |

### PRD-5.1.2: Case Entities
| Entity | Code | Description |
|--------|------|-------------|
| Worker | PRD-5.1.2.1 | Individual with injury/health case |
| Case | PRD-5.1.2.2 | Injury or health management instance |
| Certificate | PRD-5.1.2.3 | Medical certificate record |
| Document | PRD-5.1.2.4 | Uploaded file with metadata |
| Check | PRD-5.1.2.5 | Worker welfare check-in response |

### PRD-5.1.3: Workflow Entities
| Entity | Code | Description |
|--------|------|-------------|
| Action | PRD-5.1.3.1 | Pending or completed task/communication |
| Rule | PRD-5.1.3.2 | Automation trigger definition |
| Template | PRD-5.1.3.3 | Communication template |
| TimelineEvent | PRD-5.1.3.4 | Chronological case event |

### PRD-5.1.4: Communication Entities
| Entity | Code | Description |
|--------|------|-------------|
| EmailMessage | PRD-5.1.4.1 | Email record (sent/received) |
| Ticket | PRD-5.1.4.2 | Freshdesk ticket reference |

### PRD-5.1.5: Intelligence Entities
| Entity | Code | Description |
|--------|------|-------------|
| RTWPlan | PRD-5.1.5.1 | Return-to-work plan version |
| Prediction | PRD-5.1.5.2 | ML model output |
| AvatarSession | PRD-5.1.5.3 | AI conversation record |
| BehaviourSignal | PRD-5.1.5.4 | Worker engagement pattern |
| KnowledgeDocument | PRD-5.1.5.5 | Policy/protocol reference |

### PRD-5.1.6: Financial Entities
| Entity | Code | Description |
|--------|------|-------------|
| Payment | PRD-5.1.6.1 | Compensation payment record |
| WageRecord | PRD-5.1.6.2 | Historical wage data |

## PRD-5.2: Data Architecture Principles

### PRD-5.2.1: Multi-Tenancy
- Complete data isolation between organizations
- Organization-scoped queries enforced at API layer
- No cross-tenant data leakage possible

### PRD-5.2.2: Audit Trail
- All significant changes logged with:
  - Timestamp
  - User ID
  - Before/after values
  - Action type

### PRD-5.2.3: Soft Delete
- Records marked inactive rather than deleted
- Preserves referential integrity
- Supports regulatory retention requirements

---

# PRD-6: Non-Functional Requirements

## PRD-6.1: Security

### PRD-6.1.1: Authentication Security
| Requirement | Code | Specification |
|-------------|------|---------------|
| Password Complexity | PRD-6.1.1.1 | Minimum 12 characters, mixed case, numbers, symbols |
| Password Rotation | PRD-6.1.1.2 | Configurable rotation policy |
| Brute Force Protection | PRD-6.1.1.3 | Account lockout after failed attempts |
| Credential Stuffing | PRD-6.1.1.4 | Rate limiting and CAPTCHA triggers |
| MFA | PRD-6.1.1.5 | Optional TOTP-based second factor |

### PRD-6.1.2: Session Security
| Requirement | Code | Specification |
|-------------|------|---------------|
| Token Lifetime | PRD-6.1.2.1 | Short-lived access tokens (15 min) |
| Refresh Rotation | PRD-6.1.2.2 | Single-use refresh tokens |
| Session Invalidation | PRD-6.1.2.3 | Immediate logout across devices |

### PRD-6.1.3: API Security
| Requirement | Code | Specification |
|-------------|------|---------------|
| Rate Limiting | PRD-6.1.3.1 | Per-user and per-IP limits |
| Input Validation | PRD-6.1.3.2 | Schema validation on all inputs |
| SQL Injection | PRD-6.1.3.3 | Parameterized queries only |
| XSS Prevention | PRD-6.1.3.4 | Output encoding, CSP headers |

## PRD-6.2: Privacy

### PRD-6.2.1: Data Minimization
- Collect only information necessary for case management
- Clear data usage purpose documentation
- User consent tracking

### PRD-6.2.2: Retention Policies
| Data Type | Code | Retention Period |
|-----------|------|------------------|
| Active Cases | PRD-6.2.2.1 | Duration of case + 7 years |
| Closed Cases | PRD-6.2.2.2 | 7 years from closure |
| Audit Logs | PRD-6.2.2.3 | 10 years |
| Session Data | PRD-6.2.2.4 | 30 days |

### PRD-6.2.3: Access Controls
- Role-based access enforcement
- Organization-scope boundaries
- Case-level permissions where applicable

## PRD-6.3: Accessibility

### PRD-6.3.1: WCAG 2.2 Level AA Compliance
| Requirement | Code | Implementation |
|-------------|------|----------------|
| Screen Reader | PRD-6.3.1.1 | Semantic HTML, ARIA labels |
| Keyboard Navigation | PRD-6.3.1.2 | Full keyboard operability |
| Color Contrast | PRD-6.3.1.3 | 4.5:1 minimum contrast ratio |
| Focus Indicators | PRD-6.3.1.4 | Visible focus states |
| Text Scaling | PRD-6.3.1.5 | Support 200% text zoom |

## PRD-6.4: Performance

### PRD-6.4.1: Response Time Targets
| Operation | Code | Target |
|-----------|------|--------|
| Page Load | PRD-6.4.1.1 | < 2 seconds |
| API Response | PRD-6.4.1.2 | < 500ms (P95) |
| Search Results | PRD-6.4.1.3 | < 1 second |
| Report Generation | PRD-6.4.1.4 | < 10 seconds |

### PRD-6.4.2: Scalability
| Metric | Code | Target |
|--------|------|--------|
| Concurrent Users | PRD-6.4.2.1 | 1000+ simultaneous |
| Cases per Org | PRD-6.4.2.2 | 100,000+ |
| Daily Transactions | PRD-6.4.2.3 | 1M+ events |

## PRD-6.5: Reliability

### PRD-6.5.1: Availability
| Requirement | Code | Target |
|-------------|------|--------|
| Uptime | PRD-6.5.1.1 | 99.9% (8.76 hours/year downtime) |
| Planned Maintenance | PRD-6.5.1.2 | < 4 hours/month, off-peak |
| RTO | PRD-6.5.1.3 | < 4 hours |
| RPO | PRD-6.5.1.4 | < 1 hour |

---

# PRD-7: Integrations

## PRD-7.1: Email & Communication

### PRD-7.1.1: Freshdesk Integration
| Capability | Code | Description |
|------------|------|-------------|
| Ticket Sync | PRD-7.1.1.1 | Bi-directional ticket synchronization |
| Email Ingestion | PRD-7.1.1.2 | Parse attachments, link to cases |
| Contact Sync | PRD-7.1.1.3 | Worker/contact record alignment |

### PRD-7.1.2: Direct Email
| Capability | Code | Description |
|------------|------|-------------|
| SMTP Send | PRD-7.1.2.1 | Outbound email delivery |
| IMAP Receive | PRD-7.1.2.2 | Inbound email monitoring |
| Attachment Processing | PRD-7.1.2.3 | Certificate and document extraction |

## PRD-7.2: Forms & Data Intake

### PRD-7.2.1: JotForm Integration
| Capability | Code | Description |
|------------|------|-------------|
| Webhook Receiver | PRD-7.2.1.1 | Accept form submission webhooks |
| Field Mapping | PRD-7.2.1.2 | Map form fields to case/worker data |
| File Handling | PRD-7.2.1.3 | Process uploaded documents |

## PRD-7.3: Document Storage

### PRD-7.3.1: S3-Compatible Storage
| Capability | Code | Description |
|------------|------|-------------|
| Upload | PRD-7.3.1.1 | Secure document upload |
| Retrieval | PRD-7.3.1.2 | Authenticated download |
| Lifecycle | PRD-7.3.1.3 | Retention and archival policies |

## PRD-7.4: AI Services

### PRD-7.4.1: LLM Providers
| Provider | Code | Usage |
|----------|------|-------|
| Anthropic Claude | PRD-7.4.1.1 | Summaries, avatar, reasoning |
| OpenAI | PRD-7.4.1.2 | Backup/alternative provider |

### PRD-7.4.2: Vector Database
| Provider | Code | Usage |
|----------|------|-------|
| Pinecone | PRD-7.4.2.1 | Semantic search, knowledge retrieval |
| pgvector | PRD-7.4.2.2 | Embedded vector storage |

---

# PRD-8: User Journeys & Workflows

## PRD-8.1: Injury Reporting Journey

### PRD-8.1.1: Flow Steps
```
Injury Occurs → Report Submitted → Case Created → Initial Triage
     ↓                                               ↓
Worker Notified ← Certificate Requested ← First Contact Made
     ↓
Avatar Interview → Structured Data Captured → Smart Summary Generated
     ↓
RTW Assessment → Plan Created → Duties Assigned → Monitoring Begins
```

### PRD-8.1.2: Journey Touchpoints
| Step | Code | Actor | System Action |
|------|------|-------|---------------|
| Report | PRD-8.1.2.1 | Worker/Supervisor | Form submitted, case created |
| Triage | PRD-8.1.2.2 | Case Manager | Review, assign priority |
| Contact | PRD-8.1.2.3 | System | Automated first contact email |
| Interview | PRD-8.1.2.4 | Worker | Avatar conversation |
| Assessment | PRD-8.1.2.5 | Case Manager | RTW capacity review |
| Planning | PRD-8.1.2.6 | Case Manager | Create RTW plan |
| Placement | PRD-8.1.2.7 | Host Supervisor | Accept worker, assign duties |

## PRD-8.2: Certificate Management Journey

### PRD-8.2.1: Flow Steps
```
Certificate Issued → Submitted to GPNet → OCR Processing → Data Extraction
     ↓                                                        ↓
Case Updated ← Timeline Event Created ← Validation Complete ← Linked to Case
     ↓
Expiry Tracked → Reminder Sent → Chase Action Created (if needed)
     ↓
New Certificate Received → Cycle Repeats
```

## PRD-8.3: Weekly Check-in Journey

### PRD-8.3.1: Flow Steps
```
Scheduled Check-in Time → Worker Receives Link → Completes Survey
     ↓                                              ↓
Response Recorded ← Risk Score Updated ← Data Analyzed
     ↓
Timeline Event Created → Summary Updated → Alerts if Concerning
```

## PRD-8.4: RTW Progression Journey

### PRD-8.4.1: Flow Steps
```
RTW Plan Active → Shift Completed → Progress Recorded
     ↓                                   ↓
Next Phase Triggered ← Milestone Met ← Hours/Duties Reviewed
     ↓
Plan Adjusted (if needed) → Full RTW Achieved → Case Closed
```

---

# PRD-9: AI & Intelligence Layer

## PRD-9.1: Claims Avatar Engine

### PRD-9.1.1: Conversation Capabilities
| Capability | Code | Description |
|------------|------|-------------|
| Story Capture | PRD-9.1.1.1 | Gather injury narrative in worker's words |
| Symptom Assessment | PRD-9.1.1.2 | Current symptoms and limitations |
| Impact Analysis | PRD-9.1.1.3 | Effect on daily life and work |
| History Collection | PRD-9.1.1.4 | Prior medical history and treatments |
| Psychosocial Screening | PRD-9.1.1.5 | Identify anxiety, catastrophizing, support deficits |

### PRD-9.1.2: Avatar Outputs
- Complete injury story transcript
- Structured data field extraction
- Psychosocial risk flags
- RTW feasibility indicators
- Escalation recommendations

## PRD-9.2: Smart Summary Engine

### PRD-9.2.1: Input Sources
| Source | Code | Data Used |
|--------|------|-----------|
| Timeline | PRD-9.2.1.1 | All chronological events |
| Certificates | PRD-9.2.1.2 | Capacity, restrictions, dates |
| Check-ins | PRD-9.2.1.3 | Trends and current state |
| Communications | PRD-9.2.1.4 | Sentiment and key topics |
| Compliance | PRD-9.2.1.5 | Flags and risk indicators |

### PRD-9.2.2: Summary Outputs
| Output | Code | Description |
|--------|------|-------------|
| Current Snapshot | PRD-9.2.2.1 | Most recent developments |
| Risk Assessment | PRD-9.2.2.2 | Deterioration signals, compliance concerns |
| Restrictions Summary | PRD-9.2.2.3 | Current capacity with expiry tracking |
| Next Actions | PRD-9.2.2.4 | Prioritized recommendations |

## PRD-9.3: Liability Decision Engine

### PRD-9.3.1: Assessment Inputs
| Input | Code | Analysis |
|-------|------|----------|
| Injury Description | PRD-9.3.1.1 | Mechanism and circumstances |
| Job Context | PRD-9.3.1.2 | Tasks and conditions |
| Evidence | PRD-9.3.1.3 | Witnesses, incident reports |
| History | PRD-9.3.1.4 | Prior injuries and claims |
| Behaviour | PRD-9.3.1.5 | Communication patterns |

### PRD-9.3.2: Assessment Outputs
| Output | Code | Values |
|--------|------|--------|
| Likelihood | PRD-9.3.2.1 | Likely / Unlikely / Unclear |
| Rationale | PRD-9.3.2.2 | Factor-by-factor explanation |
| Evidence Gaps | PRD-9.3.2.3 | Additional info needed |

## PRD-9.4: RTW Intelligence Engine

### PRD-9.4.1: Plan Generation
| Component | Code | Consideration |
|-----------|------|---------------|
| Hours Phasing | PRD-9.4.1.1 | Clinical guidance, operational needs |
| Duty Matching | PRD-9.4.1.2 | Restrictions vs. available tasks |
| Review Timing | PRD-9.4.1.3 | Certificate alignment |

### PRD-9.4.2: Monitoring Alerts
| Alert | Code | Trigger |
|-------|------|---------|
| Unsafe Assignment | PRD-9.4.2.1 | Duties exceed restrictions |
| Fast Progression | PRD-9.4.2.2 | Hours/duties advancing too quickly |
| Deterioration | PRD-9.4.2.3 | Check-in or certificate signals |

## PRD-9.5: Predictive Analytics

### PRD-9.5.1: Prediction Models
| Model | Code | Output |
|-------|------|--------|
| Case Duration | PRD-9.5.1.1 | Estimated time to RTW/closure |
| RTW Probability | PRD-9.5.1.2 | Likelihood of successful return |
| Deterioration Risk | PRD-9.5.1.3 | Risk of worsening condition |

### PRD-9.5.2: Model Transparency
- Confidence scores with each prediction
- Key factor explanation
- Continuous performance monitoring
- Regular retraining cycles

---

# PRD-10: Success Metrics & KPIs

## PRD-10.1: Business Metrics

### PRD-10.1.1: Adoption Metrics
| Metric | Code | Target |
|--------|------|--------|
| Active Organizations | PRD-10.1.1.1 | Month-over-month growth |
| Daily Active Users | PRD-10.1.1.2 | 80% of registered users |
| Cases Managed | PRD-10.1.1.3 | Cases created and actively managed |

### PRD-10.1.2: Outcome Metrics
| Metric | Code | Target |
|--------|------|--------|
| Average RTW Time | PRD-10.1.2.1 | Reduction vs. baseline |
| Certificate Compliance | PRD-10.1.2.2 | > 95% valid certificate coverage |
| Action Completion | PRD-10.1.2.3 | > 90% actions completed on time |

## PRD-10.2: System Metrics

### PRD-10.2.1: Performance Metrics
| Metric | Code | Target |
|--------|------|--------|
| API Response Time | PRD-10.2.1.1 | P95 < 500ms |
| Page Load Time | PRD-10.2.1.2 | P95 < 2s |
| Error Rate | PRD-10.2.1.3 | < 0.1% |

### PRD-10.2.2: Reliability Metrics
| Metric | Code | Target |
|--------|------|--------|
| Uptime | PRD-10.2.2.1 | 99.9% |
| Mean Time to Recovery | PRD-10.2.2.2 | < 1 hour |
| Incident Rate | PRD-10.2.2.3 | < 2 per month |

## PRD-10.3: AI/ML Metrics

### PRD-10.3.1: Model Performance
| Metric | Code | Target |
|--------|------|--------|
| Prediction Accuracy | PRD-10.3.1.1 | > 80% for RTW predictions |
| OCR Accuracy | PRD-10.3.1.2 | > 95% field extraction |
| Summary Quality | PRD-10.3.1.3 | > 4.0/5.0 user rating |

---

# Appendix A: Section Code Reference

## Quick Reference Index

| Code Pattern | Section |
|--------------|---------|
| PRD-1.x.x | Executive Summary & Vision |
| PRD-2.x.x | Stakeholders & Personas |
| PRD-3.x.x | Functional Requirements |
| PRD-4.x.x | Technical Architecture |
| PRD-5.x.x | Data Models |
| PRD-6.x.x | Non-Functional Requirements |
| PRD-7.x.x | Integrations |
| PRD-8.x.x | User Journeys & Workflows |
| PRD-9.x.x | AI & Intelligence Layer |
| PRD-10.x.x | Success Metrics & KPIs |

## Code Structure

```
PRD-[Section].[Subsection].[Item]

Examples:
PRD-3.4.1.1  = Functional Requirements → Compliance Engine → Detection Rules → Certificate Expired
PRD-6.1.1.5  = Non-Functional → Security → Auth Security → MFA
PRD-9.2.2.4  = AI Layer → Smart Summary → Outputs → Next Actions
```

---

# Appendix B: Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-12-19 | GPNet Product Team | Initial comprehensive PRD |

---

# Appendix C: Related Documents

| Document | Location | Description |
|----------|----------|-------------|
| System Overview | `docs/spec/01-system-overview.md` | High-level system description |
| Architecture | `docs/spec/02-system-architecture.md` | Technical architecture details |
| Data Model | `docs/spec/05-data-model-schema.md` | Database schema specification |
| User Journeys | `docs/spec/12-user-journeys.md` | Detailed journey mapping |
| Security Spec | `docs/spec/28-security-privacy-accessibility.md` | Security requirements |
| Master Overview | `docs/GPNET_MASTER_OVERVIEW.md` | Product vision document |

---

*End of GPNet3 Product Requirements Document*
