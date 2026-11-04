-- Leads import (Nov 4, 2026): admins upload the Leads template to add or
-- update leads at any phase (lib/lead-import.ts). Imported leads never went
-- through the onboarding form, so they have no submission or account:
-- - intake_completed_at: Customer Intake done without the form,
-- - contract_id: the contract picked for a lead that has no account yet
--   (a lead from the form keeps using its account's contract).
--
-- Additive only: the deployed app keeps working until the new code ships.
-- Apply with: npm.cmd run db:apply -- prisma/sql/008_lead_import.sql

ALTER TABLE "vaa_sys"."customers"
    ADD COLUMN "intake_completed_at" TIMESTAMP(3),
    ADD COLUMN "contract_id" TEXT;

ALTER TABLE "vaa_sys"."customers" ADD CONSTRAINT "customers_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "vaa_sys"."contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
