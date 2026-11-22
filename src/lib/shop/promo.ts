// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
/** Shop launch promo: dismissal key, where the announcement bar shows, and the /shop social image. */

export const SHOP_PROMO_DISMISS_KEY = 'fpl_shop_promo_dismissed_v1'

/** Public product image for /shop link previews (Shopify CDN, Falcon PL Chest Logo Tee, black). */
export const SHOP_OG_IMAGE =
  'https://cdn.shopify.com/s/files/1/1116/3110/6373/files/unisex-staple-t-shirt-black-front-6b01dec48ad46.jpg'

/**
 * Shows on every page except the shop itself and the full-viewport Arcade (an extra strip
 * would push the game below the fold).
 */
export function shouldShowShopBar(pathname: string | null | undefined): boolean {
  const p = (pathname || '/').split(/[?#]/)[0].replace(/\/+$/, '') || '/'
  if (p === '/shop' || p.startsWith('/shop/')) return false
  if (p === '/arcade' || p.startsWith('/arcade/')) return false
  return true
}

export function isShopPromoDismissed(storage: Pick<Storage, 'getItem'> | null | undefined): boolean {
  try {
    return storage?.getItem(SHOP_PROMO_DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export function dismissShopPromo(storage: Pick<Storage, 'setItem'> | null | undefined): void {
  try {
    storage?.setItem(SHOP_PROMO_DISMISS_KEY, '1')
  } catch {
    /* storage blocked: dismissed for this page view only */
  }
}
