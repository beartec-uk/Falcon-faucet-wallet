// Audit 11/12: every Swap / Pool / Lend / Order-book button signs the exact body the
// chain expects (serde field order from fd-pl `TxBody`), and each button is wired to it.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { minOutAfterSlippage, quoteRoute, swapHops, SWAP_ASSETS, type SwapPool } from '@/lib/pl-swap-quote'

const seen: string[] = []

async function signers() {
  vi.resetModules()
  seen.length = 0
  vi.doMock('@/lib/falcon-wasm', () => ({
    getFalcon512: async () => ({
      sign: (m: Uint8Array) => {
        seen.push(new TextDecoder().decode(m))
        return new Uint8Array([1, 2])
      },
    }),
  }))
  vi.doMock('@/lib/falcon-keys', () => ({
    decodeFalconSecret: () => ({ pubBlob: new Uint8Array([0xfb, 0xaa]), secretKey: new Uint8Array([9]) }),
    bytesToHex: (b: Uint8Array) => Buffer.from(b).toString('hex'),
    zeroize: (b: Uint8Array) => b.fill(0),
  }))
  return import('@/lib/pl-wallet-sign')
}

const head = (seq: number) => `pl-tx:v2|alice|${seq}||0|2|2300|`
const src = (f: string) => readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')

describe('PlFplMarkets swap button', () => {
  beforeEach(() => vi.resetModules())

  it('signs swap_route {token_in, token_out, amount_in, min_out} for every directed pair', async () => {
    const { signPlSwapRoute } = await signers()
    let seq = 1
    for (const a of SWAP_ASSETS)
      for (const b of SWAP_ASSETS) {
        if (a === b) continue
        const tx = await signPlSwapRoute({ account: 'alice', tokenIn: a, tokenOut: b, amountIn: '1000', minOut: '980', sequence: seq, falconSecret: 'x' })
        expect(seen.at(-1)).toBe(`${head(seq)}{"kind":"swap_route","token_in":"${a}","token_out":"${b}","amount_in":1000,"min_out":980}`)
        expect(tx.body).toMatchObject({ kind: 'swap_route', token_in: a, token_out: b })
        seq++
      }
    expect(seq - 1).toBe(12)
  })

  it('quotes every one of the 12 pairs (f-asset to f-asset via FPL) and applies 2% min received', () => {
    const pools: SwapPool[] = [
      { asset_a: 'FPL', asset_b: 'ETH', reserve_a: '100000', reserve_b: '2000000000000000000' },
      { asset_a: 'FPL', asset_b: 'USDC', reserve_a: '80000', reserve_b: '1000000000' },
      { asset_a: 'FPL', asset_b: 'BTC4', reserve_a: '500000', reserve_b: '10000000' },
    ]
    for (const a of SWAP_ASSETS)
      for (const b of SWAP_ASSETS) {
        if (a === b) continue
        const amt = a === 'FPL' ? 1000n : a === 'ETH' ? 10n ** 16n : a === 'USDC' ? 10_000_000n : 100_000n
        const q = quoteRoute(pools, a, b, amt)
        expect(q, `${a}->${b}`).toBeGreaterThan(0n)
        expect(swapHops(a, b).length).toBe(a === 'FPL' || b === 'FPL' ? 2 : 3)
        const min = minOutAfterSlippage(q)
        expect(min).toBe(q - (q * 200n) / 10000n)
      }
  })

  it('button: disabled for same asset / no quote, submits act("swap") with the 2% min', () => {
    const s = src('components/PlFplMarkets.tsx')
    expect(s).toMatch(/disabled=\{busy \|\| sell === buy \|\| quoted <= 0n\} onClick=\{\(\) => act\('swap'\)\}/)
    expect(s).toMatch(/const minOut = minOutAfterSlippage\(quoted\)[\s\S]{0,200}signPlSwapRoute\(\{[\s\S]{0,200}minOut: minOut\.toString\(\)/)
  })
})

describe('PlFplMarkets pool buttons', () => {
  it('Add signs add_liquidity {pool_id, amt_a, amt_b}; Remove signs remove_liquidity {pool_id, lp_burn}', async () => {
    const { signPlAddLiquidity, signPlRemoveLiquidity } = await signers()
    await signPlAddLiquidity({ account: 'alice', poolId: 'eth-fpl', amtA: '100', amtB: '5000', sequence: 3, falconSecret: 'x' })
    expect(seen.at(-1)).toBe(`${head(3)}{"kind":"add_liquidity","pool_id":"eth-fpl","amt_a":100,"amt_b":5000}`)
    await signPlRemoveLiquidity({ account: 'alice', poolId: 'eth-fpl', lpBurn: '42', sequence: 4, falconSecret: 'x' })
    expect(seen.at(-1)).toBe(`${head(4)}{"kind":"remove_liquidity","pool_id":"eth-fpl","lp_burn":42}`)
  })

  it('buttons are wired to act("add") / act("remove") and Remove refuses more LP than held', () => {
    const s = src('components/PlFplMarkets.tsx')
    expect(s).toContain("onAdd={() => act('add')}")
    expect(s).toContain("onRemove={() => act('remove')}")
    expect(s).toMatch(/BigInt\(lpBurn\) > BigInt\(have\)\) throw new Error\('That is more LP than you have in this pool'\)/)
  })
})

describe('PlFplMarkets lend buttons', () => {
  it('Supply / Withdraw / Borrow / Repay sign the chain bodies', async () => {
    const { signPlLend } = await signers()
    await signPlLend({ account: 'alice', kind: 'lend_supply', marketId: 'lend-usdc', amount: '5000000', sequence: 1, falconSecret: 'x' })
    expect(seen.at(-1)).toBe(`${head(1)}{"kind":"lend_supply","market_id":"lend-usdc","amount":5000000}`)
    await signPlLend({ account: 'alice', kind: 'lend_withdraw', marketId: 'lend-usdc', amount: '77', sequence: 2, falconSecret: 'x' })
    expect(seen.at(-1)).toBe(`${head(2)}{"kind":"lend_withdraw","market_id":"lend-usdc","shares":77}`)
    await signPlLend({ account: 'alice', kind: 'lend_borrow', marketId: 'lend-eth', amount: '10', collateralFpl: '900', sequence: 3, falconSecret: 'x' })
    expect(seen.at(-1)).toBe(`${head(3)}{"kind":"lend_borrow","market_id":"lend-eth","amount":10,"collateral_fpl":900}`)
    await signPlLend({ account: 'alice', kind: 'lend_repay', marketId: 'lend-eth', amount: '10', sequence: 4, falconSecret: 'x' })
    expect(seen.at(-1)).toBe(`${head(4)}{"kind":"lend_repay","market_id":"lend-eth","amount":10}`)
  })

  it('each lend button calls run(kind) and maps to the lend_* body; borrow needs collateral', () => {
    const s = src('components/PlFplMarkets.tsx')
    for (const k of ['supply', 'withdraw', 'borrow', 'repay']) expect(s).toMatch(new RegExp(`void run\\('${k}'`))
    expect(s).toContain('onAct={(kind, coin, col) => act(kind, coin, col)}')
    expect(s).toMatch(/kind === 'borrow' && !colIn\.trim\(\)\) throw new Error\('Enter FPL collateral'\)/)
  })
})

