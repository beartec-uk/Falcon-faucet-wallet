// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
/**
 * Falcon merch shop backend (port of beartec-uk/Crypto api/shop.ts).
 *   GET  /api/shop?collection=falcon → ShopCatalogue (or { source: 'mock' } when Shopify isn't configured)
 *   POST /api/shop { lines: CheckoutLineInput[] } → { checkoutUrl } (Shopify-hosted checkout)
 * Env: SHOPIFY_STORE_DOMAIN, SHOPIFY_STOREFRONT_TOKEN (optional SHOPIFY_STOREFRONT_PRIVATE_TOKEN,
 * SHOPIFY_COLLECTION_HANDLE, SHOPIFY_API_VERSION). Never in code.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createCheckout, fetchCollectionProducts, getStorefrontConfig, sanitiseLines } from '@/lib/shop/storefront'
import type { ShopCatalogue } from '@/lib/shop/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const DEFAULT_COLLECTION = 'falcon'

function buyerIp(req: NextRequest): string | undefined {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || undefined
}

export async function GET(req: NextRequest) {
  const cfg = getStorefrontConfig()
  const requested = req.nextUrl.searchParams.get('collection') ?? ''
  const collection = HANDLE_RE.test(requested) ? requested : DEFAULT_COLLECTION
  if (!cfg) {
    return NextResponse.json({ source: 'mock', collection, products: [] } satisfies ShopCatalogue, {
      headers: { 'Cache-Control': 'no-store' },
    })
  }
  try {
    const products = await fetchCollectionProducts(cfg, collection)
    return NextResponse.json({ source: 'shopify', collection, products } satisfies ShopCatalogue, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=600' },
    })
  } catch (err) {
    console.error('[shop] catalogue error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Shop catalogue unavailable' }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  const cfg = getStorefrontConfig()
  if (!cfg) return NextResponse.json({ error: 'Checkout is not configured yet' }, { status: 503 })
  const body = (await req.json().catch(() => null)) as { lines?: unknown } | null
  const lines = sanitiseLines(body?.lines)
  if (!lines) return NextResponse.json({ error: 'Invalid basket' }, { status: 400 })
  try {
    const checkoutUrl = await createCheckout(cfg, lines, buyerIp(req))
    return NextResponse.json({ checkoutUrl }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[shop] checkout error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not start checkout' }, { status: 502 })
  }
}
