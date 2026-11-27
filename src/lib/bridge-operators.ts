// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'
/**
 * BTC bridge operators shown on the network map's Operators orbit.
 * Source: /api/scan/btc-operators (the Testnet4 BitVM2 operators' signed heartbeat feed).
 */
import { useEffect, useState } from 'react'

export interface BridgeOperator {
  name: string
  /** true when the operator's /feed heartbeat is recent. */
  live?: boolean
}

/** A heartbeat older than this marks the operator as not live. */
export const OPERATOR_LIVE_WINDOW_SEC = 15 * 60

type FeedOperator = { name?: unknown; lastSeen?: unknown }

/** Map the /api/scan/btc-operators body to map operators (empty-safe). */
export function operatorsFromFeed(body: unknown, nowSec: number = Date.now() / 1000): BridgeOperator[] {
  const ops = (body as { operators?: unknown })?.operators
  if (!Array.isArray(ops)) return []
  return (ops as FeedOperator[])
    .filter((o) => typeof o?.name === 'string' && o.name)
    .map((o) => {
      const seen = typeof o.lastSeen === 'number' ? o.lastSeen : NaN
      return { name: o.name as string, live: Number.isFinite(seen) && nowSec - seen <= OPERATOR_LIVE_WINDOW_SEC }
    })
}

/** Live BTC bridge operators for the map; refreshes every minute. */
export function useBridgeOperators(): BridgeOperator[] {
  const [ops, setOps] = useState<BridgeOperator[]>([])
  useEffect(() => {
    let cancelled = false
    const load = () =>
      fetch('/api/scan/btc-operators', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!cancelled && j) setOps(operatorsFromFeed(j))
        })
        .catch(() => {})
    void load()
    const t = setInterval(load, 60_000)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [])
  return ops
}
