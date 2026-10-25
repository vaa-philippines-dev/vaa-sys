-- Onboarding form rebuilt to ask the same questions as VAA's Google Form
-- "CUSTOMER ONBOARDING FORM" (Part 1 profile, Part 2 skill requirements,
-- Part 3 VA personality preference).
--
-- Additive only: the deployed app keeps writing the old columns until the
-- new code ships, so nothing is dropped or made stricter here.
-- ticket_requests.additional_hours_per_day is no longer written by the form
-- and can be dropped in a later file.

-- Payment methods from the Google form. NIS bank transfer stays Israel-only.
ALTER TYPE "vaa_sys"."PaymentMethod" ADD VALUE IF NOT EXISTS 'ACH_TRANSFER';
ALTER TYPE "vaa_sys"."PaymentMethod" ADD VALUE IF NOT EXISTS 'SWIFT_TRANSFER';
ALTER TYPE "vaa_sys"."PaymentMethod" ADD VALUE IF NOT EXISTS 'OTHER';

-- Project hours: a total number of hours rather than daily or weekly.
ALTER TYPE "vaa_sys"."ScheduleType" ADD VALUE IF NOT EXISTS 'PROJECT';

-- Part 1: account-level questions.
ALTER TABLE "vaa_sys"."accounts"
    ADD COLUMN "business_address" TEXT,
    ADD COLUMN "platforms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "platform_other" TEXT,
    ADD COLUMN "fulfillment_type" TEXT,
    ADD COLUMN "seller_type" TEXT,
    ADD COLUMN "other_info" TEXT,
    ADD COLUMN "invoice_contact_role" TEXT,
    ADD COLUMN "has_payoneer_or_wise" BOOLEAN,
    ADD COLUMN "payment_method_other" TEXT;

-- Part 2: platform moved to the account; project hours; additional hours
-- as free text ("1H Sat or Sun").
ALTER TABLE "vaa_sys"."ticket_requests"
    ALTER COLUMN "platform" DROP NOT NULL,
    ADD COLUMN "project_hours" DECIMAL(6,2),
    ADD COLUMN "additional_hours" TEXT;

-- Part 3: optional, can be completed later on the same link.
ALTER TABLE "vaa_sys"."onboarding_submissions"
    ADD COLUMN "part_3" JSONB,
    ADD COLUMN "part_3_submitted_at" TIMESTAMP(3);
