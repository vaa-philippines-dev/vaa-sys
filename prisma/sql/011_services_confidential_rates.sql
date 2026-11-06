-- 011: Lead Management's Departments & services (Nov 5, 2026).
--
-- service_profiles: what vaa-sys keeps about each of VAA Workforce's services
-- (public.skills, by id): the onboarding form service it bills for, its
-- contract template, and the two confidential rates, stored encrypted
-- (lib/rates.ts). The Job Description is Workforce's own
-- public.skills.job_description and isn't stored here.
--
-- rate_viewers: who besides the owner may see and set those rates. Each row
-- is signed with the rates key, so rows inserted here by hand don't count.
--
-- Additive only. Nothing in public.* is changed: the seed below only reads
-- public.skills to link the onboarding form's services to Workforce's.
--
-- Apply with: npm.cmd run db:apply -- prisma/sql/011_services_confidential_rates.sql

CREATE TABLE "vaa_sys"."service_profiles" (
    "skill_id" TEXT NOT NULL,
    "onboarding_service" TEXT,
    "contract_id" TEXT,
    "standard_rate_cipher" TEXT,
    "va_base_rate_cipher" TEXT,
    "rates_updated_at" TIMESTAMP(3),
    "rates_updated_by_email" TEXT,
    "updated_by_email" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_profiles_pkey" PRIMARY KEY ("skill_id")
);

CREATE TABLE "vaa_sys"."rate_viewers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "granted_by_email" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_viewers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "service_profiles_onboarding_service_key" ON "vaa_sys"."service_profiles"("onboarding_service");
CREATE UNIQUE INDEX "rate_viewers_email_key" ON "vaa_sys"."rate_viewers"("email");

ALTER TABLE "vaa_sys"."service_profiles" ADD CONSTRAINT "service_profiles_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "vaa_sys"."contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Which Workforce service each onboarding form service bills as. Matched by
-- Workforce's service name; one that isn't found is simply left out, and
-- admins can change any of them on the page. Shopify VA has no Workforce
-- service yet.
INSERT INTO "vaa_sys"."service_profiles" ("skill_id", "onboarding_service")
SELECT s.id, m.onboarding_service
FROM (VALUES
    ('Amazon Virtual Assistant', 'Amazon - Virtual Assistant'),
    ('Wholesale Virtual Assistant', 'Wholesale - Virtual Assistant'),
    ('Amazon PPC Virtual Assistant', 'PPC - Virtual Assistant'),
    ('Social Media Virtual Assistant', 'Social Media - Virtual Assistant'),
    ('Executive Assistant Virtual Assistant', 'Executive Assistant - Virtual Assistant'),
    ('Walmart Virtual Assistant', 'Walmart - Virtual Assistant'),
    ('Graphics Designer Virtual Assistant', 'Creatives - Graphic Designer'),
    ('Video Editor Virtual Assistant', 'Creatives - Video Editor'),
    ('Copywriter Virtual Assistant', 'Creatives - Copywriter')
) AS m(skill_name, onboarding_service)
JOIN public.skills s ON s.name = m.skill_name
ON CONFLICT DO NOTHING;
