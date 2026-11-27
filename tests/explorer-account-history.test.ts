// Audit 3: /v1/explorer/accounts/:account/transactions uses the wallet Activity sources.
import { describe, expect, it } from 'vitest'
import { accountHistory, enrichRecentTxs, fillToTx } from '@/lib/explorer-api/account-history'

const fills = [
  { height: 100, asset: 'ETH', side: 'buy', price: 53000, base: '1000000000000000', quote: 53, taker: 'alice', maker: 'amm:eth-fpl', maker_order: null },
  { height: 90, asset: 'USDC', side: 'sell', price: 85, base: '2000000', quote: 170, taker: 'bob', maker: 'alice', maker_order: 7 },
  { height: 80, asset: 'BTC4', side: 'buy', price: 1, base: '1', quote: 1, taker: 'carol', maker: 'dave', maker_order: 3 },
]

describe('explorer account history', () => {
  it('includes fills where the account is taker or maker, skips others', () => {
    expect(fillToTx(fills[2], 2, 'alice')).toBeNull()
    const swap = fillToTx(fills[0], 0, 'alice')!
    expect(swap).toMatchObject({ kind: 'swap_fill', height: 100, account: 'alice', destination: 'amm:eth-fpl' })
    expect(swap.amount).toMatchObject({ asset: 'ETH', raw: '1000000000000000', decimals: 18 })
    expect(swap.tx_id).toBe('fill:100:ETH:amm:0')
    expect(fillToTx(fills[1], 1, 'alice')).toMatchObject({ kind: 'order_fill', account: 'bob', destination: 'alice' })
  })

  it('merges recent_txs and fills newest first, de-duplicated', () => {
    const recent = [
      { tx_id: 'aa', height: 95, kind: 'pay', account: 'alice', destination: 'bob', amount: 5, fee: 2 },
      { tx_id: 'aa', height: 95, kind: 'pay', account: 'alice', destination: 'bob', amount: 5, fee: 2 },
    ]
    const rows = accountHistory('alice', recent, fills)
    expect(rows.map((r) => r.tx_id)).toEqual(['fill:100:ETH:amm:0', 'aa', 'fill:90:USDC:7:1'])
    expect(accountHistory('alice', [], [])).toEqual([])
  })

  it('enriches generic recent_txs kinds from the wallet tx log', () => {
    const meta = new Map([['aa', { kind: 'swap_route', meta: { token_in: 'ETH', token_out: 'FPL' } }]])
    const [t] = enrichRecentTxs([{ tx_id: 'AA', kind: 'tx', height: 1 }], meta)
    expect(t).toMatchObject({ kind: 'swap_route', token_in: 'ETH' })
    const [u] = enrichRecentTxs([{ tx_id: 'aa', kind: 'pay', height: 1 }], meta)
    expect(u.kind).toBe('pay')
  })
})
