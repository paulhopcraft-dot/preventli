# Preventli Manual Testing Guide
**For: HR Coordinator / Tester**
**System:** Preventli — Workplace Injury & Return to Work Management
**Login:** https://app.preventli.ai
**Credentials:** admin@gpnet.local / ChangeMe123!

---

## How to Use This Guide

Work through each scenario in order. For each step:
- ✅ Put a tick if it works as expected
- ❌ Put a cross if something is wrong or missing
- 📝 Write a note describing what you saw

You do not need any technical knowledge. Just follow the steps and record what you see.

---

## SCENARIO 1 — New Injury Reported (Day 1)

**Story:** Jake, a warehouse worker, hurt his back lifting boxes this morning. You need to log the incident.

| # | Step | What you should see | Result |
|---|------|---------------------|--------|
| 1 | Log in at app.preventli.ai | Dashboard loads, no errors | |
| 2 | Click **New Case** (or find the button to create a new case) | A form appears | |
| 3 | You are asked: *"Has a WorkSafe claim been lodged?"* — click **No** | The rest of the form appears | |
| 4 | Enter worker name: **Jake Thompson** | Field accepts the name | |
| 5 | Enter worker email and phone number | Fields accept the details | |
| 6 | Enter incident date: **today's date** | Date picker works | |
| 7 | Enter incident location: **Warehouse — Loading Bay 3** | Field accepts the text | |
| 8 | Describe the injury: **Lower back strain from manual lifting** | Text area accepts the description | |
| 9 | Submit / create the case | A confirmation appears, or you are taken to the new case | |
| 10 | Find Jake's case in the case list | Jake's case is visible | |

**Questions to answer:**
- Could you find the "New Case" button without help?
- Did the form ask for everything you'd expect to record on day 1?
- What was missing?

---

## SCENARIO 2 — WorkSafe Claim Lodged (Day 3)

**Story:** Jake's GP has issued a WorkSafe certificate. The claim has now been formally lodged. You need to update the system.

| # | Step | What you should see | Result |
|---|------|---------------------|--------|
| 1 | Open Jake's case from the case list | Case detail page loads | |
| 2 | Find a way to update the claim status to "WorkSafe claim lodged" | Option exists somewhere (tab, button, or dropdown) | |
| 3 | Enter the WorkSafe claim number | A field exists for the claim number | |
| 4 | Upload or record the GP certificate details | A section exists for certificates | |
| 5 | Record the restrictions from the certificate (e.g. *No lifting over 5kg, no bending*) | Restrictions can be entered | |
| 6 | Note the certificate expiry date | An expiry date field exists | |
| 7 | Check if the system shows a **RTW Plan deadline** (within 10 working days of claim) | A deadline date is visible | |
| 8 | Save the changes | Confirmation appears | |

**Questions to answer:**
- Does the system automatically calculate the RTW Plan deadline (10 working days)?
- Or do you have to work that out yourself?
- Is the WorkSafe claim number easy to find after you enter it?

---

## SCENARIO 3 — Return to Work Plan Created (Week 2)

**Story:** Jake's RTW Plan needs to be in place. His GP says he can do light duties — seated work only, no lifting.

| # | Step | What you should see | Result |
|---|------|---------------------|--------|
| 1 | Open Jake's case | Case loads | |
| 2 | Find the RTW Plan section | A section or tab for the RTW Plan exists | |
| 3 | Enter suitable duties: *Data entry, phone-based customer service* | Suitable duties can be entered | |
| 4 | Set the planned return date (6 weeks from now) | A date field exists for planned return | |
| 5 | Record who the RTW Coordinator is (your name) | A coordinator name field exists | |
| 6 | Save the RTW Plan | Confirmation appears | |
| 7 | Check if the case status has changed (e.g. from "New" to "RTW Plan Active") | Status is updated | |

