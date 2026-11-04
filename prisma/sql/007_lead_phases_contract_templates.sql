-- Lead Management workflow phases and contract templates (Nov 4, 2026):
-- - every lead moves through Customer Intake → Contract & Billing Initiation
--   → Contract & Payment Confirmation → Customer Success Handoff → New
--   Customer Onboarded. A Special Request (meet the VA first) goes to the
--   handoff before the contract and payment are confirmed.
-- - the facts the phase is worked out from: request type, contract sent,
--   contract and payment confirmed, handoff done (lib/lead-phase.ts),
-- - lead_phase_logs: every phase change,
-- - contracts.template_url: the template link sent to the lead.
--
-- Additive only: the deployed app keeps working until the new code ships.
-- Apply with: npm run db:apply -- prisma/sql/007_lead_phases_contract_templates.sql

CREATE TYPE "vaa_sys"."LeadPhase" AS ENUM (
    'CUSTOMER_INTAKE',
    'CONTRACT_BILLING_INITIATION',
    'CONTRACT_PAYMENT_CONFIRMATION',
    'CUSTOMER_SUCCESS_HANDOFF',
    'NEW_CUSTOMER_ONBOARDED'
);

CREATE TYPE "vaa_sys"."LeadRequestType" AS ENUM ('REGULAR', 'SPECIAL');

ALTER TABLE "vaa_sys"."customers"
    ADD COLUMN "lead_phase" "vaa_sys"."LeadPhase" NOT NULL DEFAULT 'CUSTOMER_INTAKE',
    ADD COLUMN "lead_phase_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "request_type" "vaa_sys"."LeadRequestType" NOT NULL DEFAULT 'REGULAR',
    ADD COLUMN "contract_sent_at" TIMESTAMP(3),
    ADD COLUMN "contract_sent_by_email" TEXT,
    ADD COLUMN "contract_sent_id" TEXT,
    ADD COLUMN "contract_signed_on" DATE,
    ADD COLUMN "contract_confirmed_at" TIMESTAMP(3),
    ADD COLUMN "contract_confirmed_by_email" TEXT,
    ADD COLUMN "handoff_completed_at" TIMESTAMP(3),
    ADD COLUMN "handoff_completed_by_email" TEXT;

CREATE INDEX "customers_lead_phase_idx" ON "vaa_sys"."customers"("lead_phase");

ALTER TABLE "vaa_sys"."customers" ADD CONSTRAINT "customers_contract_sent_id_fkey" FOREIGN KEY ("contract_sent_id") REFERENCES "vaa_sys"."contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "vaa_sys"."lead_phase_logs" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "from_phase" "vaa_sys"."LeadPhase" NOT NULL,
    "to_phase" "vaa_sys"."LeadPhase" NOT NULL,
    "note" TEXT,
    "changed_by_email" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_phase_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "lead_phase_logs_customer_id_changed_at_idx" ON "vaa_sys"."lead_phase_logs"("customer_id", "changed_at");

ALTER TABLE "vaa_sys"."lead_phase_logs" ADD CONSTRAINT "lead_phase_logs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "vaa_sys"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Closed to Supabase's anon/authenticated API roles, like the other tables.
ALTER TABLE "vaa_sys"."lead_phase_logs" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "vaa_sys"."contracts" ADD COLUMN "template_url" TEXT;

-- Leads that already submitted the onboarding form are in Contract & Billing
-- Initiation: nothing after the form has been recorded for them yet. The
-- phase moves from the time of their first submission.
WITH submitted AS (
    SELECT "customer_id", min("submitted_at") AS "submitted_at"
    FROM "vaa_sys"."onboarding_links"
    WHERE "submitted_at" IS NOT NULL
    GROUP BY "customer_id"
),
moved AS (
    UPDATE "vaa_sys"."customers" c
    SET "lead_phase" = 'CONTRACT_BILLING_INITIATION', "lead_phase_changed_at" = s."submitted_at"
    FROM submitted s
    WHERE c."id" = s."customer_id"
    RETURNING c."id", s."submitted_at"
)
INSERT INTO "vaa_sys"."lead_phase_logs" ("id", "customer_id", "from_phase", "to_phase", "note", "changed_by_email", "changed_at")
SELECT gen_random_uuid()::text, "id", 'CUSTOMER_INTAKE', 'CONTRACT_BILLING_INITIATION', 'Onboarding form submitted (set by 007)', 'onboarding-form', "submitted_at"
FROM moved;
