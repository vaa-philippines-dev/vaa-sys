-- vaa-sys module 1: Customer Management foundation, and Customers &
-- Accounts parity with the legacy Apps Script CMS.
--
-- - the legacy CMS roles on access_users, with a Service Manager's
--   department (a public.departments id)
-- - setting_options: the legacy "Settings" lookup lists, seeded with the
--   legacy defaults (SheetSetup.js _seedSettings). Departments and services
--   are NOT copied here: they are read from Workforce (public.departments,
--   public.skills via public.department_skills).
-- - activity_logs: one generic audit trail for every module
-- - customers: CS Specialist, payment date, Inactive, termination and
--   reactivation counts, pending review
-- - customer_takeovers, customer_account_notes
-- - accounts: status, returning flag, category/type/country-region,
--   seller onboarding link, contract link and contract, pending review
-- - account_status_logs, account_managers
-- - contracts, contract_section_defs, contract_sections
--
-- Additive only: nothing is dropped, and every new NOT NULL column has a
-- default, so the deployed app keeps working until the new code ships.
-- New enum values (CustomerStatus INACTIVE, the new AccessRole values) are
-- not used anywhere in this file, so it can run in one transaction.

-- ── Enums ────────────────────────────────────────────────────────────

ALTER TYPE "vaa_sys"."AccessRole" ADD VALUE IF NOT EXISTS 'SERVICE_MANAGER';
ALTER TYPE "vaa_sys"."AccessRole" ADD VALUE IF NOT EXISTS 'HR_SPECIALIST';
ALTER TYPE "vaa_sys"."AccessRole" ADD VALUE IF NOT EXISTS 'HR_MANAGER';
ALTER TYPE "vaa_sys"."AccessRole" ADD VALUE IF NOT EXISTS 'ACCOUNTING';
ALTER TYPE "vaa_sys"."AccessRole" ADD VALUE IF NOT EXISTS 'RECRUITMENT_SPECIALIST';
ALTER TYPE "vaa_sys"."AccessRole" ADD VALUE IF NOT EXISTS 'TRAINING_MANAGER';
ALTER TYPE "vaa_sys"."AccessRole" ADD VALUE IF NOT EXISTS 'EXECUTIVE';
ALTER TYPE "vaa_sys"."AccessRole" ADD VALUE IF NOT EXISTS 'EXECUTIVE_SUPPORT';

ALTER TYPE "vaa_sys"."CustomerStatus" ADD VALUE IF NOT EXISTS 'INACTIVE' AFTER 'PAUSED';

-- CreateEnum
CREATE TYPE "vaa_sys"."AccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'INACTIVE', 'TERMINATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "vaa_sys"."ContractFieldType" AS ENUM ('PERCENTAGE', 'AMOUNT', 'TEXT', 'YES_NO');

-- ── Access ───────────────────────────────────────────────────────────

ALTER TABLE "vaa_sys"."access_users" ADD COLUMN "department_id" TEXT;

-- ── Settings ─────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "vaa_sys"."setting_options" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "setting_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "setting_options_category_value_key" ON "vaa_sys"."setting_options"("category", "value");

-- CreateIndex
CREATE INDEX "setting_options_category_sort_order_idx" ON "vaa_sys"."setting_options"("category", "sort_order");

