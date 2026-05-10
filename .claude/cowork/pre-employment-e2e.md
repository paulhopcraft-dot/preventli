# Pre-Employment Check — End-to-End Cowork Test (single-paste version)

Single self-contained block to paste into Cowork. Fill in the four placeholders before pasting.

---

You are running an end-to-end test of the pre-employment health check flow in Preventli, a workplace claims/compliance platform. After running the scenarios, you will file structured GitHub issues for every failure and commit a report to a branch. Do not attempt to fix any bugs found — file issues only.

ENVIRONMENT
- App URL: https://app.preventli.ai (fall back to https://gpnet3.onrender.com if app.preventli.ai is not yet deployed — note which one you used in the report)
- Repo: <PASTE GH REPO, e.g. paulhopcraft/preventli>
- Partner login email: <PASTE>
- Partner login password: <PASTE>
- Test candidate Gmail address: <PASTE — must be a Gmail your connector can read>
- Test client org (already seeded): Alpine Health
- Test PDF for upload: any small PDF you have (≤10MB), or generate a one-page PDF

BACKGROUND — what is being tested
Five fixes have shipped (or are about to). Confirm each, end-to-end:
1. Partner workspace cases list — clicking a worker's name opens the case detail page, NOT the worker timeline page.
2. Closed cases are excluded from the active partner cases list (worker timeline still shows full history).
3. POST /api/assessments with a job-description file attachment no longer returns 500 — it returns 201 and stores the file URL on the assessment.
4. The candidate-facing form at /check/:token is the multi-page PreEmploymentForm (8 pages), not the short PublicQuestionnaire.
5. Email subject + sign-off use the client org name (Alpine Health), not "Preventli Health Team". The Company Name field on the form is pre-populated from the assessment.

SCENARIOS — run all six. Report PASS / FAIL / BLOCKED per scenario.

S1 — Partner cases list: row click + closed-case filtering
1. Log in as the partner. Click Alpine Health from the clients list.
2. Verify the cases list contains ONLY open cases. Capture a screenshot.
3. Verify Daryl Thompson appears exactly once (his year-old closed case must be filtered out).
4. Click on the worker name "Daryl Thompson". Expect: navigate to /employer/case/<id> (case detail). Capture URL.
5. On a different row, click anywhere except the worker name. Expect: navigate to /employer/case/<id>.
6. Both clicks must NOT land on /workers/<id> (worker timeline).

S2 — Worker timeline access (history must remain reachable)
1. From a worker's case detail, find the link/button to the worker's timeline / history view.
2. Navigate there. Verify the closed case from a year ago is visible.
3. Capture URL and screenshot.

S3 — Create pre-employment check with file attachment
1. From the partner workspace, click + New → Send a check.
2. If prompted, choose Alpine Health as the client.
3. Fill: candidate first name, last name, email = test candidate Gmail, position title (e.g. Care Coordinator), short role description.
4. Attach the test PDF as job description.
5. Submit. Expect HTTP 201, no 500. Capture network response.
6. Verify the new assessment appears in the assessments list and the file URL is on the record (e.g. a "View JD" link or visible URL).
7. Click Send on the new assessment. Expect HTTP 200 and a UI confirmation that email was sent.

S4 — Email branding
1. Open the test candidate's Gmail inbox. Find the pre-employment check email.
2. Capture: From name, subject line, full body.
3. Verify subject is in the form "Alpine Health — Pre-Employment Health Check for <Position Title>" (was "Pre-Employment Health Check — <Position>").
4. Verify body opens with "Alpine Health has invited you to complete a pre-employment health check..." (was generic "Please complete your pre-employment health check...").
5. Verify body sign-off is "— The Alpine Health team" (was "— Preventli Health Team").
6. Verify the link in the email points to https://app.preventli.ai/check/<token> (or gpnet3.onrender.com if app.preventli.ai is not yet live — note which).

