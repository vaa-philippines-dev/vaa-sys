-- 013: Request schedules, schedule changes and the ticket import (Nov 6, 2026).
--
-- ticket_requests gains:
--   day_hours  hours for each day of a daily schedule, {"Mon": 8, ..., "Sun": 0}
--   time_zone  the client's time zone for this request (null = the account's)
--   must_haves the onboarding form's "Must-haves or deal breakers"
--
-- tickets gains the request's focal person (name, email, phone, role), which
-- the Service Requests import fills in.
--
-- schedule_changes: every change to a VA request's schedule. A change while
-- the service request is open needs Executive Support's check before the VA
-- can be marked started (lib/request-schedule.ts).
--
-- Additive only; nothing in public.* is touched.
--
-- Apply with: npm.cmd run db:apply -- prisma/sql/013_request_schedules_ticket_import.sql

ALTER TABLE "vaa_sys"."ticket_requests"
    ADD COLUMN "day_hours" JSONB,
    ADD COLUMN "time_zone" TEXT,
    ADD COLUMN "must_haves" TEXT;

ALTER TABLE "vaa_sys"."tickets"
    ADD COLUMN "focal_name" TEXT,
    ADD COLUMN "focal_email" TEXT,
    ADD COLUMN "focal_phone" TEXT,
    ADD COLUMN "focal_role" TEXT;

CREATE TABLE "vaa_sys"."schedule_changes" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by_email" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "phase" TEXT NOT NULL,
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_email" TEXT,
    "review_note" TEXT,

    CONSTRAINT "schedule_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "schedule_changes_ticket_id_idx" ON "vaa_sys"."schedule_changes"("ticket_id");
CREATE INDEX "schedule_changes_request_id_idx" ON "vaa_sys"."schedule_changes"("request_id");
CREATE INDEX "schedule_changes_needs_review_reviewed_at_idx" ON "vaa_sys"."schedule_changes"("needs_review", "reviewed_at");

ALTER TABLE "vaa_sys"."schedule_changes" ADD CONSTRAINT "schedule_changes_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "vaa_sys"."tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vaa_sys"."schedule_changes" ADD CONSTRAINT "schedule_changes_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "vaa_sys"."ticket_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
