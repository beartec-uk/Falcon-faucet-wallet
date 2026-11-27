// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { getNetwork } from '@/lib/networks'
import { resolveNetworkKey } from '@/lib/network-server'

export async function GET(req: Request) {
  try {
    const configPath = path.join(process.cwd(), 'public', 'config', 'usdc-bridge.json')
    const raw = await readFile(configPath, 'utf8')
    const config = JSON.parse(raw)
    // Falcon testnet: the live Sepolia rail is FalconQcBridge V3 (pl-2300-bridge.json).
    // usdc-bridge.json is the historical 1001 lock-mint manifest; overlay the live
    // Sepolia endpoints/token and status so the wallet never reads the retired lock.
    let networkParam: string | null = null
    try {
      networkParam = new URL(req.url).searchParams.get('network')
    } catch {
      networkParam = null
    }
    if (getNetwork(resolveNetworkKey(networkParam)).networkId === 2300) {
      const pl = JSON.parse(
        await readFile(path.join(process.cwd(), 'public', 'config', 'pl-2300-bridge.json'), 'utf8'),
      )
      const ps = pl.sepolia ?? {}
      config.status = pl.status ?? 'live'
      config.description = pl.description ?? config.description
      config.historical = false
      delete config.historical_note
      config.sepolia = {
        ...config.sepolia,
        chain_id: ps.chain_id ?? config.sepolia?.chain_id,
        chain_name: ps.chain_name ?? config.sepolia?.chain_name,
        rpc_url: ps.rpc_url ?? config.sepolia?.rpc_url,
        explorer_url: ps.explorer_url ?? config.sepolia?.explorer_url,
        usdc_token: ps.usdc_token ?? config.sepolia?.usdc_token,
        usdc_decimals: ps.usdc_decimals ?? config.sepolia?.usdc_decimals,
      }
      config.pl2300 = pl
    }

    const lockContract =
      process.env.SEPOLIA_LOCK_CONTRACT?.trim() ||
      process.env.NEXT_PUBLIC_SEPOLIA_LOCK_CONTRACT?.trim() ||
      config.sepolia?.lock_contract ||
      ''

    const usdcToken =
      process.env.SEPOLIA_USDC_TOKEN?.trim() ||
      process.env.NEXT_PUBLIC_SEPOLIA_USDC_TOKEN?.trim() ||
      config.sepolia?.usdc_token ||
      ''

    // How far back the WithdrawalReleased watcher scans; env-overridable so mainnet
    // deployments can widen the reorg/miss window without a config redeploy.
    const lookbackRaw =
      process.env.RELEASE_LOOKBACK_BLOCKS?.trim() ||
      process.env.NEXT_PUBLIC_RELEASE_LOOKBACK_BLOCKS?.trim() ||
      ''
    const lookbackParsed = Number.parseInt(lookbackRaw, 10)
    const releaseLookbackBlocks =
      Number.isFinite(lookbackParsed) && lookbackParsed > 0
        ? lookbackParsed
        : config.sepolia?.release_lookback_blocks

    // The Falcon node RPC is server/relay infrastructure and must not leak an
    // internal plaintext (http://<ip>) endpoint to the browser. Only expose a
    // Falcon RPC URL if one is explicitly published via env; otherwise omit it.
    const falconRpc =
      process.env.NEXT_PUBLIC_FALCON_BRIDGE_RPC_URL?.trim() ||
      process.env.FALCON_BRIDGE_RPC_URL?.trim() ||
      ''
    const falcon = { ...(config.falcon ?? {}) }
    if (falconRpc) {
      falcon.rpc_url = falconRpc
    } else {
      delete falcon.rpc_url
    }

    return NextResponse.json({
      ...config,
      falcon,
      sepolia: {
        ...config.sepolia,
        lock_contract: lockContract,
        usdc_token: usdcToken,
        ...(releaseLookbackBlocks ? { release_lookback_blocks: releaseLookbackBlocks } : {}),
      },
      lock_contract_ready: /^0x[a-fA-F0-9]{40}$/.test(lockContract),
    })
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Bridge config unavailable' },
      { status: 500 },
    )
  }
}