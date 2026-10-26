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
import { DEPARTMENT_ROLES, ROLE_LABELS, type AccessRole } from '@/lib/access-fields'

type Department = { id: string; name: string }

export function AddAccessForm({ roles, departments }: { roles: AccessRole[]; departments: Department[] }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<AccessRole>(roles.includes('CUSTOMER_SPECIALIST') ? 'CUSTOMER_SPECIALIST' : roles[0])
  const [departmentId, setDepartmentId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const needsDepartment = DEPARTMENT_ROLES.includes(role)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    start(async () => {
      const result = await addAccessUser({ email, role, departmentId: needsDepartment ? departmentId : '' })
      if (!result.ok) return setError(result.error)
      setError(null)
      setEmail('')
      toast.success(`${result.data.name} can now use VAA Systems as ${ROLE_LABELS[role]}.`)
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="flex-1 space-y-1.5 sm:min-w-56">
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
      {needsDepartment && (
        <div className="space-y-1.5 sm:w-56">
          <Label htmlFor="access-department">Department</Label>
          <DepartmentSelect id="access-department" value={departmentId} onChange={setDepartmentId} departments={departments} disabled={pending} />
        </div>
      )}
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

function DepartmentSelect({
  id,
  value,
  onChange,
  departments,
  disabled,
  className,
}: {
  id?: string
  value: string
  onChange: (v: string) => void
  departments: Department[]
  disabled?: boolean
  className?: string
}) {
  return (
    <NativeSelect id={id} aria-label={id ? undefined : 'Department'} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={className}>
      <option value="">Pick a department…</option>
      {departments.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </NativeSelect>
  )
}

export function AccessRowControls({
  id,
  role,
  departmentId,
  isActive,
  roles,
  departments,
  isSelf,
}: {
  id: string
  role: AccessRole
  departmentId: string | null
  isActive: boolean
  roles: AccessRole[]
  departments: Department[]
  isSelf: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  // A role that needs a department waits for one to be picked.
  const [draftRole, setDraftRole] = useState<AccessRole | null>(null)

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const result = await fn()
      if (!result.ok) return void toast.error(result.error)
      setDraftRole(null)
      toast.success(done)
      router.refresh()
    })

  const shownRole = draftRole ?? role
  const showDepartment = DEPARTMENT_ROLES.includes(shownRole)

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {isActive && roles.length > 1 && (
        <NativeSelect
          aria-label="Change role"
          value={shownRole}
          disabled={pending}
          className="h-7 w-auto text-xs"
          onChange={(e) => {
            const next = e.target.value as AccessRole
            if (DEPARTMENT_ROLES.includes(next) && next !== role) return setDraftRole(next)
            setDraftRole(null)
            run(() => changeAccessRole(id, next), 'Role changed.')
          }}
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </NativeSelect>
      )}
      {isActive && showDepartment && roles.length > 1 && (
        <DepartmentSelect
          value={draftRole ? '' : (departmentId ?? '')}
          departments={departments}
          disabled={pending}
          className="h-7 w-auto text-xs"
          onChange={(dep) => dep && run(() => changeAccessRole(id, shownRole, dep), 'Department saved.')}
        />
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
