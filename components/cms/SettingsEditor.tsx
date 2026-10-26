'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowDown, ArrowUp, Loader2, Pencil, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { moveSetting, saveSetting, setSettingActive } from '@/app/(cms)/settings/actions'
import type { SettingCategory } from '@/lib/settings-fields'
import { cn } from '@/lib/utils'

type Option = { id: string; value: string; label: string; isActive: boolean; timezone: string | null }

export function SettingsEditor({ category, options }: { category: SettingCategory; options: Option[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [editing, setEditing] = useState<string | null>(null)
  const withTz = category === 'CountryRegion'

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done?: string) =>
    start(async () => {
      const result = await fn()
      if (!result.ok) return void toast.error(result.error)
      if (done) toast.success(done)
      setEditing(null)
      router.refresh()
    })

  return (
    <div className="space-y-4">
      <ul className="divide-y rounded-2xl border bg-card">
        {options.length === 0 && <li className="px-4 py-5 text-sm text-muted-foreground">No options yet.</li>}
        {options.map((o, i) =>
          editing === o.id ? (
            <li key={o.id} className="px-4 py-3">
              <OptionForm
                withTz={withTz}
                initial={o}
                pending={pending}
                onCancel={() => setEditing(null)}
                onSave={(v) => run(() => saveSetting(o.id, { category, ...v }), 'Saved.')}
              />
            </li>
          ) : (
            <li key={o.id} className={cn('flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm', !o.isActive && 'opacity-60')}>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {o.label}
                  {!o.isActive && <span className="ml-2 text-xs font-normal text-muted-foreground">(switched off)</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {o.value !== o.label && <>Stored as “{o.value}”</>}
                  {o.value !== o.label && o.timezone && ' · '}
                  {o.timezone}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Move up" disabled={pending || i === 0} onClick={() => run(() => moveSetting(o.id, 'up'))}>
                  <ArrowUp />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Move down" disabled={pending || i === options.length - 1} onClick={() => run(() => moveSetting(o.id, 'down'))}>
                  <ArrowDown />
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Edit ${o.label}`} disabled={pending} onClick={() => setEditing(o.id)}>
                  <Pencil />
                </Button>
                <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => setSettingActive(o.id, !o.isActive), o.isActive ? 'Switched off.' : 'Switched on.')}>
                  {o.isActive ? 'Switch off' : 'Switch on'}
                </Button>
              </div>
            </li>
          )
        )}
      </ul>

      {editing === 'new' ? (
        <div className="rounded-xl border bg-card p-4">
          <OptionForm withTz={withTz} pending={pending} onCancel={() => setEditing(null)} onSave={(v) => run(() => saveSetting(null, { category, ...v }), 'Added.')} />
        </div>
      ) : (
        <Button variant="outline" onClick={() => setEditing('new')}>
          <Plus /> Add an option
        </Button>
      )}
    </div>
  )
}

function OptionForm({
  withTz,
  initial,
  pending,
  onSave,
  onCancel,
}: {
  withTz: boolean
  initial?: Option
  pending: boolean
  onSave: (v: { value: string; label: string; timezone: string }) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial?.value ?? '')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [timezone, setTimezone] = useState(initial?.timezone ?? '')
  const id = initial?.id ?? 'new'

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSave({ value, label, timezone })
      }}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <div className="flex-1 space-y-1.5">
        <Label htmlFor={`value-${id}`}>Value</Label>
        <Input id={`value-${id}`} value={value} onChange={(e) => setValue(e.target.value)} required disabled={pending} />
      </div>
      <div className="flex-1 space-y-1.5">
        <Label htmlFor={`label-${id}`}>
          Label <span className="font-normal text-muted-foreground">(defaults to the value)</span>
        </Label>
        <Input id={`label-${id}`} value={label} onChange={(e) => setLabel(e.target.value)} disabled={pending} />
      </div>
      {withTz && (
        <div className="flex-1 space-y-1.5">
          <Label htmlFor={`tz-${id}`}>Time zone</Label>
          <Input id={`tz-${id}`} value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/New_York" disabled={pending} />
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Save
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
