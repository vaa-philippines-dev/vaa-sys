'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { addAccountManager, removeAccountManager, updateAccount } from '@/app/(cms)/accounts/actions'
import type { SettingOptionLite } from '@/lib/settings-fields'

type Option = { id: string; label: string; isActive?: boolean }

// The Customer Management fields of an account: category, type, country,
// links and the contract that applies.
export function AccountEditForm({
  accountId,
  initial,
  categories,
  types,
  regions,
  contracts,
}: {
  accountId: string
  initial: { categoryId: string | null; typeId: string | null; countryRegionId: string | null; sellerOnboardingLink: string | null; contractLink: string | null; contractId: string | null; isReturning: boolean }
  categories: SettingOptionLite[]
  types: SettingOptionLite[]
  regions: SettingOptionLite[]
  contracts: Option[]
}) {
  const router = useRouter()
  const [v, setV] = useState({
    categoryId: initial.categoryId ?? '',
    typeId: initial.typeId ?? '',
    countryRegionId: initial.countryRegionId ?? '',
    sellerOnboardingLink: initial.sellerOnboardingLink ?? '',
    contractLink: initial.contractLink ?? '',
    contractId: initial.contractId ?? '',
    isReturning: initial.isReturning,
  })
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((s) => ({ ...s, [k]: e.target.value }))

  const select = (id: string, label: string, key: 'categoryId' | 'typeId' | 'countryRegionId' | 'contractId', options: Option[]) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} value={v[key]} onChange={set(key)} disabled={pending}>
        <option value="">Not set</option>
        {options
          .filter((o) => o.isActive !== false || o.id === v[key])
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
              {o.isActive === false ? ' (switched off)' : ''}
            </option>
          ))}
      </NativeSelect>
    </div>
  )

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        start(async () => {
          const result = await updateAccount(accountId, v)
          if (!result.ok) return setError(result.error)
          setError(null)
          toast.success('Saved.')
          router.refresh()
        })
      }}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {select('a-category', 'Category', 'categoryId', categories)}
        {select('a-type', 'Type', 'typeId', types)}
        {select('a-region', 'Country / region', 'countryRegionId', regions)}
        {select('a-contract', 'Contract', 'contractId', contracts)}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="a-seller">Seller onboarding link</Label>
        <Input id="a-seller" type="url" value={v.sellerOnboardingLink} onChange={set('sellerOnboardingLink')} placeholder="https://" disabled={pending} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="a-contract-link">Signed contract link</Label>
        <Input id="a-contract-link" type="url" value={v.contractLink} onChange={set('contractLink')} placeholder="https://" disabled={pending} />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={v.isReturning} onChange={(e) => setV((s) => ({ ...s, isReturning: e.target.checked }))} disabled={pending} />
        Returning account (came back after being terminated)
      </label>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" variant="outline" disabled={pending} className="w-full">
        {pending && <Loader2 className="animate-spin" />} Save account details
      </Button>
    </form>
  )
}

export function AccountManagers({ accountId, managers, canEdit }: { accountId: string; managers: { id: string; name: string; email: string | null }[]; canEdit: boolean }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pending, start] = useTransition()

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) =>
    start(async () => {
      const result = await fn()
      if (!result.ok) return void toast.error(result.error)
      after?.()
      router.refresh()
    })

  return (
    <div className="space-y-3">
      {managers.length === 0 ? (
        <p className="text-sm text-muted-foreground">No account managers yet.</p>
      ) : (
        <ul className="space-y-1.5">
          {managers.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{m.name}</span>
                {m.email && <span className="block truncate text-xs text-muted-foreground">{m.email}</span>}
              </span>
              {canEdit && (
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${m.name}`} disabled={pending} onClick={() => run(() => removeAccountManager(m.id))}>
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            run(
              () => addAccountManager(accountId, { name, email }),
              () => {
                setName('')
                setEmail('')
              }
            )
          }}
          className="space-y-2"
        >
          <Input aria-label="Manager name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" required disabled={pending} />
          <Input aria-label="Manager email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" disabled={pending} />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <Plus />} Add manager
          </Button>
        </form>
      )}
    </div>
  )
}
