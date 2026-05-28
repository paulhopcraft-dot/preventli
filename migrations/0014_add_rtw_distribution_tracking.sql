-- RTW Multi-Party Plan Distribution (2026-05-27, phase 1 schema)
-- Backs the state machine introduced in commit a0de6e2:
--   * rtw_plans.distribution_status — per-plan state machine:
--       'not_distributed' (default) → 'awaiting_responses' → 'all_responded' → 'finalised'
--   * case_contacts.last_distributed_at / responded_at / response_text — per-recipient tracking.
--
-- v1 limitation: per-contact (not per-plan) tracking. A second RTW plan for the
-- same case would inherit stale responses from the first round. Phase 2 will
-- migrate to a sibling rtw_plan_distributions table; the v1 distribute route
-- guards against this by refusing to distribute if another plan on the case
-- is past 'not_distributed'.
--
-- Hand-written (not drizzle:generate) to avoid sweeping in unrelated schema drift
-- on main per .claude memory project_preventli_local_dev_quirks. Pattern matches
-- 0010-0013_add_*.sql.

ALTER TABLE "rtw_plans"
  ADD COLUMN IF NOT EXISTS "distribution_status" text NOT NULL DEFAULT 'not_distributed';

ALTER TABLE "case_contacts"
  ADD COLUMN IF NOT EXISTS "last_distributed_at" timestamp,
  ADD COLUMN IF NOT EXISTS "responded_at" timestamp,
  ADD COLUMN IF NOT EXISTS "response_text" text;

COMMENT ON COLUMN "rtw_plans"."distribution_status" IS 'Multi-party distribution state machine for the plan. Values: not_distributed | awaiting_responses | all_responded | finalised. Approve-plan endpoint refuses status transitions unless this is all_responded.';
COMMENT ON COLUMN "case_contacts"."last_distributed_at" IS 'Timestamp of the most recent successful RTW plan distribution send to this contact. v1: per-contact (overwritten by re-distribute); v2 will move to sibling rtw_plan_distributions table.';
COMMENT ON COLUMN "case_contacts"."responded_at" IS 'Timestamp the contact replied to a distributed RTW plan (manual mark in v1, inbound-email-parsed in v2).';
COMMENT ON COLUMN "case_contacts"."response_text" IS 'Text of the contact''s response, captured manually (v1) by the practitioner pasting into the case-detail responses panel.';
