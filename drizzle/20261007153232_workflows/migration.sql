-- @nestjs/workflows PostgresWorkflowStore schema v1: PostgresWorkflowStore.migrationSql({ statementBreakpoints: true }).
-- @nestjs/workflows: PostgresWorkflowStore's schema "nest_workflows", from version 0 to 1.
-- Run it in one transaction.

CREATE SCHEMA IF NOT EXISTS "nest_workflows";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nest_workflows".migrations (
  version integer PRIMARY KEY,
  name text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nest_workflows".instances (
  id text PRIMARY KEY,
  workflow text NOT NULL,
  version integer NOT NULL,
  parent_id text,
  parent_close text,
  concurrency_key text,
  rate_limit_key text,
  priority integer NOT NULL DEFAULT 0,
  schedule_id text,
  scheduled_at bigint,
  status text NOT NULL,
  input jsonb,
  output jsonb,
  error jsonb,
  wake_at bigint,
  lease_token text,
  lease_owner text,
  lease_until bigint,
  cancel_requested boolean NOT NULL DEFAULT false,
  terminate_requested boolean NOT NULL DEFAULT false,
  cancel_reason text,
  deadline bigint,
  custom_status jsonb,
  signal_cursor bigint NOT NULL,
  runs integer NOT NULL DEFAULT 0,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nest_workflows".journal (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instance_id text NOT NULL REFERENCES "nest_workflows".instances (id) ON DELETE CASCADE,
  name text NOT NULL,
  entry jsonb NOT NULL,
  CONSTRAINT journal_name UNIQUE (instance_id, name)
);
--> statement-breakpoint
CREATE TABLE "nest_workflows".waits (
  instance_id text NOT NULL REFERENCES "nest_workflows".instances (id) ON DELETE CASCADE,
  position integer NOT NULL,
  signal text NOT NULL,
  key text,
  PRIMARY KEY (instance_id, position)
);
--> statement-breakpoint
CREATE TABLE "nest_workflows".signals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL,
  key text,
  dedupe_id text,
  payload jsonb,
  created_at bigint NOT NULL,
  CONSTRAINT signals_dedupe UNIQUE (name, dedupe_id)
);
--> statement-breakpoint
CREATE TABLE "nest_workflows".schedules (
  id text PRIMARY KEY,
  workflow text NOT NULL,
  declared boolean NOT NULL,
  spec jsonb NOT NULL,
  input jsonb,
  paused boolean NOT NULL,
  wake_at bigint,
  state jsonb NOT NULL,
  revision integer NOT NULL,
  lease_token text,
  lease_owner text,
  lease_until bigint,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nest_workflows".rate_limits (
  workflow text NOT NULL,
  key text NOT NULL,
  window_end bigint NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (workflow, key)
);
--> statement-breakpoint
CREATE INDEX instances_due ON "nest_workflows".instances (wake_at) WHERE wake_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX instances_created ON "nest_workflows".instances (created_at, id);
--> statement-breakpoint
CREATE INDEX instances_status ON "nest_workflows".instances (status, updated_at);
--> statement-breakpoint
CREATE INDEX instances_leased ON "nest_workflows".instances (workflow, concurrency_key) WHERE lease_until IS NOT NULL;
--> statement-breakpoint
CREATE INDEX instances_parent ON "nest_workflows".instances (parent_id, created_at) WHERE parent_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX instances_schedule ON "nest_workflows".instances (schedule_id, created_at) WHERE schedule_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX waits_signal ON "nest_workflows".waits (signal, key);
--> statement-breakpoint
CREATE INDEX signals_lookup ON "nest_workflows".signals (name, key, id);
--> statement-breakpoint
CREATE INDEX schedules_due ON "nest_workflows".schedules (wake_at) WHERE wake_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX schedules_workflow ON "nest_workflows".schedules (workflow, id);
--> statement-breakpoint
CREATE INDEX rate_limits_end ON "nest_workflows".rate_limits (window_end);
--> statement-breakpoint
INSERT INTO "nest_workflows".migrations (version, name) VALUES (1, 'initial');
