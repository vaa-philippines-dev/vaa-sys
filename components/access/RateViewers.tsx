'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, LockKeyhole, UserPlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { addRateViewer, removeRateViewer } from '@/app/(lms)/leads/access/actions'

type Viewer = { email: string; name: string; owner: boolean; valid: boolean; grantedBy: string | null; grantedOn: string | null }
type Person = { email: string; name: string }

// User access → Confidential rates: who may see the services' Standard
// Billing Rate and VA Base Rate (lib/rates.ts). Only someone who already
// sees them can change the list; everyone else on the page sees who has it.
export function RateViewers({ viewers, people, canManage, keySet }: { viewers: Viewer[]; people: Person[]; canManage: boolean; keySet: boolean }) {
  const router = useRouter()
  const [picked, setPicked] = useState('')
  const [pending, start] = useTransition()
  const has = new Set(viewers.filter((v) => v.valid).map((v) => v.email))

  const add = () =>
    start(async () => {
      const r = await addRateViewer(picked)
      if (!r.ok) return void toast.error(r.error)
      toast.success('They can now see the confidential rates.')
      setPicked('')
      router.refresh()
    })
  const remove = (email: string) =>
    start(async () => {
      const r = await removeRateViewer(email)
      if (!r.ok) return void toast.error(r.error)
      toast.success('Access to the confidential rates removed.')
      router.refresh()
    })

  return (
    <section className="space-y-3">
      <div>
        <h2 className="flex items-center gap-1.5 font-semibold">
          <LockKeyhole className="h-4 w-4" /> Confidential rates
        </h2>
        <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
          Who can see and set each service’s Standard Billing Rate and VA Base Rate (Lead Management → Departments &amp; services). It doesn’t depend on the role. Only
          someone on this list can add or remove people.
        </p>
      </div>
      <ul className="divide-y rounded-2xl border bg-card">
        {viewers.map((v) => (
          <li key={v.email} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{v.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {v.email}
                {v.owner ? ' · always (the rates’ owner)' : v.grantedBy ? ` · added by ${v.grantedBy}${v.grantedOn ? ` on ${v.grantedOn}` : ''}` : ''}
                {!v.valid && ' · not working: this grant wasn’t made with the rates key, so give access again'}
              </p>
            </div>
            {canManage && !v.owner && (
              <Button size="sm" variant="ghost" onClick={() => remove(v.email)} disabled={pending} aria-label={`Remove ${v.name}`}>
                <X /> Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canManage &&
        (keySet ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5 sm:max-w-md">
              <Label htmlFor="rate-viewer">Give access to</Label>
              <NativeSelect id="rate-viewer" value={picked} onChange={(e) => setPicked(e.target.value)} disabled={pending}>
                <option value="">Pick a name…</option>
                {people
                  .filter((p) => !has.has(p.email))
                  .map((p) => (
                    <option key={p.email} value={p.email}>
                      {p.name} · {p.email}
                    </option>
                  ))}
              </NativeSelect>
            </div>
            <Button onClick={add} disabled={!picked || pending}>
              {pending ? <Loader2 className="animate-spin" /> : <UserPlus />} Give access
            </Button>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">The rates key isn’t set on this server, so access can be given only on the live site.</p>
        ))}
    </section>
  )
}
