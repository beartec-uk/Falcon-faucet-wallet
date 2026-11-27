// Audit 11/12: pl-btc-rail (BTC4 peg-in / peg-out helpers).
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  BTC_RAIL_LIVE,
  btcPegOutConflicts,
  clearPendingBtcPegOut,
  loadPendingBtcPegOut,
  pegInPlBtc,
  savePendingBtcPegOut,
  txidFromRawHex,
} from '@/lib/pl-btc-rail'

// Bitcoin genesis coinbase: txid 4a5e1e4b…a33b.
const GENESIS =
  '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000'
const GENESIS_TXID = '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b'

describe('pl-btc-rail', () => {
  it('rail is switched on', () => {
    expect(BTC_RAIL_LIVE).toBe(true)
  })

  it('txidFromRawHex hashes the legacy serialization', () => {
    expect(txidFromRawHex(GENESIS)).toBe(GENESIS_TXID)
  })

  it('txidFromRawHex strips segwit marker, flag and witness (txid, not wtxid)', () => {
    // Same tx re-serialized as segwit: version | 00 01 | ins/outs | witness(1 item, 2 bytes) | locktime.
    const version = GENESIS.slice(0, 8)
    const body = GENESIS.slice(8, -8)
    const lock = GENESIS.slice(-8)
    const segwit = version + '0001' + body + '01' + '02' + 'abcd' + lock
    expect(txidFromRawHex(segwit)).toBe(GENESIS_TXID)
    const wtxid = createHash('sha256').update(createHash('sha256').update(Buffer.from(segwit, 'hex')).digest()).digest().reverse().toString('hex')
    expect(wtxid).not.toBe(GENESIS_TXID)
  })

  it('pending peg-out is stored per account (case-insensitive) and conflicts on a different amount/dest', () => {
    const p = { account: 'Alice', amount: 50000, dest: 'tb1qdest', txId: 't', at: 1 } as never
    savePendingBtcPegOut(p)
    expect(loadPendingBtcPegOut('alice')).toMatchObject({ amount: 50000, dest: 'tb1qdest' })
    expect(btcPegOutConflicts(loadPendingBtcPegOut('alice'), 50000, 'tb1qdest')).toBe(false)
    expect(btcPegOutConflicts(loadPendingBtcPegOut('alice'), 60000, 'tb1qdest')).toBe(true)
    expect(btcPegOutConflicts(loadPendingBtcPegOut('alice'), 50000, 'tb1qother')).toBe(true)
    expect(btcPegOutConflicts(null, 1, 'x')).toBe(false)
    clearPendingBtcPegOut('ALICE')
    expect(loadPendingBtcPegOut('alice')).toBeNull()
  })

  it('pegInPlBtc refuses dust and short txids before any network call', async () => {
    const base = { account: 'alice', falconSecret: 'x', network: 'pl2300' }
    await expect(pegInPlBtc({ ...base, externalTxid: GENESIS_TXID, amountSats: 100 })).rejects.toThrow(/too small/)
    await expect(pegInPlBtc({ ...base, externalTxid: 'abcd', amountSats: 50000 })).rejects.toThrow(/64-character/)
  })
})
