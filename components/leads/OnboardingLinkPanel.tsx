'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Copy, Link2, Loader2, Mail, RefreshCw } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { createOnboardingLink } from '@/app/(lms)/leads/actions'
import { manilaDate, manilaDateTime } from '@/lib/customer-fields'

type LinkInfo = {
  url: string
  createdAt: string
  expiresAt: string
  openedAt: string | null
  email: { subject: string; body: string }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Copy failed. Select the text and copy it instead.')
    }
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy}>
      {copied ? <Check /> : <Copy />} {copied ? 'Copied' : label}
    </Button>
  )
}

export function OnboardingLinkPanel({
  customerId,
  customerEmail,
  link,
  hadLinks,
}: {
  customerId: string
  customerEmail: string | null
  link: LinkInfo | null
  hadLinks: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [confirmNew, setConfirmNew] = useState(false)

  const create = () =>
    start(async () => {
      const result = await createOnboardingLink(customerId)
      if (!result.ok) return void toast.error(result.error)
      setConfirmNew(false)
      toast.success('Onboarding link ready.')
      router.refresh()
    })

  if (!link) {
    return (
      <div className="space-y-3 rounded-xl border bg-card p-5">
        <p className="text-sm text-muted-foreground">
          {hadLinks
            ? 'The last link expired or was replaced. Make a new one to send.'
            : 'Make a personal link to the onboarding form. It shows this customer’s name and ID, and stays valid for 14 days.'}
        </p>
        <Button onClick={create} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Link2 />} Create onboarding link
        </Button>
      </div>
    )
  }

  const mailto = `mailto:${encodeURIComponent(customerEmail ?? '')}?subject=${encodeURIComponent(link.email.subject)}&body=${encodeURIComponent(link.email.body)}`

  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">Link</p>
          <p className="text-xs text-muted-foreground">
            Valid until {new Date(link.expiresAt).toLocaleDateString('en-PH', manilaDate)} ·{' '}
            {link.openedAt ? `Opened ${new Date(link.openedAt).toLocaleString('en-PH', manilaDateTime)}` : 'Not opened yet'}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Onboarding link" className="h-8 min-w-0 flex-1 rounded-lg border bg-muted/40 px-2.5 font-mono text-xs" />
          <CopyButton text={link.url} label="Copy link" />
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Email to send</p>
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <p className="mb-2">
            <span className="text-muted-foreground">Subject: </span>
            {link.email.subject}
          </p>
          <pre className="whitespace-pre-wrap break-words font-sans text-sm">{link.email.body}</pre>
        </div>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={`Subject: ${link.email.subject}\n\n${link.email.body}`} label="Copy email" />
          <a href={mailto} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <Mail /> Open in email app
          </a>
        </div>
        {!customerEmail && <p className="text-xs text-muted-foreground">No email saved for this lead, so add the recipient yourself.</p>}
      </div>

      <div className="border-t pt-3">
        {confirmNew ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>The current link will stop working.</span>
            <Button size="sm" variant="destructive" onClick={create} disabled={pending}>
              {pending && <Loader2 className="animate-spin" />} Replace link
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmNew(false)} disabled={pending}>
              Keep current link
            </Button>
          </div>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmNew(true)}>
            <RefreshCw /> Make a new link
          </Button>
        )}
      </div>
    </div>
  )
}
