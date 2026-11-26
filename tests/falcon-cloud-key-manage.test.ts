// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import { describe, expect, it } from 'vitest'
import {
  appendSession, cookieHeader, COOKIE_NAME, readSession, sign, verify,
} from '@/lib/developers/key-session'

const secret = 'test-session-secret'

describe('key session cookie', () => {
  it('signs, reads and rejects a tampered or expired token', () => {
    const token = appendSession(null, 'k_aaaaaaaaaaaa', secret, 1_000)
    const header = `${COOKIE_NAME}=${token}`
    expect(readSession(header, secret, 1_000)).toEqual(['k_aaaaaaaaaaaa'])
    const again = appendSession(header, 'k_bbbbbbbbbbbb', secret, 2_000)
    expect(readSession(`${COOKIE_NAME}=${again}`, secret, 2_000)).toEqual(['k_bbbbbbbbbbbb', 'k_aaaaaaaaaaaa'])
    // newest first, existing id moved to front
    const moved = appendSession(`${COOKIE_NAME}=${again}`, 'k_aaaaaaaaaaaa', secret, 3_000)
    expect(readSession(`${COOKIE_NAME}=${moved}`, secret, 3_000)[0]).toBe('k_aaaaaaaaaaaa')
    expect(verify(token + 'x', secret, 1_000)).toEqual([])
    expect(verify(token, 'other-secret', 1_000)).toEqual([])
    expect(verify(token, secret, 1_000 + 181 * 24 * 3600 * 1000)).toEqual([])
    expect(cookieHeader(token)).toContain('HttpOnly')
    expect(cookieHeader(token)).toContain('Secure')
    expect(cookieHeader(token)).toContain('SameSite=Lax')
    expect(sign({ v: 1, ids: ['not-a-key'], exp: 9_000 }, secret) && readSession(`${COOKIE_NAME}=${sign({ v: 1, ids: ['not-a-key'], exp: 9_000 }, secret)}`, secret, 1_000)).toEqual([])
  })
})
