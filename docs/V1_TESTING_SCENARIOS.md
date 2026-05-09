# Preventli v1 — Testing Scenarios

**Version:** 1.0
**Date:** March 2026
**Environment:** https://app.preventli.ai/
**Credentials:** employer@symmetry.local / ChangeMe123!
**Audience:** Preventli internal staff (case managers, clinical, admin)

---

## How to Use This Document

Work through each section in order. Check off each item as you go. If something doesn't work as described, log it using the bug template at the bottom.

---

## Module 1 — Authentication

### 1.1 Login
- [ ] Navigate to https://app.preventli.ai/
- [ ] Login screen appears
- [ ] Enter credentials and click Sign In
- [ ] Redirected to cases dashboard
- [ ] Your name/role appears in the navigation

### 1.2 Session Persistence
- [ ] Refresh the page — still logged in
- [ ] Close and reopen the tab — still logged in

### 1.3 Logout
- [ ] Click logout / avatar menu
- [ ] Redirected to login screen
- [ ] Navigating to /dashboard redirects back to login

### 1.4 Invalid Login
- [ ] Enter wrong password — error message shown
- [ ] No details about whether email or password was wrong (security)

---

## Module 2 — Cases Dashboard

### 2.1 Cases List
- [ ] Dashboard loads with list of worker cases
- [ ] Each row shows: worker name, company, injury date, status, compliance level
- [ ] Cases are paginated or scrollable (no blank screen)

### 2.2 Search
- [ ] Type a worker name in the search box — list filters correctly
- [ ] Search by company name — works
- [ ] Clear search — all cases return

### 2.3 Filters
- [ ] Filter by case status (open/closed)
- [ ] Filter by compliance level
- [ ] Filter by risk level (if available)
- [ ] Multiple filters can be applied simultaneously
- [ ] Filters can be cleared

### 2.4 Sorting
- [ ] Click column headers to sort
- [ ] Sort by compliance level (low to high)
- [ ] Sort by injury date

### 2.5 Risk Scoring
- [ ] Each case shows a risk indicator
- [ ] High-risk cases are visually distinct (red/amber)

---

## Module 3 — Case Detail (8 Tabs)

Open any case with rich data before testing these tabs.

### 3.1 Summary Tab
- [ ] Worker name, company, injury date in header
- [ ] Work status badge (e.g., "Off Work", "Partial Return")
- [ ] Compliance rules breakdown visible with PASS/WARN/FAIL indicators
- [ ] Priority actions listed
- [ ] AI smart summary present (may say "generating..." briefly)

### 3.2 Injury Tab
- [ ] Injury date shown
- [ ] Injury description/body part shown
- [ ] Claim details (Freshdesk ID if synced)
- [ ] Mental health flag visible if applicable

### 3.3 Timeline Tab
- [ ] Chronological list of case events
- [ ] Events show date, type, description
- [ ] Most recent event at top (or clearly ordered)
- [ ] Timeline loads without blank state

### 3.4 RTW Plan Tab
- [ ] Shows current RTW status
- [ ] If RTW plan exists: shows pathway, duties, target dates
- [ ] If no RTW plan: shows prompt to create one
- [ ] Functional capacity details if entered

### 3.5 Financial Tab
- [ ] Wage/payment information visible (even if partial)
- [ ] Step-down milestones (13 weeks) shown if applicable
- [ ] No broken layout or missing data errors

### 3.6 Risk Tab
- [ ] Risk register items listed
- [ ] Each risk shows likelihood and impact
- [ ] Risk level calculated (Low/Medium/High/Critical)
- [ ] Dispute tracking visible if applicable
- [ ] Related/multi-claims flag if applicable

### 3.7 Contacts Tab
- [ ] Treating providers listed (GP, physio, etc.)
- [ ] Employer contacts listed
- [ ] Contact details visible (phone/email)

### 3.8 Recovery Tab
- [ ] Recovery progress indicator
- [ ] Current barriers or notes
- [ ] No blank screen

---

## Module 4 — Medical Certificates

### 4.1 Certificate List
- [ ] Navigate to certificates / review queue (from nav or case)
- [ ] Certificates listed with worker name, dates, status
- [ ] Expired certificates flagged clearly

### 4.2 Certificate Review
- [ ] Open a certificate record
- [ ] See: issue date, expiry date, capacity details, treating doctor
- [ ] Status indicator (current / expiring soon / expired)

### 4.3 Review Queue
- [ ] Navigate to the certificate review queue
- [ ] Cases needing new certificates are listed
- [ ] Can be sorted by urgency

---

## Module 5 — Compliance Engine

### 5.1 Compliance Dashboard View
- [ ] Cases on dashboard show compliance level (Very High / High / Medium / Low / Very Low)
- [ ] Colour coding: green = high, amber = medium, red = low

