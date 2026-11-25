// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// Pure deposit-status → label / Bitcoin-explorer-link mapping for the TN4
// (BTC → FBTC) tracker in BridgeDepositPanel. No I/O.

import { TN4_MEMPOOL, type Tn4Deposit } from '@/lib/tn4-bridge'

/** States in which peg_in_confirm_txid is reserved but the confirm tx is not on Bitcoin yet. */
const PRE_BROADCAST_STATES = new Set([
  'awaiting_funding',
  'funded',
  'waiting_operator_liquidity',
  'ceremony_pubkeys',
  'awaiting_signature',
  'signed',
  'presigned',
])

const POST_BROADCAST_STATES = new Set([
  'peg_in_confirmed',
  'awaiting_mint',
  'minted',
])

const PEG_IN_CONFIRMS_NEEDED = 6

export type Tn4StatusInput = Pick<
  Tn4Deposit,
  'state' | 'confirmations' | 'peg_in_confirm_txid' | 'deposit_txid' | 'funding' | 'address' | 'last_error'
> & {
  /** Optional extra flags some intake payloads may include. */
  broadcast?: unknown
  seen?: unknown
  broadcast_at?: unknown
  seen_at?: unknown
}

export type Tn4StatusView = {
  label: string
  /** mempool.space link for the peg-in confirm tx, only once it is broadcast or seen. */
  explorerHref: string | null
  explorerLabel: string | null
  showConfirmButton: boolean
  /** True only for real failures — not for queued/waiting hints in last_error. */
  isError: boolean
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isPresentFlag(v: unknown): boolean {
  if (v === true || v === 1 || v === '1' || v === 'true') return true
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return true
  if (typeof v === 'string' && v.trim().length > 0 && v !== '0' && v !== 'false') return true
  return false
}

function confirmationsSeen(confirmations: unknown): number | null {
  if (isFiniteNumber(confirmations) && confirmations >= 0) return confirmations
  return null
}

/**
 * Whether the peg-in confirm transaction has actually been broadcast or
 * observed on Bitcoin. Presence of `peg_in_confirm_txid` alone is not enough
 * — that id is assigned at sign time, before operators broadcast it.
 */
export function isPegInBroadcastOrSeen(d: Tn4StatusInput): boolean {
  if (POST_BROADCAST_STATES.has(d.state)) return true
  if (isPresentFlag(d.broadcast) || isPresentFlag(d.seen) || isPresentFlag(d.broadcast_at) || isPresentFlag(d.seen_at)) {
    return true
  }
  const conf = confirmationsSeen(d.confirmations)
  if (conf === null) return false
  // A confirmations count is only meaningful once we have left the pre-broadcast
  // states (signed/presigned may still carry a reserved txid and a null/absent count).
  if (PRE_BROADCAST_STATES.has(d.state)) return false
  // `broadcasting` (or any later/unknown state) with confirmations >= 0: seen.
  return true
}

function confirmTxid(d: Tn4StatusInput): string | null {
  const id = typeof d.peg_in_confirm_txid === 'string' ? d.peg_in_confirm_txid.trim() : ''
  return /^[0-9a-f]{64}$/i.test(id) ? id : null
}

function confirmingLabel(d: Tn4StatusInput): string {
  const conf = confirmationsSeen(d.confirmations)
  if (conf !== null) return `Confirming on Bitcoin (${conf}/${PEG_IN_CONFIRMS_NEEDED})`
  return 'Confirming on Bitcoin'
}

/**
 * Map a TN4 deposit payload to the tracker label, confirm-tx link (or none),
 * and whether the Confirm button should show.
 */
export function tn4DepositStatusView(d: Tn4StatusInput): Tn4StatusView {
  const queued = d.state === 'funded' && d.last_error === 'waiting_ceremony_slot'
  const seen = isPegInBroadcastOrSeen(d)
  const showConfirmButton = d.state === 'awaiting_signature'
  const isError = d.state === 'failed'

  let label: string
  switch (d.state) {
    case 'awaiting_funding':
      label = 'Waiting for 1st Bitcoin confirmation'
      break
    case 'funded':
      label = queued ? 'Queued — waiting for a signing slot' : 'Preparing deposit'
      break
    case 'ceremony_pubkeys':
    case 'waiting_operator_liquidity':
      label = 'Preparing deposit'
      break
    case 'awaiting_signature':
      label = 'Ready to confirm'
      break
    case 'signed':
    case 'presigned':
      label = 'Signed — waiting for operators to bind on Falcon'
      break
    case 'broadcasting':
      label = seen ? confirmingLabel(d) : 'Broadcasting to Bitcoin'
      break
    case 'peg_in_confirmed':
      label = confirmingLabel(d)
      break
    case 'awaiting_mint':
      label = 'Minting FBTC on Falcon.'
      break
    case 'minted':
      label = 'FBTC minted'
      break
    case 'expired':
      label = 'Expired (no deposit within 3 days)'
      break
    case 'failed':
      label = 'Failed'
      break
    default:
      label = seen ? confirmingLabel(d) : 'Deposit in progress'
  }

  let explorerHref: string | null = null
  let explorerLabel: string | null = null
  if (seen) {
    const txid = confirmTxid(d)
    if (txid) {
      explorerHref = `${TN4_MEMPOOL}/tx/${txid}`
      explorerLabel = `${txid.slice(0, 10)}…${txid.slice(-8)}`
    }
  }

  return { label, explorerHref, explorerLabel, showConfirmButton, isError }
}
