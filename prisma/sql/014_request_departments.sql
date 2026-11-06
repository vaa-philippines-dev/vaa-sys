-- 014: A department for each VA request (Nov 6, 2026).
--
-- One ticket can ask for VAs from different departments, so the department
-- (and with it the Service Managers who act) moves from the ticket to each VA
-- request. Nobody assigns a manager by hand any more: any active Service
-- Manager of the request's department acts on it.
--
-- ticket_requests.department_id: a public.departments id, filled in here for
-- existing requests from their service: the Workforce service the onboarding
-- service is linked to (service_profiles), and that service's active
-- service department, preferring the one named in the service ("Wholesale -
-- Virtual Assistant" → Wholesale). Reads public.* only.
--
-- tickets.phase: new tickets start in VA Assignment, and open tickets still
-- in New move there (New was the manual "assign a manager" step).
--
-- Additive apart from the phase move; nothing in public.* is written.
--
-- Apply with: npm.cmd run db:apply -- prisma/sql/014_request_departments.sql

ALTER TABLE "vaa_sys"."ticket_requests" ADD COLUMN "department_id" TEXT;
CREATE INDEX "ticket_requests_department_id_idx" ON "vaa_sys"."ticket_requests"("department_id");

UPDATE "vaa_sys"."ticket_requests" r
SET "department_id" = x.department_id
FROM (
    SELECT DISTINCT ON (sp.onboarding_service) sp.onboarding_service, d.id AS department_id
    FROM "vaa_sys"."service_profiles" sp
    JOIN public.department_skills ds ON ds.skill_id = sp.skill_id
    JOIN public.departments d ON d.id = ds.department_id
     AND d.level::text = 'SERVICE' AND d.status::text = 'ACTIVE' AND d.parent_id IS NOT NULL
    WHERE sp.onboarding_service IS NOT NULL
    ORDER BY sp.onboarding_service, (lower(d.name) = lower(split_part(sp.onboarding_service, ' - ', 1))) DESC, d.name
) x
WHERE r.service = x.onboarding_service AND r."department_id" IS NULL;

ALTER TABLE "vaa_sys"."tickets" ALTER COLUMN "phase" SET DEFAULT 'VA_ASSIGNMENT';
UPDATE "vaa_sys"."tickets" SET "phase" = 'VA_ASSIGNMENT', "phase_changed_at" = CURRENT_TIMESTAMP WHERE "phase" = 'NEW';