### 5.2 Compliance Rules Breakdown
- [ ] Open a case with low compliance
- [ ] Summary tab shows each rule with PASS / WARN / FAIL
- [ ] Each rule includes: rule name, status, explanation
- [ ] Priority actions generated from failing rules

### 5.3 Seven Compliance Rules Present
- [ ] CERT_CURRENT — Certificate is current
- [ ] RTW_PLAN_10WK — RTW plan within 10 weeks
- [ ] FILE_REVIEW_8WK — Case reviewed every 8 weeks
- [ ] PAYMENT_STEPDOWN — 13-week step-down tracked
- [ ] CENTRELINK_CLEARANCE — Centrelink clearance
- [ ] SUITABLE_DUTIES — Employer suitable duties
- [ ] RTW_OBLIGATIONS — RTW obligations compliance

### 5.4 Breach Detection
- [ ] A case with an expired certificate shows FAIL for CERT_CURRENT
- [ ] A case at 9 weeks without RTW plan shows WARN for RTW_PLAN_10WK
- [ ] Score updates correctly based on rule outcomes

---

## Module 6 — Action Queue

### 6.1 Action Queue List
- [ ] Navigate to the action queue (from nav or case)
- [ ] Pending actions listed with: case name, action type, due date, priority
- [ ] Overdue actions highlighted

### 6.2 Action Detail
- [ ] Open an action
- [ ] See AI rationale / reason for the action
- [ ] Can mark as complete or dismiss

### 6.3 Filters
- [ ] Filter actions by priority (urgent / high / normal)
- [ ] Filter by overdue status

---

## Module 7 — Injury Date Review Queue

- [ ] Navigate to injury date review queue
- [ ] Cases with unconfirmed or disputed injury dates listed
- [ ] Can review and confirm injury date from this queue

---

## Module 8 — Return to Work (RTW)

### 8.1 RTW Planning Wizard
- [ ] From a case, initiate "Create RTW Plan"
- [ ] Wizard steps are clear (pathway selection, duties, dates)
- [ ] Can select RTW pathway type
- [ ] Worker consent capture step present

### 8.2 RTW Plan Detail
- [ ] After creating/viewing a plan, detail page loads
- [ ] Shows: pathway, duties, target dates, current status

### 8.3 Functional Capacity Assessment
- [ ] Can enter functional capacity details (restrictions, lifting limits, etc.)
- [ ] Data saves and appears on RTW plan

### 8.4 Pathway Selection
- [ ] Pre-injury duties pathway available
- [ ] Alternative duties pathway available
- [ ] Alternative employment pathway available

---

## Module 9 — AI Features

### 9.1 AI Case Chat
- [ ] Open a case — find the AI chat panel
- [ ] Type a question about the case (e.g., "What are the compliance issues?")
- [ ] AI responds with case-relevant answer
- [ ] Response references actual case data (not generic)

### 9.2 AI Smart Summary
- [ ] On the Summary tab, smart summary is generated
- [ ] Summary covers: worker status, key risks, priority actions
- [ ] No error message or blank state

### 9.3 AI Email Drafts
- [ ] From a case, find "Generate Email Draft" or similar
- [ ] Select email type (e.g., to employer, to GP)
- [ ] AI generates a draft with correct worker/case details
- [ ] Draft can be reviewed before sending

---

## Module 10 — Clinical Assessment Suite

Navigate to Assessments from the nav or a case.

### 10.1 Injury Assessment Form
- [ ] Form loads
- [ ] Can enter injury details, body part, mechanism
- [ ] Saves correctly

### 10.2 Mental Health Assessment
- [ ] Form loads with mental health screening questions
- [ ] Score or outcome calculated
- [ ] Saves and links to case

### 10.3 Functional Capacity Assessment
- [ ] Physical capacity fields present (lifting, standing, etc.)
- [ ] Restrictions section present
- [ ] Saves correctly

### 10.4 Pre-Employment Assessment
- [ ] Form loads
- [ ] Can complete and save

### 10.5 Prevention Assessment
- [ ] Form loads
- [ ] Can complete and save

### 10.6 General Wellness Check-in
- [ ] Form loads
- [ ] Can complete and save

### 10.7 Exit Health Check
- [ ] Form loads
- [ ] Can complete and save

---

## Module 11 — Termination Workflow

### 11.1 Initiate Termination
- [ ] From a case, find "Termination" option
- [ ] Risk check step runs before proceeding
- [ ] System warns if high-risk termination

### 11.2 Risk Checks
- [ ] Compliance issues flagged before proceeding
- [ ] WorkSafe obligations checklist shown
- [ ] Can acknowledge and proceed

### 11.3 Documentation Package
- [ ] System generates termination documentation
- [ ] Documents include relevant case details
- [ ] Can be downloaded or saved

---

## Module 12 — Notifications

- [ ] Notification bell / panel visible in navigation
- [ ] Unread count shown
- [ ] Can open a notification and navigate to the relevant case
- [ ] Can mark notifications as read

---

## Module 13 — Reports & CSV Export

