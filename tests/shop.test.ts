// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/shop/route'
import { mockProducts } from '@/components/shop/mockCatalogue'
import { FALCON_THEME } from '@/components/shop/themes'
import { SHOP_URL } from '@/lib/community-links'

const ENV_KEYS = ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_STOREFRONT_TOKEN', 'SHOPIFY_STOREFRONT_PRIVATE_TOKEN'] as const
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})
function unconfigure() {
  for (const k of ENV_KEYS) delete process.env[k]
}

describe('falcon /shop', () => {
  it('nav links to the native /shop route', () => {
    expect(SHOP_URL).toBe('/shop')
  })

  it('Shop is a nav tab / burger item right after Airdrop', () => {
    const h = readFileSync(join(__dirname, '..', 'src/components/Header.tsx'), 'utf8')
    const top = h.slice(h.indexOf('const NAV_ITEMS'), h.indexOf('const COMMUNITY_SUB_ITEMS'))
    expect(top).toMatch(/key: 'airdrop'[^\n]*\n\s*\{ key: 'shop', label: 'Shop', href: SHOP_URL \}/)
  })

  it('theme is Falcon, collection "falcon", logo goes home', () => {
    expect(FALCON_THEME.collectionHandle).toBe('falcon')
    expect(FALCON_THEME.homeHref).toBe('/')
  })

  it('GET falls back to mock when Shopify is not configured', async () => {
    unconfigure()
    const res = await GET(new NextRequest('https://falcon-fpl.com/api/shop?collection=falcon'))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ source: 'mock', collection: 'falcon', products: [] })
  })

  it('GET rejects odd collection handles (uses falcon)', async () => {
    unconfigure()
    const res = await GET(new NextRequest('https://falcon-fpl.com/api/shop?collection=..%2Fx'))
    expect((await res.json()).collection).toBe('falcon')
  })

  it('POST checkout is disabled without a token', async () => {
    unconfigure()
    const res = await POST(
      new NextRequest('https://falcon-fpl.com/api/shop', { method: 'POST', body: JSON.stringify({ lines: [] }) }),
    )
    expect(res.status).toBe(503)
  })

  it('mock catalogue has coin-only and coin + text versions, all Falcon images', () => {
    const products = mockProducts('falcon')
    expect(products.some((p) => p.id.endsWith('-coin'))).toBe(true)
    expect(products.some((p) => p.id.endsWith('-text'))).toBe(true)
    for (const p of products) expect(p.image.url).toMatch(/^\/shop-mock\/fa-/)
  })
})
