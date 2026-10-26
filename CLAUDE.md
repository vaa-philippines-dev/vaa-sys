# CLAUDE.md

Guidance for Claude Code in this repo. The README explains what the app does (areas, roles, status rules, tables); read it before a feature change. This file is how to work on the code.

## What this is

vaa-sys is VAA Philippines' internal Next.js app that replaces the legacy Apps Script CMS one module at a time. It has two areas on one database: **Customer Management** (`app/(cms)/`) and **Lead Management** (`app/(lms)/`), plus a public customer onboarding form (`app/onboarding/[token]/`). Two developers work on it, each with their own Claude Code sessions, so keep changes small, on a branch, and explained in the PR.

People mentioned in code and docs: **Ian** (Business Process Manager, sets priorities in the weekly meetings), **Miss Mary** (Lead Manager). Meeting dates in the README (Oct 19, 21, 26) are where requirements came from.

## Commands

```bash
npm install          # also runs prisma generate
npm run dev          # http://localhost:3001
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run build
```

There is no test suite. Before saying a change is done, run `npm run typecheck` and `npm run lint`, and for UI changes look at it running on port 3001.

`.claude/` is gitignored, so each developer creates their own `.claude/launch.json` for the preview browser:

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "vaa-sys", "runtimeExecutable": "npm", "runtimeArgs": ["run", "dev"], "port": 3001 }
  ]
}
```

Locally, `DEV_AUTH_BYPASS_EMAIL` in `.env.local` signs in as that Workforce user without Google. It is ignored in production. Never commit `.env*` files or print their values.

## Stack notes

- **Next.js 16 / React 19.** APIs differ from older versions you may remember: route protection lives in `proxy.ts` (not `middleware.ts`), and `cookies()`/`params` are async. When unsure, read the docs shipped in `node_modules/next/dist/docs/` instead of guessing.
- **Prisma 7** with `@prisma/adapter-pg`. The client is generated into `src/generated/prisma` (gitignored); import from `@/src/generated/prisma/client`. Run `npx prisma generate` after editing `prisma/schema.prisma`.
- **Tailwind v4 + shadcn** (`components/ui/`). The two areas have their own palettes, scoped by the `.lms` and `.cms` classes in `app/globals.css`. Keep each area's look; don't hardcode colors that belong in those tokens.
- **Supabase Auth** with Google only, the same Supabase project as va-management (Workforce).
- Dates are Philippine time (`manilaToday()`, `dateOnly()` in `lib/customer-fields.ts`). Vercel runs in `syd1`, next to the database.

## Database rules (shared database: read carefully)

The Postgres database is shared with **va-management** (Workforce). This app owns only the `vaa_sys` schema.

- **Never** run `prisma migrate`, `prisma db push`, or anything that diffs or alters the database. `prisma/schema.prisma` lists only `vaa_sys` on purpose.
- **Never write to `public.*`.** va-management's tables (`public.users`, `public.departments`, `public.skills`, `public.customers`, `public.accounts`...) are read with raw SQL in `lib/auth.ts` and `lib/workforce.ts`, and never modelled in Prisma.
- **Schema changes:** edit `prisma/schema.prisma`, then add the next numbered file in `prisma/sql/` (look at the folder for the next number, and at `origin/main` too, since the other developer may have taken it). Keep it additive where possible. `npm run db:sql` prints the full schema SQL as a starting point.
- **Don't apply SQL yourself.** A developer reviews the file and runs `npm run db:apply -- prisma/sql/<file>.sql`. Say in your summary that a SQL file needs applying.
- When you add a table or SQL file, update the README's Database table and the list of SQL files.

## Code patterns to follow

- **Permissions:** the module × role map is `lib/permissions.ts`. Pages call `requireCan(module, action)` or `requireArea(area)` from `lib/auth.ts`; Server Actions call `getActorFor(module, action)` and return an error if it is null. Add new modules to the `GRID` instead of writing role checks inline. Hiding a button is never the security check.
- **Scope:** any action that takes a customer or account id must also check `assertCustomerInScope` / `assertAccountInScope` (`lib/scope.ts`), so a CS Specialist can't act outside their customers.
- **Server Actions** live in `actions.ts` next to the page, validate input with the zod schemas from the matching `lib/*-fields.ts`, return `ActionResult` (`{ ok: true, data } | { ok: false, error }`, in `lib/customer-fields.ts`), and call `revalidatePath` for the pages they change.
- **Client-safe vs server files:** `lib/*-fields.ts` holds constants, labels and zod schemas and is safe in client components. Files that import `prisma` (`lib/customers.ts`, `lib/accounts.ts`, `lib/status.ts`...) are server-only.
- **Status changes** for customers and accounts go only through `lib/status.ts` (status log, activity log, cascades and pending review in one transaction).
- **Activity log:** every write records itself with `logActivity(tx, actor, ...)` from `lib/activity.ts`, inside the same transaction. `fieldChanges()` builds the entries for an edit form.
- **IDs:** customers and accounts get generated `CUST_` / `CLT_` + 12 hex codes (`lib/customers.ts`), checked against the legacy copies too. Don't let users type them.
- Comments explain *why* in plain sentences, often naming the legacy behaviour being kept or fixed. Match that, and match the surrounding naming and formatting.

## Legacy CMS

`legacy/vaa-cms-gas/` is the old Apps Script CMS, cloned with clasp, kept as read-only reference (it's excluded from lint). Don't edit it and don't `clasp push`. Start from `docs/legacy-cms.md`, which summarises its tables, roles and rules with file:line references, before reading the source.

The rebuild goes module by module; module 1 (foundation, Customers & Accounts) is done. `lib/permissions.ts` already lists the later modules, and `MODULE 2:` comments mark the places waiting for them. When importing legacy data, take only records from 2026-08-01 onward (test data only, for now).

## Git workflow

- `main` is the shared branch on GitHub (`vaa-philippines-dev/vaa-sys`). Don't commit or push to it directly; work on a branch and open a PR.
- Pull or merge `origin/main` before starting, since the other developer's work lands there too.
- Only commit or push when asked. Keep the README in step with the change in the same PR (pages, roles, statuses, tables, setup).
