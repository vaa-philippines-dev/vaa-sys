'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import { openServiceRequest } from '@/app/(cms)/service-requests/actions'
import { ScheduleFields, type ScheduleValue } from '@/components/requests/ScheduleFields'
import { NO_DAY_HOURS, SERVICE_OFFERINGS, workDaysOf, type TimeZoneOption, type VaRequest } from '@/lib/onboarding-fields'
import { SR_TYPE_LABELS, type SrType } from '@/lib/service-request-fields'

// Opening a service request on an account: its type and the VAs it asks
// for, with the same fields as the onboarding form's VA services (checked
// by the same rules on the server). Times are Philippine time; each VA
// service can have its own client time zone.

type Draft = {
  service: string
  numberOfVas: string
  targetStartDate: string
  schedule: ScheduleValue
  timeZone: string
  taskTracker: '' | 'yes' | 'no'
  tasks: string
  tools: string
  mustHaves: string
}
const empty = (): Draft => ({
  service: '',
  numberOfVas: '1',
  targetStartDate: '',
  schedule: {
    scheduleType: '',
    hoursPerDay: null,
    hoursPerWeek: null,
    hoursPerMonth: null,
    projectHours: null,
    startTimePht: '08:00',
    endTimePht: '17:00',
    dayHours: [...NO_DAY_HOURS],
    additionalHours: '',
  },
  timeZone: '',
  taskTracker: '',
  tasks: '',
  tools: '',
  mustHaves: '',
})

export function NewServiceRequestForm({ accountId, types, accountTimeZone, timeZones }: { accountId: string; types: SrType[]; accountTimeZone: string | null; timeZones: TimeZoneOption[] }) {
  const router = useRouter()
  const [type, setType] = useState<SrType>(types[0])
  const [rows, setRows] = useState<Draft[]>([empty()])
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const set = (i: number, patch: Partial<Draft>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const submit = () =>
    start(async () => {
      const requests = rows.map(
        (r) =>
          ({
            service: r.service,
            numberOfVas: Number(r.numberOfVas),
            targetStartDate: r.targetStartDate,
            ...r.schedule,
            workDays: workDaysOf(r.schedule.dayHours),
            taskTracker: r.taskTracker === '' ? null : r.taskTracker === 'yes',
            tasks: r.tasks,
            tools: r.tools,
            timeZone: r.timeZone,
            mustHaves: r.mustHaves,
          }) as VaRequest
      )
      const result = await openServiceRequest(accountId, type, requests)
      if (!result.ok) return setError(result.error)
      toast.success(`${SR_TYPE_LABELS[type]} service request opened.`)
      router.push(`/service-requests/${result.data.id}`)
    })

  return (
    <div className="space-y-5">
      <div className="max-w-xs space-y-1.5">
        <Label htmlFor="sr-type">Type</Label>
        <NativeSelect id="sr-type" value={type} onChange={(e) => setType(e.target.value as SrType)} disabled={pending}>
          {types.map((t) => (
            <option key={t} value={t}>
              {SR_TYPE_LABELS[t]}
            </option>
          ))}
        </NativeSelect>
      </div>

      {rows.map((r, i) => {
        const id = (k: string) => `sr-${i}-${k}`
        return (
          <fieldset key={i} className="space-y-4 rounded-xl border bg-card p-4">
            <legend className="px-1 text-sm font-semibold">VA service {rows.length > 1 ? i + 1 : ''}</legend>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={id('service')}>Service</Label>
                <NativeSelect id={id('service')} value={r.service} onChange={(e) => set(i, { service: e.target.value })} disabled={pending}>
                  <option value="">Pick one…</option>
                  {SERVICE_OFFERINGS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={id('vas')}>Number of VAs</Label>
                <Input id={id('vas')} type="number" min={1} max={50} value={r.numberOfVas} onChange={(e) => set(i, { numberOfVas: e.target.value })} disabled={pending} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={id('start')}>Target start</Label>
                <Input id={id('start')} type="date" value={r.targetStartDate} onChange={(e) => set(i, { targetStartDate: e.target.value })} disabled={pending} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={id('tz')}>Client time zone</Label>
                <NativeSelect id={id('tz')} value={r.timeZone} onChange={(e) => set(i, { timeZone: e.target.value })} disabled={pending}>
                  <option value="">{accountTimeZone ? `The account’s (${accountTimeZone.replace(/_/g, ' ')})` : 'The account’s (not set)'}</option>
                  {timeZones.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
            <ScheduleFields
              id={id('schedule')}
              value={r.schedule}
              onChange={(schedule) => set(i, { schedule })}
              disabled={pending}
              clientTimeZone={r.timeZone || accountTimeZone}
              targetStartDate={r.targetStartDate}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={id('tracker')}>Time tracker</Label>
                <NativeSelect id={id('tracker')} value={r.taskTracker} onChange={(e) => set(i, { taskTracker: e.target.value as Draft['taskTracker'] })} disabled={pending}>
                  <option value="">Not asked</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </NativeSelect>
              </div>
              <div />
              <div className="space-y-1.5">
                <Label htmlFor={id('tasks')}>Tasks</Label>
                <Textarea id={id('tasks')} value={r.tasks} onChange={(e) => set(i, { tasks: e.target.value })} rows={3} disabled={pending} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={id('tools')}>Tools</Label>
                <Textarea id={id('tools')} value={r.tools} onChange={(e) => set(i, { tools: e.target.value })} rows={3} disabled={pending} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={id('must')}>Must-haves or deal breakers</Label>
                <Textarea id={id('must')} value={r.mustHaves} onChange={(e) => set(i, { mustHaves: e.target.value })} rows={2} disabled={pending} />
              </div>
            </div>
            {rows.length > 1 && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} disabled={pending}>
                <Trash2 /> Remove this service
              </Button>
            )}
          </fieldset>
        )
      })}

      <Button type="button" variant="outline" size="sm" onClick={() => setRows((rs) => [...rs, empty()])} disabled={pending}>
        <Plus /> Add another service
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div>
        <Button onClick={submit} disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Open service request
        </Button>
      </div>
    </div>
  )
}
