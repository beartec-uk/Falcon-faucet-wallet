import { describe, expect, it } from 'vitest'
import {
  SWAP_ASSETS,
  minOutAfterSlippage,
  otherSwapAssets,
  quoteRoute,
  routeLabel,
  swapHops,
  type SwapPool,
} from '@/lib/pl-swap-quote'

const pools: SwapPool[] = [
  { asset_a: 'FPL', asset_b: 'ETH', reserve_a: '100000', reserve_b: '2000000000000000000' },
  { asset_a: 'FPL', asset_b: 'USDC', reserve_a: '80000', reserve_b: '1000000000' },
  { asset_a: 'FPL', asset_b: 'BTC4', reserve_a: '500000', reserve_b: '10000000' },
]

describe('pl-swap-quote', () => {
  it('refuses a swap from an asset to itself', () => {
    for (const a of SWAP_ASSETS) {
      expect(quoteRoute(pools, a, a, 1_000n)).toBe(0n)
      expect(swapHops(a, a)).toEqual([])
      expect(otherSwapAssets(a)).not.toContain(a)
      expect(otherSwapAssets(a)).toHaveLength(3)
    }
  })

  it('labels a direct FPL route and a two-hop f-asset route', () => {
    expect(routeLabel('ETH', 'FPL')).toBe('fETH → FPL')
    expect(routeLabel('FPL', 'USDC')).toBe('FPL → fUSDC')
    expect(routeLabel('BTC4', 'ETH')).toBe('fBTC → FPL → fETH')
    expect(routeLabel('USDC', 'BTC4')).toBe('fUSDC → FPL → fBTC')
    expect(swapHops('BTC4', 'ETH')).toEqual(['BTC4', 'FPL', 'ETH'])
  })

  it('quotes every directed pair through the FPL pools', () => {
    const pairs: Array<[typeof SWAP_ASSETS[number], typeof SWAP_ASSETS[number]]> = []
    for (const a of SWAP_ASSETS) {
      for (const b of SWAP_ASSETS) {
        if (a !== b) pairs.push([a, b])
      }
    }
    expect(pairs).toHaveLength(12)
    // 1 FPL, 0.01 ETH, 10 USDC, 0.01 BTC
    const amount: Record<(typeof SWAP_ASSETS)[number], bigint> = {
      FPL: 1_000n,
      ETH: 10_000_000_000_000_000n,
      USDC: 10_000_000n,
      BTC4: 1_000_000n,
    }
    for (const [a, b] of pairs) {
      const out = quoteRoute(pools, a, b, amount[a])
      expect(out, `${a}→${b}`).toBeGreaterThan(0n)
    }
  })

  it('applies 2% slippage to min-out', () => {
    expect(minOutAfterSlippage(1000n)).toBe(980n)
    expect(minOutAfterSlippage(50n)).toBe(49n)
    expect(minOutAfterSlippage(0n)).toBe(0n)
  })

  it('matches a known constant-product quote on the ETH/FPL pool', () => {
    // 1000 FPL in, fee 0.3%: inn=997000, rout=2e18, rin=100000
    // out = 997000 * 2e18 / (100000*1000 + 997000)
    const expected = (997000n * 2000000000000000000n) / (100000n * 1000n + 997000n)
    expect(quoteRoute(pools, 'FPL', 'ETH', 1000n)).toBe(expected)
  })
})
