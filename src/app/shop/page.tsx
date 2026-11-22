// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import { pageMeta } from '@/lib/seo'
import ShopClient from './ShopClient'

export const metadata = pageMeta('/shop', 'Shop', 'Falcon PL coin merch: tees, hoodies, caps and stickers.')

/** falcon-fpl.com/shop — Falcon-themed three-wheel merch shop (Shopify Storefront API via /api/shop). */
export default function ShopPage() {
  return <ShopClient />
}
