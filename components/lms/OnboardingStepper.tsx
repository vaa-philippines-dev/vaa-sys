import { Check, FileCheck2, Link2, MailOpen, UserPlus } from 'lucide-react'
import { cn } from '@/lib/utils'

// The LMS "handoff checklist" stepper, showing a lead's onboarding steps.
// Read-only: each step is done when it actually happened.
type Step = { label: string; at: Date | null; icon: typeof Check }

const when = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' })

export function OnboardingStepper({ addedAt, linkSentAt, openedAt, submittedAt }: { addedAt: Date; linkSentAt: Date | null; openedAt: Date | null; submittedAt: Date | null }) {
  const steps: Step[] = [
    { label: 'Lead added', at: addedAt, icon: UserPlus },
    { label: 'Link sent', at: linkSentAt, icon: Link2 },
    { label: 'Form opened', at: openedAt, icon: MailOpen },
    { label: 'Form submitted', at: submittedAt, icon: FileCheck2 },
  ]
  const lastDone = steps.reduce((last, s, i) => (s.at ? i : last), 0)
  const segment = 76 / (steps.length - 1)

  return (
    <section className="rounded-2xl border bg-card p-6">
      <h2 className="mb-8 text-base font-semibold">Onboarding progress</h2>
      <ol className="relative flex items-start justify-between px-2">
        <span className="absolute top-5 h-0.5 bg-border" style={{ left: '12%', right: '12%' }} aria-hidden />
        <span className="absolute top-5 h-0.5 bg-primary" style={{ left: '12%', width: `${lastDone * segment}%` }} aria-hidden />
        {steps.map((s) => {
          const done = Boolean(s.at)
          const Icon = s.icon
          return (
            <li key={s.label} className="relative z-10 flex flex-1 flex-col items-center gap-2 text-center">
              <span
                className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-full border-2',
                  done ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground'
                )}
              >
                {done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </span>
              <span className={cn('text-xs font-medium', done ? 'text-foreground' : 'text-muted-foreground')}>{s.label}</span>
              <span className="text-[10px] text-muted-foreground">{s.at ? when.format(s.at) : 'Not yet'}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
