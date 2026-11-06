-- 012: Service Requests and VA connections (Customer Management, Nov 5, 2026).
--
-- tickets gains its service request fields: type (New, Additional,
-- Replacement, Reliever), the phase its candidates add up to, the Service
-- Department Manager it's assigned to, and how it closed. Existing tickets
-- (the onboarding form's) become New tickets in the New phase.
--
-- service_request_candidates: the main and buffer VAs put forward for each VA
-- request (sub-ticket), and where each one is in the workflow.
--
-- va_connections: VAs working for an account. Made when a candidate is
-- marked Started; the legacy CMS's are imported by
-- scripts/import-legacy-customers.ts.
--
-- Additive only; nothing in public.* is touched.
--
-- Apply with: npm.cmd run db:apply -- prisma/sql/012_service_requests_va_connections.sql

CREATE TYPE "vaa_sys"."ServiceRequestType" AS ENUM ('NEW', 'ADDITIONAL', 'REPLACEMENT', 'RELIEVER');
CREATE TYPE "vaa_sys"."ServiceRequestPhase" AS ENUM ('NEW', 'VA_ASSIGNMENT', 'VA_PREPARATION', 'RATE_AGREEMENT', 'KICKOFF_CALL', 'CONNECTION_CALL', 'START_VA', 'CLOSED_WON', 'CLOSED_LOST');
CREATE TYPE "vaa_sys"."CandidateStage" AS ENUM ('VA_PREPARATION', 'RATE_AGREEMENT', 'KICKOFF_CALL', 'CONNECTION_CALL', 'START_VA', 'STARTED', 'DECLINED', 'WITHDRAWN');
CREATE TYPE "vaa_sys"."CandidateRole" AS ENUM ('MAIN', 'BUFFER');
CREATE TYPE "vaa_sys"."VaConnectionStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'STARTED', 'PAUSED', 'CANCELLED', 'TERMINATED', 'UNKNOWN');

ALTER TABLE "vaa_sys"."tickets"
    ADD COLUMN "type" "vaa_sys"."ServiceRequestType" NOT NULL DEFAULT 'NEW',
    ADD COLUMN "phase" "vaa_sys"."ServiceRequestPhase" NOT NULL DEFAULT 'NEW',
    ADD COLUMN "phase_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "manager_email" TEXT,
    ADD COLUMN "department_id" TEXT,
    ADD COLUMN "manager_assigned_at" TIMESTAMP(3),
    ADD COLUMN "manager_assigned_by_email" TEXT,
    ADD COLUMN "closed_at" TIMESTAMP(3),
    ADD COLUMN "closed_by_email" TEXT,
    ADD COLUMN "closed_reason" TEXT;

-- A ticket's phase starts when it was opened.
UPDATE "vaa_sys"."tickets" SET "phase_changed_at" = "created_at";

CREATE INDEX "tickets_phase_idx" ON "vaa_sys"."tickets"("phase");
CREATE INDEX "tickets_manager_email_idx" ON "vaa_sys"."tickets"("manager_email");

CREATE TABLE "vaa_sys"."service_request_candidates" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "va_profile_id" TEXT NOT NULL,
    "va_name" TEXT NOT NULL,
    "va_email" TEXT,
    "role" "vaa_sys"."CandidateRole" NOT NULL DEFAULT 'MAIN',
    "stage" "vaa_sys"."CandidateStage" NOT NULL DEFAULT 'VA_PREPARATION',
    "stage_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by_email" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prep_done_at" TIMESTAMP(3),
    "prep_done_by_email" TEXT,
    "rate_confirmed_at" TIMESTAMP(3),
    "rate_confirmed_by_email" TEXT,
    "kickoff_at" TIMESTAMP(3),
    "kickoff_by_email" TEXT,
    "outcome_at" TIMESTAMP(3),
    "outcome_by_email" TEXT,
    "decline_reason" TEXT,
    "start_date" DATE,
    "started_by_email" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_request_candidates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vaa_sys"."va_connections" (
    "id" TEXT NOT NULL,
    "connection_code" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "ticket_id" TEXT,
    "candidate_id" TEXT,
    "va_profile_id" TEXT,
    "va_external_id" TEXT,
    "va_name" TEXT NOT NULL,
    "status" "vaa_sys"."VaConnectionStatus" NOT NULL,
    "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connection_type" TEXT,
    "service" TEXT,
    "department" TEXT,
    "hours" TEXT,
    "hours_type" TEXT,
    "connection_date" DATE,
    "start_date" DATE,
    "end_date" DATE,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'APP',
    "created_by_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "va_connections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "service_request_candidates_ticket_id_idx" ON "vaa_sys"."service_request_candidates"("ticket_id");
CREATE UNIQUE INDEX "service_request_candidates_request_id_va_profile_id_key" ON "vaa_sys"."service_request_candidates"("request_id", "va_profile_id");
CREATE UNIQUE INDEX "va_connections_connection_code_key" ON "vaa_sys"."va_connections"("connection_code");
CREATE UNIQUE INDEX "va_connections_candidate_id_key" ON "vaa_sys"."va_connections"("candidate_id");
CREATE INDEX "va_connections_customer_id_status_idx" ON "vaa_sys"."va_connections"("customer_id", "status");
CREATE INDEX "va_connections_account_id_status_idx" ON "vaa_sys"."va_connections"("account_id", "status");
CREATE INDEX "va_connections_status_idx" ON "vaa_sys"."va_connections"("status");

ALTER TABLE "vaa_sys"."service_request_candidates" ADD CONSTRAINT "service_request_candidates_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "vaa_sys"."tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vaa_sys"."service_request_candidates" ADD CONSTRAINT "service_request_candidates_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "vaa_sys"."ticket_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vaa_sys"."va_connections" ADD CONSTRAINT "va_connections_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "vaa_sys"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vaa_sys"."va_connections" ADD CONSTRAINT "va_connections_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "vaa_sys"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vaa_sys"."va_connections" ADD CONSTRAINT "va_connections_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "vaa_sys"."tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vaa_sys"."va_connections" ADD CONSTRAINT "va_connections_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "vaa_sys"."service_request_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
