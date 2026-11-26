// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
/**
 * Wallet display names for Falcon testnet f-assets.
 * Chain asset IDs (ETH, USDC, BTC4, FPL) are unchanged; this is display only.
 */

const DISPLAY: Record<string, string> = {
  ETH: 'fETH',
  FETH: 'fETH',
  USDC: 'fUSDC',
  FUSDC: 'fUSDC',
  QUC: 'fUSDC',
  USD: 'fUSDC',
  BTC4: 'fBTC',
  BTC: 'fBTC',
  FBTC: 'fBTC',
  XBT: 'fBTC',
  FPL: 'FPL',
  FALCON: 'FPL',
  BNB: 'fBNB',
  FBNB: 'fBNB',
}

/** Compact uppercase key: "F-USDC", "fETH", "BTC4" all become comparable tokens. */
function key(asset: string): string {
  return asset.trim().replace(/[\s_-]+/g, '').toUpperCase()
}

/** User-facing label: fETH, fUSDC, fBTC, FPL. Unknown values pass through. */
export function fAssetLabel(asset: string | null | undefined): string {
  if (asset == null) return 'FPL'
  const raw = asset.trim()
  if (!raw) return 'FPL'
  return DISPLAY[key(raw)] ?? raw
}

