import { describe, expect, it } from 'vitest'
import { TN4_MEMPOOL } from '@/lib/tn4-bridge'
import { isPegInBroadcastOrSeen, tn4DepositStatusView, type Tn4StatusInput } from '@/lib/tn4-deposit-status'

const CONFIRM_TX = 'ab'.repeat(32)
const FUNDING = `${'cd'.repeat(32)}:0`

function dep(partial: Partial<Tn4StatusInput> & { state: string }): Tn4StatusInput {
  return {
    address: 'tb1qexampleaddress000000000000000000000000000',
    last_error: null,
    confirmations: null,
    peg_in_confirm_txid: null,
    deposit_txid: null,
    funding: null,
    ...partial,
  }
}

const ALL_STATES = [
  'awaiting_funding',
  'funded',
  'waiting_operator_liquidity',
  'ceremony_pubkeys',
  'awaiting_signature',
  'signed',
  'presigned',
  'broadcasting',
  'peg_in_confirmed',
  'awaiting_mint',
  'minted',
  'expired',
  'failed',
  'unknown_future_state',
] as const

describe('isPegInBroadcastOrSeen', () => {
  it('does not treat a reserved peg_in_confirm_txid as broadcast in signed/presigned', () => {
    for (const state of ['signed', 'presigned', 'awaiting_signature', 'funded'] as const) {
      expect(
        isPegInBroadcastOrSeen(dep({ state, peg_in_confirm_txid: CONFIRM_TX })),
      ).toBe(false)
    }
  })

  it('treats peg_in_confirmed, awaiting_mint and minted as seen', () => {
    for (const state of ['peg_in_confirmed', 'awaiting_mint', 'minted'] as const) {
      expect(isPegInBroadcastOrSeen(dep({ state, peg_in_confirm_txid: CONFIRM_TX }))).toBe(true)
    }
  })

  it('treats broadcasting as seen only when confirmations >= 0 is present', () => {
    expect(isPegInBroadcastOrSeen(dep({ state: 'broadcasting', peg_in_confirm_txid: CONFIRM_TX }))).toBe(false)
    expect(
      isPegInBroadcastOrSeen(dep({ state: 'broadcasting', peg_in_confirm_txid: CONFIRM_TX, confirmations: 0 })),
    ).toBe(true)
    expect(
      isPegInBroadcastOrSeen(dep({ state: 'broadcasting', peg_in_confirm_txid: CONFIRM_TX, confirmations: 3 })),
    ).toBe(true)
  })

  it('ignores confirmations on pre-broadcast states so a premature 0 cannot enable the link', () => {
    expect(
      isPegInBroadcastOrSeen(dep({ state: 'presigned', peg_in_confirm_txid: CONFIRM_TX, confirmations: 0 })),
    ).toBe(false)
  })

  it('honours explicit broadcast/seen flags', () => {
    expect(isPegInBroadcastOrSeen(dep({ state: 'presigned', broadcast: true }))).toBe(true)
    expect(isPegInBroadcastOrSeen(dep({ state: 'signed', seen: true }))).toBe(true)
    expect(isPegInBroadcastOrSeen(dep({ state: 'signed', broadcast_at: 1_700_000_000 }))).toBe(true)
  })
})

