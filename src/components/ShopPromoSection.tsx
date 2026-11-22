// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'

import { useEffect, useState } from 'react'
import type { ShopProduct } from '@/lib/shop/types'
import { loadCatalogue } from '@/components/shop/api'
import { FALCON_THEME } from '@/components/shop/themes'
import { SHOP_URL } from '@/lib/community-links'

/** Homepage section promoting /shop: one real product shot per category (text-only until loaded). */
export default function ShopPromoSection() {
  const [products, setProducts] = useState<ShopProduct[]>([])

  useEffect(() => {
    const ctrl = new AbortController()
    loadCatalogue(FALCON_THEME, ctrl.signal)
      .then((c) => {
        const seen = new Set<string>()
        const picks: ShopProduct[] = []
        for (const p of c.products) {
          if (!p.image?.url || seen.has(p.category)) continue
          seen.add(p.category)
          picks.push(p)
        }
        setProducts(picks.slice(0, 4))
      })
      .catch(() => {
        /* aborted / offline: text-only card */
      })
    return () => ctrl.abort()
  }, [])

  return (
    <section className="section section-shop" id="shop" data-testid="section-shop">
      <div className="container">
        <div className="section-header reveal">
          <p className="section-eyebrow">New · Merch</p>
          <h2 className="section-title">The Falcon PL shop is open</h2>
          <p className="shop-promo-text">
            Official coin merch: tees, hoodies, caps and stickers. Printed to order and delivered to your door.
          </p>
        </div>
        {products.length > 0 ? (
          <a href={SHOP_URL} className="shop-promo-grid" aria-label="Browse the Falcon PL shop" data-testid="section-shop-products">
            {products.map((p) => (
              <figure key={p.id} className="shop-promo-item">
                {/* eslint-disable-next-line @next/next/no-img-element -- Shopify CDN image, already sized */}
                <img src={p.image.url} alt={p.title} loading="lazy" decoding="async" />
                <figcaption>{p.title}</figcaption>
              </figure>
            ))}
          </a>
        ) : (
          <p className="shop-promo-fallback">Tees · Hoodies · Caps · Stickers</p>
        )}
        <div className="shop-promo-actions">
          <a href={SHOP_URL} className="btn btn-primary" data-testid="section-shop-cta">
            Shop the collection
          </a>
        </div>
      </div>
    </section>
  )
}
