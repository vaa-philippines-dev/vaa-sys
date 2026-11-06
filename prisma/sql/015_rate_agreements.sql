-- 015: Rate Agreements (Nov 6, 2026).
--
-- One row per VA moved to Rate Agreement on a service request
-- (lib/rate-agreements.ts). An HR Manager assigns it to an HR Specialist,
-- who sets the terms (training or performance bond, night differential,
-- incremental wage increase) and records each step: Prepared by HR, Schedule
-- confirmation by CS, Acknowledgement by Payroll, Sent to VA (with the date),
-- VA Acknowledged. It's cancelled with its ticket or VA. No rate is stored:
-- the page shows the service's confidential VA Base Rate to rate viewers.
--
-- VAs already in Rate Agreement get a row, waiting for HR.
--
-- Additive; nothing in public.* is read or written.
--
-- Apply with: npm.cmd run db:apply -- prisma/sql/015_rate_agreements.sql

CREATE TYPE "vaa_sys"."RateAgreementStatus" AS ENUM ('WAITING', 'PREPARED', 'SCHEDULE_CONFIRMED', 'PAYROLL_ACKNOWLEDGED', 'SENT_TO_VA', 'VA_ACKNOWLEDGED', 'CANCELLED');
CREATE TYPE "vaa_sys"."RateAgreementBond" AS ENUM ('NONE', 'TRAINING', 'PERFORMANCE', 'BOTH');

CREATE TABLE "vaa_sys"."rate_agreements" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "candidate_id" TEXT NOT NULL,
    "status" "vaa_sys"."RateAgreementStatus" NOT NULL DEFAULT 'WAITING',
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_to_email" TEXT,
    "assigned_by_email" TEXT,
    "assigned_at" TIMESTAMP(3),
    "bond" "vaa_sys"."RateAgreementBond",
    "night_differential" BOOLEAN,
    "incremental_wage" BOOLEAN,
    "notes" TEXT,
    "prepared_at" TIMESTAMP(3),
    "prepared_by_email" TEXT,
    "schedule_confirmed_at" TIMESTAMP(3),
    "schedule_confirmed_by_email" TEXT,
    "payroll_ack_at" TIMESTAMP(3),
    "payroll_ack_by_email" TEXT,
    "sent_on" DATE,
    "sent_by_email" TEXT,
    "va_ack_at" TIMESTAMP(3),
    "va_ack_by_email" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_agreements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "rate_agreements_candidate_id_key" ON "vaa_sys"."rate_agreements"("candidate_id");
CREATE INDEX "rate_agreements_ticket_id_idx" ON "vaa_sys"."rate_agreements"("ticket_id");
CREATE INDEX "rate_agreements_status_idx" ON "vaa_sys"."rate_agreements"("status");
CREATE INDEX "rate_agreements_assigned_to_email_idx" ON "vaa_sys"."rate_agreements"("assigned_to_email");

ALTER TABLE "vaa_sys"."rate_agreements" ADD CONSTRAINT "rate_agreements_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "vaa_sys"."tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vaa_sys"."rate_agreements" ADD CONSTRAINT "rate_agreements_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "vaa_sys"."ticket_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vaa_sys"."rate_agreements" ADD CONSTRAINT "rate_agreements_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "vaa_sys"."service_request_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "vaa_sys"."rate_agreements" ("id", "ticket_id", "request_id", "candidate_id", "status_changed_at", "updated_at")
SELECT 'ra' || substr(md5(c.id), 1, 23), c.ticket_id, c.request_id, c.id, c.stage_changed_at, CURRENT_TIMESTAMP
FROM "vaa_sys"."service_request_candidates" c
WHERE c.stage = 'RATE_AGREEMENT';
