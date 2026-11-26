// FPL per whole coin for the lend panel, matching how the chain prices a borrow.

const DECIMALS: Record<string, number> = { FPL: 0, BTC4: 8, ETH: 18, USDC: 6 }

export type LendPricePool = { asset_a: string; asset_b: string; reserve_a: string; reserve_b: string }
export type LendPriceMarket = { asset: string; price_fpl: string }

/** FPL for one whole coin, from the pool reserves. */
export function poolPrice(p: LendPricePool): { asset: string; price: string; depth: bigint } | null {
  let fpl = ''
  let other = ''
  let asset = ''
  if (p.asset_a === 'FPL' && p.asset_b in DECIMALS && p.asset_b !== 'FPL') {
    fpl = p.reserve_a
    other = p.reserve_b
    asset = p.asset_b
  } else if (p.asset_b === 'FPL' && p.asset_a in DECIMALS && p.asset_a !== 'FPL') {
    fpl = p.reserve_b
    other = p.reserve_a
    asset = p.asset_a
  }
  if (!asset || !/^\d+$/.test(other) || !/^\d+$/.test(fpl) || other === '0') return null
  const depth = BigInt(other)
  const px = (BigInt(fpl) * 10n ** BigInt(DECIMALS[asset])) / depth
  if (px <= 0n) return null
  return { asset, price: px.toString(), depth }
}

/**
 * FPL per whole coin. The chain re-reads the deepest FPL pool before every borrow,
 * so the pool spot comes first. The stored market price only moves on a borrow or
 * lend-set-price, so it can lag; BTC4's is stored per 1e6 sats before the rescale
 * height, so it is never used as a per-coin price.
 */
export function priceFor(markets: LendPriceMarket[], pools: LendPricePool[], asset: string): string {
  let best = ''
  let bestDepth = 0n
  for (const p of pools) {
    const q = poolPrice(p)
    if (!q || q.asset !== asset || q.depth <= bestDepth) continue
    bestDepth = q.depth
    best = q.price
  }
  if (best) return best
  if (asset === 'BTC4') return '0'
  const m = markets.find((x) => x.asset === asset && x.price_fpl !== '0')
  return m ? m.price_fpl : '0'
}
