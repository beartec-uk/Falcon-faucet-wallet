// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
//
// FPL prices for the activity tracker and leaderboard.
//
// Legacy: the lend market's stored `price_fpl`. It only moves on a borrow or
// lend-set-price, so it lags the pools (26 Nov: USDC 48 vs ~79), and BTC4's is
// stored per 1e6 sats, so reading it as "per coin" undervalued BTC4 ~100x.
//
// Live: the deepest FPL pool's spot per whole coin, the same source the chain
// uses for borrow/LTV checks and, from block 1,021,322, for lend rewards (#70).
//
// Switch: the first scoring-day boundary (00:00 UTC) after the chain activation,
// and only once the node reports a tip at or past the activation height, so
// merging early changes nothing. The tracker window is a rolling 60 UTC days,
// so the switch re-prices the whole window at once; a day boundary keeps every
// account on one price source within a scoring day.

import { big, toFloat } from '@/lib/pl-exact-json'
import { ASSET_DECIMALS } from '@/lib/rails-pools'

type Obj = Record<string, unknown>
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Obj[]) : [])
const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** Chain height where lend rewards switch to the live pool price (Falcon-PL #70, 2.11.21). */
export const LEND_LIVE_PRICE_HEIGHT = 1_021_322
/** First 00:00 UTC after the expected activation (~15:20 UTC 27 Nov 2026). */
export const LIVE_PRICE_SWITCH_AT_MS = Date.UTC(2026, 10, 28, 0, 0, 0)

/** Stored lend-market prices (legacy tracker behaviour, unchanged). */
export function storedPricesFpl(st: Obj): Record<string, number> {
  const out: Record<string, number> = { FPL: 1 }
  for (const m of arr(st.defi_markets)) out[s(m.asset)] = Number(m.price_fpl) || 0
  return out
}

/** FPL per whole coin from the deepest FPL pool of each asset (largest asset reserve). */
export function poolPricesFpl(st: Obj): Record<string, number> {
  const best: Record<string, { depth: bigint; price: number }> = {}
  for (const p of arr(st.defi_pools)) {
    const a = s(p.asset_a)
    const b = s(p.asset_b)
    const [asset, fplRaw, assetRaw] = a === 'FPL' ? [b, p.reserve_a, p.reserve_b] : b === 'FPL' ? [a, p.reserve_b, p.reserve_a] : ['', 0, 0]
    if (!asset || asset === 'FPL' || !(asset in ASSET_DECIMALS)) continue
    const depth = big(assetRaw)
    const fpl = big(fplRaw)
    if (depth <= 0n || fpl <= 0n) continue
    if (best[asset] && best[asset].depth >= depth) continue
    best[asset] = { depth, price: toFloat(fpl, 0) / toFloat(depth, ASSET_DECIMALS[asset]) }
  }
  const out: Record<string, number> = { FPL: 1 }
  for (const [k, v] of Object.entries(best)) out[k] = v.price
  return out
}

/** True once both the switch time has passed and the chain is past the activation height. */
export function livePricesActive(st: Obj, now: number): boolean {
  return now >= LIVE_PRICE_SWITCH_AT_MS && (Number(st.tip_height) || 0) >= LEND_LIVE_PRICE_HEIGHT
}

/**
 * Prices the tracker scores with. After the switch: live pool prices, falling back to the
 * stored price only for an asset with no FPL pool (never for BTC4, whose stored unit differs).
 */
export function scoringPricesFpl(st: Obj, now: number): Record<string, number> {
  const stored = storedPricesFpl(st)
  if (!livePricesActive(st, now)) return stored
  const live = poolPricesFpl(st)
  const out: Record<string, number> = { ...live }
  for (const [k, v] of Object.entries(stored)) if (!(k in out) && k !== 'BTC4') out[k] = v
  return out
}
