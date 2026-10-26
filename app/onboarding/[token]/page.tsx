import Image from 'next/image'
import type { Metadata } from 'next'
import { prisma } from '@/lib/prisma'
import { findLink } from '@/lib/onboarding'
import { timeZoneOptions } from '@/lib/onboarding-fields'
import { getWorkHourMinimums } from '@/lib/settings'
import { OnboardingForm } from '@/components/onboarding/OnboardingForm'

export const metadata: Metadata = {
  title: 'Onboarding | VAA Philippines',
  robots: { index: false, follow: false },
}

export default async function OnboardingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const { state, link } = await findLink(token)

  // First open is shown to Lead Management as "Form opened".
  if (link && state === 'OPEN' && !link.openedAt) {
    await prisma.onboardingLink.updateMany({ where: { id: link.id, openedAt: null }, data: { openedAt: new Date() } })
  }

  const minimums = state === 'OPEN' ? await getWorkHourMinimums() : null

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-neutral-950">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <Image src="/vaa-logo-white.png" alt="VAA Philippines" width={350} height={134} className="h-8 w-auto" priority />
          <p className="text-xs font-medium uppercase tracking-wide text-white/60">Customer onboarding</p>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8">
        {(state === 'OPEN' || state === 'PART3_OPEN') && link ? (
          <OnboardingForm
            token={token}
            customerName={link.customer.name}
            customerCode={link.customer.customerCode}
            prefillEmail={link.customer.email}
            part3Only={state === 'PART3_OPEN'}
            timeZones={state === 'OPEN' ? timeZoneOptions() : []}
            minimums={minimums}
          />
        ) : (
          <div className="mx-auto max-w-md rounded-xl border bg-card p-8 text-center">
            <h1 className="text-lg font-semibold">
              {state === 'SUBMITTED' ? 'Form submission complete' : state === 'NOT_FOUND' ? 'This link isn’t valid' : 'This link has expired'}
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {state === 'SUBMITTED'
                ? 'Thank you for providing your details. Your onboarding form has been recorded and will be used in preparing your contract. Our team will contact you about the next steps.'
                : state === 'NOT_FOUND'
                  ? 'Please open the link exactly as it appears in your email from VAA Philippines.'
                  : 'Please reply to our email and we’ll send you a new link.'}
            </p>
          </div>
        )}
      </main>
    </div>
  )
}
