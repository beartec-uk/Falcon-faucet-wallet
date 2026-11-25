// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// Pure helpers: sum in-flight (not yet minted) bridged deposits for the
// wallet's Bridged assets list. No I/O.

/** BTC → FBTC states that count as in-flight, per the deposit tracker. */
export const TN4_IN_FLIGHT_STATES = new Set([
  'funded',
  'waiting_operator_liquidity',
  'ceremony_pubkeys',
  'awaiting_signature',
  'signed',
  'presigned',
  'broadcasting',
  'confirming',
  'peg_in_confirmed',
  'awaiting_mint',
])

/** Terminal / pre-funding states that must not contribute to the pending total. */
export const TN4_EXCLUDED_STATES = new Set([
  'awaiting_funding',
  'minted',
  'failed',
  'expired',
  'refunded',
])

export type PendingDepositLike = {
  state?: unknown
  last_error?: unknown
  funding_sats?: unknown
}

export function isStageTimeoutError(lastError: unknown): boolean {
  if (typeof lastError !== 'string') return false
  return /stage[\s_-]*timeout/i.test(lastError)
}

function stateOf(d: PendingDepositLike): string {
  return typeof d.state === 'string' ? d.state.trim() : ''
}

/**
 * Whether a TN4 deposit should be included in the wallet's FBTC pending total.
 * In-flight: funded, ceremony_*, awaiting_signature, signed, presigned,
 * broadcasting, confirming (incl. peg_in_confirmed), and awaiting_mint.
 * Excludes minted, failed, refunded, expired, awaiting_funding, and any
 * row whose last_error is a stage-timeout, even if the state were still open.
 */
export function isTn4InFlightDeposit(d: PendingDepositLike): boolean {
  const state = stateOf(d)
  if (!state) return false
  if (TN4_EXCLUDED_STATES.has(state)) return false
  if (isStageTimeoutError(d.last_error)) return false
  if (TN4_IN_FLIGHT_STATES.has(state)) return true
  if (state.startsWith('ceremony_')) return true
  return false
}

export function parseFundingSats(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    if (Number.isFinite(n) && n >= 0) return n
  }
  return 0
}

/** Sum funding_sats across in-flight TN4 deposits. Invalid payloads yield 0. */
export function sumTn4PendingSats(deposits: unknown): number {
  if (!Array.isArray(deposits)) return 0
  let total = 0
  for (const row of deposits) {
    if (!row || typeof row !== 'object') continue
    const d = row as PendingDepositLike
    if (!isTn4InFlightDeposit(d)) continue
    total += parseFundingSats(d.funding_sats)
  }
  return total
}

/** Human BTC amount from sats (e.g. 21000000 → "0.21"). Null when nothing pending. */
export function formatPendingBtc(sats: number): string | null {
  if (!Number.isFinite(sats) || sats <= 0) return null
  const btc = sats / 1e8
  return formatPendingAmount(btc, 8)
}

/** Trim trailing zeros; return null when the amount is not a positive finite number. */
export function formatPendingAmount(amount: number, maxFractionDigits = 8): string | null {
  if (!Number.isFinite(amount) || amount <= 0) return null
  const fixed = amount.toFixed(maxFractionDigits)
  return fixed.replace(/\.?0+$/, '')
}

/**
 * FETH / F-USDC: there is no account-scoped pending-deposit API comparable to
 * `/api/bridge/tn4/v1/deposits`. Dest-lock mint jobs are stored only in this
 * browser's localStorage, and withdrawal-note helpers are for peg-out, not
 * peg-in. Those assets therefore contribute 0 and the UI hides their brackets.
 */
export type BridgedPendingTotals = {
  fbtcSats: number
  fusdc: number
  feth: number
}

export function bridgedPendingTotals(opts: { tn4Deposits?: unknown }): BridgedPendingTotals {
  return {
    fbtcSats: sumTn4PendingSats(opts.tn4Deposits),
    fusdc: 0,
    feth: 0,
  }
}

export function pendingLabelForAsset(
  assetId: 'fusdc' | 'feth' | 'fbtc',
  totals: BridgedPendingTotals,
): string | null {
  if (assetId === 'fbtc') return formatPendingBtc(totals.fbtcSats)
  if (assetId === 'fusdc') return formatPendingAmount(totals.fusdc, 4)
  return formatPendingAmount(totals.feth, 6)
}
