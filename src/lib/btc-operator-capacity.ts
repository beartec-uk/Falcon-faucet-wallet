// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// Pure helpers to read operator BTC capacity from /api/scan/btc-operators
// (camelCase `availableSats`) or a raw feed (`btc_available_sats` / `available_sats`).

export type OperatorCapacity = {
  maxSingleBtc: number
  totalBtc: number
  onlineCount: number
}

/** Parse a sats value that may be a number or numeric string. Rejects NaN, inf, and negatives. */
export function parseSats(v: unknown): number | null {
  if (typeof v === 'number') {
    return Number.isFinite(v) && v >= 0 ? v : null
  }
  if (typeof v === 'string') {
    const t = v.trim()
    if (!t) return null
    const n = Number(t)
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  return null
}

/**
 * Prefer the public API field (`availableSats`), then snake_case aliases.
 * Returns 0 when no usable value is present.
 */
export function operatorAvailableSats(o: unknown): number {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return 0
  const r = o as Record<string, unknown>
  return parseSats(r.availableSats) ?? parseSats(r.btc_available_sats) ?? parseSats(r.available_sats) ?? 0
}

function totalsSats(totals: unknown): number | null {
  if (!totals || typeof totals !== 'object' || Array.isArray(totals)) return null
  const r = totals as Record<string, unknown>
  return parseSats(r.availableSats) ?? parseSats(r.available_sats) ?? parseSats(r.btc_available_sats)
}

/** Roll up a /api/scan/btc-operators (or raw feed) payload into display units. */
export function operatorCapacityFromFeed(payload: unknown): OperatorCapacity {
  const empty: OperatorCapacity = { maxSingleBtc: 0, totalBtc: 0, onlineCount: 0 }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return empty
  const j = payload as Record<string, unknown>
  const ops = Array.isArray(j.operators) ? j.operators : []
  const online = ops.filter((o) => o && typeof o === 'object' && !Array.isArray(o) && (o as { online?: unknown }).online !== false)
  const active = online.length > 0 ? online : ops
  const sats = active.map(operatorAvailableSats)
  const maxSats = sats.reduce((m, s) => Math.max(m, s), 0)
  const totSats = totalsSats(j.totals) ?? sats.reduce((s, n) => s + n, 0)
  return {
    maxSingleBtc: maxSats / 1e8,
    totalBtc: totSats / 1e8,
    onlineCount: active.length,
  }
}
