# VAA Systems (vaa-sys)

One app with two areas on one database. It replaces the legacy Apps Script CMS step by step (Oct 21, 2026 meeting with Ian):

- **Customer Management** (`/customers`) is for Customer Specialists and their manager: every customer, their status and its history.
- **Lead Management** (`/leads`) is for the Lead Manager (Miss Mary): adding new customers and sending them their onboarding link.
- **Onboarding form** (`/onboarding/<token>`) is the public form a customer opens from that link. It has two parts:
  - **Part 1, profile:** primary and secondary contacts with roles, who the main (focal) contact is, the company and the name on invoices (DBA), who gets invoices, and the payment method. NIS bank transfer is offered to Israel only.
  - **Part 2, VA requests:** platform, service, how many VAs, the schedule, start date, first tasks and tools. Schedules are weekly flexible, daily flexible, or daily fixed in Philippine time; a daily-fixed shift between 10 PM and 6 AM is flagged for night differential.

Same stack as `va-management`: Next.js 16, React 19, Tailwind v4, shadcn, Prisma 7 with `@prisma/adapter-pg`, and Supabase Auth with Google.

**One app, two looks.** Each area has its own sidebar layout and palette, scoped by a class in `app/globals.css`:
- **Lead Management** (`app/(lms)/`, `.lms`): the design of the original `lead-management-sys`.
  - "VAA · LMS" sidebar, cream and near-black palette
  - stats card, Kanban board by onboarding stage, New-lead drawer
  - Only its design was brought over, not its own pipeline or database.
- **Customer Management** (`app/(cms)/`, `.cms`): a sibling look.
  - "VAA · CMS" sidebar, cool mist-green ground with a deep VAA-teal ink, Montserrat for headings and figures
  - one color per customer status
  - a portfolio card (status-mix bar, accounts, VAs requested, status changes this week), a customer ledger with a status stripe per row, and a recent-activity feed from the status log
  - on each customer, a status ribbon showing how long they spent in each status

Both sidebars have a system switcher between the two areas, the admin picker, Workforce and KPI Ms. The admin picker (`app/(app)/`, `/`) keeps the plain top-bar layout.

## Who lands where

Everyone signs in with Google and needs an active VAA Workforce account (`public.users`).

| Role | Lands on | Customers | Change status | Leads | Access page |
|---|---|---|---|---|---|
| Admin | Area picker (`/`) | ✓ | ✓ | ✓ | ✓ |
| Customer Success Manager | `/customers` | ✓ | ✓ | | ✓ (Customer Specialists only) |
| Customer Specialist | `/customers` | ✓ | ✓ | | |
| Lead Manager | `/leads` | view | | ✓ | |

- **Admins** are Workforce `SUPER_ADMIN`/`SYSTEM_ADMIN` accounts with an `@vaaphilippines.com` email. They need no row on the Access page.
- **Everyone else** gets a role on the **Access** page (`vaa_sys.access_users`).
- The rules live in `lib/access-fields.ts`, and the session side lives in `lib/auth.ts`.

## How a customer moves through it

1. **Lead Management → New lead:** enter the name and an email. The system generates the customer ID. The customer starts as **Pending**, and its first status log entry is written.
2. **Create onboarding link:** this makes a personal link, valid for 14 days. The page shows a ready-to-send email with Copy and "Open in email app" buttons. Making a new link stops the old one from working.
3. **The customer fills in the form.** Submitting it creates, in one go:
   - the customer's first **account** (`CLT_…`, named after the customer) with its contacts, invoice contact and payment method, from Part 1
   - a **main ticket** (`TKT-000001`) with one **sub-ticket** per VA request (`TKT-000001-01`), from Part 2

   Lead Management follows each lead: No link yet → Link sent → Form opened → Form submitted. On the lead's page, Lead Management sets each sub-ticket's **request group** (Regular by default, or Expert or Casual).
4. **Customer Management** reads the submission and changes the status (Active, Paused, Cancelled, Terminated). Every change is logged with who made it, when, and why. A reason is required for Paused, Cancelled and Terminated.

Customer and account IDs are always generated, in the legacy CMS formats: `CUST_` and `CLT_` followed by 12 hex characters. New IDs are checked against both this app and the legacy CMS copies in `public.customers` and `public.accounts`.

## Database

The app shares va-management's Supabase Postgres but only owns the **`vaa_sys`** schema:

| Table | Holds |
|---|---|
| `access_users` | email and role, for everyone except admins |
| `customers` | customer ID, name, email, status, created by and when |
| `customer_status_logs` | every status change (from, to, reason, who, when) |
| `onboarding_links` | link token, expiry, when it was opened, when it was submitted |
| `onboarding_submissions` | exactly what the customer submitted, kept for reference |
| `accounts` | account ID, name, company, name on invoices, website, time zone, invoice contact, payment method |
| `account_contacts` | primary and secondary contact (name, role, email, WhatsApp, region, focal) |
| `tickets` | main ticket per account request (`ticket_number` → TKT-000001) |
| `ticket_requests` | one sub-ticket per VA request: platform, service, schedule and hours, night differential, start date, tasks, tools, request group |

The app reads va-management's data with raw SQL and never modifies it:
- `public.users` for sign-in
- `public.customers` for legacy duplicate checks
- `public.departments`: the onboarding form's service list is the live list of Service departments

Don't run `prisma migrate` or `db push` here. Schema changes are SQL files in `prisma/sql/`:

```bash
npm run db:sql
```

```bash
npm run db:apply -- prisma/sql/<file>.sql
```

`db:sql` prints SQL for the whole schema as a starting point. `db:apply` applies a reviewed file in one transaction. The files so far:
- `001_client_entry_init.sql`: the retired prototype
- `002_vaa_sys_init.sql`: dropped the prototype and created `vaa_sys`
- `003_accounts_tickets.sql`: added accounts, contacts and tickets

## Setup

```bash
npm install
```

```bash
npm run dev
```

The app runs at http://localhost:3001. Locally, `DEV_AUTH_BYPASS_EMAIL` in `.env.local` signs you in as that user without Google (dev only).

Before real Google sign-in works, add the callback URL in Supabase → Authentication → URL Configuration → Redirect URLs:
- `http://localhost:3001/callback`
- `https://<deployed-domain>/callback`

Set `NEXT_PUBLIC_SITE_URL` to the deployed address, because onboarding links are built from it.

## Next phases (from the Oct 21 meeting)

- **Ticket follow-up:** ticket statuses, account managers, and terminations through tickets.
- **Ian's current Google onboarding form:** match the questions and option lists to it (`lib/onboarding-fields.ts`).
- **Service list:** switch to Workforce's official services and positions once database access is given.
- **Personality / VA profile questions:** on hold; the team already has a format.
- **Sending the onboarding email from the app,** for example through Resend, which va-management already uses.
- **Calculations** (phase 2).
