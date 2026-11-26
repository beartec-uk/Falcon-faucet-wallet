// Audit 8: the lend panel prices from the live pool, like the chain's borrow check.
import { describe, expect, it } from 'vitest'
import { priceFor } from '@/lib/pl-lend-price'

const pool = (a: string, b: string, ra: string, rb: string) => ({ asset_a: a, asset_b: b, reserve_a: ra, reserve_b: rb })

describe('priceFor', () => {
  it('prefers the pool spot over a stale stored market price', () => {
    // 85 FPL per USDC in the pool; the market still stores 48.
    const pools = [pool('FPL', 'USDC', '85000', '1000000000')]
    expect(priceFor([{ asset: 'USDC', price_fpl: '48' }], pools, 'USDC')).toBe('85')
  })

  it('uses the deepest pool, like pool_price_fpl_scaled on chain', () => {
    const pools = [pool('ETH', 'FPL', '5' + '0'.repeat(17), '5000'), pool('FPL', 'ETH', '53800', '1' + '0'.repeat(18))]
    expect(priceFor([], pools, 'ETH')).toBe('53800')
  })

  it('never reads BTC4 per-1e6-sat stored price as a per-coin price', () => {
    expect(priceFor([{ asset: 'BTC4', price_fpl: '40676' }], [], 'BTC4')).toBe('0')
    expect(priceFor([], [pool('BTC4', 'FPL', '10000000', '406760')], 'BTC4')).toBe('4067600')
  })

  it('falls back to the stored price when no pool exists', () => {
    expect(priceFor([{ asset: 'USDC', price_fpl: '48' }], [], 'USDC')).toBe('48')
  })
})
