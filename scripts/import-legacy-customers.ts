// Imports the legacy CMS's customers and accounts into vaa-sys (asked for on
// Nov 5, 2026): Customer Management loads and saves its own vaa_sys tables,
// and this copies VA Workforce's copy of the legacy CMS (public.customers,
// public.accounts, synced from the Apps Script sheet) into them, once.
// public.* is only read.
//
//   npm run db:import-legacy                       (a dry run: counts and problems, saves nothing)
//   npm run db:import-legacy -- --apply --by you@vaaphilippines.com
//
// Re-runnable: a customer or account whose CUST_/CLT_ ID is already in vaa-sys
// is left alone, so a second run only adds what's new in the legacy copy. It
// never updates or deletes anything already in vaa-sys.
//
// What each legacy record becomes:
// - Customer: same Customer ID, name, status (since status_date), CS
//   Specialist email, first payment, termination and reactivation counts,
//   notes, created date and creator. A status log row records the imported
//   status, and the legacy status history text is kept as a note.
// - Legacy customers already went through onboarding, so each one is marked
//   onboarded (intake, contract sent and confirmed, handoff, all on its
//   legacy created date, by "Legacy CMS"). Otherwise the Pending ones would
//   show up as leads in Lead Management, and any later lead action would
//   move them back to Customer Intake (lib/lead-phase.ts).
// - Account: same Account ID, name, company, status, Returning, Category,
//   Type and Country/region (missing Country/region options are added to
//   Settings), seller onboarding link, contract (CON-…), contacts, account
//   managers and notes. The legacy CMS has no payment method or invoice
//   source, so those are "Other: not recorded in the legacy CMS" and the
//   primary contact.
import { prisma } from '@/lib/prisma'
import type { Prisma } from '@/src/generated/prisma/client'
import { logActivity } from '@/lib/activity'
import { dateOnly, dayString } from '@/lib/customer-fields'

const LEGACY = 'Legacy CMS'
const SOURCE = 'Imported from the legacy CMS (VA Workforce public.customers / public.accounts)'
const CHUNK = 500

type LegacyCustomer = {
  id: string
  code: string
  name: string
  status: string | null
  statusDate: Date | null
  specialist: string | null
  createdBy: string | null
  notes: string | null
  paymentDate: Date | null
  noPaymentYet: boolean | null
  terminationCount: number | null
  reactivationCount: number | null
  lastStatusReason: string | null
  statusHistory: string | null
  createdAt: Date | null
}

type LegacyAccount = {
  code: string
  customerCode: string | null
  name: string | null
  company: string | null
  primaryContact: string | null
  primaryRole: string | null
  primaryEmail: string | null
  primaryIsFocal: boolean | null
  secondaryContact: string | null
  secondaryRole: string | null
  secondaryEmail: string | null
  secondaryIsFocal: boolean | null
  accountManagers: string | null
  invoiceName: string | null
  invoiceRole: string | null
  invoiceEmail: string | null
  category: string | null
  type: string | null
  countryRegion: string | null
  status: string | null
  statusDate: Date | null
  isReturning: boolean | null
  notes: string | null
  sellerLink: string | null
  contractCode: string | null
  createdAt: Date | null
}

