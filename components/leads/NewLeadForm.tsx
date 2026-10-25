'use client'

import { useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { createLead, searchCustomerMatches } from '@/app/(lms)/leads/actions'
import { newLeadSchema, type CustomerMatch } from '@/lib/customer-fields'

// Lives in the Lead Management board's right-hand drawer (LMS design).
export function NewLeadForm({ onCancel }: { onCancel: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [matches, setMatches] = useState<CustomerMatch[]>([])
  const [saving, start] = useTransition()

  // Similar customers here or in the legacy CMS, while typing the name.
  useEffect(() => {
    const q = name.trim()
    if (q.length < 2) return
    let stale = false
    const timer = setTimeout(() => {
      searchCustomerMatches(q)
        .catch(() => [])
        .then((found) => !stale && setMatches(found))
    }, 300)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [name])

  const visibleMatches = name.trim().length < 2 ? [] : matches

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const input = { name, email, notes }
    const parsed = newLeadSchema.safeParse(input)
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? 'Check the form.')
    start(async () => {
      // Only errors come back; success redirects to the new lead's page.
      const result = await createLead(input)
      if (result && !result.ok) setError(result.error)
    })
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <div className="space-y-1.5">
          <Label htmlFor="lead-name">
            Customer name <span className="text-destructive">*</span>
          </Label>
          <Input id="lead-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Person or company" autoFocus disabled={saving} />
        </div>

        {visibleMatches.length > 0 && (
          <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-sm">
            <p className="font-medium">Similar customers already exist</p>
            <p className="mb-2 text-xs text-muted-foreground">Check it isn’t the same customer before adding a new one.</p>
            <ul className="space-y-1">
              {visibleMatches.map((m, i) => (
                <li key={`${m.source}-${m.code ?? i}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {m.id ? (
                    <Link href={`/leads/${m.id}`} className="font-medium underline-offset-4 hover:underline">
                      {m.name}
                    </Link>
                  ) : (
                    <span className="font-medium">{m.name}</span>
                  )}
                  <span className="font-mono text-xs text-muted-foreground">{m.code}</span>
                  <span className="text-xs text-muted-foreground">
                    {m.source === 'legacy_cms' ? 'Legacy CMS' : 'VAA Systems'}
                    {m.status ? ` · ${m.status.charAt(0) + m.status.slice(1).toLowerCase()}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="lead-email">Email for the onboarding link</Label>
          <Input id="lead-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@company.com" disabled={saving} />
          <p className="text-xs text-muted-foreground">The customer ID is created automatically when you add the lead.</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="lead-notes">Notes</Label>
          <Textarea id="lead-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional: where the lead came from, what they asked for" disabled={saving} />
        </div>

        {error && (
          <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t px-5 py-4">
        <Button type="button" variant="outline" size="lg" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" size="lg" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />} Add lead
        </Button>
      </div>
    </form>
  )
}
