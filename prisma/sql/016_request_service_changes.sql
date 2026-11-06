-- 016: Service and department changes on VA requests (Nov 6, 2026).
--
-- A VA request's service and department can be changed on its ticket, after
-- a confirmation step. Each change is kept in schedule_changes alongside the
-- schedule changes, as kind SERVICE (before and after: the service and the
-- department). On an open New ticket it waits for Executive Support's check,
-- like a schedule change, and the VA can't be marked started until then.
--
-- Additive only; nothing in public.* is read or written.
--
-- Apply with: npm.cmd run db:apply -- prisma/sql/016_request_service_changes.sql

ALTER TABLE "vaa_sys"."schedule_changes" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'SCHEDULE';
