// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import type { Metadata } from 'next'
import { pageMeta } from '@/lib/seo'
import { SHOP_OG_IMAGE } from '@/lib/shop/promo'
import ShopClient from './ShopClient'

const SHOP_TITLE = 'Merch shop'
const SHOP_DESCRIPTION = 'Official Falcon PL merch: coin tees, hoodies, caps and stickers. Printed to order.'
const base = pageMeta('/shop', SHOP_TITLE, SHOP_DESCRIPTION)
const ogImage = { url: SHOP_OG_IMAGE, alt: 'Falcon PL Chest Logo Tee' }

/** Link previews (X, WhatsApp, Discord) show a real product shot instead of the generic site card. */
export const metadata: Metadata = {
  ...base,
  openGraph: { ...base.openGraph, images: [ogImage] },
  twitter: { ...base.twitter, images: [ogImage] },
}

/** falcon-fpl.com/shop — Falcon-themed three-wheel merch shop (Shopify Storefront API via /api/shop). */
export default function ShopPage() {
  return <ShopClient />
}
