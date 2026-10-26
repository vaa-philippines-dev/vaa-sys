# VAA Systems (vaa-sys)

One app with two areas on one database. It replaces the legacy Apps Script CMS step by step (Oct 21, 2026 meeting with Ian):

- **Customer Management** (`/customers`) is for Customer Specialists and their manager: every customer, their status and its history.
- **Lead Management** (`/leads`) is for the Lead Manager (Miss Mary): adding new customers and sending them their onboarding link.
- **Onboarding form** (`/onboarding/<token>`) is the public form a customer opens from that link. It asks the same questions as VAA's Google Form "CUSTOMER ONBOARDING FORM", in three parts:
  - **Part 1, customer profile:**
    - primary and secondary contacts with roles, and whether the primary contact is the focal person
    - company, DBA name, business address, website
    - region of residence (The Americas, Europe, Israel, Middle East, Asia-Pacific)
    - time zone (required): every zone the runtime knows (`Intl`), labelled by UTC offset, e.g. "(UTC+08:00) Asia/Manila"
    - optionally, the platforms the VAs will work on and any other information (where Google's hint asks about FBA/FBM and private label or reseller)
    - the invoice contact
    - payment details. Customers in Israel choose from Payoneer, Wise, NIS bank transfer or Other. Everyone else is asked whether they have an active Payoneer or Wise account and chooses from Payoneer, Wise, ACH, SWIFT, credit card or Other.
  - **Part 2, skill requirements:** one VA service per service type, each with:
    - service offering (the Google Form's list), quantity and target start date
    - work hour type: initial project hours, daily fixed, daily flexible, weekly or monthly. Only minimums apply (defaults 3 h a day, 15 h a week, 60 h a month, 15 project hours; admins change them under Lead Management → Form settings). A field below its minimum is outlined in red.
    - daily fixed times are entered in the customer's time zone (default 8:00 AM – 5:00 PM Philippine time) and stored in Philippine time; a shift between 10 PM and 6 AM Philippine time is flagged for night differential
    - additional hours, whether the VA will use a task tracker, and the (optional) tasks and tools
  - **Part 3, VA personality preference:** optional. Ten scenarios, each with four statements rated 1 (least preferred) to 5 (most preferred). The statements follow the DISC styles in the same order every time, so the lead's page shows a total per style. A customer who skips it can complete it later on the same link, even after the link's 14 days, and the lead's page shows it as not filled in yet with the link to copy.

New here? Start with [Setup](#setup) and [Working together](#working-together). If you use Claude Code, it reads [`CLAUDE.md`](CLAUDE.md) on its own.

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

Everyone signs in with Google and needs an active VAA Workforce account (`public.users`). Nobody is let in automatically: without an admin role in Workforce or a row on the Access page, there is no access.

The roles are the legacy CMS's. What each may do is one module × role map in `lib/permissions.ts` (modelled on the legacy `_permDefaultFor` and `NAV_ROLE_DEFAULT`); every page and Server Action checks it on the server, and later modules extend it.

| Role | Lands on | Customers & accounts | Status changes | CS Specialists | Approvals | Contracts | Activity log | Settings | Access page |
|---|---|---|---|---|---|---|---|---|---|
| Admin | Area picker (`/`) | all, edit | apply directly | manage | ✓ | manage | ✓ | ✓ | ✓ (every role) |
| Customer Success Manager | `/customers` | all, edit | apply directly | manage | ✓ | manage | ✓ | | ✓ (Customer Specialists only) |
| Customer Specialist | `/customers` | own + covering, edit | pause/terminate/cancel go to review | view | | view | own customers' history | | |
| Service Manager (with a department) | `/customers` | all, view | | | | | | | |
| Accounting | `/customers` | all, view | | | | view | | | |
| Executive, Executive Support | `/customers` | all, view | | | | view | ✓ | | |
| Lead Manager | `/leads` | view customers | | | | | | | |
| HR Specialist, HR Manager, Recruitment Specialist, Training Manager | `/waiting` until their modules arrive | | | | | | | | |

- **Admins** are Workforce `SUPER_ADMIN`/`SYSTEM_ADMIN` accounts with an `@vaaphilippines.com` email. They need no row on the Access page.
- **Everyone else** gets a role on the **Access** page (`vaa_sys.access_users`). A Service Manager also gets one of Workforce's service departments.
- **CS Specialist scope:** customers assigned to them (`customers.assigned_specialist_email`) plus customers they cover through a running takeover. Out-of-scope customers and accounts read as "not found".
- The rules live in `lib/permissions.ts` and `lib/access-fields.ts`, the session side in `lib/auth.ts`, and the customer scope in `lib/scope.ts`.

## Customer Management pages

| Page | What it does |
|---|---|
| `/customers` | Portfolio card, customer ledger (status, CS Specialist, review and warning flags), recent activity. Filters: status, `?cs=none`, `?review=1`. |
| `/customers/<id>` | Status ribbon, CS Specialist, first payment, termination/reactivation counts, warnings, takeovers, accounts, customer notes, history, status form, details form, status log. |
| `/accounts`, `/accounts/<id>` | Account list by status; account profile with status, category/type/country (with local time), links, contract, account managers, notes (its own and its customer's), onboarding details and tickets, history. |
| `/specialists` | CS team portfolios, customers without a CS Specialist, transfer/assign, takeovers (cover customers for a date range). |
| `/approvals` | Pending reviews: Confirm keeps the change, Cancel puts the previous status back (cascaded accounts included). |
| `/contracts` | Contract templates (`CON-001`) with typed sections (Percentage, Amount, Text, Yes/No) and the accounts using each. |
| `/activity` | The activity log, filterable by date range, record, action, user and text. |
| `/settings` | Admin-only lookup lists: categories, types, countries/regions (with time zone), termination reasons, lost reasons, inquiry types. Departments and services are shown read-only from Workforce. |
| `/access` | Roles, and a Service Manager's department. |

## Status rules

All in `lib/status.ts`, one transaction per change with its status log and activity log rows:
- **Customer statuses:** Pending, Active, Paused, Inactive, Cancelled, Terminated. **Account statuses:** the same; Pending is never picked by hand (new and reactivated accounts wait there for a VA connection).
- **Pending review:** a pause, termination or cancellation by anyone but a CS Manager or admin applies at once and is flagged; a CS Manager confirms or cancels it on `/approvals`.
- **Cascades:** a paused customer pauses its Active accounts; a terminated/cancelled customer applies that to every account not already terminated/cancelled. After an account changes, the customer follows: any Active → Active, else any Paused → Paused, else all Terminated → Terminated.
- **Reactivation:** leaving Terminated/Cancelled counts a reactivation and can bring chosen accounts back to Pending, marked Returning. Entering it counts a termination.
- Terminations can't be dated in the future, and nothing is terminated or cancelled while a VA connection is Started (`lib/va-connection-hooks.ts`, filled in by module 2).

## How a customer moves through it

1. **Lead Management → New lead:** enter the name and an email. The system generates the customer ID. The customer starts as **Pending**, and its first status log entry is written.
2. **Create onboarding link:** this makes a personal link, valid for 14 days. The page shows a ready-to-send email with Copy and "Open in email app" buttons. Making a new link stops the old one from working.
3. **The customer fills in the form.** Submitting it creates, in one go:
   - the customer's first **account** (`CLT_…`, named after the customer) with its contacts, invoice contact and payment method, from Part 1
   - a **main ticket** (`TKT-000001`) with one **sub-ticket** per VA (`TKT-000001-01`), from Part 2: a service asking for 2 VAs makes two sub-tickets
   - the Part 3 answers on the submission, if the customer filled them in

   Lead Management follows each lead: No link yet → Link sent → Form opened → Form submitted. On the lead's page, Lead Management sets each sub-ticket's **request group** (Regular by default, or Expert or Casual).
4. **Customer Management** reads the submission and changes the status (Active, Paused, Cancelled, Terminated). Every change is logged with who made it, when, and why. A reason is required for Paused, Cancelled and Terminated.

Customer and account IDs are always generated, in the legacy CMS formats: `CUST_` and `CLT_` followed by 12 hex characters. New IDs are checked against both this app and the legacy CMS copies in `public.customers` and `public.accounts`.

## Database

The app shares va-management's Supabase Postgres but only owns the **`vaa_sys`** schema:

| Table | Holds |
|---|---|
| `access_users` | email, role and (Service Managers) department, for everyone except admins |
| `setting_options` | the Settings lookup lists (category, value, label, order, on/off, time zone) |
| `activity_logs` | the generic activity log every module writes through `logActivity()` in `lib/activity.ts` |
| `customers` | customer ID, name, email, status, CS Specialist, first payment, termination/reactivation counts, pending review, created by and when |
| `customer_status_logs` | every status change (from, to, reason, termination reason, effective date, who, when) |
| `customer_takeovers` | a CS Specialist covering a customer between two dates |
| `customer_account_notes` | notes on a customer or one of its accounts |
| `onboarding_links` | link token, expiry, when it was opened, when it was submitted |
| `onboarding_submissions` | exactly what the customer submitted, kept for reference, and the Part 3 answers once given |
| `accounts` | account ID, name, company, DBA name, business address, website, time zone, platforms, other information, invoice contact, payment details. `fulfillment_type` and `seller_type` are unused. |
| `account_contacts` | primary and secondary contact (name, role, email, WhatsApp, region, focal) |
| `account_status_logs` | every account status change |
| `account_managers` | the account's managers, one row each (name, email) |
| `contracts`, `contract_section_defs`, `contract_sections` | contract templates, their typed sections, and each contract's values. `accounts.contract_id` says which applies. |
| `tickets` | main ticket per account request (`ticket_number` → TKT-000001) |
| `app_settings` | general settings admins edit, one row per key (e.g. the work hour minimums); no row means the built-in defaults |
| `ticket_requests` | one sub-ticket per VA: service, schedule and hours, night differential, additional hours, task tracker, start date, tasks, tools, request group. `platform` is only set on requests made before the platforms moved to the account. |

Accounts also hold status, Returning, category/type/country-region (from `setting_options`), seller onboarding link, contract link, contract and pending review.

The app reads va-management's data with raw SQL and never modifies it (`lib/workforce.ts`, `lib/auth.ts`):
- `public.users` for sign-in and names
- `public.customers` and `public.accounts` for legacy duplicate checks
- `public.departments` (active SERVICE-level departments) for Service Managers and the Department list
- `public.skills` with `public.department_skills` for the Service list

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
- `004_onboarding_google_form.sql`: added the Google Form's questions and Part 3 (additive only)
- `005_cms_foundation_customers_accounts.sql`: CMS module 1 — roles, settings (seeded with the legacy defaults), activity log, customers and accounts parity, takeovers, notes, account managers, contracts (additive only)
- `006_settings_monthly_tracker.sql`: the monthly work hour type, the task tracker answer and `app_settings` for the onboarding form's work hour minimums (additive only)

## Setup

You need Node.js 20 or later, access to the GitHub repo (`vaa-philippines-dev/vaa-sys`), and an `.env.local` from Neil (it is never committed).

```bash
git clone https://github.com/vaa-philippines-dev/vaa-sys.git
```

```bash
npm install
```

`npm install` also generates the Prisma client into `src/generated/prisma`.

Put these in `.env.local` at the repo root:

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Supabase Postgres, pooled connection (the app's runtime) |
| `DIRECT_URL` | Supabase Postgres, direct connection (Prisma CLI and `db:apply`) |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | the Supabase project shared with va-management, for Google sign-in |
| `NEXT_PUBLIC_SITE_URL` | the app's address; onboarding links are built from it (`http://localhost:3001` locally) |
| `DEV_AUTH_BYPASS_EMAIL` | optional, dev only: signs you in as this Workforce user without Google |

```bash
npm run dev
```

The app runs at http://localhost:3001. To get in, your Google account (or the bypass email) must be an active user in Workforce and either a Workforce admin with an `@vaaphilippines.com` email or on the Access page (see [Who lands where](#who-lands-where)).

**The database is shared with va-management.** Your local app talks to the same database as everyone else, so data you create locally is real data. Don't run `prisma migrate` or `db push`; see [Database](#database).

Before real Google sign-in works, add the callback URL in Supabase → Authentication → URL Configuration → Redirect URLs:
- `http://localhost:3001/callback`
- `https://<deployed-domain>/callback`

Set `NEXT_PUBLIC_SITE_URL` to the deployed address, because onboarding links are built from it.

### Scripts

| Command | What it does |
|---|---|
| `npm run dev` | dev server on port 3001 |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm run build` | production build |
| `npm run db:sql` | print SQL for the whole Prisma schema, as a starting point for a new `prisma/sql/` file |
| `npm run db:apply -- <file>` | apply one reviewed SQL file to the shared database |

There is no automated test suite yet; check changes with `typecheck`, `lint` and by using the page.

### Where things are

| Folder | Holds |
|---|---|
| `app/(cms)/` | Customer Management pages, each with its Server Actions in `actions.ts` |
| `app/(lms)/` | Lead Management pages |
| `app/(app)/` | the admin area picker and the `/waiting` page |
| `app/onboarding/[token]/` | the public onboarding form |
| `components/` | UI by area (`cms`, `lms`, `customers`, `leads`, `onboarding`...); `components/ui` is shadcn |
| `lib/` | auth, permissions, scope, status rules, activity log and data access. `*-fields.ts` files are client-safe (labels, zod schemas); the rest use Prisma and are server-only |
| `prisma/` | `schema.prisma` (the `vaa_sys` schema only) and the hand-applied SQL files in `prisma/sql/` |
| `proxy.ts` | Next.js 16 route protection (what `middleware.ts` used to be) |
| `legacy/vaa-cms-gas/` | the old Apps Script CMS, read-only reference |
| `docs/legacy-cms.md` | notes on how the legacy CMS works, for rebuilding it |

## Working together

- `main` is the shared branch. Work on your own branch and open a pull request; don't push to `main` directly.
- Pull `main` before you start, and before you number a new SQL file: two branches must not both add `007_….sql`.
- SQL files are applied to the shared database by hand, after review, with `npm run db:apply`. Mention in the PR when one needs applying.
- Keep this README current in the same PR when pages, roles, statuses, tables or setup change.

### With Claude Code

[`CLAUDE.md`](CLAUDE.md) is loaded by Claude Code automatically. It holds the commands, the shared-database rules and the code patterns (permissions, scope, Server Actions, activity log), so Claude follows the same rules for both of us. If you find yourself correcting Claude on something about this project, add it to `CLAUDE.md` in your PR.

`.claude/` is gitignored, so local settings stay on your machine. For Claude's preview browser, create `.claude/launch.json` as shown in `CLAUDE.md`.

## Next phases (from the Oct 21 meeting)

- **Ticket follow-up:** ticket statuses, account managers, and terminations through tickets.
- **Service list:** the form uses the Google Form's service offerings (`lib/onboarding-fields.ts`). Switch to Workforce's official services and positions once database access is given.
- **Sending the onboarding email from the app,** for example through Resend, which va-management already uses.
- **Calculations** (phase 2).
