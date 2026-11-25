// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
//
// Explorer visibility for rails (bridges) and AMM pools, aligned to the
// Falcon-PL STATUS source of truth:
//   falcon-pl-rs/crates/fd-pl/docs/BRIDGES_2300_STATUS.md
//
// - Live Bitcoin rail / asset: BTC4 (Bitcoin Testnet4 BitVM2), since height 692,000.
// - Legacy Bitcoin rail / asset: BTC (Bitcoin Testnet3 custodial NUMS/watch pool),
//   frozen 16 Oct 2026.
//
// Visibility is by rail asset, not by hard-coded pool ids.

/** Assets the explorer should treat as live rails. */
export const LIVE_RAIL_ASSETS = ["USDC", "ETH", "BTC4"] as const;

/** Frozen / retired rails that must not appear in explorer rails or pool tabs. */
export const LEGACY_RAIL_ASSETS = ["BTC"] as const;

export type LiveRailAsset = (typeof LIVE_RAIL_ASSETS)[number];
export type LegacyRailAsset = (typeof LEGACY_RAIL_ASSETS)[number];

export function isLegacyRailAsset(asset: string): boolean {
  return (LEGACY_RAIL_ASSETS as readonly string[]).includes(asset);
}

export function isLiveRailAsset(asset: string): boolean {
  return (LIVE_RAIL_ASSETS as readonly string[]).includes(asset);
}

/** Live Bitcoin Testnet4 rail / AMM asset (STATUS §2). */
export function isLiveBitcoinAsset(asset: string): boolean {
  return asset === "BTC4";
}

export function isLegacyBitcoinAsset(asset: string): boolean {
  return asset === "BTC";
}

export type ExplorerPoolLike = {
  asset_a: string;
  asset_b: string;
  reserve_a?: string;
  reserve_b?: string;
  lp_supply?: string;
};

function zeroish(v: string | undefined): boolean {
  return v == null || v === "" || v === "0";
}

export function poolUsesLegacyRailAsset(
  p: Pick<ExplorerPoolLike, "asset_a" | "asset_b">,
): boolean {
  return isLegacyRailAsset(p.asset_a) || isLegacyRailAsset(p.asset_b);
}

export function isEmptyBtcFamilyPool(p: ExplorerPoolLike): boolean {
  const btcFamily = [p.asset_a, p.asset_b].some(
    (a) => isLiveBitcoinAsset(a) || isLegacyBitcoinAsset(a),
  );
  return (
    btcFamily &&
    zeroish(p.reserve_a) &&
    zeroish(p.reserve_b) &&
    zeroish(p.lp_supply)
  );
}

/** Hidden on the explorer: any pool on a legacy rail asset, or an empty BTC/BTC4 pool. */
export function isHiddenExplorerPool(p: ExplorerPoolLike): boolean {
  return poolUsesLegacyRailAsset(p) || isEmptyBtcFamilyPool(p);
}

export function visibleExplorerPools<T extends ExplorerPoolLike>(
  pools: T[],
): T[] {
  return pools.filter((p) => !isHiddenExplorerPool(p));
}

export function visibleExplorerRails<T extends { asset: string }>(
  rails: T[],
): T[] {
  return rails.filter((r) => !isLegacyRailAsset(r.asset));
}

/** Tab label for a visible pool. The live BTC4 pool is named after the SoT asset. */
export function explorerPoolLabel(
  p: Pick<ExplorerPoolLike, "asset_a" | "asset_b">,
  all: Pick<ExplorerPoolLike, "asset_a" | "asset_b">[] = [],
): string {
  const pair = `${p.asset_a}/${p.asset_b}`;
  if (isLiveBitcoinAsset(p.asset_a) || isLiveBitcoinAsset(p.asset_b))
    return `${pair} (live)`;
  const dup =
    all.filter((x) => `${x.asset_a}/${x.asset_b}` === pair).length > 1;
  return dup ? `${pair}` : pair;
}

export function explorerRailLabel(asset: string): string {
  if (isLiveBitcoinAsset(asset)) return "BTC4 (live)";
  return asset;
}