const STATUSES = ['PENDING', 'ACTIVE', 'PAUSED', 'INACTIVE', 'CANCELLED', 'TERMINATED'] as const
type Status = (typeof STATUSES)[number]
const statusOf = (s: string | null): Status | null => {
  const up = (s ?? '').trim().toUpperCase()
  return (STATUSES as readonly string[]).includes(up) ? (up as Status) : null
}
const text = (s: string | null | undefined) => {
  const t = (s ?? '').trim()
  return t === '' ? null : t
}
const email = (s: string | null | undefined) => {
  const t = text(s)?.toLowerCase() ?? null
  return t && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null
}
// "First Last" → first word, the rest.
const splitName = (full: string) => {
  const parts = full.trim().split(/\s+/)
  return { firstName: parts[0] ?? '', lastName: parts.slice(1).join(' ') }
}
const chunks = <T>(rows: T[]) => Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK))

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const by = email(args[args.indexOf('--by') + 1] ?? '')
  if (apply && (!args.includes('--by') || !by)) throw new Error('Say who is running the import: --apply --by you@vaaphilippines.com')

  const [customers, accounts] = await Promise.all([
    prisma.$queryRaw<LegacyCustomer[]>`
      SELECT id, external_customer_id AS code, name, status, status_date AS "statusDate", assigned_specialist AS specialist,
             created_by_email AS "createdBy", notes, payment_date AS "paymentDate", no_payment_yet AS "noPaymentYet",
             termination_count AS "terminationCount", reactivation_count AS "reactivationCount",
             last_status_reason AS "lastStatusReason", status_history AS "statusHistory", cms_created_at AS "createdAt"
      FROM public.customers ORDER BY cms_created_at, external_customer_id`,
    prisma.$queryRaw<LegacyAccount[]>`
      SELECT external_account_id AS code, external_customer_id AS "customerCode", account_name AS name, company_name AS company,
             primary_contact AS "primaryContact", primary_role AS "primaryRole", primary_email AS "primaryEmail", primary_is_focal AS "primaryIsFocal",
             secondary_contact AS "secondaryContact", secondary_role AS "secondaryRole", secondary_email AS "secondaryEmail", secondary_is_focal AS "secondaryIsFocal",
             account_managers AS "accountManagers", invoice_contact_name AS "invoiceName", invoice_contact_role AS "invoiceRole", invoice_contact_email AS "invoiceEmail",
             category, type, country_region AS "countryRegion", status, status_date AS "statusDate", is_returning AS "isReturning", notes,
             seller_onboarding_link AS "sellerLink", contract_id AS "contractCode", cms_created_at AS "createdAt"
      FROM public.accounts ORDER BY cms_created_at, external_account_id`,
  ])

  const [haveCustomers, haveAccounts, options, contracts] = await Promise.all([
    prisma.customer.findMany({ select: { id: true, customerCode: true } }),
    prisma.account.findMany({ select: { accountCode: true } }),
    prisma.settingOption.findMany({ where: { category: { in: ['Category', 'Type', 'CountryRegion'] } }, select: { id: true, category: true, label: true, value: true, sortOrder: true } }),
    prisma.contract.findMany({ select: { id: true, contractCode: true } }),
  ])
  const existingCustomer = new Map(haveCustomers.map((c) => [c.customerCode.toUpperCase(), c.id]))
  const existingAccount = new Set(haveAccounts.map((a) => a.accountCode.toUpperCase()))
  const optionId = (category: string, label: string | null) => {
    const l = text(label)?.toLowerCase()
    return l ? (options.find((o) => o.category === category && (o.label.toLowerCase() === l || o.value.toLowerCase() === l))?.id ?? null) : null
  }
  const contractId = new Map(contracts.map((c) => [c.contractCode.toUpperCase(), c.id]))

  // ── Plan ────────────────────────────────────────────────────────
  const problems: string[] = []
  const newCustomers = customers.filter((c) => {
    if (!/^CUST_[0-9A-F]{12}$/i.test(c.code ?? '')) return problems.push(`Customer without a proper CUST_ ID (legacy row ${c.id}) skipped.`), false
    if (!statusOf(c.status)) return problems.push(`${c.code}: status “${c.status}” isn’t one of vaa-sys’s, skipped.`), false
    return !existingCustomer.has(c.code.toUpperCase())
  })
  const importedCodes = new Set([...existingCustomer.keys(), ...newCustomers.map((c) => c.code.toUpperCase())])
  const newAccounts = accounts.filter((a) => {
    if (!text(a.code)) return problems.push('An account without an ID skipped.'), false
    if (!a.customerCode || !importedCodes.has(a.customerCode.toUpperCase())) return problems.push(`${a.code}: its customer isn’t in the legacy customers (the sheet shows an error there), skipped.`), false
    if (!statusOf(a.status)) return problems.push(`${a.code}: status “${a.status}” isn’t one of vaa-sys’s, skipped.`), false
    return !existingAccount.has(a.code.toUpperCase())
  })
  const missingRegions = [...new Set(newAccounts.map((a) => text(a.countryRegion)).filter((r): r is string => !!r && !optionId('CountryRegion', r)))].sort()
  const unknownCategory = newAccounts.filter((a) => text(a.category) && !optionId('Category', a.category)).length
  const unknownType = newAccounts.filter((a) => text(a.type) && !optionId('Type', a.type)).length
  const unknownContract = newAccounts.filter((a) => text(a.contractCode) && !contractId.has(a.contractCode!.toUpperCase())).length
  const specialists = [...new Set(newCustomers.map((c) => email(c.specialist)).filter((e): e is string => !!e))]
  const onAccess = new Set((await prisma.accessUser.findMany({ where: { email: { in: specialists }, isActive: true }, select: { email: true } })).map((a) => a.email))

  console.log(apply ? 'IMPORT' : 'DRY RUN (nothing is saved; add --apply --by <email> to import)')
  console.log(`Customers: ${customers.length} in the legacy copy, ${newCustomers.length} to add, ${customers.length - newCustomers.length} already in vaa-sys or skipped.`)
  console.log(`  by status: ${STATUSES.map((s) => `${s} ${newCustomers.filter((c) => statusOf(c.status) === s).length}`).join(', ')}`)
  console.log(`Accounts: ${accounts.length} in the legacy copy, ${newAccounts.length} to add, ${accounts.length - newAccounts.length} already in vaa-sys or skipped.`)
  console.log(`Country/region options to add to Settings: ${missingRegions.length}`)
  if (unknownCategory || unknownType || unknownContract) console.log(`Left blank (not in Settings/Contracts): category ${unknownCategory}, type ${unknownType}, contract ${unknownContract}`)
  console.log(`CS Specialists named on the customers: ${specialists.length}, of whom ${onAccess.size} are on the Access page. The others need a Customer Specialist row on Access to see their customers.`)
  for (const p of problems) console.log(`  ! ${p}`)
  if (!apply) return importConnections(false, null)

  // ── Import ──────────────────────────────────────────────────────
  const actor = { email: by! }
  const now = new Date()
  const day = (d: Date | null) => (d ? dateOnly(dayString(d)) : null)

  const result = await prisma.$transaction(
    async (tx) => {
      // Settings: the legacy Country/region values that aren't there yet.
      let sort = Math.max(0, ...options.filter((o) => o.category === 'CountryRegion').map((o) => o.sortOrder))
      for (const part of chunks(missingRegions)) {
        const made = await tx.settingOption.createManyAndReturn({
          data: part.map((label) => ({ category: 'CountryRegion', value: label, label, sortOrder: ++sort })),
          select: { id: true, category: true, label: true, value: true, sortOrder: true },
        })
        options.push(...made)
      }

      // Customers.
      const customerId = new Map(existingCustomer)
      for (const part of chunks(newCustomers)) {
        const made = await tx.customer.createManyAndReturn({
          data: part.map((c) => {
            const created = c.createdAt ?? now
            const status = statusOf(c.status)!
            return {
              customerCode: c.code.toUpperCase(),
              name: c.name.trim() || c.code,
              status,
              statusChangedAt: c.statusDate ?? created,
              notes: text(c.notes),
              assignedSpecialistEmail: email(c.specialist),
              paymentDate: day(c.paymentDate),
              noPaymentYet: c.noPaymentYet ?? !c.paymentDate,
              terminationCount: c.terminationCount ?? 0,
              reactivationCount: c.reactivationCount ?? 0,
              createdByEmail: email(c.createdBy) ?? LEGACY,
              createdAt: created,
              // Onboarded before vaa-sys (see the top of this file).
              leadPhase: 'NEW_CUSTOMER_ONBOARDED' as const,
              leadPhaseChangedAt: created,
              intakeCompletedAt: created,
              contractSentAt: created,
              contractSentByEmail: LEGACY,
              contractConfirmedAt: created,
              contractConfirmedByEmail: LEGACY,
              handoffCompletedAt: created,
              handoffCompletedByEmail: LEGACY,
            } satisfies Prisma.CustomerCreateManyInput
          }),
          select: { id: true, customerCode: true },
        })
        for (const m of made) customerId.set(m.customerCode.toUpperCase(), m.id)
      }
      const added = newCustomers.map((c) => ({ c, id: customerId.get(c.code.toUpperCase())! }))
      for (const part of chunks(added)) {
        await tx.customerStatusLog.createMany({
          data: part.map(({ c, id }) => ({
            customerId: id,
            fromStatus: null,
            toStatus: statusOf(c.status)!,
            reason: text(c.lastStatusReason) ? `${text(c.lastStatusReason)} (from the legacy CMS)` : 'Status in the legacy CMS',
            effectiveDate: c.statusDate,
            changedByEmail: LEGACY,
            changedAt: c.statusDate ?? c.createdAt ?? now,
          })),
        })
      }
      const histories = added.filter(({ c }) => text(c.statusHistory))
      for (const part of chunks(histories)) {
        await tx.customerAccountNote.createMany({
          data: part.map(({ c, id }) => ({ customerId: id, body: `Status history from the legacy CMS:\n${text(c.statusHistory)}`, createdByEmail: LEGACY, createdAt: now })),
        })
      }

      // Accounts.
      const accountRows: { a: LegacyAccount; id: string; customerId: string }[] = []
      for (const part of chunks(newAccounts)) {
        const made = await tx.account.createManyAndReturn({
          data: part.map((a) => {
            const created = a.createdAt ?? now
            const primary = email(a.primaryEmail)
            const invoice = email(a.invoiceEmail)
            return {
              accountCode: a.code.trim(),
              customerId: customerId.get(a.customerCode!.toUpperCase())!,
              name: text(a.name) ?? text(a.company) ?? a.code,
              companyName: text(a.company) ?? text(a.name) ?? a.code,
              invoiceContactSource: invoice && invoice !== primary ? ('OTHER' as const) : ('PRIMARY' as const),
              invoiceContactName: text(a.invoiceName),
              invoiceContactRole: text(a.invoiceRole),
              invoiceContactEmail: invoice ?? primary ?? '',
              paymentMethod: 'OTHER' as const,
              paymentMethodOther: 'Not recorded in the legacy CMS',
              status: statusOf(a.status)!,
              statusChangedAt: a.statusDate ?? created,
              isReturning: a.isReturning ?? false,
              categoryId: optionId('Category', a.category),
              typeId: optionId('Type', a.type),
              countryRegionId: optionId('CountryRegion', a.countryRegion),
              sellerOnboardingLink: text(a.sellerLink),
              contractId: text(a.contractCode) ? (contractId.get(a.contractCode!.toUpperCase()) ?? null) : null,
              createdAt: created,
            } satisfies Prisma.AccountCreateManyInput
          }),
          select: { id: true, accountCode: true, customerId: true },
        })
        const byCode = new Map(made.map((m) => [m.accountCode, m]))
        for (const a of part) {
          const m = byCode.get(a.code.trim())!
          accountRows.push({ a, id: m.id, customerId: m.customerId })
        }
      }
      for (const part of chunks(accountRows)) {
        await tx.accountStatusLog.createMany({
          data: part.map(({ a, id }) => ({
            accountId: id,
            fromStatus: null,
            toStatus: statusOf(a.status)!,
            reason: 'Status in the legacy CMS',
            effectiveDate: a.statusDate,
            changedByEmail: LEGACY,
            changedAt: a.statusDate ?? a.createdAt ?? now,
          })),
        })
        const contacts: Prisma.AccountContactCreateManyInput[] = []
        const managers: Prisma.AccountManagerCreateManyInput[] = []
        const notes: Prisma.CustomerAccountNoteCreateManyInput[] = []
        for (const { a, id, customerId: cid } of part) {
          // One focal contact per account (account_contacts_one_focal_per_account):
          // the legacy sheet sometimes ticks both, and then the primary stays focal.
          const primaryFocal = !!text(a.primaryContact) && (a.primaryIsFocal ?? true)
          if (text(a.primaryContact)) {
            contacts.push({ accountId: id, kind: 'PRIMARY', ...splitName(a.primaryContact!), role: text(a.primaryRole), email: email(a.primaryEmail) ?? '', isFocal: primaryFocal })
          }
          if (text(a.secondaryContact)) {
            contacts.push({ accountId: id, kind: 'SECONDARY', ...splitName(a.secondaryContact!), role: text(a.secondaryRole), email: email(a.secondaryEmail) ?? '', isFocal: !primaryFocal && !!a.secondaryIsFocal })
          }
          ;(text(a.accountManagers) ?? '')
            .split(',')
            .map((n) => n.trim())
            .filter(Boolean)
            .forEach((n, i) => managers.push({ accountId: id, name: n, sortOrder: i }))
          if (text(a.notes)) notes.push({ customerId: cid, accountId: id, body: text(a.notes)!, createdByEmail: LEGACY, createdAt: a.createdAt ?? now })
        }
        if (contacts.length) await tx.accountContact.createMany({ data: contacts })
        if (managers.length) await tx.accountManager.createMany({ data: managers })
        if (notes.length) await tx.customerAccountNote.createMany({ data: notes })
      }

      // One activity row per record, so each one's history says where it came from.
      const entries = [
        ...added.map(({ c, id }) => ({ entityType: 'Customer', entityId: id, entityLabel: c.name, customerId: id, action: 'CREATE', newValue: c.code, notes: SOURCE })),
        ...accountRows.map(({ a, id, customerId: cid }) => ({ entityType: 'Account', entityId: id, entityLabel: `${text(a.name) ?? a.code} (${a.code})`, customerId: cid, action: 'CREATE', newValue: a.code, notes: SOURCE })),
        ...missingRegions.map((r) => ({ entityType: 'SettingOption', entityId: r, entityLabel: `Country/region: ${r}`, action: 'CREATE', notes: SOURCE })),
      ]
      for (const part of chunks(entries)) await logActivity(tx, actor, part)
      return { customers: added.length, accounts: accountRows.length, regions: missingRegions.length }
    },
    { maxWait: 20_000, timeout: 600_000 }
  )
  console.log(`Imported ${result.customers} customers, ${result.accounts} accounts and ${result.regions} Country/region options.`)
  await importConnections(true, by)
}

