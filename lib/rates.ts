import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { logActivity } from '@/lib/activity'
import type { Actor } from '@/lib/auth'

// Server-only: the confidential service rates (Standard Billing Rate and VA
// Base Rate, asked for on Nov 5, 2026) and who may see them.
//
// Nobody without the key can read them, developers included:
// - Each rate is encrypted with AES-256-GCM under a key derived from
//   RATES_ENCRYPTION_KEY. That key is set only in Vercel, as a Sensitive
//   variable nobody can read back, and never in a developer's .env.local. The
//   database, its backups and a local copy of the app hold only ciphertext.
// - The ciphertext is bound to its service and field (AES-GCM additional
//   data), so it can't be copied onto another service.
// - Who may see them: the owner below, plus the people granted on User access.
//   Each grant row carries an HMAC of the email made with the key, so a row
//   added straight in the database doesn't count.
// - Values never go in the activity log, the console or an error message.
//
// What this can't stop: someone who can deploy code could change the app to
// show them. Changes to this file and to who can deploy need review.

export const RATE_OWNER_EMAIL = 'operations-admin@vaaphilippines.com'

type Keys = { enc: Buffer; mac: Buffer; kid: string }
let cached: { raw: string; keys: Keys | null } | null = null

function keys(): Keys | null {
  const raw = process.env.RATES_ENCRYPTION_KEY ?? ''
  if (cached && cached.raw === raw) return cached.keys
  let result: Keys | null = null
  if (raw) {
    const master = Buffer.from(raw, 'base64')
    if (master.length === 32) {
      const enc = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'vaa-sys service rates: encryption v1', 32))
      const mac = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'vaa-sys service rates: grants v1', 32))
      // A short fingerprint of the key, stored with each value, so a value
      // saved under another key reads as that rather than as garbage.
      const kid = createHmac('sha256', mac).update('key id').digest('hex').slice(0, 8)
      result = { enc, mac, kid }
    } else {
      console.error('[rates] RATES_ENCRYPTION_KEY must be 32 random bytes, base64-encoded. Rates stay locked.')
    }
  }
  cached = { raw, keys: result }
  return result
}

export function ratesKeySet(): boolean {
  return keys() !== null
}

const b64 = (b: Buffer) => b.toString('base64url')

// `v1.<key id>.<iv>.<tag>.<ciphertext>`
export function encryptRate(value: number, aad: string): string {
  const k = keys()
  if (!k) throw new Error('rates-locked')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', k.enc, iv)
  cipher.setAAD(Buffer.from(aad))
  const ct = Buffer.concat([cipher.update(value.toFixed(2), 'utf8'), cipher.final()])
  return ['v1', k.kid, b64(iv), b64(cipher.getAuthTag()), b64(ct)].join('.')
}

export type Decrypted = { ok: true; value: number } | { ok: false; reason: 'locked' | 'other-key' | 'unreadable' }

export function decryptRate(stored: string, aad: string): Decrypted {
  const k = keys()
  if (!k) return { ok: false, reason: 'locked' }
  const [v, kid, iv, tag, ct] = stored.split('.')
  if (v !== 'v1' || !iv || !tag || !ct) return { ok: false, reason: 'unreadable' }
  if (kid !== k.kid) return { ok: false, reason: 'other-key' }
  try {
    const d = createDecipheriv('aes-256-gcm', k.enc, Buffer.from(iv, 'base64url'))
    d.setAAD(Buffer.from(aad))
    d.setAuthTag(Buffer.from(tag, 'base64url'))
    const text = Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8')
    const value = Number(text)
    return Number.isFinite(value) ? { ok: true, value } : { ok: false, reason: 'unreadable' }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

export const rateAad = (skillId: string, field: 'standard' | 'vaBase') => `service-rate:${skillId}:${field}`

// ── Who may see them ──────────────────────────────────────────────

function signViewer(email: string): string | null {
  const k = keys()
  return k ? createHmac('sha256', k.mac).update(`rate-viewer:${email.toLowerCase()}`).digest('base64url') : null
}

function signatureOk(email: string, signature: string): boolean {
  const expected = signViewer(email)
  if (!expected) return false
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function canViewRates(email: string | null | undefined): Promise<boolean> {
  const e = email?.toLowerCase()
  if (!e) return false
  if (e === RATE_OWNER_EMAIL) return true
  // Fails closed: any error reading the grants means no access.
  const row = await prisma.rateViewer.findUnique({ where: { email: e } }).catch(() => null)
  return !!row && signatureOk(e, row.signature)
}

export type RateViewerRow = { id: string | null; email: string; grantedByEmail: string | null; grantedAt: Date | null; valid: boolean; owner: boolean }

export async function listRateViewers(): Promise<RateViewerRow[]> {
  // The owner is listed even if the grants can't be read.
  const rows = await prisma.rateViewer.findMany({ orderBy: { grantedAt: 'asc' } }).catch(() => [])
  return [
    { id: null, email: RATE_OWNER_EMAIL, grantedByEmail: null, grantedAt: null, valid: true, owner: true },
    ...rows.filter((r) => r.email !== RATE_OWNER_EMAIL).map((r) => ({ id: r.id, email: r.email, grantedByEmail: r.grantedByEmail, grantedAt: r.grantedAt, valid: signatureOk(r.email, r.signature), owner: false })),
  ]
}

type Result = { ok: true; data: null } | { ok: false; error: string }

// Only someone who can already see the rates grants or removes access.
export async function grantRateViewer(actor: Actor, email: string): Promise<Result> {
  if (!(await canViewRates(actor.email))) return { ok: false, error: 'Only people who can see the rates can give access to them.' }
  const e = email.trim().toLowerCase()
  if (e === RATE_OWNER_EMAIL) return { ok: false, error: 'That account can always see the rates.' }
  const signature = signViewer(e)
  if (!signature) return { ok: false, error: 'The rates key isn’t set on this server, so access can’t be given here. Use the live site.' }
  await prisma.$transaction(async (tx) => {
    await tx.rateViewer.upsert({ where: { email: e }, create: { email: e, signature, grantedByEmail: actor.email.toLowerCase() }, update: { signature, grantedByEmail: actor.email.toLowerCase(), grantedAt: new Date() } })
    await logActivity(tx, actor, { entityType: 'RateAccess', entityId: e, entityLabel: e, action: 'CREATE', notes: 'Can now see the confidential service rates' })
  })
  return { ok: true, data: null }
}

export async function revokeRateViewer(actor: Actor, email: string): Promise<Result> {
  if (!(await canViewRates(actor.email))) return { ok: false, error: 'Only people who can see the rates can change who sees them.' }
  const e = email.trim().toLowerCase()
  if (e === RATE_OWNER_EMAIL) return { ok: false, error: 'That account always sees the rates.' }
  await prisma.$transaction(async (tx) => {
    await tx.rateViewer.deleteMany({ where: { email: e } })
    await logActivity(tx, actor, { entityType: 'RateAccess', entityId: e, entityLabel: e, action: 'DELETE', notes: 'Can no longer see the confidential service rates' })
  })
  return { ok: true, data: null }
}
