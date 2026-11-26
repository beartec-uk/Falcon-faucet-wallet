// Audit 11/12: Bridge panel ETH V3 deposit / withdraw and fBTC Bridge out routing.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Interface } from 'ethers'
import liveCfg from '../public/config/pl-2300-bridge.json'

const V3 = '0xEd4eE497F21a9255a59e87535FF2A6097592Cfd4'
const src = (f: string) => readFileSync(path.join(__dirname, '..', f), 'utf8')

describe('ETH bridge V3 peg-in', () => {
  it('dest20 = sha256(lowercase account)[:20], matching the registered mmeth mappings', async () => {
    const { dest20FromAccount } = await import('@/lib/pl-dest-lock')
    expect(dest20FromAccount('mmeth01')).toBe('0xed3ae487a145f0c003abf00c0d4344efa4d0a833')
    expect(dest20FromAccount('MMETH02')).toBe('0xe94a0719046cb020c7be83fdf15271ccdbfca0a6')
    expect(dest20FromAccount(' mmeth03 ')).toBe('0xe69ce4635a03bd0812e9ee9710807c6f65e3c286')
    expect(dest20FromAccount('mmeth04')).toBe('0x80d630de000351c21e2bdb0925f7e07a5f271932')
  })

  it('peg-in targets FalconQcBridgeV3 for the live config and for the offline fallback (never frozen V1)', async () => {
    const { pegInBridge, pegInIsV3, PL2300_BRIDGE_FALLBACK } = await import('@/lib/pl-dest-lock')
    expect(pegInBridge(liveCfg as never)).toBe(V3)
    expect(pegInIsV3(liveCfg as never)).toBe(true)
    expect(pegInBridge(PL2300_BRIDGE_FALLBACK)).toBe(V3)
    expect(PL2300_BRIDGE_FALLBACK.sepolia.qc_v3).toBe((liveCfg as { sepolia: { qc_v3: string } }).sepolia.qc_v3)
  })

  it('depositEthDestLock calls depositEth(dest20) on V3 with the ETH value and returns the V3 deposit id', async () => {
    vi.resetModules()
    const calls: Array<{ to: string; dest20: string; value: bigint }> = []
    const iface = new Interface([
      'event Deposit(bytes32 indexed depositId, address indexed sender, bytes20 dest20, address token, uint256 amount, uint64 timestamp)',
    ])
    const depositId = '0x' + 'ab'.repeat(32)
    vi.doMock('ethers', async (orig) => {
      const real = (await orig()) as Record<string, unknown>
      class FakeProvider {
        async waitForTransaction() {
          const log = iface.encodeEventLog('Deposit', [depositId, '0x2E0630BB9339AC427feB2aaae31DFEf90fD1181e', '0x' + '11'.repeat(20), '0x' + '00'.repeat(20), 10n ** 16n, 1n])
          return { status: 1, logs: [{ address: V3, topics: log.topics, data: log.data }] }
        }
      }
      class FakeWallet {
        constructor(public key: string, public provider: unknown) {}
      }
      class FakeContract {
        constructor(public addr: string) {}
        async depositEth(dest20: string, o: { value: bigint }) {
          calls.push({ to: this.addr, dest20, value: o.value })
          return { hash: '0x' + 'cd'.repeat(32) }
        }
      }
      return { ...real, JsonRpcProvider: FakeProvider, Wallet: FakeWallet, Contract: FakeContract }
    })
    const { depositEthDestLock, dest20FromAccount } = await import('@/lib/pl-dest-lock')
    const out = await depositEthDestLock({ cfg: liveCfg as never, evmPrivateKey: '0x' + '01'.repeat(32), amountEth: '0.01', plAccount: 'mmeth01' })
    expect(calls).toEqual([{ to: V3, dest20: dest20FromAccount('mmeth01'), value: 10n ** 16n }])
    expect(out.v3DepositId).toBe(depositId)
    vi.doUnmock('ethers')
  })
})

describe('Bridge panel wiring', () => {
  const panel = src('src/components/BridgeDepositPanel.tsx')

  it('ETH / USDC Bridge in uses the dest-lock V3 deposit, Bridge out uses pegOutDestLock', () => {
    expect(panel).toMatch(/depositEthDestLock\(\{/)
    expect(panel).toMatch(/depositUsdcDestLock\(\{/)
    expect(panel).toMatch(/pegOutDestLock\(\{/)
  })

  it('fBTC Bridge out only goes through the Testnet4 rail_withdraw (no dead SPV branch)', () => {
    expect(panel).toMatch(/if \(isFbtcRoute\) \{\s*await handleTn4BridgeOut\(\)\s*return\s*\}/)
    expect(panel).not.toMatch(/pegOutPlBtc\(/)
    expect(panel).not.toContain('className="hidden" aria-hidden="true"')
    const tn4 = panel.slice(panel.indexOf('async function handleTn4BridgeOut()'))
    expect(tn4.slice(0, 4000)).toMatch(/signRailWithdraw\(\{[\s\S]*asset: 'BTC4'/)
  })

  it('fBTC rail_withdraw signs {asset, amount, external_to} with no kickoff on BitVM2', async () => {
    vi.resetModules()
    const seen: string[] = []
    vi.doMock('@/lib/falcon-wasm', () => ({
      getFalcon512: async () => ({ sign: (m: Uint8Array) => (seen.push(new TextDecoder().decode(m)), new Uint8Array([1])) }),
    }))
    vi.doMock('@/lib/falcon-keys', () => ({
      decodeFalconSecret: () => ({ pubBlob: new Uint8Array([0xfb, 0xaa]), secretKey: new Uint8Array([9]) }),
      bytesToHex: (b: Uint8Array) => Buffer.from(b).toString('hex'),
      zeroize: (b: Uint8Array) => b.fill(0),
    }))
    const { signRailWithdraw } = await import('@/lib/pl-wallet-sign')
    const to = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx'
    const tx = await signRailWithdraw({ account: 'alice', sequence: 9, asset: 'BTC4', amount: 50000, externalTo: to, falconSecret: 'x' })
    expect(seen[0]).toBe(`pl-tx:v2|alice|9|${to}|50000|2|2300|{"kind":"rail_withdraw","asset":"BTC4","amount":50000,"external_to":"${to}"}`)
    expect(tx.body).not.toHaveProperty('signed_btc_tx')
    await expect(signRailWithdraw({ account: 'a', sequence: 1, asset: 'BTC4', amount: 0, externalTo: to, falconSecret: 'x' })).rejects.toThrow(/positive integer/)
  })
})

describe('/api/bridge/config on the Falcon testnet', () => {
  it('serves the live V3 rail (pl-2300-bridge.json), not the historical 1001 manifest', async () => {
    vi.resetModules()
    const { GET } = await import('@/app/api/bridge/config/route')
    const res = await GET(new Request('https://falcon-fpl.com/api/bridge/config'))
    const j = (await res.json()) as Record<string, any>
    expect(j.status).toBe('live')
    expect(j.historical).toBe(false)
    expect(j.historical_note).toBeUndefined()
    expect(j.pl2300.sepolia.qc_v3).toBe(V3)
    expect(j.sepolia.usdc_token).toBe((liveCfg as any).sepolia.usdc_token)
  })
})
