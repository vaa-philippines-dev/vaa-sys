-- Accounting System and the initial bill (Nov 4, 2026). The Lead Manager
-- prepares a lead's initial bill in Contract & Billing Initiation, from the
-- service requests on its onboarding form, and Accounting records the
-- payments (app/(acct)/, lib/billing-fields.ts). Follows the "Initial Billing
-- Process — Summary & Guide" doc: OTF per department, deposit per VA, the
-- prorated service fee, night differential, free hours, VAT for Israeli
-- clients, the PayPal fee, and Foregone Revenue for anything not billed.
--
-- - invoices: one bill (INV-0001), with the fee settings it used;
-- - invoice_items: each VA request on it (rate, hours, ND hours, free hours,
--   deposit discount);
-- - invoice_department_fees: each department's One-Time Fee (exempt,
--   discount);
-- - invoice_lines: the lines worked out from those, rewritten on every save;
--   reductions keep what they gave up (Foregone Revenue);
-- - payments: what Accounting recorded against a bill;
-- - billing_rates: the default hourly rate per service.
--
-- Additive only: new types and tables, nothing existing changes. The
-- deployed app keeps working until the new code ships.
-- Apply with: npm.cmd run db:apply -- prisma/sql/010_accounting_initial_billing.sql

CREATE TYPE "vaa_sys"."InvoiceKind" AS ENUM ('INITIAL');
CREATE TYPE "vaa_sys"."InvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PARTIALLY_PAID', 'PAID', 'VOID');
CREATE TYPE "vaa_sys"."BillingCurrency" AS ENUM ('USD', 'GBP', 'NIS');
CREATE TYPE "vaa_sys"."InvoiceLineKind" AS ENUM ('OTF', 'OTF_DISCOUNT', 'DEPOSIT', 'DEPOSIT_DISCOUNT', 'SERVICE_FEE', 'ND_FEE', 'FREE_HOURS');
CREATE TYPE "vaa_sys"."ForegoneType" AS ENUM ('WAIVED', 'DISCOUNTED', 'FREE');

CREATE TABLE "vaa_sys"."invoices" (
    "id" TEXT NOT NULL,
    "invoice_number" SERIAL NOT NULL,
    "kind" "vaa_sys"."InvoiceKind" NOT NULL DEFAULT 'INITIAL',
    "customer_id" TEXT NOT NULL,
    "account_id" TEXT,
    "status" "vaa_sys"."InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" "vaa_sys"."BillingCurrency" NOT NULL DEFAULT 'USD',
    "apply_vat" BOOLEAN NOT NULL DEFAULT false,
    "apply_paypal_fee" BOOLEAN NOT NULL DEFAULT false,
    "otf_amount" DECIMAL(10,2) NOT NULL,
    "deposit_amount" DECIMAL(10,2) NOT NULL,
    "nd_percent" DECIMAL(5,2) NOT NULL,
    "vat_percent" DECIMAL(5,2) NOT NULL,
    "paypal_percent" DECIMAL(5,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "vat_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paypal_fee_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "sent_at" TIMESTAMP(3),
    "sent_by_email" TEXT,
    "voided_at" TIMESTAMP(3),
    "voided_by_email" TEXT,
    "void_reason" TEXT,
    "created_by_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_email" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vaa_sys"."invoice_items" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "ticket_request_id" TEXT,
    "line_no" INTEGER NOT NULL,
    "service" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "schedule_type" "vaa_sys"."ScheduleType" NOT NULL,
    "number_of_vas" INTEGER NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE,
    "hourly_rate" DECIMAL(10,2) NOT NULL,
    "hours" DECIMAL(8,2) NOT NULL,
    "nd_hours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "hours_basis" TEXT NOT NULL,
    "free_hours" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "free_hours_ref" TEXT,
    "deposit_discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "deposit_approval_ref" TEXT,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vaa_sys"."invoice_department_fees" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "exempt" BOOLEAN NOT NULL DEFAULT false,
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "approval_ref" TEXT,

    CONSTRAINT "invoice_department_fees_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vaa_sys"."invoice_lines" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "line_no" INTEGER NOT NULL,
    "kind" "vaa_sys"."InvoiceLineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "calculation" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "department" TEXT,
    "foregone_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "foregone_type" "vaa_sys"."ForegoneType",
    "approval_ref" TEXT,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vaa_sys"."payments" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paid_on" DATE NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "recorded_by_email" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vaa_sys"."billing_rates" (
    "id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "hourly_rate" DECIMAL(10,2) NOT NULL,
    "updated_by_email" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_rates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "vaa_sys"."invoices"("invoice_number");
CREATE INDEX "invoices_customer_id_idx" ON "vaa_sys"."invoices"("customer_id");
CREATE INDEX "invoices_status_idx" ON "vaa_sys"."invoices"("status");
CREATE UNIQUE INDEX "invoice_items_invoice_id_line_no_key" ON "vaa_sys"."invoice_items"("invoice_id", "line_no");
CREATE UNIQUE INDEX "invoice_department_fees_invoice_id_department_key" ON "vaa_sys"."invoice_department_fees"("invoice_id", "department");
CREATE INDEX "invoice_lines_foregone_type_idx" ON "vaa_sys"."invoice_lines"("foregone_type");
CREATE UNIQUE INDEX "invoice_lines_invoice_id_line_no_key" ON "vaa_sys"."invoice_lines"("invoice_id", "line_no");
CREATE INDEX "payments_invoice_id_idx" ON "vaa_sys"."payments"("invoice_id");
CREATE INDEX "payments_customer_id_idx" ON "vaa_sys"."payments"("customer_id");
CREATE INDEX "payments_paid_on_idx" ON "vaa_sys"."payments"("paid_on");
CREATE UNIQUE INDEX "billing_rates_service_key" ON "vaa_sys"."billing_rates"("service");

ALTER TABLE "vaa_sys"."invoices" ADD CONSTRAINT "invoices_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "vaa_sys"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vaa_sys"."invoices" ADD CONSTRAINT "invoices_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "vaa_sys"."accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vaa_sys"."invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "vaa_sys"."invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vaa_sys"."invoice_items" ADD CONSTRAINT "invoice_items_ticket_request_id_fkey" FOREIGN KEY ("ticket_request_id") REFERENCES "vaa_sys"."ticket_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "vaa_sys"."invoice_department_fees" ADD CONSTRAINT "invoice_department_fees_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "vaa_sys"."invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vaa_sys"."invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "vaa_sys"."invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vaa_sys"."payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "vaa_sys"."invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vaa_sys"."payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "vaa_sys"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