-- Legacy defaults (SheetSetup.js _seedSettings). CountryRegion time zones
-- were blank in the legacy seed; these are the obvious IANA zones.
INSERT INTO "vaa_sys"."setting_options" ("id", "category", "value", "label", "sort_order", "timezone", "updated_at")
VALUES
    (gen_random_uuid()::text, 'Category', 'Seller', 'Seller', 1, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Category', 'Big Seller', 'Big Seller', 2, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Category', 'Agency', 'Agency', 3, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Category', 'Consultancy', 'Consultancy', 4, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Category', 'Aggregator', 'Aggregator', 5, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Type', 'Silver', 'Silver', 1, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Type', 'Gold', 'Gold', 2, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'Type', 'Platinum', 'Platinum', 3, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'CountryRegion', 'Israel', 'Israel', 1, 'Asia/Jerusalem', CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'CountryRegion', 'United Kingdom', 'United Kingdom', 2, 'Europe/London', CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'CountryRegion', 'USA - New Jersey', 'USA - New Jersey', 3, 'America/New_York', CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'TerminationReason', 'Client request', 'Client request', 1, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'TerminationReason', 'Budget constraints', 'Budget constraints', 2, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'TerminationReason', 'Service dissatisfaction', 'Service dissatisfaction', 3, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'TerminationReason', 'Business closure', 'Business closure', 4, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'TerminationReason', 'Switched to competitor', 'Switched to competitor', 5, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'TerminationReason', 'Contract ended', 'Contract ended', 6, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'TerminationReason', 'Non-payment', 'Non-payment', 7, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'InquiryType', 'VA-Related Concern', 'VA-Related Concern', 1, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'InquiryType', 'Payment / Account Concern', 'Payment / Account Concern', 2, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'InquiryType', 'General Inquiry', 'General Inquiry', 3, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'InquiryType', 'Termination', 'Termination', 4, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'InquiryLostReason', 'Issue could not be resolved', 'Issue could not be resolved', 1, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'InquiryLostReason', 'Client withdrew inquiry', 'Client withdrew inquiry', 2, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'InquiryLostReason', 'Duplicate inquiry', 'Duplicate inquiry', 3, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'InquiryLostReason', 'No response from client', 'No response from client', 4, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'InquiryLostReason', 'Out of scope', 'Out of scope', 5, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'VARequestLostReason', 'Client went with another provider', 'Client went with another provider', 1, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'VARequestLostReason', 'Client no longer needs the service', 'Client no longer needs the service', 2, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'VARequestLostReason', 'Budget constraints', 'Budget constraints', 3, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'VARequestLostReason', 'No response from client', 'No response from client', 4, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'VARequestLostReason', 'Duplicate request', 'Duplicate request', 5, NULL, CURRENT_TIMESTAMP),
    (gen_random_uuid()::text, 'VARequestLostReason', 'Other', 'Other', 6, NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("category", "value") DO NOTHING;

-- ── Activity log ─────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "vaa_sys"."activity_logs" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "entity_label" TEXT,
    "customer_id" TEXT,
    "action" TEXT NOT NULL,
    "field" TEXT,
    "old_value" TEXT,
    "new_value" TEXT,
    "notes" TEXT,
    "actor_email" TEXT NOT NULL,
    "actor_name" TEXT,
    "effective_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_logs_entity_type_entity_id_created_at_idx" ON "vaa_sys"."activity_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_logs_customer_id_created_at_idx" ON "vaa_sys"."activity_logs"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_logs_created_at_idx" ON "vaa_sys"."activity_logs"("created_at");

-- CreateIndex
CREATE INDEX "activity_logs_actor_email_created_at_idx" ON "vaa_sys"."activity_logs"("actor_email", "created_at");

-- ── Customers ────────────────────────────────────────────────────────

-- Existing customers came from Lead Management and have no payment yet.
ALTER TABLE "vaa_sys"."customers"
    ADD COLUMN "assigned_specialist_email" TEXT,
    ADD COLUMN "payment_date" DATE,
    ADD COLUMN "no_payment_yet" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "termination_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "reactivation_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "review_action" "vaa_sys"."CustomerStatus",
    ADD COLUMN "status_before_review" "vaa_sys"."CustomerStatus",
    ADD COLUMN "review_requested_by_email" TEXT,
    ADD COLUMN "review_requested_at" TIMESTAMP(3),
    ADD COLUMN "review_reason" TEXT;

-- CreateIndex
CREATE INDEX "customers_assigned_specialist_email_idx" ON "vaa_sys"."customers"("assigned_specialist_email");

ALTER TABLE "vaa_sys"."customer_status_logs"
    ADD COLUMN "termination_reason_id" TEXT,
    ADD COLUMN "effective_date" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "vaa_sys"."customer_takeovers" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "specialist_email" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" TEXT,
    "created_by_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_email" TEXT,

    CONSTRAINT "customer_takeovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaa_sys"."customer_account_notes" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "account_id" TEXT,
    "body" TEXT NOT NULL,
    "created_by_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_account_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_takeovers_specialist_email_start_date_end_date_idx" ON "vaa_sys"."customer_takeovers"("specialist_email", "start_date", "end_date");

-- CreateIndex
CREATE INDEX "customer_takeovers_customer_id_idx" ON "vaa_sys"."customer_takeovers"("customer_id");

-- CreateIndex
CREATE INDEX "customer_account_notes_customer_id_created_at_idx" ON "vaa_sys"."customer_account_notes"("customer_id", "created_at");

-- CreateIndex
CREATE INDEX "customer_account_notes_account_id_created_at_idx" ON "vaa_sys"."customer_account_notes"("account_id", "created_at");

-- ── Accounts ─────────────────────────────────────────────────────────

-- Existing accounts were made by the onboarding form and have no VA yet,
-- so they start as Pending like every new account.
ALTER TABLE "vaa_sys"."accounts"
    ADD COLUMN "status" "vaa_sys"."AccountStatus" NOT NULL DEFAULT 'PENDING',
    ADD COLUMN "status_changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "is_returning" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "category_id" TEXT,
    ADD COLUMN "type_id" TEXT,
    ADD COLUMN "country_region_id" TEXT,
    ADD COLUMN "seller_onboarding_link" TEXT,
    ADD COLUMN "contract_link" TEXT,
    ADD COLUMN "contract_id" TEXT,
    ADD COLUMN "review_action" "vaa_sys"."AccountStatus",
    ADD COLUMN "status_before_review" "vaa_sys"."AccountStatus",
    ADD COLUMN "review_requested_by_email" TEXT,
    ADD COLUMN "review_requested_at" TIMESTAMP(3),
    ADD COLUMN "review_reason" TEXT,
    ADD COLUMN "review_from_customer" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "accounts_status_idx" ON "vaa_sys"."accounts"("status");

-- CreateTable
CREATE TABLE "vaa_sys"."account_status_logs" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "from_status" "vaa_sys"."AccountStatus",
    "to_status" "vaa_sys"."AccountStatus" NOT NULL,
    "reason" TEXT,
    "termination_reason_id" TEXT,
    "effective_date" TIMESTAMP(3),
    "changed_by_email" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_status_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaa_sys"."account_managers" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_managers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_status_logs_account_id_changed_at_idx" ON "vaa_sys"."account_status_logs"("account_id", "changed_at");

-- CreateIndex
CREATE INDEX "account_managers_account_id_idx" ON "vaa_sys"."account_managers"("account_id");

-- Every existing account gets its first status log row, like new ones.
INSERT INTO "vaa_sys"."account_status_logs" ("id", "account_id", "from_status", "to_status", "changed_by_email", "changed_at")
SELECT gen_random_uuid()::text, "id", NULL, 'PENDING', 'system', "created_at"
FROM "vaa_sys"."accounts";

-- ── Contracts ────────────────────────────────────────────────────────

-- CreateTable
CREATE TABLE "vaa_sys"."contracts" (
    "id" TEXT NOT NULL,
    "contract_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "period" TEXT NOT NULL DEFAULT 'Annual',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_by_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_email" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaa_sys"."contract_section_defs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "field_type" "vaa_sys"."ContractFieldType" NOT NULL DEFAULT 'TEXT',
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_section_defs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaa_sys"."contract_sections" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "section_def_id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_by_email" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_sections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contracts_contract_code_key" ON "vaa_sys"."contracts"("contract_code");

-- CreateIndex
CREATE UNIQUE INDEX "contract_sections_contract_id_section_def_id_key" ON "vaa_sys"."contract_sections"("contract_id", "section_def_id");

-- ── Foreign keys ─────────────────────────────────────────────────────

-- AddForeignKey
ALTER TABLE "vaa_sys"."customer_status_logs" ADD CONSTRAINT "customer_status_logs_termination_reason_id_fkey" FOREIGN KEY ("termination_reason_id") REFERENCES "vaa_sys"."setting_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaa_sys"."customer_takeovers" ADD CONSTRAINT "customer_takeovers_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "vaa_sys"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaa_sys"."customer_account_notes" ADD CONSTRAINT "customer_account_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "vaa_sys"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaa_sys"."customer_account_notes" ADD CONSTRAINT "customer_account_notes_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "vaa_sys"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaa_sys"."accounts" ADD CONSTRAINT "accounts_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "vaa_sys"."setting_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaa_sys"."accounts" ADD CONSTRAINT "accounts_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "vaa_sys"."setting_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaa_sys"."accounts" ADD CONSTRAINT "accounts_country_region_id_fkey" FOREIGN KEY ("country_region_id") REFERENCES "vaa_sys"."setting_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaa_sys"."accounts" ADD CONSTRAINT "accounts_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "vaa_sys"."contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaa_sys"."account_status_logs" ADD CONSTRAINT "account_status_logs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "vaa_sys"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaa_sys"."account_status_logs" ADD CONSTRAINT "account_status_logs_termination_reason_id_fkey" FOREIGN KEY ("termination_reason_id") REFERENCES "vaa_sys"."setting_options"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaa_sys"."account_managers" ADD CONSTRAINT "account_managers_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "vaa_sys"."accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaa_sys"."contract_sections" ADD CONSTRAINT "contract_sections_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "vaa_sys"."contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaa_sys"."contract_sections" ADD CONSTRAINT "contract_sections_section_def_id_fkey" FOREIGN KEY ("section_def_id") REFERENCES "vaa_sys"."contract_section_defs"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── Hand-added (not generated by Prisma) ─────────────────────────────
-- One person per account in account_managers, whatever the capitalisation.
CREATE UNIQUE INDEX "account_managers_account_id_name_key" ON "vaa_sys"."account_managers"("account_id", lower("name"));

-- A takeover never ends before it starts.
ALTER TABLE "vaa_sys"."customer_takeovers" ADD CONSTRAINT "customer_takeovers_dates_check" CHECK ("end_date" >= "start_date");

-- Closed to Supabase's anon/authenticated API roles, like the other tables.
ALTER TABLE "vaa_sys"."setting_options" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vaa_sys"."activity_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vaa_sys"."customer_takeovers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vaa_sys"."customer_account_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vaa_sys"."account_status_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vaa_sys"."account_managers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vaa_sys"."contracts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vaa_sys"."contract_section_defs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vaa_sys"."contract_sections" ENABLE ROW LEVEL SECURITY;