describe('tn4DepositStatusView — every state', () => {
  it('covers a label for every known state and the unknown fallback', () => {
    const labels: Record<string, string> = {}
    for (const state of ALL_STATES) {
      labels[state] = tn4DepositStatusView(dep({ state })).label
    }
    expect(labels).toEqual({
      awaiting_funding: 'Waiting for 1st Bitcoin confirmation',
      funded: 'Preparing deposit',
      waiting_operator_liquidity: 'Preparing deposit',
      ceremony_pubkeys: 'Preparing deposit',
      awaiting_signature: 'Ready to confirm',
      signed: 'Signed — waiting for operators to bind on Falcon',
      presigned: 'Signed — waiting for operators to bind on Falcon',
      broadcasting: 'Broadcasting to Bitcoin',
      peg_in_confirmed: 'Confirming on Bitcoin',
      awaiting_mint: 'Minting fBTC on Falcon.',
      minted: 'fBTC minted',
      expired: 'Expired (no deposit within 3 days)',
      failed: 'Failed',
      unknown_future_state: 'Deposit in progress',
    })
  })

  it('signed/presigned never link the reserved confirm txid', () => {
    for (const state of ['signed', 'presigned'] as const) {
      const v = tn4DepositStatusView(dep({ state, peg_in_confirm_txid: CONFIRM_TX, funding: FUNDING }))
      expect(v.label).toBe('Signed — waiting for operators to bind on Falcon')
      expect(v.explorerHref).toBeNull()
      expect(v.explorerLabel).toBeNull()
      expect(v.showConfirmButton).toBe(false)
      expect(v.isError).toBe(false)
    }
  })

  it('funded + last_error waiting_ceremony_slot is queued, not an error', () => {
    const v = tn4DepositStatusView(dep({ state: 'funded', last_error: 'waiting_ceremony_slot' }))
    expect(v.label).toBe('Queued — waiting for a signing slot')
    expect(v.isError).toBe(false)
    expect(v.explorerHref).toBeNull()
    expect(v.showConfirmButton).toBe(false)
  })

  it('funded with a different last_error is still preparing, not the queued label', () => {
    const v = tn4DepositStatusView(dep({ state: 'funded', last_error: 'something_else' }))
    expect(v.label).toBe('Preparing deposit')
    expect(v.isError).toBe(false)
  })

  it('awaiting_signature is Ready to confirm and shows the Confirm button', () => {
    const v = tn4DepositStatusView(dep({ state: 'awaiting_signature', peg_in_confirm_txid: CONFIRM_TX }))
    expect(v.label).toBe('Ready to confirm')
    expect(v.showConfirmButton).toBe(true)
    expect(v.explorerHref).toBeNull()
    expect(v.isError).toBe(false)
  })

  it('only awaiting_signature shows the Confirm button', () => {
    for (const state of ALL_STATES) {
      const v = tn4DepositStatusView(dep({ state }))
      expect(v.showConfirmButton).toBe(state === 'awaiting_signature')
    }
  })

  it('broadcasting without a seen signal has no confirm-tx link and no confirming label', () => {
    const v = tn4DepositStatusView(dep({ state: 'broadcasting', peg_in_confirm_txid: CONFIRM_TX }))
    expect(v.label).toBe('Broadcasting to Bitcoin')
    expect(v.explorerHref).toBeNull()
  })

  it('Confirming on Bitcoin with a confirmations count only after the peg-in is broadcast', () => {
    const seen = tn4DepositStatusView(
      dep({ state: 'peg_in_confirmed', peg_in_confirm_txid: CONFIRM_TX, confirmations: 3 }),
    )
    expect(seen.label).toBe('Confirming on Bitcoin (3/6)')
    expect(seen.explorerHref).toBe(`${TN4_MEMPOOL}/tx/${CONFIRM_TX}`)
    expect(seen.explorerLabel).toBe(`${CONFIRM_TX.slice(0, 10)}…${CONFIRM_TX.slice(-8)}`)

    const unconfirmed = tn4DepositStatusView(
      dep({ state: 'broadcasting', peg_in_confirm_txid: CONFIRM_TX, confirmations: 0 }),
    )
    expect(unconfirmed.label).toBe('Confirming on Bitcoin (0/6)')
    expect(unconfirmed.explorerHref).toBe(`${TN4_MEMPOOL}/tx/${CONFIRM_TX}`)

    const noCount = tn4DepositStatusView(dep({ state: 'peg_in_confirmed', peg_in_confirm_txid: CONFIRM_TX }))
    expect(noCount.label).toBe('Confirming on Bitcoin')
    expect(noCount.explorerHref).toBe(`${TN4_MEMPOOL}/tx/${CONFIRM_TX}`)
  })

  it('does not invent a confirmations count when the field is missing', () => {
    expect(tn4DepositStatusView(dep({ state: 'peg_in_confirmed' })).label).toBe('Confirming on Bitcoin')
  })

  it('never links a short or empty reserved txid', () => {
    const v = tn4DepositStatusView(dep({ state: 'peg_in_confirmed', peg_in_confirm_txid: 'abc', confirmations: 1 }))
    expect(v.label).toBe('Confirming on Bitcoin (1/6)')
    expect(v.explorerHref).toBeNull()
  })

  it('failed is the only isError state', () => {
    for (const state of ALL_STATES) {
      expect(tn4DepositStatusView(dep({ state, last_error: 'waiting_ceremony_slot' })).isError).toBe(
        state === 'failed',
      )
    }
  })
})
