# employer-onboarding-ux-polish

## Purpose

Make the employer "Record a Case + Send an Injury Check" flow recording-ready for the onboarding Loom (video #1). Six surgical UX fixes that turn the current rough flow into something Paul can demo live on `app.preventli.ai` as `jane@arcelectrical.com.au` with no UX gaps. No AI/OCR work — quick wins only.

## Requirements

### 1. Edit-before-send modal on Send Injury Check Email
- Clicking "Send Injury Check Email" no longer fires the email immediately
- Opens a modal pre-filled with the AI-drafted `{to, subject, body}`, all editable
- Modal buttons: `[Cancel]` and `[Send]`
- New endpoint: `POST /api/cases/:id/injury-check/draft` returns the draft payload without sending
- Existing send endpoint accepts the (possibly edited) final payload from the modal
- Timeline event `"Injury Check Sent to <worker>"` recorded on actual send (not on draft)

### 2. Persistent confirmation (not toast)
- After successful send, the button area transforms to a success card:
  > "✓ Injury check sent to `<worker>` at `<timestamp>`. Reminder auto-sent in 24h if no response."
- Card persists until the user navigates away — no auto-dismiss toast

### 3. Visible loading state
- While send is in flight: button text changes to `"Sending…"`, icon visible, button disabled
- Not just an icon swap — the copy must change so the user can see what's happening

### 4. Button copy fix
- Drop the current subtitle: `"Send a personalized check-in email to the worker"`
- Replace with: `"AI-drafted — you review before sending"`

### 5. Case Summary "Unknown Company" bug
- On `/employer/case/:id/success`, the Case Summary currently shows `"Unknown Company"` for `jane@arcelectrical.com.au`
- Should show `"Arc Electrical"` (the tenant the user belongs to)
- Trace tenant context through the case-creation path: `server/storage.ts` + the success page's company lookup query
- Root-cause fix, not a hardcode

### 6. Dashboard parity (Arc Electrical employer dashboard) — **DEFERRED 2026-05-25**

Originally: Arc Electrical employer dashboard at `/` must match the partner dashboard layout, components, and data shape.

**Status:** moved to its own spec — see [agent-specs/employer-dashboard-partner-parity.md](employer-dashboard-partner-parity.md). Scope analysis showed this is a 1.5–2 day rebuild (798-line partner workspace, partner-only endpoints, JWT-swap mechanism), not a polish task. Video #1 onboarding flow is not blocked by dashboard parity (Jane lands at `/` and immediately clicks "+ New Case"), so reqs 1-5 are sufficient for the recording.

## Out of scope

- Any OCR, document scanning, or AI extraction work (that's `medical-cert-ocr-with-doctor` — Spec B)
- Email body content/style improvements beyond making it editable
- New tenant onboarding flows
- Changes to the partner dashboard itself (employer dashboard conforms to it, not the other way around)
- Refactor of the AI draft generation logic — only its surfacing changes

## Code pointers

- `client/src/pages/` — employer flow pages (case detail, success page, dashboard at `/`)
- `client/src/pages/` — partner dashboard (reference for parity check in requirement 6)
- `server/routes.ts` — add the new draft endpoint; locate the existing send endpoint
- `server/storage.ts` — tenant context lookup for the company-name bug (req 5)
- `shared/schema.ts` — `worker_cases`, `tenants`/`organizations`, user→tenant relation (for req 5)
- `client/src/components/ui/dialog.tsx` — modal primitive (req 1)
- Existing injury-check button/component — locate via grep for "Injury Check" or "injury-check"

## Verification

End-to-end manual walkthrough on `app.preventli.ai` logged in as `jane@arcelectrical.com.au`:

1. **Req 1 (edit modal):**
   - Click Send Injury Check Email → modal opens with editable to/subject/body, no email sent yet
   - Edit body → click Send → email actually goes; timeline shows "Injury Check Sent to <worker>"
   - Cancel from modal closes it without sending and without timeline entry

2. **Req 2 (persistent confirmation):**
   - After send, success card visible and stays after 5+ seconds; only disappears on navigation

3. **Req 3 (loading state):**
   - During send: button shows "Sending…" text + disabled state — observable for at least one frame

4. **Req 4 (button copy):**
   - Inspect button area — subtitle reads "AI-drafted — you review before sending" exactly

5. **Req 5 (Unknown Company bug):**
   - Create a case as Jane → navigate to `/employer/case/<id>/success` → Case Summary shows "Arc Electrical", never "Unknown Company"
   - Repeat for at least one other tenant user to confirm it's not hardcoded

6. **Req 6 (dashboard parity):** DEFERRED — see [employer-dashboard-partner-parity.md](employer-dashboard-partner-parity.md). Not gating this spec.

**Failure mode:** any of 1-5 failing = the Loom recording is blocked. All five (originally six) must pass on live before closure.

## Closure

Requirements 1-5 shipped and verified live on `app.preventli.ai` as `jane@arcelectrical.com.au`. Video #1 can be recorded against the live app with no UX gaps. Req 6 deferred to its own spec.
