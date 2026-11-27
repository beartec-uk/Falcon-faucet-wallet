// Audit 4/7: XRPL-era market routes answer 410 on the Falcon testnet, and the
// Swap / Pool faces no longer call them there.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'

const routes = [
  '@/app/api/swap/route',
  '@/app/api/market/orderbook/route',
  '@/app/api/market/pool-stats/route',
  '@/app/api/market/offers/route',
  '@/app/api/market/lp-position/route',
  '@/app/api/marketplace/route',
]

describe('legacy market routes on the Falcon testnet', () => {
  for (const r of routes)
    it(`${r} → 410`, async () => {
      const { GET } = (await import(r)) as { GET: (req: NextRequest) => Promise<Response> }
      const res = await GET(new NextRequest('https://falcon-fpl.com/api/x?symbol=FBTC'))
      expect(res.status).toBe(410)
      expect(((await res.json()) as { networkId: number }).networkId).toBe(2300)
    })

  it('Swap and Pool faces skip the legacy pair-list fetch on 2300', () => {
    for (const f of ['SwapFace.tsx', 'PoolFace.tsx']) {
      const s = readFileSync(path.join(__dirname, '..', 'src/components/wallet-faces', f), 'utf8')
      const i = s.indexOf("fetch(withNetworkQuery('/api/swap?symbol=FBTC'")
      const guard = s.lastIndexOf('if (network.networkId === 2300) {', i)
      expect(guard, f).toBeGreaterThan(0)
      expect(i - guard, f).toBeLessThan(400)
    }
  })
})
