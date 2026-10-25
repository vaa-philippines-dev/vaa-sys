import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { FALLBACK_SERVICES, LINK_VALID_DAYS } from '@/lib/onboarding-fields'

// Server-only: onboarding links and what the public form needs.

export function newLinkToken() {
  return randomBytes(32).toString('base64url')
}

export function linkExpiry(from = new Date()) {
  return new Date(from.getTime() + LINK_VALID_DAYS * 24 * 3_600_000)
}

export function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3001').replace(/\/$/, '')
}

export function onboardingUrl(token: string) {
  return `${siteUrl()}/onboarding/${token}`
}

export type LinkState = 'OPEN' | 'SUBMITTED' | 'EXPIRED' | 'REVOKED' | 'NOT_FOUND'

// The public form only ever sees the customer's name and ID.
export async function findLink(token: string) {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(token)) return { state: 'NOT_FOUND' as LinkState, link: null }
  const link = await prisma.onboardingLink.findUnique({
    where: { token },
    select: {
      id: true,
      customerId: true,
      expiresAt: true,
      revokedAt: true,
      openedAt: true,
      submittedAt: true,
      customer: { select: { name: true, customerCode: true, email: true } },
    },
  })
  if (!link) return { state: 'NOT_FOUND' as LinkState, link: null }
  const state: LinkState = link.submittedAt
    ? 'SUBMITTED'
    : link.revokedAt
      ? 'REVOKED'
      : link.expiresAt <= new Date()
        ? 'EXPIRED'
        : 'OPEN'
  return { state, link }
}

// Services offered come from va-management's live Service departments, so
// a new department shows up on the form without a code change.
export async function listServices(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    SELECT d.name
    FROM public.departments d
    JOIN public.departments p ON p.id = d.parent_id
    WHERE p.name = 'Service' AND d.status::text = 'ACTIVE'
    ORDER BY d.name`.catch(() => [])
  return rows.length > 0 ? rows.map((r) => r.name) : FALLBACK_SERVICES
}

// The email Lead Management sends with the link.
export function onboardingEmail(params: { customerName: string; link: string; senderName: string; expiresAt: Date }) {
  const expires = params.expiresAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' })
  const subject = 'Welcome to VAA Philippines: your onboarding form'
  const body = [
    `Hi ${params.customerName},`,
    '',
    'Thank you for choosing VAA Philippines. To get your virtual assistant set up, please fill in our short onboarding form:',
    '',
    params.link,
    '',
    'It has two parts:',
    '1. Your profile: primary and secondary contacts, company details and where invoices should go.',
    '2. Your VA request: the platform, service, schedule and start date you need.',
    '',
    `The link is personal to you and works until ${expires}. It takes about 10 minutes.`,
    '',
    'If you have any questions, just reply to this email.',
    '',
    'Best regards,',
    params.senderName,
    'VAA Philippines',
  ].join('\n')
  return { subject, body }
}
