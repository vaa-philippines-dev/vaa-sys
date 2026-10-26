'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { assignCustomers, cancelTakeover, createTakeover } from '@/app/(cms)/specialists/actions'
import { STATUS_META } from '@/components/cms/status-meta'
import { manilaToday, type CustomerStatus } from '@/lib/customer-fields'
import { cn } from '@/lib/utils'

type Customer = { id: string; name: string; customerCode: string; status: CustomerStatus; formerOwner?: string | null }
type Member = { email: string; name: string }

// A list of customers to pick from, with Transfer and Cover (takeover)
// actions for those who manage the team.
export function CustomerBatch({
  customers,
  team,
  manage,
  summary,
  open = false,
  assignOnly = false,
}: {
  customers: Customer[]
  team: Member[]
  manage: boolean
  summary: string
  open?: boolean
  assignOnly?: boolean
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'transfer' | 'cover' | null>(null)
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const today = manilaToday()
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  const [pending, run] = useTransition()

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const customerIds = [...selected]
    run(async () => {
      const result =
        mode === 'cover'
          ? await createTakeover({ customerIds, specialistEmail: to, startDate: start, endDate: end, reason: note })
          : await assignCustomers({ customerIds, toEmail: to, note })
      if (!result.ok) return void toast.error(result.error)
      toast.success(mode === 'cover' ? `Takeover set for ${result.data.count} ${result.data.count === 1 ? 'customer' : 'customers'}.` : `Moved ${result.data.count} ${result.data.count === 1 ? 'customer' : 'customers'}.`)
      setSelected(new Set())
      setMode(null)
      setNote('')
      router.refresh()
    })
  }

  return (
    <details className="group" open={open}>
      <summary className="cursor-pointer text-sm text-primary">{summary}</summary>
      <ul className="mt-2 max-h-72 divide-y overflow-y-auto rounded-xl border">
        {customers.map((c) => (
          <li key={c.id} className="flex items-center gap-2.5 px-3 py-1.5 text-sm">
            {manage && <input type="checkbox" aria-label={`Select ${c.name}`} checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="h-3.5 w-3.5 accent-primary" />}
            <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_META[c.status].dot)} title={STATUS_META[c.status].label} />
            <Link href={`/customers/${c.id}`} className="min-w-0 flex-1 truncate hover:underline">
              {c.name}
            </Link>
            {c.formerOwner && <span className="truncate text-xs text-muted-foreground">was {c.formerOwner}</span>}
          </li>
        ))}
      </ul>

      {manage && selected.size > 0 && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">{selected.size} selected:</span>
            <Button size="sm" variant={mode === 'transfer' ? 'default' : 'outline'} onClick={() => setMode('transfer')}>
              {assignOnly ? 'Assign' : 'Transfer'}
            </Button>
            {!assignOnly && (
              <Button size="sm" variant={mode === 'cover' ? 'default' : 'outline'} onClick={() => setMode('cover')}>
                Cover (takeover)
              </Button>
            )}
          </div>
          {mode && (
            <form onSubmit={submit} className="grid gap-3 rounded-xl border bg-muted/30 p-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{mode === 'cover' ? 'Covered by' : 'To'}</Label>
                <NativeSelect value={to} onChange={(e) => setTo(e.target.value)} required disabled={pending}>
                  <option value="">Pick someone…</option>
                  {team.map((m) => (
                    <option key={m.email} value={m.email}>
                      {m.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {mode === 'cover' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label>From</Label>
                    <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} required disabled={pending} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>To</Label>
                    <Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required disabled={pending} />
                  </div>
                </div>
              )}
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{mode === 'cover' ? 'Reason' : 'Note'} (optional)</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'cover' ? 'e.g. On leave' : 'Recorded in the activity log'} disabled={pending} />
              </div>
              <div className="flex gap-2 sm:col-span-2">
                <Button type="submit" disabled={pending}>
                  {pending && <Loader2 className="animate-spin" />} {mode === 'cover' ? 'Set takeover' : assignOnly ? 'Assign' : 'Transfer'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setMode(null)} disabled={pending}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </details>
  )
}

export function CancelTakeoverButton({ id }: { id: string }) {
  const router = useRouter()
  const [pending, run] = useTransition()
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        run(async () => {
          const result = await cancelTakeover(id)
          if (!result.ok) return void toast.error(result.error)
          toast.success('Takeover ended.')
          router.refresh()
        })
      }
    >
      {pending && <Loader2 className="animate-spin" />} End
    </Button>
  )
}
