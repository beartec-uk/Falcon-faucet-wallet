// Leaderboard switches to live pool prices at the first 00:00 UTC after lending activation.
import { describe, expect, it } from 'vitest'
import { LEND_LIVE_PRICE_HEIGHT, LIVE_PRICE_SWITCH_AT_MS, livePricesActive, poolPricesFpl, scoringPricesFpl, storedPricesFpl } from '@/lib/scoring-prices'
import { positionValues } from '@/lib/activity-index'

// Live 27 Nov snapshot (pl2300/defi), reserves as the exact-JSON status carries them.
const st = (tip: number) => ({
  tip_height: tip,
  defi_markets: [
    { asset: 'BTC4', price_fpl: 40676 },
    { asset: 'ETH', price_fpl: 47322 },
    { asset: 'USDC', price_fpl: 48 },
    { asset: 'BTC', price_fpl: 4067598 },
  ],
  defi_pools: [
    { id: 'btc4-fpl', asset_a: 'FPL', asset_b: 'BTC4', reserve_a: 729266, reserve_b: 18358803, lp_supply: 1 },
    { id: 'eth-fpl', asset_a: 'FPL', asset_b: 'ETH', reserve_a: 15506, reserve_b: '308868913151415914', lp_supply: 1 },
    { id: 'usdc-fpl', asset_a: 'FPL', asset_b: 'USDC', reserve_a: 64897, reserve_b: 821473894, lp_supply: 1 },
    { id: 'fpl-btc', asset_a: 'FPL', asset_b: 'BTC', reserve_a: 0, reserve_b: 0, lp_supply: 0 },
  ],
})
const before = LIVE_PRICE_SWITCH_AT_MS - 1
const after = LIVE_PRICE_SWITCH_AT_MS

describe('scoring prices', () => {
  it('switch is 00:00 UTC 28 Nov 2026 and block 1,021,322', () => {
    expect(new Date(LIVE_PRICE_SWITCH_AT_MS).toISOString()).toBe('2026-11-28T00:00:00.000Z')
    expect(LEND_LIVE_PRICE_HEIGHT).toBe(1_021_322)
  })

  it('stays on stored prices before the boundary or before activation (safe to merge early)', () => {
    expect(scoringPricesFpl(st(1_030_000), before)).toEqual(storedPricesFpl(st(0)))
    expect(scoringPricesFpl(st(1_021_321), after)).toEqual(storedPricesFpl(st(0)))
    expect(livePricesActive(st(1_021_322), after)).toBe(true)
  })

  it('live prices are per whole coin from the deepest pool, BTC4 included', () => {
    const p = poolPricesFpl(st(0))
    expect(p.BTC4).toBeCloseTo(3_972_296, 0) // 729,266 FPL / 0.18358803 BTC4
    expect(p.ETH).toBeCloseTo(50_202.5, 0)
    expect(p.USDC).toBeCloseTo(79.0, 1)
    expect(p.BTC).toBeUndefined() // empty pool: no price
    const live = scoringPricesFpl(st(1_021_322), after)
    expect(live.BTC4 / 40_676).toBeGreaterThan(97)
    expect(live.BTC).toBe(4_067_598) // no live pool: stored price kept
  })

  it('deepest pool wins', () => {
    const s2 = st(0)
    s2.defi_pools.push({ id: 'usdc-fpl-2', asset_a: 'USDC', asset_b: 'FPL', reserve_a: 1_000_000, reserve_b: 1, lp_supply: 1 })
    expect(poolPricesFpl(s2).USDC).toBeCloseTo(79.0, 1)
  })

  it('lend value-hours accrue at live prices only after the switch', () => {
    const snap = { account: 'a', sequence: 1, lp: [], lend: [{ market_id: 'lend-usdc', asset: 'USDC', shares: '100000000' }] }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(positionValues(st(1_021_322), snap as any, before).lend).toBe(4_800)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(positionValues(st(1_021_322), snap as any, after).lend).toBeCloseTo(7_900, -1)
  })
})
