'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Save } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { updateBillingDefaults, updateRate } from '@/app/(acct)/accounting/actions'
import { BILLING_DEFAULT_LABELS, type BillingDefaults } from '@/lib/billing-fields'

// Accounting → Rates & fees: what a new bill starts from. Bills already made
// keep the values they were made with.

export function DefaultsForm({ value }: { value: BillingDefaults }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [draft, setDraft] = useState<Record<keyof BillingDefaults, string>>(
    Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)])) as Record<keyof BillingDefaults, string>
  )
  const keys = Object.keys(BILLING_DEFAULT_LABELS) as (keyof BillingDefaults)[]
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const input = Object.fromEntries(keys.map((k) => [k, Number(draft[k])])) as BillingDefaults
          const r = await updateBillingDefaults(input)
          if (!r.ok) return void toast.error(r.error)
          toast.success('Fees saved. New bills start from them.')
          router.refresh()
        })
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {keys.map((k) => {
          const meta = BILLING_DEFAULT_LABELS[k]
          return (
            <label key={k} className="block space-y-1.5">
              <span className="block text-sm font-medium">
                {meta.label} ({meta.unit === '$' ? 'amount' : '%'})
              </span>
              <Input type="number" inputMode="decimal" min={0} step="0.01" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} required disabled={pending} />
              <span className="block text-xs text-muted-foreground">{meta.hint}</span>
            </label>
          )
        })}
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <Save />} Save fees
      </Button>
    </form>
  )
}

export function RateRow({ service, rate, updated }: { service: string; rate: number | null; updated: string | null }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [value, setValue] = useState(rate == null ? '' : String(rate))
  const changed = value !== (rate == null ? '' : String(rate))
  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-2.5">{service}</td>
      <td className="px-4 py-2.5">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            start(async () => {
              const r = await updateRate(service, Number(value))
              if (!r.ok) return void toast.error(r.error)
              toast.success(`${service}: rate saved.`)
              router.refresh()
            })
          }}
          className="flex items-center gap-2"
        >
          <label className="sr-only" htmlFor={`rate-${service}`}>
            Hourly rate for {service}
          </label>
          <Input id={`rate-${service}`} type="number" inputMode="decimal" min={0} step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Not set" className="h-8 w-28 text-right tabular-nums" disabled={pending} />
          <Button type="submit" size="sm" variant="outline" disabled={pending || !changed || value === ''}>
            {pending ? <Loader2 className="animate-spin" /> : 'Save'}
          </Button>
        </form>
      </td>
      <td className="px-4 py-2.5 text-[12px] text-muted-foreground">{updated ?? '–'}</td>
    </tr>
  )
}
