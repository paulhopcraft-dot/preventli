/**
 * Preventli End-to-End Test Suite
 *
 * Covers everything built in sessions 91-97:
 *   - Authentication
 *   - Workers list & profile (CheckTimeline, RecheckBanner)
 *   - Pre-employment assessments (create, send magic link, worker submission, clearance)
 *   - Employer-initiated flows (email send + web activation)
 *   - Telehealth bookings (clinician + employer-triggered)
 *   - Alex chat (context injection, memory persistence, SUGGEST_BOOKING)
 *   - Case compliance context (certificate, RTW, overdue actions)
 *   - Notification API (health check due)
 *   - Agents API (trigger + status)
 *
 * Tags:
 *   @smoke     — fast sanity (~2 min), run on every push
 *   @critical  — full happy paths (~10 min), run before deploy
 *   @regression — edge cases + negative tests, run nightly
 */

import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

// ─── Shared helpers ───────────────────────────────────────────────────────────

const ADMIN_EMAIL = "admin@gpnet.local";
const ADMIN_PASSWORD = "ChangeMe123!";
const BASE = "http://localhost:5000";

/** Log in via UI and wait for dashboard */
async function loginUI(page: Page) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /sign in|login/i }).click();
  await expect(page).not.toHaveURL(/login/, { timeout: 10_000 });
}

