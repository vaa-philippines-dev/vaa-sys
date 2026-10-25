'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { NativeSelect } from '@/components/ui/native-select'
import { changeCustomerStatus } from '@/app/(cms)/customers/actions'
import { CUSTOMER_STATUSES, REASON_REQUIRED, STATUS_LABELS, type CustomerStatus } from '@/lib/customer-fields'

export function StatusChanger({ customerId, current }: { customerId: string; current: CustomerStatus }) {
  const router = useRouter()
  const options = CUSTOMER_STATUSES.filter((s) => s !== current)
  const [status, setStatus] = useState<CustomerStatus>(options[0])
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const needsReason = REASON_REQUIRED.includes(status)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    start(async () => {
      const result = await changeCustomerStatus(customerId, { status, reason })
      if (!result.ok) return setError(result.error)
      setError(null)
      setReason('')
      toast.success(`Status changed to ${STATUS_LABELS[status]}.`)
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="new-status">Change status to</Label>
        <NativeSelect id="new-status" value={status} onChange={(e) => setStatus(e.target.value as CustomerStatus)} disabled={pending}>
          {options.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="status-reason">
          Reason {needsReason ? <span className="text-destructive">*</span> : <span className="font-normal text-muted-foreground">(optional)</span>}
        </Label>
        <Textarea id="status-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Recorded in the status log" disabled={pending} className="min-h-14" />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending} className="w-full">
        {pending && <Loader2 className="animate-spin" />} Save status
      </Button>
    </form>
  )
}
