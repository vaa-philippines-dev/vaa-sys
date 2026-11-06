'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CheckCheck, Loader2, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { checkScheduleChange, saveRequestSchedule } from '@/app/(cms)/service-requests/actions'
import { ScheduleFields, type ScheduleValue } from '@/components/requests/ScheduleFields'
import { REVIEWER, type ScheduleEdit } from '@/lib/request-schedule-fields'
import type { TimeZoneOption } from '@/lib/onboarding-fields'

// Change a VA request's schedule from its service request. While the
// request is open, a change waits for Executive Support's check before the
// VA can start.
export function ScheduleEditor({
  requestId,
  initial,
  accountTimeZone,
  timeZones,
  open,
  targetStartDate,
}: {
  requestId: string
  initial: ScheduleEdit
  accountTimeZone: string | null
  timeZones: TimeZoneOption[]
  // The service request is still open: a change needs the check.
  open: boolean
  targetStartDate: string
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState<ScheduleValue>(() => toValue(initial))
  const [timeZone, setTimeZone] = useState(initial.timeZone ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (!editing)
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
        <Pencil /> Edit schedule
      </Button>
    )

  const save = () =>
    start(async () => {
      const r = await saveRequestSchedule(requestId, { ...value, scheduleType: value.scheduleType || 'DAILY_FIXED', timeZone } as ScheduleEdit)
      if (!r.ok) return setError(r.error)
      setError(null)
      setEditing(false)
      toast.success(!r.data.changed ? 'Saved.' : r.data.needsReview ? `Schedule changed. ${REVIEWER} checks it before the VA starts, and Lead Management is told.` : 'Schedule changed and added to its history.')
      router.refresh()
    })

  return (
    <div className="w-full space-y-4 rounded-lg border bg-muted/30 p-4">
      {open && (
        <p className="text-xs text-muted-foreground">
          This service request is still open, so a schedule change affects the bill: {REVIEWER} checks it, and the VA can’t be marked started until then.
        </p>
      )}
      <div className="max-w-sm space-y-1.5">
        <Label htmlFor={`tz-${requestId}`}>Client time zone</Label>
        <NativeSelect id={`tz-${requestId}`} value={timeZone} onChange={(e) => setTimeZone(e.target.value)} disabled={pending}>
          <option value="">{accountTimeZone ? `The account’s (${accountTimeZone.replace(/_/g, ' ')})` : 'The account’s (not set)'}</option>
          {timeZones.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <ScheduleFields id={`sch-${requestId}`} value={value} onChange={setValue} disabled={pending} clientTimeZone={timeZone || accountTimeZone} targetStartDate={targetStartDate} />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Save schedule
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setEditing(false)
            setValue(toValue(initial))
            setTimeZone(initial.timeZone ?? '')
            setError(null)
          }}
          disabled={pending}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

function toValue(e: ScheduleEdit): ScheduleValue {
  return {
    scheduleType: e.scheduleType,
    hoursPerDay: e.hoursPerDay ?? null,
    hoursPerWeek: e.hoursPerWeek ?? null,
    hoursPerMonth: e.hoursPerMonth ?? null,
    projectHours: e.projectHours ?? null,
    startTimePht: e.startTimePht,
    endTimePht: e.endTimePht,
    dayHours: e.dayHours ?? [null, null, null, null, null, null, null],
    additionalHours: e.additionalHours,
  }
}

// Executive Support marks a schedule change checked, with an optional note.
export function ScheduleCheck({ changeId }: { changeId: string }) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [pending, start] = useTransition()
  const check = () =>
    start(async () => {
      const r = await checkScheduleChange(changeId, note)
      if (!r.ok) return void toast.error(r.error)
      toast.success('Schedule change checked.')
      router.refresh()
    })
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input aria-label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="h-8 w-48 text-xs" disabled={pending} />
      <Button type="button" size="sm" onClick={check} disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <CheckCheck />} Mark checked
      </Button>
    </div>
  )
}
