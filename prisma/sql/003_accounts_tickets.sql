-- vaa-sys: accounts (Part 1 of the onboarding form) and tickets (Part 2).
-- Onboarding submissions stored before this had no account; none existed
-- in the database when this was written.

-- CreateEnum
CREATE TYPE "vaa_sys"."ContactKind" AS ENUM ('PRIMARY', 'SECONDARY');

-- CreateEnum
CREATE TYPE "vaa_sys"."InvoiceContactSource" AS ENUM ('PRIMARY', 'SECONDARY', 'OTHER');

-- CreateEnum
CREATE TYPE "vaa_sys"."PaymentMethod" AS ENUM ('NIS_BANK_TRANSFER', 'PAYONEER', 'WISE', 'CREDIT_CARD');

-- CreateEnum
CREATE TYPE "vaa_sys"."RequestGroup" AS ENUM ('REGULAR', 'EXPERT', 'CASUAL');

-- CreateEnum
CREATE TYPE "vaa_sys"."ScheduleType" AS ENUM ('WEEKLY_FLEXIBLE', 'DAILY_FLEXIBLE', 'DAILY_FIXED');

-- AlterTable
ALTER TABLE "vaa_sys"."onboarding_submissions" ADD COLUMN     "account_id" TEXT;

-- CreateTable
CREATE TABLE "vaa_sys"."accounts" (
    "id" TEXT NOT NULL,
    "account_code" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "dba_name" TEXT,
    "website" TEXT,
    "time_zone" TEXT,
    "invoice_contact_source" "vaa_sys"."InvoiceContactSource" NOT NULL,
    "invoice_contact_name" TEXT,
    "invoice_contact_email" TEXT NOT NULL,
    "payment_method" "vaa_sys"."PaymentMethod" NOT NULL,
    "billing_country" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaa_sys"."account_contacts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "kind" "vaa_sys"."ContactKind" NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT NOT NULL,
    "whatsapp" TEXT,
    "region" TEXT,
    "is_focal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaa_sys"."tickets" (
    "id" TEXT NOT NULL,
    "ticket_number" SERIAL NOT NULL,
    "customer_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "submission_id" TEXT,
    "created_by_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaa_sys"."ticket_requests" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "platform" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "number_of_vas" INTEGER NOT NULL,
    "schedule_type" "vaa_sys"."ScheduleType" NOT NULL,
    "hours_per_week" DECIMAL(5,2),
    "hours_per_day" DECIMAL(4,2),
    "start_time_pht" TEXT,
    "end_time_pht" TEXT,
    "work_days" TEXT[],
    "night_differential" BOOLEAN NOT NULL DEFAULT false,
    "additional_hours_per_day" DECIMAL(4,2),
    "target_start_date" DATE NOT NULL,
    "tasks" TEXT NOT NULL,
    "tools" TEXT,
    "request_group" "vaa_sys"."RequestGroup" NOT NULL DEFAULT 'REGULAR',
    "request_group_set_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_account_code_key" ON "vaa_sys"."accounts"("account_code");

-- CreateIndex
CREATE INDEX "accounts_customer_id_idx" ON "vaa_sys"."accounts"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_contacts_account_id_kind_key" ON "vaa_sys"."account_contacts"("account_id", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_ticket_number_key" ON "vaa_sys"."tickets"("ticket_number");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_submission_id_key" ON "vaa_sys"."tickets"("submission_id");

-- CreateIndex
CREATE INDEX "tickets_customer_id_idx" ON "vaa_sys"."tickets"("customer_id");

-- CreateIndex
CREATE INDEX "tickets_account_id_idx" ON "vaa_sys"."tickets"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_requests_ticket_id_line_no_key" ON "vaa_sys"."ticket_requests"("ticket_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "onboarding_submissions_account_id_key" ON "vaa_sys"."onboarding_submissions"("account_id");

-- AddForeignKey
ALTER TABLE "vaa_sys"."onboarding_submissions" ADD CONSTRAINT "onboarding_submissions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "vaa_sys"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaa_sys"."accounts" ADD CONSTRAINT "accounts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "vaa_sys"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaa_sys"."account_contacts" ADD CONSTRAINT "account_contacts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "vaa_sys"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaa_sys"."tickets" ADD CONSTRAINT "tickets_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "vaa_sys"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaa_sys"."tickets" ADD CONSTRAINT "tickets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "vaa_sys"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaa_sys"."tickets" ADD CONSTRAINT "tickets_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "vaa_sys"."onboarding_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaa_sys"."ticket_requests" ADD CONSTRAINT "ticket_requests_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "vaa_sys"."tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Hand-added (not generated by Prisma) ─────────────────────────────
-- At most one focal contact per account (the app always sets exactly one).
CREATE UNIQUE INDEX "account_contacts_one_focal_per_account" ON "vaa_sys"."account_contacts"("account_id") WHERE "is_focal";

-- Closed to Supabase's anon/authenticated API roles, like the other tables.
ALTER TABLE "vaa_sys"."accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vaa_sys"."account_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vaa_sys"."tickets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vaa_sys"."ticket_requests" ENABLE ROW LEVEL SECURITY;
