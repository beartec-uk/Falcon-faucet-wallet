// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// Signed, httpOnly cookie that remembers key_ids minted or claimed in this browser.
// The cookie never holds the API key plaintext — only public key_ids (`k_…`).
import { createHmac, timingSafeEqual } from 'crypto'

export const COOKIE_NAME = 'fpl_cloud_keys'
export const COOKIE_MAX_AGE_SEC = 180 * 24 * 3600
export const MAX_IDS = 20

export type SessionPayload = { v: 1; ids: string[]; exp: number }

export function parseCookieHeader(header: string | null, name = COOKIE_NAME): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=')
    if (k === name) return rest.join('=')
  }
  return null
}

export function readSession(cookieHeader: string | null, secret: string, now = Date.now()): string[] {
  const raw = parseCookieHeader(cookieHeader)
  if (!raw) return []
  return verify(raw, secret, now)
}

export function appendSession(cookieHeader: string | null, keyId: string, secret: string, now = Date.now()): string {
  const ids = readSession(cookieHeader, secret, now)
  const next = [keyId, ...ids.filter((id) => id !== keyId)].slice(0, MAX_IDS)
  return sign({ v: 1, ids: next, exp: now + COOKIE_MAX_AGE_SEC * 1000 }, secret)
}

export function sign(payload: SessionPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  const mac = createHmac('sha256', secret).update(`falcon-cloud-key-session:v1:${body}`).digest('base64url')
  return `${body}.${mac}`
}

export function verify(token: string, secret: string, now = Date.now()): string[] {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return []
  const body = token.slice(0, dot)
  const mac = token.slice(dot + 1)
  const expected = createHmac('sha256', secret).update(`falcon-cloud-key-session:v1:${body}`).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return []
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
    if (p.v !== 1 || !Array.isArray(p.ids) || typeof p.exp !== 'number' || p.exp < now) return []
    return p.ids.filter((id) => typeof id === 'string' && /^k_[a-f0-9]{12}$/.test(id)).slice(0, MAX_IDS)
  } catch {
    return []
  }
}

export function cookieHeader(value: string): string {
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE_SEC}`
}

/** Secret used to sign the browser session cookie. Same family as the reveal secret. */
export function sessionSecret(env: Record<string, string | undefined> = process.env): string | null {
  return (env.FALCON_CLOUD_REVEAL_SECRET || env.FALCON_CLOUD_EXPORT_TOKEN)?.trim() || null
}
