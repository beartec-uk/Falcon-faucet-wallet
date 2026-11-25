// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// Persistent non-secret metadata log for Falcon PL wallet submissions.
// The node's account_query.recent_txs collapses non-Pay/Claim/AssetPay variants
// to kind="tx" with amount=0, so the wallet records the tx_id -> kind + body
// summary when a transaction is accepted by /api/wallet/submit.
// Stored in Neon `wallet_pl_txs` with an in-memory fallback when DATABASE_URL is unset.

import { getSql, isDbConfigured } from '@/lib/db'

const ACCOUNT_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i
const KIND_RE = /^[a-z0-9_]{1,40}$/

export type PlTxMeta = Record<string, string>

export interface PlTxSummary {
  tx_id: string
  account: string
  kind: string
  meta: PlTxMeta
}

const BIGINT_KEYS_RE =
  /("(?:amount|amount_in|min_out|amt_a|amt_b|lp_burn|shares|collateral_fpl|price|order_id|observed_amount|height|expires_height|expiry_height)"\s*:\s*)(\d+)/g

const SAFE_META_KEYS = [
  'asset',
  'pool_id',
  'market_id',
  'token_in',
  'token_out',
  'amount_in',
  'min_out',
  'amt_a',
  'amt_b',
  'lp_burn',
  'amount',
  'shares',
  'collateral_fpl',
  'pair',
  'side',
  'price',
  'order_id',
  'chain',
  'address',
  'validator',
  'external_to',
  'destination',
  'deposit_id',
  'credit_to',
  'to',
] as const

function parseJsonPreserveBigInts(raw: string): Record<string, unknown> | null {
  try {
    const safe = raw.replace(BIGINT_KEYS_RE, '$1"$2"')
    const parsed = JSON.parse(safe)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export function parsePlTxSummary(input: string | Record<string, unknown>): PlTxSummary | null {
  const root = typeof input === 'string' ? parseJsonPreserveBigInts(input) : input
  if (!root || typeof root !== 'object') return null

  const txObj =
    root.tx && typeof root.tx === 'object' && !Array.isArray(root.tx)
      ? (root.tx as Record<string, unknown>)
      : root

  const body =
    txObj.body && typeof txObj.body === 'object' && !Array.isArray(txObj.body)
      ? (txObj.body as Record<string, unknown>)
      : null
  if (!body) return null

  const kind = String(body.kind ?? '').trim()
  const account = String(txObj.account ?? '').trim()
  const tx_id = String(txObj.tx_id ?? root.tx_id ?? '').trim().toLowerCase()
  if (!KIND_RE.test(kind) || !ACCOUNT_RE.test(account) || !tx_id) return null

  const meta: PlTxMeta = {}
  const topAmt = txObj.amount != null ? String(txObj.amount).trim() : ''
  if (topAmt && topAmt !== '0') meta.amount = topAmt
  const topDest = txObj.destination != null ? String(txObj.destination).trim() : ''
  if (topDest) meta.destination = topDest

  for (const k of SAFE_META_KEYS) {
    const v = body[k]
    if (v != null && String(v).trim() !== '') {
      meta[k] = String(v).trim()
    }
  }
  return { tx_id, account, kind, meta }
}

const mem = new Map<string, PlTxSummary>()
let ready = false

async function ensureTable() {
  if (ready) return
  const sql = getSql()
  await sql`CREATE TABLE IF NOT EXISTS wallet_pl_txs (
    tx_id TEXT PRIMARY KEY,
    account TEXT NOT NULL,
    kind TEXT NOT NULL,
    meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    at BIGINT NOT NULL
  )`
  await sql`CREATE INDEX IF NOT EXISTS wallet_pl_txs_acct_idx ON wallet_pl_txs (account, at DESC)`
  ready = true
}

export async function recordPlTx(
  input: string | Record<string, unknown>,
  now = Date.now(),
): Promise<boolean> {
  const p = parsePlTxSummary(input)
  if (!p) return false
  if (!isDbConfigured()) {
    mem.set(p.tx_id, p)
    return true
  }
  try {
    await ensureTable()
    await getSql()`INSERT INTO wallet_pl_txs (tx_id, account, kind, meta, at)
      VALUES (${p.tx_id}, ${p.account}, ${p.kind}, ${JSON.stringify(p.meta)}::jsonb, ${now})
      ON CONFLICT (tx_id) DO NOTHING`
    return true
  } catch (e) {
    console.error('[pl-tx-log] record', e)
    return false
  }
}

export async function lookupPlTxs(txIds: string[]): Promise<Map<string, PlTxSummary>> {
  const clean = [...new Set(txIds.map((x) => x.trim().toLowerCase()).filter(Boolean))]
  const out = new Map<string, PlTxSummary>()
  if (clean.length === 0) return out

  if (!isDbConfigured()) {
    for (const id of clean) {
      const hit = mem.get(id)
      if (hit) out.set(id, hit)
    }
    return out
  }

  try {
    await ensureTable()
    const rows = (await getSql()`SELECT tx_id, account, kind, meta
      FROM wallet_pl_txs
      WHERE tx_id = ANY(${clean}::text[])`) as Array<Record<string, unknown>>
    for (const r of rows) {
      const id = String(r.tx_id ?? '').toLowerCase()
      if (!id) continue
      const rawMeta = r.meta && typeof r.meta === 'object' ? (r.meta as Record<string, unknown>) : {}
      const meta: PlTxMeta = {}
      for (const [k, v] of Object.entries(rawMeta)) {
        if (v != null) meta[k] = String(v)
      }
      out.set(id, {
        tx_id: id,
        account: String(r.account ?? ''),
        kind: String(r.kind ?? 'tx'),
        meta,
      })
    }
  } catch (e) {
    console.error('[pl-tx-log] lookup', e)
  }

  // Also backfill any legacy swap_route txs from tracker_swaps if not yet in wallet_pl_txs.
  const missing = clean.filter((id) => !out.has(id))
  if (missing.length > 0) {
    try {
      const swapRows = (await getSql()`SELECT tx_id, account, token_in, amount_in
        FROM tracker_swaps
        WHERE tx_id = ANY(${missing}::text[])`) as Array<Record<string, unknown>>
      for (const r of swapRows) {
        const id = String(r.tx_id ?? '').toLowerCase()
        if (!id) continue
        out.set(id, {
          tx_id: id,
          account: String(r.account ?? ''),
          kind: 'swap_route',
          meta: {
            token_in: String(r.token_in ?? ''),
            amount_in: String(r.amount_in ?? ''),
          },
        })
      }
    } catch {
      // tracker_swaps may not exist in fresh DBs
    }
  }

  return out
}

export function clearPlTxMemoryForTest() {
  mem.clear()
}