// ── VA connections (Nov 5, 2026) ──────────────────────────────────
//
// The legacy CMS's VA connections, from VA Workforce's copy
// (public.va_connection_records), onto the imported accounts by their CLT_
// ID. Each keeps its CONN_ ID, status, VA (legacy id and name: they don't
// match VA Workforce's profiles), service, department, hours and dates. The
// legacy rates and rate agreements are left out. Needs SQL 012; re-runnable
// like the rest (a CONN_ ID already in vaa-sys is left alone).

type LegacyConnection = {
  code: string | null
  status: string | null
  connectionType: string | null
  vaId: string | null
  vaName: string | null
  accountCode: string | null
  department: string | null
  service: string | null
  hours: string | null
  hoursType: string | null
  connectionDate: string | null
  startDate: string | null
  endDate: string | null
  notes: string | null
}

const CONNECTION_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'STARTED', 'PAUSED', 'CANCELLED', 'TERMINATED', 'UNKNOWN'] as const
type ConnectionStatus = (typeof CONNECTION_STATUSES)[number]
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// The legacy sheet's two date styles: "Oct 2026 29" and "Jul 17 2026".
function legacyDay(s: string | null): Date | null {
  const m = /^([A-Za-z]{3})[a-z]*\s+(\d{1,4}),?\s+(\d{1,4})$/.exec((s ?? '').trim())
  if (!m) return null
  const month = MONTHS.indexOf(m[1].toLowerCase())
  const [year, dayN] = m[2].length === 4 ? [Number(m[2]), Number(m[3])] : [Number(m[3]), Number(m[2])]
  if (month < 0 || year < 2000 || dayN < 1 || dayN > 31) return null
  const d = new Date(Date.UTC(year, month, dayN))
  return d.getUTCMonth() === month ? d : null
}

