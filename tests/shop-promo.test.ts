// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SHOP_OG_IMAGE,
  SHOP_PROMO_DISMISS_KEY,
  dismissShopPromo,
  isShopPromoDismissed,
  shouldShowShopBar,
} from '@/lib/shop/promo'
import { metadata } from '@/app/shop/page'

describe('shop announcement bar', () => {
  it('shows on normal pages', () => {
    for (const p of ['/', '/wallet', '/faucet', '/scan', '/community/faq', '/nope', null]) {
      expect(shouldShowShopBar(p)).toBe(true)
    }
  })
  it('hides on /shop and the full-viewport arcade', () => {
    for (const p of ['/shop', '/shop/', '/shop?x=1', '/shop/anything', '/arcade', '/arcade/leaderboard']) {
      expect(shouldShowShopBar(p)).toBe(false)
    }
  })
  it('remembers dismissal and tolerates blocked storage', () => {
    const m = new Map<string, string>()
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }
    expect(isShopPromoDismissed(s)).toBe(false)
    dismissShopPromo(s)
    expect(m.get(SHOP_PROMO_DISMISS_KEY)).toBe('1')
    expect(isShopPromoDismissed(s)).toBe(true)
    const bad = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } }
    expect(isShopPromoDismissed(bad)).toBe(false)
    expect(() => dismissShopPromo(bad)).not.toThrow()
  })
  it('is mounted once in the root layout', () => {
    const layout = readFileSync(join(__dirname, '..', 'src/app/layout.tsx'), 'utf8')
    expect(layout.match(/<ShopAnnouncementBar \/>/g)?.length).toBe(1)
  })
})

describe('/shop metadata', () => {
  it('uses a real product image for link previews', () => {
    const og = metadata.openGraph as { images?: Array<{ url: string }> }
    const tw = metadata.twitter as { images?: Array<{ url: string }> }
    expect(og.images?.[0]?.url).toBe(SHOP_OG_IMAGE)
    expect(tw.images?.[0]?.url).toBe(SHOP_OG_IMAGE)
    expect(SHOP_OG_IMAGE).toMatch(/^https:\/\/cdn\.shopify\.com\//)
    expect(metadata.alternates?.canonical).toBe('/shop')
  })
})
