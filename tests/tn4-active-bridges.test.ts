import { describe, expect, it } from 'vitest'
import type { Tn4Deposit } from '@/lib/tn4-bridge'
import {
  isTn4ActionRequired,
  isTn4Dismissible,
  mergeTn4Deposits,
  selectActiveTn4Deposits,
  selectDoneTn4Deposits,
} from '@/lib/tn4-active-bridges'
import { tn4DepositStatusView } from '@/lib/tn4-deposit-status'

function dep(overrides: Partial<Tn4Deposit> & { id: string; state: string }): Tn4Deposit {
  return {
    account: 'scott.reynolds.123',
    address: 'tb1qd9p7l9mrwpln4meuk94teyc5x9mg9vnmltkaeanvcxv0rn8wazxqv9kej4',
    created: 1_795_574_330,
    updated: 1_795_591_199,
    last_error: null,
    confirmations: null,
    funding: null,
    funding_sats: 10_000_000,
    deposit_txid: null,
    peg_in_confirm_txid: null,
    ...overrides,
  }
}

describe('mergeTn4Deposits', () => {
  it('surfaces server-side awaiting_signature deposits even when there are no local records', () => {
    const server = [
      dep({ id: 'fca255c5e66c3ee7', state: 'awaiting_signature', funding_sats: 10_000_000 }),
    ]
    const merged = mergeTn4Deposits([], server)
    expect(merged).toHaveLength(1)
    const active = selectActiveTn4Deposits(merged, [])
    expect(active.map((d) => d.id)).toEqual(['fca255c5e66c3ee7'])
    const status = tn4DepositStatusView(active[0])
    expect(status.label).toBe('Ready to confirm')
    expect(status.showConfirmButton).toBe(true)
  })

  it('dedupes by id against local records while preserving local funding fallback and local-only rows', () => {
    const localOnly = dep({ id: 'local11111111111', state: 'awaiting_funding', created: 200, funding_sats: 5_000_000 })
    const localSeeded = dep({
      id: 'shared2222222222',
      state: 'awaiting_funding',
      created: 100,
      funding: 'abcd:0',
      funding_sats: 10_000_000,
    })
    const serverUpdated = dep({
      id: 'shared2222222222',
      state: 'awaiting_signature',
      created: 100,
      updated: 150,
      funding: null,
      funding_sats: null,
    })
    const serverOnly = dep({ id: 'server3333333333', state: 'funded', created: 150 })

    const merged = mergeTn4Deposits([localSeeded, localOnly], [serverUpdated, serverOnly])
    expect(merged.map((d) => d.id)).toEqual([
      'local11111111111',
      'server3333333333',
      'shared2222222222',
    ])
    const shared = merged.find((d) => d.id === 'shared2222222222')!
    expect(shared.state).toBe('awaiting_signature')
    expect(shared.funding).toBe('abcd:0')
    expect(shared.funding_sats).toBe(10_000_000)
  })
})

describe('dismiss visibility rule', () => {
  it('dismissed → awaiting_signature → reappears with Ready to confirm and Confirm', () => {
    const id = 'fca255c5e66c3ee7'
    const dismissedIds = [id]

    // 1) While informational (funded / awaiting_funding / ceremony_pubkeys), dismiss hides it.
    for (const state of ['awaiting_funding', 'funded', 'ceremony_pubkeys', 'signed', 'presigned'] as const) {
      const merged = mergeTn4Deposits([], [dep({ id, state })])
      expect(selectActiveTn4Deposits(merged, dismissedIds)).toEqual([])
    }

    // 2) Once the server transitions the same deposit to awaiting_signature, it reappears.
    const mergedReady = mergeTn4Deposits([], [dep({ id, state: 'awaiting_signature' })])
    const active = selectActiveTn4Deposits(mergedReady, dismissedIds)
    expect(active.map((d) => d.id)).toEqual([id])

    const view = tn4DepositStatusView(active[0])
    expect(view.label).toBe('Ready to confirm')
    expect(view.showConfirmButton).toBe(true)
  })

  it('never hides awaiting_signature even when already in dismissedIds', () => {
    const active = selectActiveTn4Deposits(
      [
        dep({ id: 'needs-user', state: 'awaiting_signature' }),
        dep({ id: 'info-only', state: 'funded' }),
      ],
      ['needs-user', 'info-only'],
    )
    expect(active.map((d) => d.id)).toEqual(['needs-user'])
  })

  it('marks only user-action states as non-dismissible and informational/terminal rows as dismissible', () => {
    expect(isTn4ActionRequired({ state: 'awaiting_signature' })).toBe(true)
    expect(isTn4Dismissible({ state: 'awaiting_signature' })).toBe(false)

    for (const state of [
      'awaiting_funding',
      'funded',
      'waiting_operator_liquidity',
      'ceremony_pubkeys',
      'signed',
      'presigned',
      'broadcasting',
      'peg_in_confirmed',
      'awaiting_mint',
      'minted',
      'failed',
      'expired',
    ]) {
      expect(isTn4ActionRequired({ state })).toBe(false)
      expect(isTn4Dismissible({ state })).toBe(true)
    }
  })

  it('excludes terminal states from active and only hides dismissed minted rows from done', () => {
    const rows = [
      dep({ id: 'm1', state: 'minted' }),
      dep({ id: 'm2', state: 'minted' }),
      dep({ id: 'f1', state: 'failed' }),
      dep({ id: 'e1', state: 'expired' }),
    ]
    expect(selectActiveTn4Deposits(rows, [])).toEqual([])
    expect(selectDoneTn4Deposits(rows, ['m2']).map((d) => d.id)).toEqual(['m1'])
  })
})