**Questions to answer:**
- Is it clear where to create the RTW Plan?
- Can you record the specific suitable duties Jake can do?
- Does the case status reflect that a plan is now in place?

---

## SCENARIO 4 — Certificate Renewal, No Progress (Week 6)

**Story:** Jake's GP has issued a new certificate. The restrictions are exactly the same as before — no improvement.

| # | Step | What you should see | Result |
|---|------|---------------------|--------|
| 1 | Open Jake's case | Case loads | |
| 2 | Add the new certificate with the same restrictions as last time | Certificate can be added | |
| 3 | Check if the system **flags** that the restrictions haven't changed | A warning or flag appears (e.g. "Restrictions unchanged for 6 weeks") | |
| 4 | Check if the system suggests contacting the GP for a case conference | A suggestion or prompt appears | |
| 5 | View the certificate history — can you see both certificates? | Both certificates are listed with dates | |
| 6 | Check Jake's case risk level — has it changed? | Risk level is visible (Low / Medium / High) | |

**Questions to answer:**
- Did the system warn you that restrictions were the same as last time?
- Did it tell you what to do about it?
- Could you see the history of all certificates in one place?

---

## SCENARIO 5 — RTW Milestone Missed (Week 12)

**Story:** Jake was meant to be back at work by now. He isn't. His case is overdue.

| # | Step | What you should see | Result |
|---|------|---------------------|--------|
| 1 | Go to the dashboard (home page after login) | Dashboard loads | |
| 2 | Look for Jake's case — does it stand out as overdue? | Jake's case is highlighted / flagged / in a separate overdue section | |
| 3 | Open Jake's case | Case loads | |
| 4 | Check the case status — does it say **Overdue** or **Off Track**? | Status clearly shows overdue | |
| 5 | Check the risk level — has it escalated to **High**? | Risk level shows High | |
| 6 | Look for a **"What to do next"** section or action item | A next step is shown (e.g. "Contact worker, review RTW Plan") | |
| 7 | Check the timeline — does it show that the RTW milestone was missed? | Timeline has an entry for the missed milestone with the date | |

**Questions to answer:**
- Did Jake's case immediately stand out on the dashboard as a problem?
- Did the system tell you what to do next — or did you have to figure it out yourself?
- Is the case status clearly showing "Overdue" (not just "Active")?

---

## SCENARIO 6 — No Suitable Duties Available (Week 16)

**Story:** You've tried everything. There are no tasks Jake can do in your manufacturing environment with his back restrictions. You need to document this formally.

| # | Step | What you should see | Result |
|---|------|---------------------|--------|
| 1 | Open Jake's case | Case loads | |
| 2 | Find the suitable duties section | A section exists to document duty attempts | |
| 3 | Record the duties you considered and why they don't work | Text fields or a structured form exists | |
| 4 | Mark that no suitable duties are available | An option exists: "Cannot provide suitable duties" | |
| 5 | Check if the system prompts a **vocational assessment referral** | A suggestion appears: "Consider referring for vocational assessment" | |
| 6 | Check if there is any mention of the **insurance premium impact** | A warning about premium classification appears | |

**Questions to answer:**
- Does the system have a proper section for documenting your duty attempts?
- Or did you have to put this in a notes field?
- Did it prompt you to refer for a vocational assessment?

---

## SCENARIO 7 — Worker Non-Compliance (Week 20)

**Story:** Jake has stopped attending appointments and isn't responding to calls or emails. You need to document your attempts to contact him.

| # | Step | What you should see | Result |
|---|------|---------------------|--------|
| 1 | Open Jake's case | Case loads | |
| 2 | Find a section to log contact attempts | A contact log section exists | |
| 3 | Add a contact attempt: *Phone call, 9am, no answer, left voicemail* | Fields for date, method, and outcome exist | |
| 4 | Add another contact attempt: *Email sent, no reply* | Can add multiple entries | |
| 5 | Add another: *Letter sent by post* | Can add a letter entry | |
| 6 | Check if the system prompts you to issue a **formal notice** after 3+ failed attempts | A prompt appears about formal notice | |
| 7 | Check if the system mentions **Fair Work Act** obligations | An alert or info section mentions FWA adverse action risks | |