### 13.1 Reports Page
- [ ] Navigate to Reports
- [ ] Report types available (compliance, cases, certificates)
- [ ] Date range filter works

### 13.2 CSV Export
- [ ] Select a report type
- [ ] Click Export / Download CSV
- [ ] File downloads with correct data
- [ ] Column headers are meaningful

---

## Module 14 — Admin

### 14.1 User Management & Invites
- [ ] Navigate to Admin > Users
- [ ] Existing users listed with roles
- [ ] "Invite User" button works
- [ ] Enter email + role → invite sends (or queues if SMTP not configured)

### 14.2 RBAC Roles
- [ ] Different roles visible: admin, case manager, clinical, etc.
- [ ] Assigning a role restricts/grants appropriate access

### 14.3 Organisation / Company Management
- [ ] Can view / add / edit companies (employers)
- [ ] Company links to related cases

### 14.4 RTW Roles & Duties Library
- [ ] Can view list of roles/duties
- [ ] Can add or edit a duty
- [ ] Duties are available when creating RTW plans

### 14.5 Audit Log
- [ ] Navigate to Admin > Audit Log
- [ ] Events listed: login, case updates, user actions
- [ ] Includes timestamp, user, action type

---

## Module 15 — Telehealth Booking (New)

### 15.1 Access Modal
- [ ] Find "Book Telehealth" button (check case detail or nav)
- [ ] Modal opens correctly

### 15.2 Form Validation
- [ ] Submit with empty fields — validation errors shown
- [ ] Enter invalid email — error shown
- [ ] Select a past date — should not be allowed (min = today)

### 15.3 Successful Booking
- [ ] Fill all required fields
- [ ] Upload an optional attachment
- [ ] Submit — confirmation message shown
- [ ] Confirmation says: "All telehealth providers have been notified"

### 15.4 API Endpoint
- [ ] POST /api/telehealth/booking exists
- [ ] Returns success response
- [ ] (If SMTP configured) notification email sent to providers

---

## Module 16 — Freshdesk Integration

### 16.1 Sync Status
- [ ] Navigate to Freshdesk sync section (admin or settings)
- [ ] Last sync time visible
- [ ] Can trigger manual sync

### 16.2 Ticket to Case Mapping
- [ ] Freshdesk ticket ID appears on case (e.g., FD-44223)
- [ ] Worker details match Freshdesk record
- [ ] New Freshdesk tickets appear as cases after sync

---

## Module 17 — Help & Onboarding

### 17.1 Contextual Help
- [ ] Help icons or tooltips present on key screens
- [ ] Clicking help icon shows relevant explanation
- [ ] Links to documentation where applicable

### 17.2 First-Time Guided Tour
- [ ] If available, guided tour triggers for new users
- [ ] Tour highlights key sections
- [ ] Can skip or dismiss tour

---

## Module 18 — Control Tower (Admin Only)

Navigate to /admin/control-tower (admin role required).

- [ ] Overview panel loads: active cases, open actions, users
- [ ] AI subsystem panel shows API status and latency
- [ ] Agent panel shows recent agent job outcomes
- [ ] Uploads panel shows storage status
- [ ] Auth panel shows recent login events
- [ ] Alerts panel shows any system alerts
- [ ] Performance panel shows API response times
- [ ] Auto-refreshes every 30 seconds

---

## Performance Checks

For each of these actions, note if it feels slow (>3 seconds) or acceptable:

| Action | Acceptable? | Notes |
|--------|-------------|-------|
| Dashboard initial load | | |
| Opening a case detail | | |
| Switching between tabs | | |
| Generating AI summary | | |
| Running AI chat | | |
| Loading action queue | | |
| CSV export download | | |

---

## Bug Report Template

```
BUG: [Title]
=============

SEVERITY: Critical / High / Medium / Low

MODULE: [e.g., Module 5 - Compliance / Module 9 - AI]

STEPS TO REPRODUCE:
1.
2.
3.

EXPECTED RESULT:
[What should happen]

ACTUAL RESULT:
[What actually happened]

URL when it happened:
[Paste the URL from your browser]

SCREENSHOT:
[Attach if helpful]
```

**Severity Guide:**

| Severity | Definition |
|----------|------------|
| Critical | Can't use the system, data wrong, can't login |
| High | Major feature broken or missing |
| Medium | Feature works but with problems |
| Low | Cosmetic issue, typo, minor layout problem |

---

## Summary Checklist

Before finishing testing:

- [ ] Logged in and navigated the main dashboard
- [ ] Opened at least 3 different cases
- [ ] Checked compliance rules on a low-compliance case
- [ ] Used AI chat on a case
- [ ] Submitted at least one assessment form
- [ ] Checked the action queue
- [ ] Tested at least one admin function
- [ ] Reviewed the control tower (if admin)
- [ ] Logged all bugs found using the template above

---

*Prepared for Preventli v1 internal testing week — 16–22 March 2026*
