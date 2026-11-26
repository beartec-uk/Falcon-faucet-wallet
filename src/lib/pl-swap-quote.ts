// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
/**
 * AMM quotes for Falcon testnet swaps. Direct f-asset/FPL pools, or two hops
 * through FPL for f-asset to f-asset. The ledger submits this as one swap_route.
 */
import { fAssetLabel } from '@/lib/f-asset-label'

export const SWAP_ASSETS = ['FPL', 'USDC', 'ETH', 'BTC4'] as const
export type SwapAsset = (typeof SWAP_ASSETS)[number]

/** 2% slippage, same as the swap form's min-out (quoted - quoted/50). */
export const SWAP_SLIPPAGE_BPS = 200

export type SwapPool = {
  asset_a: string
  asset_b: string
  reserve_a: string
  reserve_b: string
}

export function quoteOut(rin: bigint, rout: bigint, amountIn: bigint): bigint {
  if (rin <= 0n || rout <= 0n || amountIn <= 0n) return 0n
  const inn = amountIn * 997n
  return (inn * rout) / (rin * 1000n + inn)
}

export function poolSides(p: SwapPool, tokenIn: string): { rin: bigint; rout: bigint } | null {
  if (p.reserve_a === '0' || p.reserve_b === '0') return null
  if (p.asset_a === tokenIn) return { rin: BigInt(p.reserve_a), rout: BigInt(p.reserve_b) }
  if (p.asset_b === tokenIn) return { rin: BigInt(p.reserve_b), rout: BigInt(p.reserve_a) }
  return null
}

export function quoteRoute(pools: SwapPool[], tokenIn: SwapAsset, tokenOut: SwapAsset, amountIn: bigint): bigint {
  if (tokenIn === tokenOut || amountIn <= 0n) return 0n
  const direct = pools.find((p) => poolSides(p, tokenIn) && (p.asset_a === tokenOut || p.asset_b === tokenOut))
  if (direct) {
    const s = poolSides(direct, tokenIn)!
    return quoteOut(s.rin, s.rout, amountIn)
  }
  if (tokenIn !== 'FPL' && tokenOut !== 'FPL') {
    const mid = quoteRoute(pools, tokenIn, 'FPL', amountIn)
    return quoteRoute(pools, 'FPL', tokenOut, mid)
  }
  return 0n
}

/** Hops for a swap_route: direct vs FPL, or From → FPL → To. */
export function swapHops(tokenIn: SwapAsset, tokenOut: SwapAsset): SwapAsset[] {
  if (tokenIn === tokenOut) return []
  if (tokenIn === 'FPL' || tokenOut === 'FPL') return [tokenIn, tokenOut]
  return [tokenIn, 'FPL', tokenOut]
}

export function routeLabel(tokenIn: SwapAsset, tokenOut: SwapAsset): string {
  const hops = swapHops(tokenIn, tokenOut)
  if (!hops.length) return ''
  return hops.map((a) => fAssetLabel(a)).join(' → ')
}

export function minOutAfterSlippage(quoted: bigint, bps: number = SWAP_SLIPPAGE_BPS): bigint {
  if (quoted <= 1n) return quoted > 0n ? 1n : 0n
  const cut = (quoted * BigInt(bps)) / 10000n
  const out = quoted - cut
  return out > 0n ? out : 1n
}

export function otherSwapAssets(from: SwapAsset): SwapAsset[] {
  return SWAP_ASSETS.filter((a) => a !== from)
}
