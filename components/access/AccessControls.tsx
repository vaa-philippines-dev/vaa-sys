'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { addAccessUser, changeAccessRole, setAccessActive } from '@/app/(cms)/access/actions'
import { ROLE_LABELS, type AccessRole } from '@/lib/access-fields'

export function AddAccessForm({ roles }: { roles: AccessRole[] }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AccessRole>(roles.includes('CUSTOMER_SPECIALIST') ? 'CUSTOMER_SPECIALIST' : roles[0])
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    start(async () => {
      const result = await addAccessUser({ email, role })
      if (!result.ok) return setError(result.error)
      setError(null)
      setEmail('')
      toast.success(`${result.data.name} can now use VAA Systems as ${ROLE_LABELS[role]}.`)
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-end">
      <div className="flex-1 space-y-1.5">
        <Label htmlFor="access-email">Work email</Label>
        <Input id="access-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@vaaphilippines.com" required disabled={pending} />
      </div>
      <div className="space-y-1.5 sm:w-60">
        <Label htmlFor="access-role">Role</Label>
        <NativeSelect id="access-role" value={role} onChange={(e) => setRole(e.target.value as AccessRole)} disabled={pending || roles.length === 1}>
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? <Loader2 className="animate-spin" /> : <UserPlus />} Give access
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive sm:basis-full">
          {error}
        </p>
      )}
    </form>
  )
}

export function AccessRowControls({ id, role, isActive, roles, isSelf }: { id: string; role: AccessRole; isActive: boolean; roles: AccessRole[]; isSelf: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const result = await fn()
      if (!result.ok) return void toast.error(result.error)
      toast.success(done)
      router.refresh()
    })

  return (
    <div className="flex items-center justify-end gap-2">
      {isActive && roles.length > 1 && (
        <NativeSelect
          aria-label="Change role"
          value={role}
          disabled={pending}
          className="h-7 w-auto text-xs"
          onChange={(e) => run(() => changeAccessRole(id, e.target.value as AccessRole), 'Role changed.')}
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </NativeSelect>
      )}
      {!isSelf && (
        <Button
          variant={isActive ? 'ghost' : 'outline'}
          size="sm"
          disabled={pending}
          onClick={() => run(() => setAccessActive(id, !isActive), isActive ? 'Access removed.' : 'Access restored.')}
        >
          {pending && <Loader2 className="animate-spin" />}
          {isActive ? 'Remove' : 'Restore'}
        </Button>
      )}
    </div>
  )
}