describe('PlOrderBookPro buttons', () => {
  it('Place signs place_limit_order (expiry omitted when unset); Cancel signs cancel_order', async () => {
    const { signPlPlaceLimitOrder, signPlCancelOrder } = await signers()
    await signPlPlaceLimitOrder({ account: 'alice', pair: 'ETH-FPL', side: 'buy', price: '53000', amount: '1000', sequence: 1, falconSecret: 'x' })
    expect(seen.at(-1)).toBe(`${head(1)}{"kind":"place_limit_order","pair":"ETH-FPL","side":"buy","price":53000,"amount":1000}`)
    await signPlPlaceLimitOrder({ account: 'alice', pair: 'BTC4-FPL', side: 'sell', price: '4200000', amount: '5000', expiryHeight: '1010000', sequence: 2, falconSecret: 'x' })
    expect(seen.at(-1)).toBe(`${head(2)}{"kind":"place_limit_order","pair":"BTC4-FPL","side":"sell","price":4200000,"amount":5000,"expiry_height":1010000}`)
    await signPlCancelOrder({ account: 'alice', orderId: '17', sequence: 3, falconSecret: 'x' })
    expect(seen.at(-1)).toBe(`${head(3)}{"kind":"cancel_order","order_id":17}`)
    await expect(signPlPlaceLimitOrder({ account: 'a', pair: 'ETH-USDC', side: 'buy', price: '1', amount: '1', sequence: 1, falconSecret: 'x' })).rejects.toThrow(/ASSET>-FPL/)
  })

  it('market orders route through swap_route with a 2% min; cancel is wired per open order', () => {
    const s = src('components/PlOrderBookPro.tsx')
    expect(s).toMatch(/const minOut = market\.out > 1n \? market\.out - market\.out \/ 50n : 1n/)
    expect(s).toMatch(/tokenIn: side === 'buy' \? 'FPL' : asset,\s*tokenOut: side === 'buy' \? asset : 'FPL'/)
    expect(s).toContain('onClick={() => cancel(o)}')
    expect(s).toMatch(/Not enough balance for this order/)
  })
})