async function importConnections(apply: boolean, by: string | null) {
  const ready = await prisma.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('vaa_sys.va_connections') IS NOT NULL AS ok`
  if (!ready[0]?.ok) return console.log('VA connections: apply prisma/sql/012_service_requests_va_connections.sql first, then run this again to import them.')

  const [rows, accounts, have] = await Promise.all([
    prisma.$queryRaw<LegacyConnection[]>`
      SELECT connection_id AS code, status, connection_type AS "connectionType", va_external_id AS "vaId", va_name AS "vaName",
             client_external_id AS "accountCode", department, service, hours, hours_type AS "hoursType",
             connection_date AS "connectionDate", start_date AS "startDate", termination_date AS "endDate", notes
      FROM public.va_connection_records ORDER BY connection_id`,
    prisma.account.findMany({ select: { id: true, accountCode: true, customerId: true } }),
    prisma.vaConnection.findMany({ select: { connectionCode: true } }),
  ])
  const accountOf = new Map(accounts.map((a) => [a.accountCode.toUpperCase(), a]))
  const existing = new Set(have.map((h) => h.connectionCode.toUpperCase()))
  const noAccount = rows.filter((r) => !r.accountCode || !accountOf.has(r.accountCode.toUpperCase())).length
  const todo = rows.filter((r) => text(r.code) && r.accountCode && accountOf.has(r.accountCode.toUpperCase()) && !existing.has(r.code!.toUpperCase()))
  const statusOfConn = (s: string | null): ConnectionStatus => {
    const up = (s ?? '').trim().toUpperCase()
    return (CONNECTION_STATUSES as readonly string[]).includes(up) ? (up as ConnectionStatus) : 'UNKNOWN'
  }
  console.log(`VA connections: ${rows.length} in the legacy copy, ${todo.length} to add, ${rows.length - todo.length - noAccount} already in vaa-sys, ${noAccount} skipped (their account isn’t in vaa-sys).`)
  console.log(`  by status: ${CONNECTION_STATUSES.map((s) => `${s} ${todo.filter((r) => statusOfConn(r.status) === s).length}`).join(', ')}`)
  if (!apply) return

  const actor = { email: by! }
  const added = await prisma.$transaction(
    async (tx) => {
      let n = 0
      for (const part of chunks(todo)) {
        const made = await tx.vaConnection.createManyAndReturn({
          data: part.map((r) => {
            const a = accountOf.get(r.accountCode!.toUpperCase())!
            const start = legacyDay(r.startDate)
            const end = legacyDay(r.endDate)
            const status = statusOfConn(r.status)
            return {
              connectionCode: r.code!.trim(),
              customerId: a.customerId,
              accountId: a.id,
              vaExternalId: text(r.vaId),
              vaName: text(r.vaName) ?? text(r.vaId) ?? 'VA',
              status,
              statusChangedAt: (status === 'TERMINATED' || status === 'CANCELLED' ? end : null) ?? start ?? legacyDay(r.connectionDate) ?? new Date(),
              connectionType: text(r.connectionType),
              service: text(r.service),
              department: text(r.department),
              hours: text(r.hours),
              hoursType: text(r.hoursType),
              connectionDate: legacyDay(r.connectionDate),
              startDate: start,
              endDate: end,
              notes: text(r.notes),
              source: 'LEGACY',
              createdByEmail: LEGACY,
            } satisfies Prisma.VaConnectionCreateManyInput
          }),
          select: { id: true, connectionCode: true, customerId: true, vaName: true },
        })
        await logActivity(
          tx,
          actor,
          made.map((m) => ({ entityType: 'VaConnection', entityId: m.id, entityLabel: `${m.connectionCode} (${m.vaName})`, customerId: m.customerId, action: 'CREATE', notes: SOURCE }))
        )
        n += made.length
      }
      return n
    },
    { maxWait: 20_000, timeout: 600_000 }
  )
  console.log(`Imported ${added} VA connections.`)
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
