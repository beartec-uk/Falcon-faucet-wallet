// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
//
// Account transaction history for /v1/explorer/accounts/:account/transactions.
// Same sources as the wallet Activity list (/api/wallet/account): the node's
// recent_txs (enriched from the wallet tx log) plus order-book fills, because
// limit fills and AMM swaps never appear in recent_txs. Pure, no I/O.

import { amount } from './amounts'
import { txFromNode, type TxV1 } from './mappers'

type Obj = Record<string, unknown>

const s = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(x) ? x : 0
}

/** Merge wallet tx-log metadata (kind, asset, amounts) into raw node rows, as the wallet does. */
export function enrichRecentTxs(raw: Obj[], meta: Map<string, { kind: string; meta: Obj }>): Obj[] {
  return raw.map((t) => {
    const hit = meta.get(s(t.tx_id).toLowerCase())
    if (!hit) return t
    const kind = s(t.kind) || 'tx'
    return { ...hit.meta, ...t, kind: kind === 'tx' ? hit.kind : kind }
  })
}

/** One order-book fill as an explorer tx row (only fills where `self` is taker or maker). */
export function fillToTx(f: Obj, i: number, self: string): TxV1 | null {
  const taker = s(f.taker)
  const maker = s(f.maker)
  if (taker !== self && maker !== self) return null
  const asset = s(f.asset).toUpperCase() || 'FPL'
  const height = n(f.height)
  const mo = f.maker_order == null ? 'amm' : s(f.maker_order)
  const amm = maker.startsWith('amm:')
  return {
    tx_id: `fill:${height}:${asset}:${mo}:${i}`,
    height,
    kind: amm && taker === self ? 'swap_fill' : 'order_fill',
    account: taker,
    destination: maker || null,
    amount: amount(asset, s(f.base) || '0'),
    fee: amount('FPL', 0),
    sealed_at: null,
  }
}

/** recent_txs + fills, newest first, de-duplicated by tx_id. */
export function accountHistory(self: string, recentTxs: Obj[], fills: Obj[]): TxV1[] {
  const rows: TxV1[] = []
  const seen = new Set<string>()
  for (const t of recentTxs) {
    const row = txFromNode(t)
    if (!row.tx_id || seen.has(row.tx_id)) continue
    seen.add(row.tx_id)
    rows.push(row)
  }
  fills.forEach((f, i) => {
    const row = fillToTx(f, i, self)
    if (!row || seen.has(row.tx_id)) return
    seen.add(row.tx_id)
    rows.push(row)
  })
  return rows.sort((a, b) => b.height - a.height)
}
