// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// GET  /api/falcon-cloud/keys           -> { keys: [...] } for key_ids in the browser session cookie.
// POST /api/falcon-cloud/keys           { action: 'revoke'|'claim', keyId? | key? }
//   revoke: session must own keyId, or the plaintext key is presented.
//   claim:  attach a pasted key to this browser session.
import { NextRequest, NextResponse } from 'next/server'
import { requireBrowserOrigin } from '@/lib/origin'
import { hashApiKey } from '@/lib/developers/api-keys'
import { disableKeyById, findKeyBySha256, listKeysByIds } from '@/lib/developers/key-store'
import { appendSession, cookieHeader, readSession, sessionSecret } from '@/lib/developers/key-session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

function secretOr503(): string | NextResponse {
  const s = sessionSecret()
  if (!s) return NextResponse.json({ error: 'Not available right now.' }, { status: 503, headers: noStore })
  return s
}

export async function GET(req: NextRequest) {
  if (!requireBrowserOrigin(req)) return NextResponse.json({ error: 'Origin not allowed' }, { status: 403, headers: noStore })
  const secret = secretOr503()
  if (secret instanceof NextResponse) return secret
  try {
    const ids = readSession(req.headers.get('cookie'), secret)
    return NextResponse.json({ keys: await listKeysByIds(ids) }, { headers: noStore })
  } catch (e) {
    console.error('falcon-cloud list keys failed:', (e as Error).message)
    return NextResponse.json({ error: 'Could not list keys.' }, { status: 500, headers: noStore })
  }
}

export async function POST(req: NextRequest) {
  if (!requireBrowserOrigin(req)) return NextResponse.json({ error: 'Origin not allowed' }, { status: 403, headers: noStore })
  const secret = secretOr503()
  if (secret instanceof NextResponse) return secret
  let body: { action?: unknown; keyId?: unknown; key?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers: noStore }) }
  const action = body.action === 'claim' ? 'claim' : body.action === 'revoke' ? 'revoke' : null
  if (!action) return NextResponse.json({ error: 'Unknown action.' }, { status: 400, headers: noStore })

  try {
    if (action === 'claim') {
      if (typeof body.key !== 'string' || !body.key.startsWith('fplk_')) {
        return NextResponse.json({ error: 'Paste a Falcon Cloud API key.' }, { status: 400, headers: noStore })
      }
      const found = await findKeyBySha256(hashApiKey(body.key))
      if (!found) return NextResponse.json({ error: 'Unknown key.' }, { status: 404, headers: noStore })
      const token = appendSession(req.headers.get('cookie'), found.keyId, secret)
      return NextResponse.json({ key: found }, { headers: { ...noStore, 'Set-Cookie': cookieHeader(token) } })
    }

    // revoke
    let keyId: string | null = typeof body.keyId === 'string' ? body.keyId : null
    if (!keyId && typeof body.key === 'string' && body.key.startsWith('fplk_')) {
      const found = await findKeyBySha256(hashApiKey(body.key))
      if (!found) return NextResponse.json({ error: 'Unknown key.' }, { status: 404, headers: noStore })
      keyId = found.keyId
    }
    if (!keyId) return NextResponse.json({ error: 'Which key should we revoke?' }, { status: 400, headers: noStore })
    const sessionIds = readSession(req.headers.get('cookie'), secret)
    const presentedPlain = typeof body.key === 'string' && body.key.startsWith('fplk_')
    if (!presentedPlain && !sessionIds.includes(keyId)) {
      return NextResponse.json({ error: 'That key is not in this browser session. Paste the key to revoke it.' }, { status: 403, headers: noStore })
    }
    const changed = await disableKeyById(keyId)
    const token = appendSession(req.headers.get('cookie'), keyId, secret)
    return NextResponse.json({ ok: true, keyId, disabled: true, alreadyDisabled: !changed }, { headers: { ...noStore, 'Set-Cookie': cookieHeader(token) } })
  } catch (e) {
    console.error('falcon-cloud key action failed:', (e as Error).message)
    return NextResponse.json({ error: 'Could not update the key.' }, { status: 500, headers: noStore })
  }
}