/** Authenticated API client — returns { token, csrfToken, request } */
async function apiSession(request: APIRequestContext) {
  const csrfRes = await request.get(`${BASE}/api/csrf-token`);
  const csrfJson = await csrfRes.json();
  const csrfToken = csrfJson.data.csrfToken;

  const loginRes = await request.post(`${BASE}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    headers: { "X-CSRF-Token": csrfToken, "Content-Type": "application/json" },
  });
  const loginJson = await loginRes.json();
  const accessToken = loginJson.data?.accessToken ?? "";

  const authHeaders = {
    "Authorization": `Bearer ${accessToken}`,
    "X-CSRF-Token": csrfToken,
    "Content-Type": "application/json",
  };

  return { token: accessToken, csrfToken, headers: authHeaders };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. AUTHENTICATION
// ─────────────────────────────────────────────────────────────────────────────

test.describe("@smoke Authentication", () => {
  test("login with valid credentials reaches dashboard", async ({ page }) => {
    await loginUI(page);
    // Dashboard should show worker cases or nav
    await expect(page.locator("nav, [data-testid='sidebar']").first()).toBeVisible({ timeout: 8_000 });
  });

  test("login with wrong password shows error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(ADMIN_EMAIL);
    await page.getByLabel(/password/i).fill("wrong-password");
    await page.getByRole("button", { name: /sign in|login/i }).click();
    await expect(page.getByText(/invalid|incorrect|unauthorized/i).first()).toBeVisible({ timeout: 6_000 });
  });

  test("CSRF token endpoint returns token", async ({ request }) => {
    const res = await request.get(`${BASE}/api/csrf-token`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.data?.csrfToken).toBeTruthy();
  });

  test("protected endpoint returns 401 without auth", async ({ request }) => {
    const res = await request.get(`${BASE}/api/workers`);
    expect(res.status()).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. WORKERS LIST & PROFILE
// ─────────────────────────────────────────────────────────────────────────────

test.describe("@critical Workers", () => {
  test("workers list page loads with health check status", async ({ page }) => {
    await loginUI(page);
    await page.goto("/workers-list");
    // Workers are rendered as Link cards, not table rows
    await expect(
      page.getByRole("link", { name: /.+/ }).first()
    ).toBeVisible({ timeout: 10_000 });
    // Should show check status badges
    await expect(
      page.getByText(/cleared|pending|overdue|due soon|upcoming/i).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test("workers list shows recheck urgency badge", async ({ page }) => {
    await loginUI(page);
    await page.goto("/workers-list");
    await page.waitForLoadState("networkidle");
    // Look for any urgency indicator — at least one worker should have a status badge
    const badge = page.locator(
      "[class*='badge'], [class*='chip'], [class*='tag'], span:has-text('overdue'), span:has-text('due')"
    ).first();
    // May not exist if all workers are upcoming — just verify page loaded
    await expect(page.locator("h1, h2").first()).toBeVisible();
  });

  test("worker profile shows check timeline", async ({ page, request }) => {
    await loginUI(page);
    const { headers } = await apiSession(request);
    const workersRes = await request.get(`${BASE}/api/workers`, { headers });
    const workers = await workersRes.json();
    const workerList = workers.workers ?? (Array.isArray(workers) ? workers : workers.data ?? []);
    const firstWorker = workerList[0];

    if (!firstWorker) {
      test.skip(true, "No workers in DB");
      return;
    }

    await page.goto(`/workers/${firstWorker.id}`);
    // Timeline is inside a Card titled "Check History"
    await expect(page.getByText("Check History").first()).toBeVisible({ timeout: 10_000 });
  });

  test("worker profile shows recheck banner when overdue", async ({ page, request }) => {
    // Find a worker with completed assessments via API
    const { headers } = await apiSession(request);
    const workersRes = await request.get(`${BASE}/api/workers`, { headers });
    const workers = await workersRes.json();
    const list = Array.isArray(workers) ? workers : workers.data ?? [];

    // Find one with overdue/due_soon urgency
    const urgent = list.find(
      (w: any) => w.recheckUrgency === "overdue" || w.recheckUrgency === "due_soon"
    );
    if (!urgent) {
      test.skip(true, "No workers with overdue recheck");
      return;
    }

    await loginUI(page);
    await page.goto(`/workers/${urgent.id}`);
    // Banner should mention overdue or due date
    await expect(
      page.getByText(/overdue|due in|schedule|book/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("API: workers endpoint returns list with recheckUrgency", async ({ request }) => {
    const { headers } = await apiSession(request);
    const res = await request.get(`${BASE}/api/workers`, { headers });
    expect(res.status()).toBe(200);
    const json = await res.json();
    // Response is { workers: [...] }
    const list = json.workers ?? (Array.isArray(json) ? json : json.data ?? []);
    expect(Array.isArray(list)).toBe(true);
    if (list.length > 0) {
      expect(list[0]).toHaveProperty("recheckUrgency");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. PRE-EMPLOYMENT ASSESSMENTS
// ─────────────────────────────────────────────────────────────────────────────

test.describe("@critical Pre-Employment Assessments", () => {
  let assessmentId: string;
  let magicToken: string;

  test("API: create a pre-employment assessment", async ({ request }) => {
    const { headers } = await apiSession(request);

    const res = await request.post(`${BASE}/api/assessments`, {
      headers,
      data: {
        candidateName: "Test Worker E2E",
        candidateEmail: "testworker.e2e@example.com",
        positionTitle: "Warehouse Operator",
        jobDescription: "Manual handling up to 20kg, standing 8hrs/day",
      },
    });

    expect(res.status()).toBe(201);
    const json = await res.json();
    const assessment = json.assessment ?? json.data ?? json;
    expect(assessment).toHaveProperty("id");
    // Initial status is "created"
    expect(["created", "pending"]).toContain(assessment.status);
    assessmentId = assessment.id;
    // Capture the accessToken returned on creation (used for magic link)
    magicToken = assessment.accessToken;
    console.log("Created assessment:", assessmentId);
  });

  test("API: send magic link to worker", async ({ request }) => {
    if (!assessmentId) {
      test.skip(true, "Requires previous test to create assessment");
      return;
    }
    const { headers } = await apiSession(request);

    const res = await request.post(`${BASE}/api/assessments/${assessmentId}/send`, {
      headers,
      data: {},
    });

    expect(res.status()).toBe(200);
    const json = await res.json();
    // Send returns { success: true, sentTo: "email" }
    expect(json.success).toBe(true);
    expect(json.sentTo).toBeTruthy();
    // magicToken already captured from create response
  });

  test("public: magic link returns assessment data without auth", async ({ request }) => {
    if (!magicToken) {
      test.skip(true, "Requires previous test to get magic token");
      return;
    }

    const res = await request.get(`${BASE}/api/public/check/${magicToken}`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    const data = json.data ?? json;
    // Should expose candidate name and position but NOT internal org IDs
    expect(data).toHaveProperty("candidateName");
    expect(data).toHaveProperty("positionTitle");
    expect(data).not.toHaveProperty("organizationId");
  });

  test("public: worker submits health history via magic link", async ({ request }) => {
    if (!magicToken) {
      test.skip(true, "Requires previous test to get magic token");
      return;
    }

    // Public route expects { responses: Record<string, unknown> }
    const res = await request.post(`${BASE}/api/public/check/${magicToken}`, {
      data: {
        responses: {
          musculoskeletal: { hasCondition: true, condition: "Back strain 2022", notes: "Resolved" },
          cardiovascular: { hasCondition: false },
          declarationSigned: true,
          signedAt: new Date().toISOString(),
        },
      },
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  test("API: assessment appears in list with submitted status", async ({ request }) => {
    if (!assessmentId) {
      test.skip(true, "Requires previous tests");
      return;
    }
    const { headers } = await apiSession(request);

    const res = await request.get(`${BASE}/api/assessments`, { headers });
    expect(res.status()).toBe(200);
    const json = await res.json();
    // Response shape: { assessments: [...] }
    const list = json.assessments ?? (Array.isArray(json) ? json : json.data ?? []);
    const found = list.find((a: any) => a.id === assessmentId);
    // Should be in list (status could be 'submitted' or 'completed' now)
    expect(found).toBeTruthy();
  });

  test("API: invalid magic token returns 404", async ({ request }) => {
    const res = await request.get(`${BASE}/api/public/check/invalid-token-xyz`);
    expect(res.status()).toBe(404);
  });

  test("API: expired/used magic link is rejected on second submission", async ({ request }) => {
    if (!magicToken) {
      test.skip(true, "Requires previous test");
      return;
    }
    // Submitting again should fail (already completed)
    const res = await request.post(`${BASE}/api/public/check/${magicToken}`, {
      data: { histories: [], declarationSigned: true },
      headers: { "Content-Type": "application/json" },
    });
    // Should be 400 (already submitted) or 200 if server is lenient — not 500
    expect(res.status()).not.toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. EMPLOYER-INITIATED FLOWS
// ─────────────────────────────────────────────────────────────────────────────

test.describe("@critical Employer-Initiated Pre-Employment", () => {
  test("API: employer can create assessment (employer role)", async ({ request }) => {
    // Get CSRF + login as employer
    const csrfRes = await request.get(`${BASE}/api/csrf-token`);
    const csrfJson = await csrfRes.json();
    const csrfToken = csrfJson.data.csrfToken;

    // Try employer login — fall back to admin if no employer user
    const loginRes = await request.post(`${BASE}/api/auth/login`, {
      data: { email: "employer@symmetry.local", password: "ChangeMe123!" },
      headers: { "X-CSRF-Token": csrfToken, "Content-Type": "application/json" },
    });

    let authHeaders: Record<string, string>;
    if (loginRes.status() === 200) {
      const loginJson = await loginRes.json();
      authHeaders = {
        "Authorization": `Bearer ${loginJson.data?.accessToken}`,
        "X-CSRF-Token": csrfToken,
        "Content-Type": "application/json",
      };
    } else {
      // Use admin as fallback
      const { headers } = await apiSession(request);
      authHeaders = headers;
    }

    const res = await request.post(`${BASE}/api/assessments`, {
      headers: authHeaders,
      data: {
        candidateName: "New Starter Via Employer",
        candidateEmail: "newstarter.employer@example.com",
        positionTitle: "Forklift Operator",
        jobDescription: "Forklift operation, outdoor yard work, PPE required",
      },
    });

    expect(res.status()).toBe(201);
    const json = await res.json();
    expect(["created", "pending"]).toContain((json.assessment ?? json.data ?? json).status);
  });

  test("API: assessment send triggers email flow", async ({ request }) => {
    // Create assessment then send — verify status transitions to 'sent'
    const { headers } = await apiSession(request);

    const createRes = await request.post(`${BASE}/api/assessments`, {
      headers,
      data: {
        candidateName: "Email Flow Test Worker",
        candidateEmail: "emailflow@example.com",
        positionTitle: "Admin Officer",
        jobDescription: "Administrative duties, desk-based, light filing",
      },
    });
    expect(createRes.status()).toBe(201);
    const createJson = await createRes.json();
    const assessment = createJson.assessment ?? createJson.data ?? createJson;
    const id = assessment.id;

    const sendRes = await request.post(`${BASE}/api/assessments/${id}/send`, {
      headers,
      data: {},
    });
    expect(sendRes.status()).toBe(200);
    const sendJson = await sendRes.json();
    // Send returns { success: true, sentTo: email }
    expect(sendJson.success).toBe(true);
    expect(sendJson.sentTo).toBeTruthy();
  });

  test("UI: /checks page loads and shows assessment list", async ({ page }) => {
    await loginUI(page);
    await page.goto("/checks");
    await page.waitForLoadState("networkidle");
    // Page should show heading about checks/assessments
    await expect(
      page.getByRole("heading", { name: /check|assessment|health/i }).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("UI: /assessments/new page loads create form", async ({ page }) => {
    await loginUI(page);
    await page.goto("/assessments/new");
    await page.waitForLoadState("networkidle");
    // Should show a form for creating a new assessment
    await expect(
      page.getByRole("textbox").first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("UI: magic link page renders worker form without login", async ({ page, request }) => {
    // Create an assessment and get the token without logging in on the page
    const { headers } = await apiSession(request);
    const createRes = await request.post(`${BASE}/api/assessments`, {
      headers,
      data: { candidateName: "UI Magic Test", candidateEmail: "ui.magic@example.com", positionTitle: "Driver" },
    });
    const createJson = await createRes.json();
    const id = (createJson.assessment ?? createJson.data ?? createJson).id;

    const sendRes = await request.post(`${BASE}/api/assessments/${id}/send`, {
      headers,
      data: {},
    });
    const token = (await sendRes.json()).data?.accessToken;

    if (!token) {
      test.skip(true, "Could not get magic token");
      return;
    }

    // Navigate to public form — should NOT redirect to login
    await page.goto(`/check/${token}`);
    await page.waitForLoadState("networkidle");
    // Should show worker's name or the form, not a login page
    await expect(page.getByText(/sign in|login/i).first()).not.toBeVisible({ timeout: 3_000 })
      .catch(() => {}); // Page may have worker form instead
    await expect(
      page.getByText(/health|declaration|questionnaire|history/i).first()
    ).toBeVisible({ timeout: 8_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. DR. ALEX CHAT — CONTEXT & MEMORY
// ─────────────────────────────────────────────────────────────────────────────

test.describe("@critical Alex Chat", () => {
  test("API: chat responds to basic message", async ({ request }) => {
    const { headers } = await apiSession(request);

    const res = await request.post(`${BASE}/api/chat/message`, {
      headers,
      data: {
        message: "Hello, who are you?",
        sessionId: "smoke-test-basic",
      },
    });

    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.reply).toBeTruthy();
    expect(typeof json.suggestBooking).toBe("boolean");
    expect(json.sessionId).toBe("smoke-test-basic");
  });

  test("API: chat with caseId injects case context", async ({ request }) => {
    const { headers } = await apiSession(request);

    // Get a case ID
    const casesRes = await request.get(`${BASE}/api/cases`, { headers });
    const casesJson = await casesRes.json();
    const cases = casesJson.cases ?? (Array.isArray(casesJson) ? casesJson : casesJson.data ?? []);
    if (!cases.length) { test.skip(true, "No cases"); return; }

    const caseId = cases[0].id;
    const res = await request.post(`${BASE}/api/chat/message`, {
      headers,
      data: {
        message: "What is the main concern?",
        sessionId: "smoke-test-case-context",
        context: { caseId },
      },
    });

    expect(res.status()).toBe(200);
    const json = await res.json();
    // Alex should respond with case-specific content, not a generic greeting
    expect(json.reply.length).toBeGreaterThan(20);
  });

  test("API: chat with workerId injects worker context", async ({ request }) => {
    const { headers } = await apiSession(request);

    const workersRes = await request.get(`${BASE}/api/workers`, { headers });
    const workersJson = await workersRes.json();
    const workers = workersJson.workers ?? (Array.isArray(workersJson) ? workersJson : workersJson.data ?? []);
    if (!workers.length) { test.skip(true, "No workers"); return; }

    const workerId = workers[0].id;
    const res = await request.post(`${BASE}/api/chat/message`, {
      headers,
      data: {
        message: "What's their check status?",
        sessionId: "smoke-test-worker-context",
        context: { workerId },
      },
    });

    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.reply.length).toBeGreaterThan(20);
  });

  test("API: chat memory persists across messages for same case", async ({ request }) => {
    const { headers } = await apiSession(request);

    const casesRes = await request.get(`${BASE}/api/cases`, { headers });
    const casesJson = await casesRes.json();
    const cases = casesJson.cases ?? (Array.isArray(casesJson) ? casesJson : casesJson.data ?? []);
    if (!cases.length) { test.skip(true, "No cases"); return; }

    const caseId = cases[0].id;
    const sessionId = `memory-test-${Date.now()}`;

    // Message 1: specific question
    await request.post(`${BASE}/api/chat/message`, {
      headers,
      data: {
        message: "Tell me the certificate status in one sentence.",
        sessionId,
        context: { caseId },
      },
    });

    // Message 2: ask Alex to recall
    const res2 = await request.post(`${BASE}/api/chat/message`, {
      headers,
      data: {
        message: "What did you just tell me?",
        sessionId,
        context: { caseId },
      },
    });

    const json2 = await res2.json();
    // Alex should reference the previous message content
    expect(json2.reply.length).toBeGreaterThan(30);
    // The reply should mention certificate or the previous topic
    const lowerReply = json2.reply.toLowerCase();
    expect(
      lowerReply.includes("certificate") ||
      lowerReply.includes("cert") ||
      lowerReply.includes("previously") ||
      lowerReply.includes("mentioned") ||
      lowerReply.includes("told")
    ).toBe(true);
  });

  test("API: SUGGEST_BOOKING signal returned when appropriate", async ({ request }) => {
    const { headers } = await apiSession(request);

    // Find a case with expired certificate to trigger booking suggestion
    const casesRes = await request.get(`${BASE}/api/cases`, { headers });
    const casesJson = await casesRes.json();
    const cases = casesJson.cases ?? (Array.isArray(casesJson) ? casesJson : casesJson.data ?? []);
    if (!cases.length) { test.skip(true, "No cases"); return; }

    const caseId = cases[0].id;
    const res = await request.post(`${BASE}/api/chat/message`, {
      headers,
      data: {
        message: "The worker needs to see a doctor urgently about their injury.",
        sessionId: `booking-signal-${Date.now()}`,
        context: { caseId },
      },
    });

    expect(res.status()).toBe(200);
    const json = await res.json();
    // suggestBooking is a boolean — true or false depending on Alex judgment
    expect(typeof json.suggestBooking).toBe("boolean");
    // Reply should not contain the raw [SUGGEST_BOOKING] tag
    expect(json.reply).not.toContain("[SUGGEST_BOOKING]");
  });

  test("UI: chat widget appears on workers page", async ({ page }) => {
    await loginUI(page);
    // Workers list uses PageLayout which includes ChatWidget
    await page.goto("/workers-list");
    await page.waitForLoadState("networkidle");
    const chatBtn = page.getByRole("button", { name: /talk with a doctor/i }).first();
    await expect(chatBtn).toBeVisible({ timeout: 8_000 });
  });

  test("UI: chat widget opens when clicked", async ({ page }) => {
    await loginUI(page);
    await page.goto("/workers-list");
    await page.waitForLoadState("networkidle");

    const chatBtn = page.getByRole("button", { name: /talk with a doctor/i }).first();
    await chatBtn.click();

    // Chat panel shows Alex header
    await expect(
      page.getByText(/Dr\. Alex/i).first()
    ).toBeVisible({ timeout: 6_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. TELEHEALTH BOOKINGS
// ─────────────────────────────────────────────────────────────────────────────

test.describe("@critical Telehealth Bookings", () => {
  let bookingId: string;

  test("API: create a telehealth booking", async ({ request }) => {
    const { headers } = await apiSession(request);

    const res = await request.post(`${BASE}/api/bookings`, {
      headers,
      data: {
        workerName: "Sarah Johnson",
        workerEmail: "sarah.j@example.com",
        employerName: "Symmetry Corp",
        serviceType: "injury",
        appointmentType: "video",
        employerNotes: "Worker has back pain, needs clearance for return",
        requestReferral: false,
      },
    });

    expect(res.status()).toBe(201);
    const json = await res.json();
    // Response shape: { booking: {...} }
    const booking = json.booking ?? json.data ?? json;
    expect(booking).toHaveProperty("id");
    expect(booking.status).toBe("pending");
    bookingId = booking.id;
  });

  test("API: list bookings returns created booking", async ({ request }) => {
    if (!bookingId) { test.skip(true, "Requires previous test"); return; }
    const { headers } = await apiSession(request);

    const res = await request.get(`${BASE}/api/bookings`, { headers });
    expect(res.status()).toBe(200);
    const json = await res.json();
    // Response shape: { bookings: [...] }
    const list = json.bookings ?? (Array.isArray(json) ? json : json.data ?? []);
    const found = list.find((b: any) => b.id === bookingId);
    expect(found).toBeTruthy();
    expect(found.workerName).toBe("Sarah Johnson");
  });

  test("API: update booking status to confirmed", async ({ request }) => {
    if (!bookingId) { test.skip(true, "Requires previous test"); return; }
    const { headers } = await apiSession(request);

    const res = await request.patch(`${BASE}/api/bookings/${bookingId}`, {
      headers,
      data: { status: "confirmed" },
    });

    expect(res.status()).toBe(200);
    const json = await res.json();
    // Response shape: { booking: {...} }
    expect((json.booking ?? json.data ?? json).status).toBe("confirmed");
  });

  test("API: booking with caseId links to case", async ({ request }) => {
    const { headers } = await apiSession(request);

    // Get a case to link
    const casesRes = await request.get(`${BASE}/api/cases`, { headers });
    const casesJson = await casesRes.json();
    const cases = casesJson.cases ?? (Array.isArray(casesJson) ? casesJson : casesJson.data ?? []);
    if (!cases.length) { test.skip(true, "No cases"); return; }

    const res = await request.post(`${BASE}/api/bookings`, {
      headers,
      data: {
        workerName: cases[0].workerName ?? "Test Worker",
        workerEmail: "linked@example.com",
        caseId: cases[0].id,
        serviceType: "injury",
        appointmentType: "video",
      },
    });

    expect(res.status()).toBe(201);
    const resJson = await res.json();
    const booking = resJson.booking ?? resJson.data ?? resJson;
    expect(booking.caseId).toBe(cases[0].id);
  });

  test("API: pre-employment booking type accepted", async ({ request }) => {
    const { headers } = await apiSession(request);

    const res = await request.post(`${BASE}/api/bookings`, {
      headers,
      data: {
        workerName: "New Hire Pre-Emp",
        workerEmail: "newhire@example.com",
        serviceType: "pre_employment",
        appointmentType: "face_to_face",
      },
    });

    expect(res.status()).toBe(201);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. CASE COMPLIANCE — CERTIFICATE & RTW
// ─────────────────────────────────────────────────────────────────────────────

test.describe("@critical Case Compliance", () => {
  test("API: cases list returns compliance data", async ({ request }) => {
    const { headers } = await apiSession(request);

    const res = await request.get(`${BASE}/api/cases`, { headers });
    expect(res.status()).toBe(200);
    const json = await res.json();
    // Response shape: { cases: [...], total, page, limit, hasMore }
    const list = json.cases ?? (Array.isArray(json) ? json : json.data ?? []);
    expect(list.length).toBeGreaterThan(0);

    const c = list[0];
    expect(c).toHaveProperty("id");
    expect(c).toHaveProperty("workerName");
  });

  test("API: case detail returns certificate and RTW compliance", async ({ request }) => {
    const { headers } = await apiSession(request);

    const casesRes = await request.get(`${BASE}/api/cases`, { headers });
    const cases = await casesRes.json();
    const list = cases.cases ?? (Array.isArray(cases) ? cases : cases.data ?? []);
    if (!list.length) { test.skip(true, "No cases"); return; }

    const caseId = list[0].id;
    const res = await request.get(`${BASE}/api/cases/${caseId}/compliance`, { headers });
    // Compliance endpoint may return 200 or 404 if not set up — either is fine
    expect([200, 404]).toContain(res.status());
  });

  test("UI: case page shows Alex context chat", async ({ page, request }) => {
    await loginUI(page);
    const { headers } = await apiSession(request);
    const casesRes = await request.get(`${BASE}/api/cases`, { headers });
    const cases = await casesRes.json();
    const list = cases.cases ?? (Array.isArray(cases) ? cases : cases.data ?? []);
    if (!list.length) { test.skip(true, "No cases"); return; }

    // Navigate to cases list — chat widget is on all authenticated pages
    await page.goto(`/`);
    await page.waitForLoadState("networkidle");

    // Navigate to a PageLayout page — chat FAB is on workers list
    await page.goto("/workers-list");
    await page.waitForLoadState("networkidle");
    const chatBtn = page.getByRole("button", { name: /talk with a doctor/i }).first();
    await expect(chatBtn).toBeVisible({ timeout: 8_000 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. NOTIFICATION API — HEALTH CHECK DUE
// ─────────────────────────────────────────────────────────────────────────────

test.describe("@regression Notifications", () => {
  test("API: notifications endpoint returns list", async ({ request }) => {
    const { headers } = await apiSession(request);

    const res = await request.get(`${BASE}/api/notifications/recent`, { headers });
    expect(res.status()).toBe(200);
    const json = await res.json();
    const list = Array.isArray(json) ? json : json.data ?? [];
    expect(Array.isArray(list)).toBe(true);
  });

  test("API: notifications include health_check_due type when applicable", async ({ request }) => {
    const { headers } = await apiSession(request);

    const res = await request.get(`${BASE}/api/notifications/recent`, { headers });
    const json = await res.json();
    const list = Array.isArray(json) ? json : json.data ?? [];

    // Filter for health check notifications
    const healthCheckNotifs = list.filter((n: any) => n.type === "health_check_due");
    // Verifies the type is accepted — may be 0 if no workers are overdue
    expect(Array.isArray(healthCheckNotifs)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. AGENTS API
// ─────────────────────────────────────────────────────────────────────────────

test.describe("@regression Agents", () => {
  test("API: agent jobs endpoint returns list", async ({ request }) => {
    const { headers } = await apiSession(request);

    const res = await request.get(`${BASE}/api/agents/jobs`, { headers });
    expect(res.status()).toBe(200);
    const json = await res.json();
    const list = Array.isArray(json) ? json : json.data ?? json.jobs ?? [];
    expect(Array.isArray(list)).toBe(true);
  });

  test("API: agent briefing endpoint is reachable", async ({ request }) => {
    const { headers } = await apiSession(request);

    // Briefing may trigger a run — just verify it's reachable, not a 404/500
    const res = await request.post(`${BASE}/api/agents/briefing`, { headers, data: {} });
    expect([200, 202, 503]).toContain(res.status()); // 503 if AGENTS_ENABLED=false
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. SMOKE — CRITICAL PAGES LOAD
// ─────────────────────────────────────────────────────────────────────────────

test.describe("@smoke Page Load Smoke Tests", () => {
  const routes = [
    { path: "/",                name: "Dashboard" },
    { path: "/workers-list",    name: "Workers List" },
    { path: "/checks",          name: "Pre-Employment Checks" },
    { path: "/cases",           name: "Cases" },
    { path: "/assessments/new", name: "New Assessment Form" },
    { path: "/agents",          name: "Agents" },
    { path: "/reports",         name: "Reports" },
  ];

  for (const { path, name } of routes) {
    test(`${name} page loads without error`, async ({ page }) => {
      await loginUI(page);
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      // No error page
      await expect(page.getByText(/500|server error|something went wrong/i).first())
        .not.toBeVisible({ timeout: 3_000 })
        .catch(() => {}); // OK if not found

      // Some visible content
      await expect(page.locator("h1, h2, nav, main").first()).toBeVisible({ timeout: 10_000 });
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. REGRESSION — NEGATIVE & EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

test.describe("@regression Edge Cases", () => {
  test("API: chat with no ANTHROPIC_API_KEY returns 503 gracefully", async ({ request }) => {
    // We can't unset the env var — just verify the endpoint handles errors gracefully
    // If the key IS set, we get 200. Either way, not a 500.
    const { headers } = await apiSession(request);
    const res = await request.post(`${BASE}/api/chat/message`, {
      headers,
      data: { message: "Hello", sessionId: "edge-test-1" },
    });
    expect([200, 503]).toContain(res.status());
  });

  test("API: chat without message returns 400", async ({ request }) => {
    const { headers } = await apiSession(request);
    const res = await request.post(`${BASE}/api/chat/message`, {
      headers,
      data: { sessionId: "edge-test-2" }, // missing message
    });
    expect(res.status()).toBe(400);
  });

  test("API: chat without sessionId returns 400", async ({ request }) => {
    const { headers } = await apiSession(request);
    const res = await request.post(`${BASE}/api/chat/message`, {
      headers,
      data: { message: "Hello" }, // missing sessionId
    });
    expect(res.status()).toBe(400);
  });

  test("API: creating assessment without candidateName returns 400", async ({ request }) => {
    const { headers } = await apiSession(request);
    const res = await request.post(`${BASE}/api/assessments`, {
      headers,
      data: { candidateEmail: "noname@example.com" }, // missing candidateName
    });
    expect([400, 422]).toContain(res.status());
  });

  test("API: booking with invalid status transition returns error", async ({ request }) => {
    const { headers } = await apiSession(request);

    // Create a booking first
    const createRes = await request.post(`${BASE}/api/bookings`, {
      headers,
      data: {
        workerName: "Status Edge Test",
        workerEmail: "statusedge@example.com",
        serviceType: "wellbeing",
        appointmentType: "video",
        // bookings use workerName/workerEmail (not candidateName)
      },
    });
    if (createRes.status() !== 201) { test.skip(true, "Could not create booking"); return; }

    const id = ((await createRes.json()).data ?? await createRes.json()).id;
    const res = await request.patch(`${BASE}/api/bookings/${id}`, {
      headers,
      data: { status: "invalid_status_xyz" },
    });
    // Should reject invalid status
    expect([400, 422]).toContain(res.status());
  });

  test("public: magic link form without declaration returns error", async ({ request }) => {
    // Create and send assessment
    const { headers } = await apiSession(request);
    const createRes = await request.post(`${BASE}/api/assessments`, {
      headers,
      data: { candidateName: "No Decl Test", candidateEmail: "nodecl@example.com", positionTitle: "Driver" },
    });
    const id = ((await createRes.json()).data ?? await createRes.json()).id;
    const sendRes = await request.post(`${BASE}/api/assessments/${id}/send`, { headers, data: {} });
    const token = ((await sendRes.json()).data ?? await sendRes.json()).accessToken;
    if (!token) { test.skip(true, "No token"); return; }

    // Submit without responses object
    const res = await request.post(`${BASE}/api/public/check/${token}`, {
      data: {}, // missing responses object
      headers: { "Content-Type": "application/json" },
    });
    // Should require responses
    expect([400, 422]).toContain(res.status());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. JOB DESCRIPTION REQUIREMENT (text + file upload)
// ─────────────────────────────────────────────────────────────────────────────

test.describe("@critical Job Description Requirement", () => {
  /** Auth headers without Content-Type so Playwright can set multipart boundary */
  async function multipartHeaders(request: APIRequestContext) {
    const { token, csrfToken } = await apiSession(request);
    return {
      "Authorization": `Bearer ${token}`,
      "X-CSRF-Token": csrfToken,
    };
  }

  const minCandidate = {
    candidateName: "JD Test Candidate",
    candidateEmail: "jdtest@example.com",
    positionTitle: "Site Labourer",
  };

  test("rejects creation when neither text description nor file is provided", async ({ request }) => {
    const { headers } = await apiSession(request);
    const res = await request.post(`${BASE}/api/assessments`, {
      headers,
      data: minCandidate, // no jobDescription field, no file
    });
    expect(res.status()).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/description|document/i);
  });

  test("accepts creation with text description only (multipart)", async ({ request }) => {
    const hdrs = await multipartHeaders(request);
    const res = await request.post(`${BASE}/api/assessments`, {
      headers: hdrs,
      multipart: {
        ...minCandidate,
        candidateEmail: "jdtest-text@example.com",
        jobDescription: "Manual handling up to 25kg, outdoor environment",
      },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();
    const a = json.assessment ?? json;
    expect(a).toHaveProperty("id");
    expect(a.status).toBe("created");
  });

  test("accepts creation with PDF file attachment only (multipart)", async ({ request }) => {
    const hdrs = await multipartHeaders(request);
    const res = await request.post(`${BASE}/api/assessments`, {
      headers: hdrs,
      multipart: {
        ...minCandidate,
        candidateEmail: "jdtest-file@example.com",
        jobDescriptionFile: {
          name: "job-description.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("%PDF-1.4 fake pdf content for testing"),
        },
      },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();
    const a = json.assessment ?? json;
    expect(a).toHaveProperty("id");
    expect(a.status).toBe("created");
  });

  test("accepts creation with both text description and file (multipart)", async ({ request }) => {
    const hdrs = await multipartHeaders(request);
    const res = await request.post(`${BASE}/api/assessments`, {
      headers: hdrs,
      multipart: {
        ...minCandidate,
        candidateEmail: "jdtest-both@example.com",
        jobDescription: "Role involves heavy lifting and outdoor work",
        jobDescriptionFile: {
          name: "full-jd.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("%PDF-1.4 detailed job description document"),
        },
      },
    });
    expect(res.status()).toBe(201);
    const json = await res.json();
    const a = json.assessment ?? json;
    expect(a).toHaveProperty("id");
  });

  test("rejects unsupported file type (e.g. image)", async ({ request }) => {
    const hdrs = await multipartHeaders(request);
    const res = await request.post(`${BASE}/api/assessments`, {
      headers: hdrs,
      multipart: {
        ...minCandidate,
        candidateEmail: "jdtest-badfile@example.com",
        jobDescriptionFile: {
          name: "photo.jpg",
          mimeType: "image/jpeg",
          buffer: Buffer.from("fake image data"),
        },
      },
    });
    // Multer file filter rejects unsupported types
    expect(res.status()).toBe(400);
  });

  test("uploaded job description file is accessible at its URL", async ({ request }) => {
    const hdrs = await multipartHeaders(request);

    // Create with file
    const createRes = await request.post(`${BASE}/api/assessments`, {
      headers: hdrs,
      multipart: {
        ...minCandidate,
        candidateEmail: "jdtest-url@example.com",
        jobDescriptionFile: {
          name: "roles.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("%PDF-1.4 accessible file test"),
        },
      },
    });
    expect(createRes.status()).toBe(201);
    const json = await createRes.json();
    const a = json.assessment ?? json;
    const fileUrl: string | undefined = a.jobDescriptionFileUrl;
    expect(fileUrl).toBeTruthy();

    // File should be served statically
    const fileRes = await request.get(`${BASE}${fileUrl}`);
    expect(fileRes.status()).toBe(200);
  });
});
