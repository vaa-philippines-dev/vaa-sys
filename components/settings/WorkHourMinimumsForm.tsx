'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateWorkHourMinimums } from '@/app/(lms)/leads/settings/actions'
import { DEFAULT_MINIMUMS, MINIMUM_KEYS, MINIMUM_LABELS, type WorkHourMinimums } from '@/lib/onboarding-fields'

export function WorkHourMinimumsForm({ initial }: { initial: WorkHourMinimums }) {
  const router = useRouter()
  const [values, setValues] = useState<Record<keyof WorkHourMinimums, string>>(
    () => Object.fromEntries(MINIMUM_KEYS.map((k) => [k, String(initial[k])])) as Record<keyof WorkHourMinimums, string>
  )
  const [saving, start] = useTransition()

  const save = () =>
    start(async () => {
      const input = Object.fromEntries(MINIMUM_KEYS.map((k) => [k, values[k] === '' ? Number.NaN : Number(values[k])])) as WorkHourMinimums
      const result = await updateWorkHourMinimums(input)
      if (!result.ok) return void toast.error(result.error)
      toast.success('Minimums saved.')
      router.refresh()
    })

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {MINIMUM_KEYS.map((k) => (
          <div key={k} className="space-y-1.5">
            <Label htmlFor={`min-${k}`}>{MINIMUM_LABELS[k]}</Label>
            <Input id={`min-${k}`} type="number" min={0} step={0.5} value={values[k]} onChange={(e) => setValues((v) => ({ ...v, [k]: e.target.value }))} />
            <p className="text-xs text-muted-foreground">Default {DEFAULT_MINIMUMS[k]}</p>
          </div>
        ))}
      </div>
      <Button onClick={save} disabled={saving}>
        {saving && <Loader2 className="animate-spin" />} Save minimums
      </Button>
    </div>
  )
}
