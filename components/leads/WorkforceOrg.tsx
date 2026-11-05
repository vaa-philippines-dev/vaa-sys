'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Building2, BriefcaseBusiness, Eye, EyeOff, Loader2, LockKeyhole, Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { Markdown, MarkdownEditor } from '@/components/ui/markdown'
import { SortableTable } from '@/components/ui/sortable-table'
import { updateDepartment, updateServiceDetails, updateServiceRates } from '@/app/(lms)/leads/departments/actions'
import {
  DEPARTMENT_STATUSES,
  DEPARTMENT_STATUS_LABELS,
  RATE_PROBLEMS,
  departmentPath,
  type ContractOption,
  type DepartmentInput,
  type OrgDepartment,
  type OrgService,
  type RateCell,
} from '@/lib/workforce-org-fields'
import { SERVICE_OFFERINGS } from '@/lib/onboarding-fields'
import { cn } from '@/lib/utils'

const NEW = 'new'
const byOrder = <T extends { sortOrder: number }>(name: (x: T) => string) => (a: T, b: T) => a.sortOrder - b.sortOrder || name(a).localeCompare(name(b))
const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

// Workforce's service departments in tree order: the Service group, then
// what sits under it, with each one's depth for the indent.
function treeOrder(departments: OrgDepartment[]) {
  const kids = new Map<string | null, OrgDepartment[]>()
  const ids = new Set(departments.map((d) => d.id))
  for (const d of departments) {
    const key = d.parentId && ids.has(d.parentId) ? d.parentId : null
    kids.set(key, [...(kids.get(key) ?? []), d])
  }
  const out: { d: OrgDepartment; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null, depth: number) => {
    for (const d of (kids.get(parent) ?? []).sort(byOrder((x) => x.name))) {
      if (seen.has(d.id)) continue
      seen.add(d.id)
      out.push({ d, depth })
      walk(d.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

function descendantsOf(id: string, departments: OrgDepartment[]) {
  const out = new Set<string>([id])
  let grew = true
  while (grew) {
    grew = false
    for (const d of departments) {
      if (d.parentId && out.has(d.parentId) && !out.has(d.id)) {
        out.add(d.id)
        grew = true
      }
    }
  }
  return out
}

export function WorkforceOrg({
  departments,
  services,
  contracts,
  canEdit,
  showRates,
  ratesKeySet,
}: {
  departments: OrgDepartment[]
  services: OrgService[]
  contracts: ContractOption[]
  // Admins: departments and a service's details.
  canEdit: boolean
  // People allowed to see the confidential rates (lib/rates.ts).
  showRates: boolean
  // Whether this server has the rates key (only told to rate viewers).
  ratesKeySet: boolean
}) {
  const [tab, setTab] = useState<'services' | 'departments'>('services')
  const tabs = [
    { key: 'services' as const, label: 'Services', count: services.length, Icon: BriefcaseBusiness },
    { key: 'departments' as const, label: 'Service departments', count: departments.length, Icon: Building2 },
  ]
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Workforce" className="inline-flex rounded-xl border bg-card p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium',
              tab === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <t.Icon className="h-4 w-4" strokeWidth={1.75} />
            {t.label}
            <span className="text-xs tabular-nums opacity-75">{t.count}</span>
          </button>
        ))}
      </div>
      {tab === 'services' ? (
        <Services services={services} departments={departments} contracts={contracts} canEdit={canEdit} showRates={showRates} keySet={ratesKeySet} />
      ) : (
        <Departments departments={departments} canEdit={canEdit} />
      )}
    </div>
  )
}

