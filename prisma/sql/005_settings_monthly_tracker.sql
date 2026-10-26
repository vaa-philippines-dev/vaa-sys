-- Oct 26, 2026 meeting changes to the onboarding form:
-- - a Monthly work hour type (minimum 60 hours a month by default),
-- - "Will the VA be working with a task tracker?" per VA service,
-- - general settings, starting with the work hour type minimums, editable
--   by admins instead of fixed in code.
--
-- Additive only, like 004: the deployed app keeps working until the new
-- code ships.

ALTER TYPE "vaa_sys"."ScheduleType" ADD VALUE IF NOT EXISTS 'MONTHLY';

ALTER TABLE "vaa_sys"."ticket_requests"
    ADD COLUMN "hours_per_month" DECIMAL(6,2),
    ADD COLUMN "task_tracker" BOOLEAN;

-- One row per setting, e.g. key 'work_hour_minimums' with value
-- {"hoursPerDay": 3, "hoursPerWeek": 15, "hoursPerMonth": 60, "projectHours": 15}.
-- A missing row means the app's built-in defaults.
CREATE TABLE "vaa_sys"."app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by_email" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

-- Closed to Supabase's anon/authenticated API roles, like the other tables.
ALTER TABLE "vaa_sys"."app_settings" ENABLE ROW LEVEL SECURITY;