**Questions to answer:**
- Is there a proper contact log — or just a free text notes box?
- Did the system warn you about Fair Work obligations?
- Would a new HR coordinator know what to do next without being told?

---

## SCENARIO 8 — Considering Termination (Week 24)

**Story:** After 6 months, Jake still hasn't returned. You are now considering whether termination is the right course of action. This is legally sensitive.

| # | Step | What you should see | Result |
|---|------|---------------------|--------|
| 1 | Open Jake's case | Case loads | |
| 2 | Look for a termination or escalation section | A section exists (may be in a menu or tab) | |
| 3 | Check if there is a **pre-termination checklist** | A checklist appears with required steps before proceeding | |
| 4 | Check if **Fair Work Act Section 340** (adverse action) is prominently warned | A clear warning is visible — not hidden in a tooltip | |
| 5 | Check if the system tells you to obtain **independent legal advice** | A prompt appears recommending legal advice | |
| 6 | Check the timeline — does it show the full history of the case? | Timeline has entries for every key event | |

**Questions to answer:**
- Did the system warn you loudly about the legal risks of terminating an injured worker?
- Was there a checklist to work through before taking action?
- Did it recommend getting legal advice?
- Would you feel confident using this system to manage a termination without separate legal support?

---

## SCENARIO 9 — AI Assistant (Alex)

**Story:** You open Jake's case and want to ask for help. You use the Alex AI assistant.

| # | Step | What you should see | Result |
|---|------|---------------------|--------|
| 1 | Open Jake's case | Case loads | |
| 2 | Find the Alex chat or AI assistant | A chat interface is visible on the case | |
| 3 | Ask: *"Jake has been off for 6 months and missed his RTW milestone. What should I do?"* | Alex responds with practical advice | |
| 4 | Check if the response mentions specific next steps | Response includes actions, not just general information | |
| 5 | Ask: *"What are my legal obligations at this point?"* | Response mentions WorkSafe Code of Practice and Fair Work Act | |
| 6 | Check if the advice is relevant to Jake's case specifically | Response references case details, not generic text | |

**Questions to answer:**
- Is Alex easy to find on the case page?
- Did the advice feel relevant and helpful?
- Or was it generic and could have come from a Google search?

---

## SCENARIO 10 — Case Closed, Worker Exits

**Story:** Jake has decided not to return. The case needs to be formally closed with an exit outcome recorded.

| # | Step | What you should see | Result |
|---|------|---------------------|--------|
| 1 | Open Jake's case | Case loads | |
| 2 | Find the option to close / resolve the case | A "Close Case" or "Resolve" option exists | |
| 3 | Select the exit reason: *Worker resigned / did not return* | Exit reasons are listed (not just "Closed") | |
| 4 | Record the final date of employment | A field exists for last day | |
| 5 | Close the case | Case status changes to Closed / Resolved | |
| 6 | Check if the closed case still appears in history | Can search and view closed cases | |
| 7 | Check if a final summary or report is generated | A closure report or summary is available | |

**Questions to answer:**
- Can you record why the case closed (not just that it closed)?
- Is there a final report you can keep for your records?
- Can you find closed cases later if needed for a WorkSafe audit?

---

## Overall Feedback

After completing all scenarios, please answer:

1. **On a scale of 1–10, how useful is Preventli for managing a real WorkSafe case?**

2. **What was the most helpful thing the system did?**

3. **What was the most frustrating or confusing thing?**

4. **What is the single most important thing that is missing?**

5. **Would a new HR coordinator be able to use this without training?** (Yes / With some training / No)

6. **Any other comments:**

---

*Testing guide version 1.0 — March 2026*
