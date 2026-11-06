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
import { SCHEDULE_LABELS, SCHEDULE_TYPES, SERVICE_OFFERINGS, WORK_DAYS, type ScheduleType, type VaRequest } from '@/lib/onboarding-fields'
import { SR_TYPE_LABELS, type SrType } from '@/lib/service-request-fields'

// Opening a service request on an account: its type and the VAs it asks
// for, with the same fields as the onboarding form's VA services (checked
// by the same rules on the server). Times are Philippine time.

type Draft = {
  service: string
  numberOfVas: string
  targetStartDate: string
  scheduleType: ScheduleType | ''
  hoursPerDay: string
  hoursPerWeek: string
  hoursPerMonth: string
  projectHours: string
  startTimePht: string
  endTimePht: string
  workDays: string[]
  additionalHours: string
  taskTracker: '' | 'yes' | 'no'
  tasks: string
  tools: string
}
const empty = (): Draft => ({
  service: '',
  numberOfVas: '1',
  targetStartDate: '',
  scheduleType: '',
  hoursPerDay: '',
  hoursPerWeek: '',
  hoursPerMonth: '',
  projectHours: '',
  startTimePht: '',
  endTimePht: '',
  workDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  additionalHours: '',
  taskTracker: '',
  tasks: '',
  tools: '',
})
const num = (v: string) => (v.trim() === '' ? null : Number(v))

export function NewServiceRequestForm({ accountId, types }: { accountId: string; types: SrType[] }) {
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
            scheduleType: r.scheduleType,
            hoursPerDay: num(r.hoursPerDay),
            hoursPerWeek: num(r.hoursPerWeek),
            hoursPerMonth: num(r.hoursPerMonth),
            projectHours: num(r.projectHours),
            startTimePht: r.startTimePht,
            endTimePht: r.endTimePht,
            workDays: r.workDays,
            additionalHours: r.additionalHours,
            taskTracker: r.taskTracker === '' ? null : r.taskTracker === 'yes',
            tasks: r.tasks,
            tools: r.tools,
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
        const daily = r.scheduleType === 'DAILY_FIXED' || r.scheduleType === 'DAILY_FLEXIBLE'
        return (
          <fieldset key={i} className="space-y-3 rounded-xl border bg-card p-4">
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
                <Label htmlFor={id('schedule')}>Work hour type</Label>
                <NativeSelect id={id('schedule')} value={r.scheduleType} onChange={(e) => set(i, { scheduleType: e.target.value as ScheduleType })} disabled={pending}>
                  <option value="">Pick one…</option>
                  {SCHEDULE_TYPES.map((s) => (
                    <option key={s} value={s}>
                      {SCHEDULE_LABELS[s]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              {r.scheduleType === 'DAILY_FIXED' && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor={id('from')}>Starts (PH time)</Label>
                    <Input id={id('from')} type="time" value={r.startTimePht} onChange={(e) => set(i, { startTimePht: e.target.value })} disabled={pending} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={id('to')}>Ends (PH time)</Label>
                    <Input id={id('to')} type="time" value={r.endTimePht} onChange={(e) => set(i, { endTimePht: e.target.value })} disabled={pending} />
                  </div>
                </>
              )}
              {r.scheduleType === 'DAILY_FLEXIBLE' && (
                <div className="space-y-1.5">
                  <Label htmlFor={id('hpd')}>Hours a day</Label>
                  <Input id={id('hpd')} type="number" min={0} step={0.5} value={r.hoursPerDay} onChange={(e) => set(i, { hoursPerDay: e.target.value })} disabled={pending} />
                </div>
              )}
              {r.scheduleType === 'WEEKLY_FLEXIBLE' && (
                <div className="space-y-1.5">
                  <Label htmlFor={id('hpw')}>Hours a week</Label>
                  <Input id={id('hpw')} type="number" min={0} step={0.5} value={r.hoursPerWeek} onChange={(e) => set(i, { hoursPerWeek: e.target.value })} disabled={pending} />
                </div>
              )}
              {r.scheduleType === 'MONTHLY' && (
                <div className="space-y-1.5">
                  <Label htmlFor={id('hpm')}>Hours a month</Label>
                  <Input id={id('hpm')} type="number" min={0} step={0.5} value={r.hoursPerMonth} onChange={(e) => set(i, { hoursPerMonth: e.target.value })} disabled={pending} />
                </div>
              )}
              {r.scheduleType === 'PROJECT' && (
                <div className="space-y-1.5">
                  <Label htmlFor={id('ph')}>Project hours</Label>
                  <Input id={id('ph')} type="number" min={0} step={0.5} value={r.projectHours} onChange={(e) => set(i, { projectHours: e.target.value })} disabled={pending} />
                </div>
              )}
            </div>
            {daily && (
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">Work days</legend>
                <div className="flex flex-wrap gap-3">
                  {WORK_DAYS.map((d) => (
                    <label key={d} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-primary"
                        checked={r.workDays.includes(d)}
                        onChange={(e) => set(i, { workDays: e.target.checked ? [...r.workDays, d] : r.workDays.filter((x) => x !== d) })}
                        disabled={pending}
                      />
                      {d}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={id('extra')}>Additional hours</Label>
                <Input id={id('extra')} value={r.additionalHours} onChange={(e) => set(i, { additionalHours: e.target.value })} placeholder="e.g. 1H Sat or Sun" disabled={pending} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={id('tracker')}>Task tracker</Label>
                <NativeSelect id={id('tracker')} value={r.taskTracker} onChange={(e) => set(i, { taskTracker: e.target.value as Draft['taskTracker'] })} disabled={pending}>
                  <option value="">Not asked</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </NativeSelect>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={id('tasks')}>Tasks</Label>
                <Textarea id={id('tasks')} value={r.tasks} onChange={(e) => set(i, { tasks: e.target.value })} rows={3} disabled={pending} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={id('tools')}>Tools</Label>
                <Textarea id={id('tools')} value={r.tools} onChange={(e) => set(i, { tools: e.target.value })} rows={3} disabled={pending} />
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
