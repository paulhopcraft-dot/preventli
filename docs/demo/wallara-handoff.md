# Wallara demo handoff

## Access

- URL: https://app.preventli.ai
- Email: `wallara@wallara.com.au`
- Password: `wallara01`
- User: Ellen Burns (People and Culture Manager, role = `employer`)
- Tenant: `org-wallara` (Wallara, kind = `employer`)

## 5-minute demo flow

1. Open https://app.preventli.ai, log in as `wallara@wallara.com.au` / `wallara01`.
2. The employer dashboard loads. Top card greets: *Good morning Ellen, here's your morning brief* — pre-baked coordinator summary covers last night's review, today's actions, and the open caseload.
3. Click into Sarah Chen's case (Wallara worker, lumbar strain, active treatment, week 4). Show:
   - Pre-employment history (cleared ~18 months ago).
   - Diagnosis-scan attachment: MRI lumbar spine (clickable JPEG).
   - 3 medical certificates: initial off-work, week-2 off-work, week-4 light duties — each date-aligned to the injury timeline.
4. Click into Marcus Tanaka's case (rotator cuff, RTW transition). Show:
   - Pre-employment history (cleared ~2 years ago).
   - 2 diagnosis scans (ultrasound + MRI shoulder).
   - 4 medical certificates progressing off-work → restricted → modified-duties-with-restrictions.
   - Active RTW plan (graduated return, suitable duties: admin/supervision, restricted: overhead lifting >5kg / repetitive shoulder use).
5. Open Priya Reddy's case (preventative wellness intake, no claim) — illustrates "we track healthy workers too".
6. Show James O'Brien's exit telehealth booking (completed exit health check, with a 3-year-old pre-employment record bookending the lifecycle).
7. Wrap with the morning briefing card to circle back to the coordinator narrative.

## Data summary

| Worker | Phase | Case type | Highlights |
|---|---|---|---|
| Sarah Chen | active_treatment | injury (WC-WAL-001) | 1 MRI scan, 3 certs |
| Marcus Tanaka | rtw_transition | injury (WC-WAL-002) | 2 scans, 4 certs, 1 RTW plan |
| Priya Reddy | intake | preventative (no claim) | wellness intake |
| James O'Brien | n/a | exit telehealth_booking | completed exit health check |

All four workers have a `preEmploymentAssessments` row with `clearanceLevel = cleared_unconditional` so the history shows up on later cases.

## Cleanup query

To remove the Wallara demo tenant entirely, in FK-safe order:

```sql
-- Find case IDs (used by certificate/attachment cleanup)
WITH wallara_cases AS (
  SELECT id FROM worker_cases WHERE organization_id = 'org-wallara'
), wallara_plans AS (
  SELECT id FROM rtw_plans WHERE organization_id = 'org-wallara'
)
SELECT 1; -- separator

DELETE FROM agent_jobs           WHERE organization_id = 'org-wallara';
DELETE FROM rtw_plan_versions    WHERE plan_id IN (SELECT id FROM rtw_plans WHERE organization_id = 'org-wallara');
DELETE FROM rtw_plans            WHERE organization_id = 'org-wallara';
DELETE FROM medical_certificates WHERE case_id IN (SELECT id FROM worker_cases WHERE organization_id = 'org-wallara');
DELETE FROM case_attachments     WHERE organization_id = 'org-wallara';
DELETE FROM telehealth_bookings  WHERE organization_id = 'org-wallara';
DELETE FROM pre_employment_assessments WHERE organization_id = 'org-wallara';
DELETE FROM worker_cases         WHERE organization_id = 'org-wallara';
DELETE FROM workers              WHERE organization_id = 'org-wallara';
DELETE FROM users                WHERE id = 'user-wallara-ellen';
DELETE FROM organizations        WHERE id = 'org-wallara';
```

## Re-seed

The seed is idempotent. To refresh:

```bash
npm run seed:wallara
```

It will also run automatically on every Render deploy via the boot `npm run seed` step.

## Stable IDs

| Constant | Value |
|---|---|
| `WALLARA_ORG_ID` | `org-wallara` |
| `USER_ELLEN_ID` | `user-wallara-ellen` |
| `WORKER_SARAH_ID` | `worker-wallara-sarah` |
| `WORKER_MARCUS_ID` | `worker-wallara-marcus` |
| `WORKER_PRIYA_ID` | `worker-wallara-priya` |
| `WORKER_JAMES_ID` | `worker-wallara-james` |
| `CASE_SARAH_ID` | `case-wallara-sarah` |
| `CASE_MARCUS_ID` | `case-wallara-marcus` |
| `CASE_PRIYA_ID` | `case-wallara-priya` |
| `RTW_PLAN_MARCUS_ID` | `rtw-plan-wallara-marcus` |
| `AGENT_JOB_BRIEFING_ID` | `agent-job-wallara-briefing` |
