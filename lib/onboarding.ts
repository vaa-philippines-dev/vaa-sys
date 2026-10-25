import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { LINK_VALID_DAYS } from '@/lib/onboarding-fields'

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

// PART3_OPEN: the form is in but Part 3 (VA personality preference) was
// skipped, so the same link stays usable for Part 3 alone, even past its
// expiry date. No new link can be made once a customer has submitted.
export type LinkState = 'OPEN' | 'PART3_OPEN' | 'SUBMITTED' | 'EXPIRED' | 'REVOKED' | 'NOT_FOUND'

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
      submission: { select: { id: true, part3SubmittedAt: true } },
    },
  })
  if (!link) return { state: 'NOT_FOUND' as LinkState, link: null }
  const state: LinkState = link.submittedAt
    ? link.submission && !link.submission.part3SubmittedAt && !link.revokedAt
      ? 'PART3_OPEN'
      : 'SUBMITTED'
    : link.revokedAt
      ? 'REVOKED'
      : link.expiresAt <= new Date()
        ? 'EXPIRED'
        : 'OPEN'
  return { state, link }
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
    'It has three parts:',
    '1. Customer profile: your contacts, company details, platforms, and invoice and payment details.',
    '2. Skill requirements: the services, number of VAs, schedule and start date you need.',
    '3. VA personality preference: optional, and you can complete it later, but it helps us find the right VA.',
    '',
    `The link is personal to you and works until ${expires}. Parts 1 and 2 take about 10 minutes.`,
    '',
    'If you have any questions, just reply to this email.',
    '',
    'Best regards,',
    params.senderName,
    'VAA Philippines',
  ].join('\n')
  return { subject, body }
}
