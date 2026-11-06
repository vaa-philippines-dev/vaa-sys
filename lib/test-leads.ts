import { prisma } from '@/lib/prisma'
import { logActivity } from '@/lib/activity'
import { generateCustomerCode } from '@/lib/customers'
import { linkExpiry, newLinkToken } from '@/lib/onboarding'
import { manilaToday, dayString } from '@/lib/customer-fields'
import type { Actor } from '@/lib/auth'
import type { OnboardingInput } from '@/lib/onboarding-fields'

// Server-only: test leads. An admin adds one to try Lead Management end to
// end without a real customer: a Pending lead marked is_test, an onboarding
// link, and a sample onboarding form submitted through the same code as the
// public form (app/onboarding/[token]/actions.ts), so it lands in Contract &
// Billing Initiation exactly like a real lead. Test leads are left out of
// reports and counts (REAL_CUSTOMERS in lib/customers.ts).

const pad = (n: number) => String(n).padStart(3, '0')

// example.com is reserved for examples, so nothing can ever reach a real
// mailbox through the contract or onboarding emails' mailto links.
export function testLeadDefaults(n: number) {
  return { name: `Test Lead ${pad(n)}`, email: `test-lead-${pad(n)}@example.com` }
}

// A complete, valid onboarding form: one Amazon VA, 8 AM to 5 PM Philippine
// time on weekdays, starting in two weeks. Part 3 is left for later, like a
// customer who skips it.
export function sampleOnboarding(n: number, today = manilaToday()): OnboardingInput {
  const { email } = testLeadDefaults(n)
  const [y, m, d] = today.split('-').map(Number)
  const start = dayString(new Date(Date.UTC(y, m - 1, d + 14)))
  return {
    part1: {
      primary: { firstName: 'Test', lastName: `Contact ${pad(n)}`, role: 'Owner', email, whatsapp: '+1 555 010 0000', region: 'The Americas' },
      focalContact: 'PRIMARY',
      company: {
        companyName: `Test Company ${pad(n)} LLC`,
        dbaName: '',
        businessAddress: '123 Sample Street, Austin, TX 78701, USA',
        website: 'https://example.com',
        timeZone: 'America/Chicago',
      },
      hasSecondary: false,
      secondary: { firstName: '', lastName: '', role: '', email: '', whatsapp: '' },
      business: { platforms: ['Amazon US'], platformOther: '', otherInfo: 'Test record added from Lead Management. Not a real customer.' },
      invoice: { source: 'PRIMARY', firstName: '', lastName: '', role: '', email: '' },
      payment: { hasPayoneerOrWise: true, method: 'WISE', methodOther: '', billingCountry: '' },
    },
    part2: {
      requests: [
        {
          service: 'Amazon - Virtual Assistant',
          numberOfVas: 1,
          targetStartDate: start,
          scheduleType: 'DAILY_FIXED',
          hoursPerWeek: null,
          hoursPerDay: null,
          hoursPerMonth: null,
          projectHours: null,
          startTimePht: '08:00',
          endTimePht: '17:00',
          workDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
          dayHours: [9, 9, 9, 9, 9, null, null],
          additionalHours: '',
          taskTracker: true,
          tasks: 'Sample tasks for testing: listings, inventory checks, customer messages.',
          tools: 'Seller Central',
          timeZone: '',
          mustHaves: 'Sample must-have: has Seller Central experience.',
        },
      ],
    },
    part3: { completeNow: false },
  }
}

// The lead and its open onboarding link. The form is submitted afterwards
// by the caller, through the public form's own action.
export async function addTestLead(actor: Actor): Promise<{ id: string; n: number; token: string }> {
  // Numbered after the highest test lead so far, so a deleted one's number
  // isn't reused while others remain.
  const existing = await prisma.customer.findMany({ where: { isTest: true }, select: { name: true } })
  const n = Math.max(0, ...existing.map((c) => Number(/^Test Lead (\d+)$/.exec(c.name)?.[1]) || 0)) + 1
  const { name, email } = testLeadDefaults(n)
  const customerCode = await generateCustomerCode()
  const token = newLinkToken()
  const now = new Date()

  const id = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.create({
      data: {
        customerCode,
        name,
        email,
        notes: 'Test lead with a sample onboarding form. Not counted in reports.',
        status: 'PENDING',
        isTest: true,
        createdById: actor.id,
        createdByEmail: actor.email,
        statusLogs: { create: { fromStatus: null, toStatus: 'PENDING', changedById: actor.id, changedByEmail: actor.email } },
        onboardingLinks: { create: { token, createdByEmail: actor.email, expiresAt: linkExpiry(now) } },
      },
      select: { id: true },
    })
    await logActivity(tx, actor, { entityType: 'Customer', entityId: customer.id, entityLabel: name, customerId: customer.id, action: 'CREATE', notes: 'Test lead' })
    return customer.id
  })
  return { id, n, token }
}

// Deleting one is the same as any lead (lib/lead-delete.ts), without the
// typed-name confirmation.
