import { describe, expect, it } from 'vitest'
import {
  bridgedPendingTotals,
  formatPendingAmount,
  formatPendingBtc,
  isStageTimeoutError,
  isTn4InFlightDeposit,
  pendingLabelForAsset,
  sumTn4PendingSats,
} from '@/lib/pending-bridged-deposits'

const IN_FLIGHT = [
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
] as const

const EXCLUDED = ['awaiting_funding', 'minted', 'failed', 'expired', 'refunded'] as const

describe('isTn4InFlightDeposit', () => {
  it('includes every listed in-flight state and ceremony_* wildcard', () => {
    for (const state of IN_FLIGHT) {
      expect(isTn4InFlightDeposit({ state, funding_sats: 1 })).toBe(true)
    }
    expect(isTn4InFlightDeposit({ state: 'ceremony_nonces', funding_sats: 1 })).toBe(true)
  })

  it('excludes minted, failed, refunded, expired, awaiting_funding, and unknown states', () => {
    for (const state of EXCLUDED) {
      expect(isTn4InFlightDeposit({ state, funding_sats: 10_000_000 })).toBe(false)
    }
    expect(isTn4InFlightDeposit({ state: 'unknown', funding_sats: 1 })).toBe(false)
    expect(isTn4InFlightDeposit({ funding_sats: 1 })).toBe(false)
  })

  it('excludes stage-timeout rows even if the state were still open', () => {
    expect(
      isTn4InFlightDeposit({
        state: 'awaiting_signature',
        last_error: 'stage timeout: awaiting_signature for 7962 min (limit 1440 min)',
        funding_sats: 10_000_000,
      }),
    ).toBe(false)
    expect(isStageTimeoutError('stage-timeout: funded')).toBe(true)
    expect(isStageTimeoutError('stage_timeout')).toBe(true)
    expect(isStageTimeoutError('waiting_ceremony_slot')).toBe(false)
  })
})

describe('sumTn4PendingSats', () => {
  it('sums only in-flight rows and ignores junk', () => {
    expect(
      sumTn4PendingSats([
        { state: 'broadcasting', funding_sats: 10_000_000 },
        { state: 'presigned', funding_sats: '1000000' },
        { state: 'awaiting_signature', funding_sats: 10_000_000 },
        { state: 'minted', funding_sats: 10_000_000 },
        { state: 'failed', funding_sats: 10_000_000 },
        {
          state: 'failed',
          last_error: 'stage timeout: awaiting_signature for 7962 min (limit 1440 min)',
          funding_sats: 10_000_000,
        },
        { state: 'expired', funding_sats: 5_000_000 },
        { state: 'awaiting_funding', funding_sats: 9_000_000 },
      ]),
    ).toBe(21_000_000)
    expect(sumTn4PendingSats(null)).toBe(0)
    expect(sumTn4PendingSats({})).toBe(0)
    expect(sumTn4PendingSats([{ state: 'signed' }])).toBe(0)
  })

  it('matches the live scott.reynolds.123 mix: 0.1 + 0.01 + 0.1 BTC', () => {
    // Live states at the time of the request: broadcasting 0.1, presigned 0.01,
    // awaiting_signature 0.1, plus minted / failed / stage-timeout rows that must be ignored.
    const sats = sumTn4PendingSats([
      { state: 'failed', funding_sats: 1_000_000 },
      { state: 'minted', funding_sats: 10_000_000 },
      {
        state: 'failed',
        last_error: 'stage timeout: awaiting_signature for 7962 min (limit 1440 min)',
        funding_sats: 10_000_000,
      },
      { state: 'broadcasting', funding_sats: 10_000_000 },
      { state: 'presigned', funding_sats: 1_000_000 },
      { state: 'awaiting_signature', funding_sats: 10_000_000 },
    ])
    expect(sats).toBe(21_000_000)
    expect(formatPendingBtc(sats)).toBe('0.21')
  })

  it('includes confirming / peg_in_confirmed / awaiting_mint and funded / ceremony states', () => {
    expect(
      sumTn4PendingSats([
        { state: 'funded', funding_sats: 1 },
        { state: 'waiting_operator_liquidity', funding_sats: 2 },
        { state: 'ceremony_pubkeys', funding_sats: 4 },
        { state: 'signed', funding_sats: 8 },
        { state: 'confirming', funding_sats: 16 },
        { state: 'peg_in_confirmed', funding_sats: 32 },
        { state: 'awaiting_mint', funding_sats: 64 },
      ]),
    ).toBe(127)
  })
})

describe('formatPendingAmount / pending labels', () => {
  it('hides a zero or invalid pending amount', () => {
    expect(formatPendingBtc(0)).toBeNull()
    expect(formatPendingAmount(0)).toBeNull()
    expect(formatPendingAmount(-1)).toBeNull()
    expect(formatPendingAmount(Number.NaN)).toBeNull()
  })

  it('only FBTC has a pending label today — FETH and F-USDC have no account API', () => {
    const totals = bridgedPendingTotals({
      tn4Deposits: [{ state: 'broadcasting', funding_sats: 21_000_000 }],
    })
    expect(totals).toEqual({ fbtcSats: 21_000_000, fusdc: 0, feth: 0 })
    expect(pendingLabelForAsset('fbtc', totals)).toBe('0.21')
    expect(pendingLabelForAsset('fusdc', totals)).toBeNull()
    expect(pendingLabelForAsset('feth', totals)).toBeNull()
  })
})