S5 — Form click-through and completion
1. Click the secure link in the email. Confirm URL.
2. Verify the page header (avatar + label at top) shows "Alpine Health" (or the client org name), not "Preventli". The first letter avatar should be the org's first letter, not "P".
3. Verify the welcome line says "Alpine Health has invited you to complete a health questionnaire as part of your application for the <Position> role."
4. (Bug #5 — until that ships, the form will be the short single-page PublicQuestionnaire. Once #5 ships, the form should have multi-page navigation across 8 pages: Personal Information, Work History, Occupational Health, Medical Conditions, Functional Capacity, Psychological Wellbeing, Family & Vaccination, Lifestyle & Review. Note in the report which form variant you saw.)
5. Fill minimum required fields. Submit. Verify a success state.

S6 — Assessment status reflects completion
1. Log back in as partner. Navigate to the assessment created in S3.
2. Verify status shows completed (or equivalent terminal state).
3. Verify candidate's submitted responses are visible.

EDGE CASES — run after S1–S6
- E1. Try uploading a non-PDF/DOC/DOCX (e.g. .zip) on a fresh assessment. Expect HTTP 400 with a clear "Only PDF, DOC, or DOCX" message — NOT 500.
- E2. Try uploading a file >10MB. Expect HTTP 400 with a size-limit message — NOT 500.
- E3. After completing the form in S5, click the same email link again. Note what happens. Informational only.
- E4. While filling the form mid-page, reload the page. Verify auto-save (form data persists). Informational only.
- E5. (Tests fix #57.) If S3 returned 500 before this PR landed, capture the full response body now. Expected after fix: a 502 (not 500) with a specific message naming the storage provider and underlying error (e.g. "File storage is misconfigured: AWS_S3_BUCKET not set (provider: s3)"). If you see 500, fix #57 has not deployed; flag in the report.

REPORTING — STRICT FORMAT (this is what gets consumed downstream)

For EVERY scenario or edge case that FAILED or was BLOCKED, file a GitHub issue in the repo above with:
- Title: [E2E pre-employment] S<#>: <one-line symptom>
- Label: e2e-pre-employment (create the label if it doesn't exist; any colour)
- Body — use this exact template (replace placeholders, keep the headings):

  ## Scenario
  S<#> and name

  ## Expected
  one or two sentences

  ## Actual
  one or two sentences

  ## Repro steps
  1.
  2.

  ## Evidence
  - URL where it failed: <url>
  - HTTP status (if relevant): <code>
  - Console errors: <paste, or "none">
  - Network errors: <paste, or "none">
  - Screenshot: <path or "n/a">

  ## Probable code area (best guess)
  <file path : line range, or "unknown">

  ## Suggested fix (if obvious)
  <one or two sentences, or "investigate">

Save a single combined markdown report to tests/e2e-reports/pre-employment-<YYYY-MM-DD>.md in the repo. Include:
- Summary line at top: "X/6 scenarios passing, Y/4 edge cases as expected"
- Full PASS / FAIL / BLOCKED list for all 6 scenarios + 4 edge cases (one row each)
- For each FAIL, a one-paragraph evidence summary
- List of GitHub issue numbers filed (linked)

Commit the report on a NEW branch named e2e-report/pre-employment-<YYYY-MM-DD>. Push the branch. Open a PR titled "E2E pre-employment test — <YYYY-MM-DD>" with the report file as the only changed file. Post a top-level PR comment listing every issue filed by number.

CONSTRAINTS
- DO NOT modify production data beyond what's strictly needed for the test (one assessment per run, one email send).
- DO NOT delete the test assessment afterwards — Paul will inspect it.
- DO NOT attempt to fix any bug found. File issues only.
- DO NOT push to main. The report goes on its own branch via PR.
- If a scenario is BLOCKED (login fails, deploy not yet up, Gmail connector empty), STOP, file a single BLOCKED issue with what's wrong, and skip dependent scenarios. Don't paper over.

CLOSURE
Reply when done with: the PR URL for the report, and the list of issue URLs filed.
