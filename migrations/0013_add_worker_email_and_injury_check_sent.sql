-- Add worker_email + injury_check_sent_at columns to worker_cases
-- Supports the employer onboarding flow: the worker's contact email captured at case
-- creation, and a timestamp when the injury-check email is actually sent (used by
-- the success page to render a persistent "sent" confirmation that survives reloads).

ALTER TABLE "worker_cases"
  ADD COLUMN IF NOT EXISTS "worker_email" text,
  ADD COLUMN IF NOT EXISTS "injury_check_sent_at" timestamp;

COMMENT ON COLUMN "worker_cases"."worker_email" IS 'Worker contact email captured at employer case creation. Used to pre-populate the injury-check draft modal.';
COMMENT ON COLUMN "worker_cases"."injury_check_sent_at" IS 'Set when the employer''s injury-check email has actually been sent. Persists the confirmation across page reloads.';
