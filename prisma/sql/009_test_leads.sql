-- Test leads (Nov 4, 2026): admins add a lead with a sample onboarding form
-- to try the workflow (lib/test-leads.ts). is_test marks it: test leads are
-- listed with a Test badge, left out of reports and counts, and are the only
-- customers that can be deleted.
--
-- Additive only: the deployed app keeps working until the new code ships.
-- Apply with: npm.cmd run db:apply -- prisma/sql/009_test_leads.sql

ALTER TABLE "vaa_sys"."customers"
    ADD COLUMN "is_test" BOOLEAN NOT NULL DEFAULT false;
