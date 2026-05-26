# Wallara walkthrough + WorkSafe RTWI grant ask — 2026-05-26

**Audience:** Ellen Burns (Head of People & Culture, Wallara). Possibly Michelle, Nicole, new OHS officer.
**Outcome you need to leave with:** Ellen's verbal yes to (1) being named in the RTWI Round 3 submission, (2) one operational metric, (3) a letter of support.
**Time:** Plan 30 min. Walkthrough 15. Grant ask 10. Q&A 5.

---

## 🔍 SELF-TEST CHECKLIST (Tue night / Wed morning, ~5 min)

Log into `https://app.preventli.ai` as `wallara@wallara.com.au / wallara01`. Hit each page below — confirm it loads and looks right. If any page is broken / ugly / slow, add it to the polish list and decide whether to skip it on Wed.

| Page | What to confirm | Demo use? |
|---|---|---|
| `/` Dashboard | Morning briefing greets Ellen (after fix #5), 3 cases-needing-attention shown, table below | Open with this. 60s. |
| `/cases` Cases list | All 6 workers visible (5 + Jenna after re-seed), risk levels render, filter works | 30s scan only. |
| `/employer/case/case-wallara-jenna` ⭐ | NEW after re-seed. Has summary, current cert with restrictions, "Draft RTW Plan" button enabled | THE HERO. 4–5 min. |
| `/employer/case/case-wallara-marcus` | Existing approved plan shows; auto-draft update button enabled | 1 min if time. |
| `/employer/case/case-wallara-david` | IME panel renders with 5 numbered actions | 2 min — medico-legal showcase. |
| `/employer/case/case-wallara-naomi` | Prevention Check report modal opens cleanly | 1 min — preventative pathway. |
| `/checks` Health Checks | All 5+ check categories tab through cleanly | 30s — multi-pathway breadth. |
| `/rtw-planner` | RTW Planner page loads (not 404), shows planning surface | Mention only if it works. |
| `/employer/new-case` | New case form loads, fields don't crash | Mention if Ellen asks about onboarding new injuries. |
| Settings / Users area | Self-serve invite for Michelle, Nicole, OHS officer | 30s — final beat: "you can do this without me." |

**Pages I have NOT verified live this session:** `/checks`, `/rtw-planner`, `/checkins`, `/financials`, `/predictions`, `/risk`, `/employer/new-case`, Settings. Browser session kept expiring mid-walk. **You need to eyeball these tonight.** If any one is broken or empty, exclude it from Layer 1 — don't navigate somewhere that breaks the spell.

**Session expiry warning:** JWT is 15 minutes. If you pause mid-demo (e.g. Ellen has a long question), you may get bounced to login. Options: (a) keep clicking every few minutes to keep the session live, (b) bump JWT TTL temporarily for the demo, (c) keep `wallara01` taped to your screen so re-login is 5 seconds.

---

## 🚨 PRE-DEMO POLISH PUNCHLIST (live-tested 2026-05-26)

Live walkthrough of prod app as Ellen surfaced these. **Fix before Wednesday** in this order:

### 🔴 Blockers (Ellen will notice within 60 seconds)

1. **Morning briefing modal re-pops on every page navigation.** Dismissal doesn't persist. Ellen will hit "Got it" 8–10 times in 15 minutes. Fix: persist dismissal in session state (localStorage / TanStack Query) so it stays dismissed for the rest of the session.

2. **"Compliance: Non-Compliant — Hover for details" on Marcus has no inline reason.** This breaks the standing rule (`feedback_compliance_reason_required.md`). Fix: replace bare "Non-Compliant" with `Non-Compliant — case file incomplete (missing recent FCE)` inline. Don't rely on hover.

3. **Date drift in seed data.** Dashboard says David's cert is "164 days expired", Sarah "31 days", Marcus "66 days". Due dates "21 May" and "24 May" are now overdue (today is 26 May). Looks neglected, not active. Fix: re-seed Wallara before Wednesday so cert lapses are 3–10 days, due dates are this week.

4. **Two morning briefings tell different stories.** Dashboard greeting shows cert-expiry days (164/66/31). Case-page modal shows different numbers and language ("10 days overdue", "off work for 193 days", generic "low compliance" flags for everyone). One source of truth or one of them gets removed.

### 🟡 Polish items (Ellen probably notices, definitely hurts on second look)

5. **"Good morning Wallara 👋" should be "Good morning Ellen 👋".** Name-level personalisation is dramatically warmer. One template change.

6. **"Demo CTAs do not currently dispatch external actions" disclaimer inside David's IME panel.** Fine for an alpha. Bad for a prospect who you're telling "we're in production". Either remove or reword as "Coordinator review required before any external action".

7. **GP escalation badge/filter not surfacing on Cases list.** Memory says shipped 2026-05-15. On prod, the Cases list has Risk filter (All/At Work/Off Work) but no GP-escalation surface. Either feature isn't deployed (check `db:push` ran), or it only triggers under specific data conditions. Skip this from Layer 1 OR fix surface OR seed data that triggers it.

8. **Generic "flagged as low compliance" appearing for Priya & Naomi in the briefing.** Priya is a preventative wellness intake, Naomi just completed a Prevention Check — neither has a compliance issue, but the briefing implies they do. Fix the briefing copy generator to distinguish "no action needed" from "low compliance flag".

### 🟢 Strong content — lean into these verbally

- **Alex briefing tone is excellent:** *"I sent a reminder email last night but still no response — you might need to give David a call."* Sells the 24/7 follow-up product commitment perfectly.
- **"Alex reviewed your active claims overnight. The items above are the only things that need you today."** Use this exact line in your verbal intro.
- **David's IME panel is gorgeous.** Capacity Verdict, key diagnoses, prognosis, 5 numbered IME recommendations with action buttons. This IS your medico-legal showcase.
- **The compliance/recovery split on cases.** Marcus's "Compliance: Non-Compliant" + "Recovery: On Track" is the perfect demonstration of "you can be fully compliant on paper AND have a worker stuck off-track" — exactly Preventli's positioning. After fix #2, this becomes a hero moment.
- **"Chat with Alex" floating button is now visible** on case pages — Talk-with-Alex appears to have shipped (or has at least a placeholder UI). Verify whether it actually does anything before demoing.

### How to triage time before Wednesday

- If you only have 1 hour: do #1 (modal persistence) + #2 (compliance reason). Those are non-negotiable.
- If you have half a day: add #3 (re-seed) + #5 (name) + #6 (disclaimer).
- If GP escalation (#7) doesn't get fixed: remove it from the Layer 1 script below; lead with update-plan + IME panel instead.

---



---

## Pre-meeting (5 min before)

- Open `https://app.preventli.ai` in two tabs:
  - Tab A: `wallara@wallara.com.au` / `wallara01` (Ellen's account)
  - Tab B: drafts of new features in case you want to demo as employer-admin
- Have this doc open on a second screen / phone for the ask script
- Have the **grant role one-pager** (below) ready to email her after

---

## Layer 0 — Opening framing (3 min, before any product demo)

**Why this exists:** Every prospect right now is hearing "we use AI" from every vendor. You need to land your positioning in the first 3 minutes so the demo lands inside a frame, not as another AI tool. This also lets you bring your data-analytics background in as a wedge, not a CV line.

### Three beats. Land them in order.

**Beat 1 — Acknowledge the noise (15 sec)**
> "Quick context before I show you anything. Every WHS and claims vendor right now is saying 'we use AI'. Most of them mean a chatbot or a document summariser. That's not what we're doing. I want to tell you what's actually different about Preventli, because it shapes what you're about to see."

**Beat 2 — Where you came from + why it matters (45 sec)**
> "My background is data analytics. I spent years building systems that surface patterns in operational data — finding the signal in the noise. The thing I learned the hard way: the moment you try to encode every pattern as a rule, the system snaps. Real life doesn't fit the rules. So you either keep adding branches until the logic is uninspectable, or you accept the system can't handle the messy cases — which is most of them. That's the wall every rule-based claims tool hits."

This buys you: (a) credibility — you're not a tinkerer, (b) diagnosis of Ellen's pain — she's TRIED to write the rules, (c) the "why Preventli exists" moment.

**Beat 3 — The architecture you actually built (90 sec)**
> "What I'm building is one layer up from 'we use AI'. It's two layers, separated on purpose:
>
> **The compliance layer is hard rules.** WIRC Act, WorkSafe obligations, certificate windows, notification timing. Anything that's legally required, when, by whom — that lives in a deterministic rules engine. It's auditable. It doesn't hallucinate. If a worker has been off work for X weeks and there's no plan, the rules engine knows.
>
> **The agent layer is judgment.** What to do when a GP goes silent. When the case is technically compliant on paper but the worker is going backwards. Whether to escalate this one or wait another week. Those signals are too messy for a rule tree — different combinations mean different things case by case. That's pattern recognition. That's agent territory.
>
> The rules say 'this must happen'. The agent figures out HOW to make it happen in this specific case, with this specific GP, this specific worker, this specific employer. Both have human review at the points where it matters."

### The one-liner to memorise (use it again later if anyone asks "but how is this different from [other tool]?")

> *"A rules engine can tell you a case IS non-compliant. It can't tell you a case is going to BE non-compliant in four days unless someone moves. That's agent territory — and that's what Preventli does."*

### Bridge into Layer 1

> "Let me show you what that looks like in practice. Four things have shipped since the demo on the 15th, all of them specifically off your feedback."

Then go straight to Layer 1. Don't pause for questions yet — questions land better after they've seen the product.

### If Ellen pushes back on "agents will do something stupid"

You're ready. Your answer:
> "That's the whole reason for separating the two layers. Anything regulated — anything where a wrong action has legal consequences — lives in rules, not in the agent. Anything judgement-based has a human review checkpoint. You'll see it on David's case in a minute — the IME panel has 5 recommended actions, and every single one is a button the coordinator presses, not something the agent does autonomously. The agent SURFACES the recommendation. The human decides. That's the design — and it's the design specifically because of what you're asking."

---

## Layer 1 — Product walkthrough (15 min)

### Opening hook (1 min)
> "Since the last demo on the 15th, we've shipped a lot specifically off your feedback. I want to show you the four pieces that landed, and then I've got one ask about the WorkSafe grant we talked about briefly."

Don't apologise for what's not done. Name what's new.

### The four new things to show

**1. GP escalation detection (1–2 min) — Cases list**
- Show the Cases list. Point at any case that has the GP escalation badge.
- Filter by "GP escalation pending" — show that the system surfaces cases where the doctor is non-responsive.
- Frame: *"This is what we built to address your point about 24/7 follow-up. The system flags it; you don't have to remember."*
- ⚠️ Caveat for yourself: per memory, `db:push` for the per-org threshold column may not have run on prod yet — check the column exists before this section. If badge isn't appearing, skip this and lead with #2.

**2. The Draft RTW Plan auto-draft flow (4–5 min) — Jenna Okafor's case** ⭐ HERO MOMENT

This is the demo's most active moment — you click a button and the system DOES SOMETHING in front of Ellen. Practice this beat.

- Click into **Jenna Okafor** on the Cases list (DSW, wrist injury, modified duties, no plan on file).
- Frame her case for 30 seconds before clicking anything:
  > *"Jenna is back at work on modified duties — splint on her right wrist, no lifting over 3 kilos, no repetitive movements, max 5 hours a day. She's been doing this for three weeks. But there's no formal RTW plan on file — which under WorkSafe Vic obligations is a gap. Watch what happens when I ask Preventli to draft one."*
- Show the **prior-injury pattern callout** on her case summary (left shoulder strain 14 months ago, same role mechanism). One sentence:
  > *"Notice the system has linked this to a prior injury 14 months ago — same role, same mechanism. That's the pattern Preventli surfaces. A rules engine wouldn't connect those two."*
- Click **`Draft RTW Plan`** button.
- Wait for the draft to generate (a few seconds — narrate while it works):
  > *"What the agent is doing right now: reading the current cert restrictions, comparing them against every duty in the Disability Support Worker role, matching suitable duties to her current capacity, and proposing a graduated return schedule. All of that, on the spot."*
- Once drafted, show the draft view: suitable duties (documentation, intake, light supervision), restricted duties (personal care, transfers, hoist), graduated hours, review cadence.
- Click **WorkSafe Vic format** toggle:
  > *"Same plan, rendered in the official WorkSafe Vic template — exactly the form your insurer is going to ask for. Print or PDF, ready to send."*
- Click **Download** (PDF).
- Land the closer:
  > *"From clicking a button to having a WorkSafe-format RTW plan ready for review took 30 seconds. That's the agent layer doing the judgment work — and the coordinator confirms before anything goes out."*

**Also worth a beat (1 min) on Marcus, if time allows:**
- Click into Marcus Tanaka. Show his existing approved RTW plan.
- Show that the "Auto-draft update" button is now enabled (was greyed at last demo — fixed).
- Frame: *"For workers who already have a plan, the same drafter generates an update when capacity changes. Last demo this was broken. Fixed."*

**3. Inbound email ingestion (2 min) — Wallara's tenant address**
- This is the headline product commitment from last meeting.
- Show the architecture verbally: `support+wallara@preventli.ai` (or the per-tenant alias) → Alex matches the email to a worker by name in subject → updates the case.
- If a worked example exists in seed data, walk through it. If not, sketch on the screen: *"Sarah's GP sends a new cert by email; Alex parses, attaches, updates her timeline, flags any change in capacity."*
- Frame: *"This is the operational shift. Your team doesn't chase certificates anymore — they arrive."*

**4. Multi-user / partner workspaces (2 min) — Settings**
- Open Settings → Users. Show that Wallara can invite Michelle, Nicole, and the new OHS officer directly.
- Mention the partner-tier work (WorkBetter as a partner workspace) — frame as *"if you ever bring in an external rehab provider, they get a scoped view too"*.
- Frame: *"You're ready to onboard your team today. I don't need to be in the loop."*

### Where to NOT spend time
- Don't demo: Talk-with-Alex (not built yet — was on the commitment list)
- Don't demo: voice/Zoom calls (v2/v3)
- Don't open the medico-legal IME modal unless she asks — that was demoed already

### Bridge to the grant ask
> "All of this builds toward a bigger picture. WorkSafe Victoria runs a grant program — RTWI, Return to Work Incentives — and we've drafted a submission for Round 3. You're in it. I want to walk you through your role and ask if you're comfortable with it."

---

## Layer 2 — The grant ask (10 min)

### Frame the program (1 min)

> "RTWI is a Victorian WorkSafe program that funds projects designed to improve return-to-work outcomes for injured workers. Our submission is led by **Symmetry** as the primary applicant — they're the established RTW provider partner. **Princes Laundry** is the Year 1 delivery employer. Preventli is the technology layer. The grant is approximately $450K over 18–24 months, of which roughly $220K goes to Preventli to build out the pilot infrastructure."

### Frame Wallara's specific role (2 min)

**Wallara is NOT being asked for money. Wallara is NOT the primary delivery site.**

Wallara is named as:
- **Existing pilot partner** — the live deployment that proves the system works in a real Victorian employer
- **Operational evidence source** — one or two metrics showing what changed once Preventli was in place
- **Reference site** — WorkSafe assessors may want to see a working deployment; that's you
- **Cross-sector peer** for the knowledge-sharing outputs at end of grant

### The three concrete asks (5 min)

Walk through each one slowly. Get a yes/no on each.

**Ask 1 — Permission to be named**
> "Are you comfortable with Wallara being named in the submission as our existing pilot partner? We'd reference Wallara Australia by name in Sections 2, 6, 8, and 10. If you'd prefer 'a Victorian disability services provider' anonymised, that works too — but named is stronger."

**Ask 2 — One operational metric**
> "We need one number. Anything that compares 'before Preventli' to 'now'. The most useful ones would be:
> - Certificate lapse rate (how often certs went missing or expired without renewal)
> - OHS / case-management hours per week per active case
> - Number of active cases being tracked at one time
>
> Even a rough estimate is fine — 'we used to lose track of about 1 in 5 certificates; now it's basically zero' is gold. WorkSafe wants a concrete change, not a precise study."

If she pushes back: *"What's a number you'd be comfortable giving me by Friday?"* Don't leave without an agreed deliverable.

**Ask 3 — Letter of support**
> "The submission includes letters of support from each named partner. It's one page, on Wallara letterhead, confirming three things:
> (a) Wallara has been piloting Preventli since [DATE]
> (b) Wallara endorses the project and will participate as a reference site
> (c) The named metric from ask #2
>
> I can draft it for you and send it across — you just need to review, edit, and sign. Two weeks is plenty of time. Submission deadline is [CHECK ROUND 3 DATE]."

### Optional ask (if she's enthusiastic)
> "Would Wallara's Operations Manager be open to a 15-minute call with WorkSafe assessors if it goes to the assessment stage? Just a reference call. Probably 1 in 3 chance it happens."

### If she hesitates on any ask
- **"Can I think about it?"** → "Yes. Can we schedule a 15-min follow-up Wednesday or Thursday?" Don't leave it open-ended.
- **"I'd need to check with the board / CEO"** → "Of course. What do you need from me to take to them? I can draft a one-page summary of what we're asking."
- **"I'm not sure about the metric"** → "Let's not pick the number today. I'll send you three options to choose from this week."

---

## Layer 3 — Q&A you should be ready for (5 min)

| Question | Short answer |
|---|---|
| "How much of our time will this take?" | "Effectively zero. You're already using it. The metric and letter are the only new work — maybe 2 hours total over a fortnight." |
| "What happens if the grant doesn't get funded?" | "Nothing changes for Wallara. You keep using Preventli as you are now. The grant accelerates what we'd build anyway." |
| "What if it IS funded — does that change our pricing or access?" | "No. Wallara stays on the existing arrangement. The grant funds work for the new Year 1 delivery employer (Princes Laundry), not Wallara." |
| "Will WorkSafe contact us directly?" | "Possibly during assessment — a single reference call. Not a compliance burden. I'd brief you fully before any contact." |
| "Do we get any IP or ownership of what's built?" | "No IP transfer. Wallara gets continuity of access as the pilot site. The knowledge-sharing outputs at end of grant — playbooks, case studies — are open-access, so you can use them however you like." |
| "Can we see the submission?" | "Yes — I'll send the latest draft today/tomorrow. You'll see exactly where you're mentioned." |
| "What's the timeline if it's funded?" | "Funding decision approximately [CHECK] months after submission. Project starts ~3 months after that. We'd loop you in at each stage." |

---

## After the meeting — same-day actions

- [ ] Email Ellen the **grant role one-pager** (extract from this doc — the "Wallara's specific role" section + the three asks)
- [ ] Send the **letter of support draft** if she said yes to ask 3
- [ ] Send the **submission draft** (`docs/rtwi-grant-submission.md`) if she asked to see it
- [ ] Block calendar for the metric follow-up (Wednesday or Thursday)
- [ ] Update `project_wallara_demo_post_meeting.md` memory with what was committed
- [ ] Update `docs/rtwi-grant-submission.md` with whatever specifics Ellen provides (delete placeholders)

---

## What you ARE NOT doing today

- Not building anything new
- Not promising Talk-with-Alex by a date (still unbuilt, big bundle)
- Not negotiating commercial terms (this isn't a sales call)
- Not asking for money

One ask, three deliverables. Get to yes on each.
