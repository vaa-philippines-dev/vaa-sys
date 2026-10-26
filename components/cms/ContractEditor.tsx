'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { NativeSelect } from '@/components/ui/native-select'
import { addSectionDef, saveContract, setContractActive, setSectionDefActive } from '@/app/(cms)/contracts/actions'
import { CONTRACT_PERIODS, FIELD_TYPES, FIELD_TYPE_LABELS, type ContractFieldType } from '@/lib/contract-fields'

type Def = { id: string; name: string; fieldType: ContractFieldType; description: string | null }
type Contract = { id: string; name: string; description: string | null; period: string; notes: string | null; isActive: boolean; sections: Record<string, string> }

// New contract (no contract) or edit one, in a panel that opens in place.
export function ContractEditor({ defs, contract }: { defs: Def[]; contract?: Contract }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(contract?.name ?? '')
  const [description, setDescription] = useState(contract?.description ?? '')
  const [period, setPeriod] = useState(contract?.period ?? 'Annual')
  const [notes, setNotes] = useState(contract?.notes ?? '')
  const [sections, setSections] = useState<Record<string, string>>(contract?.sections ?? {})
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (!open)
    return (
      <Button size="sm" variant={contract ? 'ghost' : 'default'} onClick={() => setOpen(true)}>
        {contract ? <Pencil /> : <Plus />} {contract ? 'Edit' : 'New contract'}
      </Button>
    )

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const result = await saveContract(contract?.id ?? null, { name, description, period: period as (typeof CONTRACT_PERIODS)[number], notes, sections })
          if (!result.ok) return setError(result.error)
          setError(null)
          setOpen(false)
          toast.success('Contract saved.')
          router.refresh()
        })
      }}
      className="basis-full space-y-3 rounded-xl border bg-muted/30 p-4"
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="space-y-1.5">
          <Label htmlFor={`k-name-${contract?.id ?? 'new'}`}>Name</Label>
          <Input id={`k-name-${contract?.id ?? 'new'}`} value={name} onChange={(e) => setName(e.target.value)} required disabled={pending} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`k-period-${contract?.id ?? 'new'}`}>Review period</Label>
          <NativeSelect id={`k-period-${contract?.id ?? 'new'}`} value={period} onChange={(e) => setPeriod(e.target.value)} disabled={pending}>
            {CONTRACT_PERIODS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`k-desc-${contract?.id ?? 'new'}`}>Description</Label>
        <Textarea id={`k-desc-${contract?.id ?? 'new'}`} value={description} onChange={(e) => setDescription(e.target.value)} disabled={pending} className="min-h-12" />
      </div>
      {defs.length > 0 && (
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-medium">Sections</legend>
          {defs.map((d) => {
            const value = sections[d.id] ?? ''
            const set = (v: string) => setSections((s) => ({ ...s, [d.id]: v }))
            return (
              <div key={d.id} className="space-y-1.5">
                <Label htmlFor={`k-sec-${contract?.id ?? 'new'}-${d.id}`}>
                  {d.name} <span className="font-normal text-muted-foreground">{FIELD_TYPE_LABELS[d.fieldType]}</span>
                </Label>
                {d.fieldType === 'YES_NO' ? (
                  <NativeSelect id={`k-sec-${contract?.id ?? 'new'}-${d.id}`} value={value} onChange={(e) => set(e.target.value)} disabled={pending}>
                    <option value="">Not set</option>
                    <option value="Yes">Yes</option>
                    <option value="No">No</option>
                  </NativeSelect>
                ) : (
                  <Input
                    id={`k-sec-${contract?.id ?? 'new'}-${d.id}`}
                    type={d.fieldType === 'TEXT' ? 'text' : 'number'}
                    step="any"
                    value={value}
                    onChange={(e) => set(e.target.value)}
                    disabled={pending}
                  />
                )}
              </div>
            )
          })}
        </fieldset>
      )}
      <div className="space-y-1.5">
        <Label htmlFor={`k-notes-${contract?.id ?? 'new'}`}>Notes</Label>
        <Textarea id={`k-notes-${contract?.id ?? 'new'}`} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={pending} className="min-h-12" />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Save contract
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
        {contract && (
          <Button
            type="button"
            variant="outline"
            className="ml-auto"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await setContractActive(contract.id, !contract.isActive)
                if (!result.ok) return void toast.error(result.error)
                setOpen(false)
                router.refresh()
              })
            }
          >
            {contract.isActive ? 'Switch off' : 'Switch on'}
          </Button>
        )}
      </div>
    </form>
  )
}

// With an id: the switch on/off button for a section. Without: the form to
// add a new section.
export function SectionDefControls({ id, isActive }: { id?: string; isActive?: boolean }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [fieldType, setFieldType] = useState<ContractFieldType>('TEXT')
  const [description, setDescription] = useState('')
  const [pending, start] = useTransition()

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const result = await fn()
      if (!result.ok) return void toast.error(result.error)
      after?.()
      router.refresh()
    })

  if (id)
    return (
      <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setSectionDefActive(id, !isActive))}>
        {pending && <Loader2 className="animate-spin" />} {isActive ? 'Switch off' : 'Switch on'}
      </Button>
    )

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        run(
          () => addSectionDef({ name, fieldType, description }),
          () => {
            setName('')
            setDescription('')
          }
        )
      }}
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-end"
    >
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="sd-name">New section</Label>
        <Input id="sd-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Late payment fee" required disabled={pending} />
      </div>
      <div className="space-y-1.5 sm:w-40">
        <Label htmlFor="sd-type">Type</Label>
        <NativeSelect id="sd-type" value={fieldType} onChange={(e) => setFieldType(e.target.value as ContractFieldType)} disabled={pending}>
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {FIELD_TYPE_LABELS[t]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="sd-desc">Description (optional)</Label>
        <Input id="sd-desc" value={description} onChange={(e) => setDescription(e.target.value)} disabled={pending} />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Plus />} Add section
      </Button>
    </form>
  )
}
