'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { NativeSelect } from '@/components/ui/native-select'
import { setRequestGroup } from '@/app/(lms)/leads/actions'
import { REQUEST_GROUPS, REQUEST_GROUP_LABELS, type RequestGroup } from '@/lib/onboarding-fields'

export function RequestGroupSelect({ requestId, value }: { requestId: string; value: RequestGroup }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      Request group
      <NativeSelect
        value={value}
        disabled={pending}
        className="h-7 w-auto text-xs"
        onChange={(e) => {
          const group = e.target.value as RequestGroup
          start(async () => {
            const result = await setRequestGroup(requestId, group)
            if (!result.ok) return void toast.error(result.error)
            toast.success(`Request group set to ${REQUEST_GROUP_LABELS[group]}.`)
            router.refresh()
          })
        }}
      >
        {REQUEST_GROUPS.map((g) => (
          <option key={g} value={g}>
            {REQUEST_GROUP_LABELS[g]}
          </option>
        ))}
      </NativeSelect>
    </label>
  )
}
