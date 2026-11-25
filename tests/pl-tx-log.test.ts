import { beforeEach, describe, expect, it } from 'vitest'
import { clearPlTxMemoryForTest, lookupPlTxs, parsePlTxSummary, recordPlTx } from '@/lib/pl-tx-log'

describe('pl-tx-log', () => {
  beforeEach(() => clearPlTxMemoryForTest())

  it('preserves 18-decimal u64 amounts when parsing raw tx JSON', () => {
    const raw = JSON.stringify({
      account: 'scott.reynolds.123',
      sequence: 65,
      destination: '',
      amount: 0,
      fee: 2,
      network_id: 2300,
      tx_id: '1C484339969D2EEB',
      body: { kind: 'lend_withdraw', market_id: 'lend-eth', shares: 0 },
    }).replace('"shares":0', '"shares":410000000000000000')
    const parsed = parsePlTxSummary(raw)
    expect(parsed).toEqual({
      tx_id: '1c484339969d2eeb',
      account: 'scott.reynolds.123',
      kind: 'lend_withdraw',
      meta: {
        market_id: 'lend-eth',
        shares: '410000000000000000',
      },
    })
  })

  it('records and looks up non-pay txs in memory when DB is unconfigured', async () => {
    const ok = await recordPlTx({
      account: 'scott.reynolds.123',
      tx_id: 'e192034f3a5085',
      body: {
        kind: 'remove_liquidity',
        pool_id: 'usdc-fpl',
        lp_burn: '5000000',
      },
    })
    expect(ok).toBe(true)
    const map = await lookupPlTxs(['E192034F3A5085', 'missing'])
    expect(map.get('e192034f3a5085')).toEqual({
      tx_id: 'e192034f3a5085',
      account: 'scott.reynolds.123',
      kind: 'remove_liquidity',
      meta: {
        pool_id: 'usdc-fpl',
        lp_burn: '5000000',
      },
    })
    expect(map.has('missing')).toBe(false)
  })
})