function StatusPill({ active, label }: { active: boolean; label: string }) {
  return <span className={cn('inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium', active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>{label}</span>
}

// ── Services ─────────────────────────────────────────────────────

function RateText({ cell, hidden }: { cell: RateCell; hidden: boolean }) {
  if (cell.problem)
    return (
      <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground" title={RATE_PROBLEMS[cell.problem]}>
        <LockKeyhole className="h-3 w-3" /> {cell.problem === 'locked' ? 'Locked' : 'Unreadable'}
      </span>
    )
  if (cell.value === null) return <span className="text-muted-foreground">Not set</span>
  return <span className="tabular-nums">{hidden ? '••••' : `${usd.format(cell.value)}/h`}</span>
}

function Services({
  services,
  departments,
  contracts,
  canEdit,
  showRates,
  keySet,
}: {
  services: OrgService[]
  departments: OrgDepartment[]
  contracts: ContractOption[]
  canEdit: boolean
  showRates: boolean
  keySet: boolean
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const deptName = useMemo(() => new Map(departments.map((d) => [d.id, d.name])), [departments])
  const contractLabel = useMemo(() => new Map(contracts.map((c) => [c.id, c.label])), [contracts])
  const anyLocked = !keySet

  const columns = [
    { key: 'name', label: 'Service', className: 'py-3 pl-5 pr-3 font-medium' },
    { key: 'departments', label: 'Departments', className: 'hidden px-3 py-3 font-medium md:table-cell' },
    { key: 'billedAs', label: 'Onboarding form service', className: 'hidden px-3 py-3 font-medium lg:table-cell' },
    { key: 'contract', label: 'Contract template', className: 'hidden px-3 py-3 font-medium lg:table-cell' },
    { key: 'jd', label: 'Job description', className: 'px-3 py-3 font-medium' },
    ...(showRates
      ? [
          { key: 'standard', label: 'Standard billing rate', align: 'right' as const, firstDir: 'desc' as const, className: 'px-3 py-3 font-medium' },
          { key: 'vaBase', label: 'VA base rate', align: 'right' as const, firstDir: 'desc' as const, className: 'px-3 py-3 font-medium' },
        ]
      : []),
    { key: 'edit', label: <span className="sr-only">Edit</span>, sortable: false, className: 'py-3 pl-3 pr-5' },
  ]
  const span = columns.length

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-muted-foreground">
          VAA Workforce’s services. The Job Description is saved to Workforce. The onboarding form service is how a lead’s request finds its service, so a new initial bill starts from its Standard Billing Rate.
        </p>
        {showRates && (
          <Button size="sm" variant="outline" onClick={() => setRevealed((r) => !r)} aria-pressed={revealed}>
            {revealed ? <EyeOff /> : <Eye />} {revealed ? 'Hide rates' : 'Show rates'}
          </Button>
        )}
      </div>
      {showRates && anyLocked && (
        <p className="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-[13px] text-warning">
          <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          The rates key isn’t set on this server, so the confidential rates can’t be read or saved here. They work on the live site, where the key is set.
        </p>
      )}
      <div className="overflow-x-auto rounded-2xl border bg-card">
        <SortableTable
          className="w-full text-sm"
          theadClassName="text-left text-[11px] uppercase tracking-wide text-muted-foreground"
          headRowClassName="border-b"
          columns={columns}
          rows={services.map((s) => {
            const depts = s.departmentIds.map((id) => deptName.get(id)).filter(Boolean).join(', ')
            const contract = s.contractId ? (contractLabel.get(s.contractId) ?? null) : null
            const open = editing === s.id
            return {
              id: s.id,
              values: {
                name: s.name,
                departments: depts,
                billedAs: s.onboardingService,
                contract,
                jd: s.jobDescription ? 1 : 0,
                standard: s.rates?.standard.value ?? null,
                vaBase: s.rates?.vaBase.value ?? null,
              },
              node: (
                <tr key={s.id} className={cn('border-b last:border-b-0 align-top', !s.isActive && 'text-muted-foreground')}>
                  <td className="py-2.5 pl-5 pr-3">
                    <span className="font-medium">{s.name}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {s.category.charAt(0) + s.category.slice(1).toLowerCase()}
                      {!s.isActive && ' · inactive in Workforce'}
                    </span>
                  </td>
                  <td className="hidden px-3 py-2.5 text-[13px] md:table-cell">{depts || <span className="text-muted-foreground">None</span>}</td>
                  <td className="hidden px-3 py-2.5 text-[13px] lg:table-cell">{s.onboardingService ?? <span className="text-muted-foreground">None</span>}</td>
                  <td className="hidden px-3 py-2.5 text-[13px] lg:table-cell">{contract ?? <span className="text-muted-foreground">None</span>}</td>
                  <td className="px-3 py-2.5 text-[13px]">{s.jobDescription ? 'Written' : <span className="text-muted-foreground">Not yet</span>}</td>
                  {s.rates && (
                    <>
                      <td className="px-3 py-2.5 text-right text-[13px]">
                        <RateText cell={s.rates.standard} hidden={!revealed} />
                      </td>
                      <td className="px-3 py-2.5 text-right text-[13px]">
                        <RateText cell={s.rates.vaBase} hidden={!revealed} />
                      </td>
                    </>
                  )}
                  <td className="py-2.5 pl-3 pr-5 text-right">
                    <button
                      type="button"
                      onClick={() => setEditing(open ? null : s.id)}
                      aria-expanded={open}
                      className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={`${canEdit || showRates ? 'Edit' : 'View'} ${s.name}`}
                    >
                      {canEdit || showRates ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </td>
                </tr>
              ),
              after: open ? (
                <tr className="border-b bg-muted/30">
                  <td colSpan={span} className="px-5 py-4">
                    <ServicePanel service={s} services={services} contracts={contracts} canEdit={canEdit} keySet={keySet} onDone={() => setEditing(null)} />
                  </td>
                </tr>
              ) : null,
            }
          })}
        />
      </div>
    </section>
  )
}

function ServicePanel({
  service,
  services,
  contracts,
  canEdit,
  keySet,
  onDone,
}: {
  service: OrgService
  services: OrgService[]
  contracts: ContractOption[]
  canEdit: boolean
  keySet: boolean
  onDone: () => void
}) {
  return (
    <div className="space-y-6">
      {canEdit ? (
        <ServiceDetailsForm service={service} services={services} contracts={contracts} onDone={onDone} />
      ) : (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Job description</p>
          {service.jobDescription ? <Markdown text={service.jobDescription} /> : <p className="text-sm text-muted-foreground">Not written yet.</p>}
        </div>
      )}
      {service.rates && <ServiceRatesForm service={service} keySet={keySet} />}
    </div>
  )
}

function ServiceDetailsForm({ service, services, contracts, onDone }: { service: OrgService; services: OrgService[]; contracts: ContractOption[]; onDone: () => void }) {
  const router = useRouter()
  const [saving, start] = useTransition()
  const [jd, setJd] = useState(service.jobDescription ?? '')
  const [contractId, setContractId] = useState(service.contractId ?? '')
  const [onboarding, setOnboarding] = useState(service.onboardingService ?? '')
  // An onboarding form service bills as one service only.
  const takenBy = useMemo(() => new Map(services.filter((s) => s.id !== service.id && s.onboardingService).map((s) => [s.onboardingService!, s.name])), [services, service.id])

  const save = () =>
    start(async () => {
      const result = await updateServiceDetails(service.id, { jobDescription: jd, contractId: contractId || null, onboardingService: onboarding || null })
      if (!result.ok) return void toast.error(result.error)
      toast.success(`${service.name} saved.`)
      onDone()
      router.refresh()
    })

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold">{service.name}</p>
      <div className="space-y-1.5">
        <Label htmlFor={`jd-${service.id}`}>Job description</Label>
        <MarkdownEditor id={`jd-${service.id}`} value={jd} onChange={setJd} placeholder="What the VA does, what they need to know, which tools they use…" />
        <p className="text-xs text-muted-foreground">Saved to VAA Workforce’s own job description for this service.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`contract-${service.id}`}>Contract template</Label>
          <NativeSelect id={`contract-${service.id}`} value={contractId} onChange={(e) => setContractId(e.target.value)}>
            <option value="">None</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`onboarding-${service.id}`}>Onboarding form service</Label>
          <NativeSelect id={`onboarding-${service.id}`} value={onboarding} onChange={(e) => setOnboarding(e.target.value)}>
            <option value="">None</option>
            {SERVICE_OFFERINGS.map((o) => (
              <option key={o} value={o} disabled={takenBy.has(o)}>
                {o}
                {takenBy.has(o) ? ` (${takenBy.get(o)})` : ''}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />} Save service
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function ServiceRatesForm({ service, keySet }: { service: OrgService; keySet: boolean }) {
  const router = useRouter()
  const [saving, start] = useTransition()
  const rates = service.rates!
  const problem = !keySet ? 'locked' : (rates.standard.problem ?? rates.vaBase.problem)
  const locked = !!problem
  const [standard, setStandard] = useState(rates.standard.value == null ? '' : String(rates.standard.value))
  const [vaBase, setVaBase] = useState(rates.vaBase.value == null ? '' : String(rates.vaBase.value))
  const num = (v: string) => (v.trim() === '' ? null : Number(v))

  const save = () =>
    start(async () => {
      const result = await updateServiceRates(service.id, { standard: num(standard), vaBase: num(vaBase) })
      if (!result.ok) return void toast.error(result.error)
      toast.success('Rates saved.')
      router.refresh()
    })

  return (
    <div className="space-y-3 rounded-xl border border-dashed bg-card p-4">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <LockKeyhole className="h-3.5 w-3.5" /> Confidential rates
      </p>
      <p className="text-xs text-muted-foreground">
        Only the people on User access → Confidential rates see these. They’re stored encrypted. The Standard Billing Rate is where a new initial bill starts for this service, so it shows on the bills made from it.
      </p>
      {locked ? (
        <p className="text-[13px] text-muted-foreground">{RATE_PROBLEMS[problem!]}. They can be set on the live site, where the key is.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`std-${service.id}`}>Standard billing rate (USD per hour)</Label>
              <Input id={`std-${service.id}`} type="number" inputMode="decimal" min={0} step="0.01" value={standard} onChange={(e) => setStandard(e.target.value)} placeholder="Not set" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`va-${service.id}`}>VA base rate (USD per hour)</Label>
              <Input id={`va-${service.id}`} type="number" inputMode="decimal" min={0} step="0.01" value={vaBase} onChange={(e) => setVaBase(e.target.value)} placeholder="Not set" autoComplete="off" />
            </div>
          </div>
          {rates.updatedAt && (
            <p className="text-[11px] text-muted-foreground">
              Last changed {new Date(rates.updatedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })}
              {rates.updatedBy && ` by ${rates.updatedBy}`}.
            </p>
          )}
          <Button onClick={save} disabled={saving} variant="outline">
            {saving && <Loader2 className="animate-spin" />} Save rates
          </Button>
        </>
      )}
    </div>
  )
}

// ── Service departments ──────────────────────────────────────────

function Departments({ departments, canEdit }: { departments: OrgDepartment[]; canEdit: boolean }) {
  const [editing, setEditing] = useState<string | null>(null)
  const rows = useMemo(() => treeOrder(departments), [departments])

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Workforce’s service departments, the ones customers pick on the onboarding form, nested the way Workforce nests them.</p>
        {canEdit && (
          <Button size="sm" variant="outline" onClick={() => setEditing(NEW)} disabled={editing === NEW}>
            <Plus /> Add service department
          </Button>
        )}
      </div>
      {editing === NEW && (
        <div className="rounded-2xl border bg-card p-4">
          <DepartmentForm departments={departments} onDone={() => setEditing(null)} />
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border bg-card">
        {/* Unsorted, the rows are Workforce's tree; sorted, a flat list (the indent stays as a hint). */}
        <SortableTable
          className="w-full text-sm"
          theadClassName="text-left text-[11px] uppercase tracking-wide text-muted-foreground"
          headRowClassName="border-b"
          columns={[
            { key: 'name', label: 'Department', className: 'py-3 pl-5 pr-3 font-medium' },
            { key: 'status', label: 'Status', className: 'px-3 py-3 font-medium' },
            { key: 'services', label: 'Services', align: 'right', firstDir: 'desc', className: 'hidden px-3 py-3 font-medium sm:table-cell' },
            { key: 'people', label: 'People', align: 'right', firstDir: 'desc', className: 'hidden px-3 py-3 font-medium sm:table-cell' },
            { key: 'edit', label: <span className="sr-only">Edit</span>, sortable: false, className: 'py-3 pl-3 pr-5' },
          ]}
          rows={rows.map(({ d, depth }) => ({
            id: d.id,
            values: { name: d.name, status: DEPARTMENT_STATUSES.indexOf(d.status), services: d.serviceCount, people: d.memberCount },
            node: <DepartmentRow key={d.id} d={d} depth={depth} canEdit={canEdit} open={editing === d.id} onEdit={() => setEditing(editing === d.id ? null : d.id)} />,
            after:
              editing === d.id ? (
                <tr className="border-b bg-muted/30">
                  <td colSpan={5} className="px-5 py-4">
                    <DepartmentForm department={d} departments={departments} onDone={() => setEditing(null)} />
                  </td>
                </tr>
              ) : null,
          }))}
        />
      </div>
    </section>
  )
}

function DepartmentRow({ d, depth, canEdit, open, onEdit }: { d: OrgDepartment; depth: number; canEdit: boolean; open: boolean; onEdit: () => void }) {
  const readOnly = d.status === 'MERGED' || d.status === 'SPLIT'
  return (
    <tr className={cn('border-b last:border-b-0', d.status !== 'ACTIVE' && 'text-muted-foreground')}>
      <td className="py-2.5 pl-5 pr-3" style={{ paddingLeft: `${1.25 + depth * 1.25}rem` }}>
        <span className={cn('font-medium', depth === 0 && 'font-semibold')}>{d.name}</span>
        {(d.acronym || d.shortName) && <span className="ml-1.5 text-xs text-muted-foreground">{[d.acronym, d.shortName].filter(Boolean).join(' · ')}</span>}
        {(d.headName || d.mergedIntoName) && (
          <p className="text-[11px] text-muted-foreground">
            {d.headName && `Head: ${d.headName}`}
            {d.headName && d.mergedIntoName && ' · '}
            {d.mergedIntoName && `Merged into ${d.mergedIntoName}`}
          </p>
        )}
      </td>
      <td className="px-3 py-2.5">
        <StatusPill active={d.status === 'ACTIVE'} label={DEPARTMENT_STATUS_LABELS[d.status]} />
      </td>
      <td className="hidden px-3 py-2.5 text-right tabular-nums sm:table-cell">{d.serviceCount}</td>
      <td className="hidden px-3 py-2.5 text-right tabular-nums sm:table-cell">{d.memberCount}</td>
      <td className="py-2.5 pl-3 pr-5 text-right">
        {!canEdit ? null : readOnly ? (
          <span className="text-[11px] text-muted-foreground" title="Merged and split departments are changed in Workforce">
            In Workforce
          </span>
        ) : (
          <button type="button" onClick={onEdit} aria-expanded={open} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Edit ${d.name}`}>
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </td>
    </tr>
  )
}

function DepartmentForm({ department, departments, onDone }: { department?: OrgDepartment; departments: OrgDepartment[]; onDone: () => void }) {
  const router = useRouter()
  const [saving, start] = useTransition()
  // A new one goes under the top Service department unless another is picked.
  const top = departments.find((d) => !d.parentId)?.id ?? ''
  const [v, setV] = useState({
    name: department?.name ?? '',
    shortName: department?.shortName ?? '',
    acronym: department?.acronym ?? '',
    description: department?.description ?? '',
    parentId: department ? (department.parentId ?? '') : top,
    status: department?.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE',
    sortOrder: String(department?.sortOrder ?? 0),
  })
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }))
  const id = department?.id ?? NEW

  const byId = useMemo(() => new Map(departments.map((d) => [d.id, d])), [departments])
  const parents = useMemo(() => {
    const blocked = department ? descendantsOf(department.id, departments) : new Set<string>()
    return departments
      .filter((d) => !blocked.has(d.id))
      .map((d) => ({ id: d.id, label: departmentPath(d.id, byId) + (d.status === 'ACTIVE' ? '' : ` (${DEPARTMENT_STATUS_LABELS[d.status]})`) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [department, departments, byId])

  const save = () =>
    start(async () => {
      const input = {
        name: v.name,
        shortName: v.shortName,
        acronym: v.acronym,
        description: v.description,
        parentId: v.parentId || null,
        status: v.status,
        sortOrder: v.sortOrder === '' ? Number.NaN : Number(v.sortOrder),
      } as DepartmentInput
      const result = await updateDepartment(department?.id ?? null, input)
      if (!result.ok) return void toast.error(result.error)
      toast.success(department ? `${v.name.trim()} saved in Workforce.` : `${v.name.trim()} added to Workforce.`)
      onDone()
      router.refresh()
    })

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold">{department ? `Edit ${department.name}` : 'New service department'}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`dept-name-${id}`}>Name</Label>
          <Input id={`dept-name-${id}`} value={v.name} onChange={set('name')} maxLength={120} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`dept-short-${id}`}>Short name</Label>
          <Input id={`dept-short-${id}`} value={v.shortName} onChange={set('shortName')} maxLength={60} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`dept-acronym-${id}`}>Acronym</Label>
          <Input id={`dept-acronym-${id}`} value={v.acronym} onChange={set('acronym')} maxLength={20} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`dept-parent-${id}`}>Sits under</Label>
          <NativeSelect id={`dept-parent-${id}`} value={v.parentId} onChange={set('parentId')}>
            <option value="">Nothing (top level)</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`dept-status-${id}`}>Status</Label>
          <NativeSelect id={`dept-status-${id}`} value={v.status} onChange={set('status')}>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`dept-order-${id}`}>Order</Label>
          <Input id={`dept-order-${id}`} type="number" min={0} step={1} value={v.sortOrder} onChange={set('sortOrder')} />
        </div>
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
          <Label htmlFor={`dept-desc-${id}`}>Description</Label>
          <Textarea id={`dept-desc-${id}`} value={v.description} onChange={set('description')} rows={2} maxLength={1000} />
        </div>
      </div>
      {department && department.status === 'ACTIVE' && v.status === 'INACTIVE' && department.memberCount > 0 && (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-[13px] text-warning">
          {department.memberCount} {department.memberCount === 1 ? 'person is' : 'people are'} still in {department.name} in Workforce. Setting it Inactive doesn’t move them.
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={save} disabled={saving}>
          {saving && <Loader2 className="animate-spin" />} {department ? 'Save department' : 'Add department'}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
