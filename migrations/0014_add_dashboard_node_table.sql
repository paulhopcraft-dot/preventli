-- Build status board — shared with preventli-dashboard repo.
-- Adds the "Node" table (quoted, capital N to match dashboard's Drizzle schema)
-- used by the kanban board at dashboard.preventli.ai.
--
-- Both apps point at the same Postgres; the dashboard's lib/schema.ts and this
-- file must stay aligned on column names + types.

CREATE TABLE IF NOT EXISTS "Node" (
  "id" text PRIMARY KEY,
  "type" text NOT NULL,
  "parent_id" text,
  "title" text NOT NULL,
  "description" text,
  "status" text,
  "owner_type" text,
  "owner_id" text,
  "priority" integer DEFAULT 0,
  "metadata" json,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp
);

COMMENT ON TABLE "Node" IS 'Build status board cards. Shared between Preventli (writes via admin nav + future Alex chat) and preventli-dashboard (reads/writes via Next.js Server Actions).';
COMMENT ON COLUMN "Node"."type" IS 'business | product | idea | bug | feature | chore | question | stage';
COMMENT ON COLUMN "Node"."status" IS 'open | active | complete | dev_request';

-- Seed the 2-level tree the dashboard's queries (lib/queries.ts) expect:
--   business → product → card
-- The business node id matches the existing PREVENTLI_BUSINESS_NODE_ID env var
-- value already in dashboard/.env.local so Paul doesn't have to update env files.
INSERT INTO "Node" ("id", "type", "parent_id", "title", "status", "priority", "created_at", "updated_at")
VALUES
  ('cmn5cg9em000fd74nmfuxd953', 'business', NULL, 'Preventli', 'open', 0, NOW(), NOW()),
  ('preventli-app', 'product', 'cmn5cg9em000fd74nmfuxd953', 'Preventli App', 'open', 0, NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;
