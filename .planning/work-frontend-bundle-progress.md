# Frontend follow-ups bundle — progress

Branch: demo/wallara-seed

- Task 14 (Exit/pre-employment surface + approve): PASS — added Exit Interviews & Pre-Employment section + detail modal with Approve button on EmployerDashboardPage. Approve calls PATCH /api/bookings/:id with status=confirmed (existing endpoint).
- Task 15 (Medical certificates view on case detail): PASS — Medical Certificates subsection on Injury & Diagnosis tab now lists ALL certs (active / expiring soon / expired) from /api/actions/case/:id/certificates-with-status, click row opens documentUrl.
- Task 17 (Talk with an Expert → Talk with Alex): PASS — single string in ChatWidget.tsx replaced.
- Task 18 (Latest cert on injury & diagnosis): PASS (already covered) — Medical Certificates subsection on Injury & Diagnosis tab already surfaced the latest cert with view link; task 15 work expanded this to the full list, latest is the top row.
- Task 19 (Clickable recovery timeline dots): PASS (already implemented) — DynamicRecoveryTimeline.tsx:629-642 already renders clickable Customized dots, opens a modal at lines 1023-1149 showing the cert image, date, week, and capacity. No code change needed.
