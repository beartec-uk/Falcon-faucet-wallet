// Copyright (c) 2025-2026 BEARTEC (Scott Reynolds). All rights reserved.
/**
 * Falcon PL shop front theme (falcon-fpl.com/shop). Ported from beartec-uk/Crypto
 * client/src/shop (PR #624): the same three-wheel component drives both brands, so keep
 * the two copies in step. Only the Falcon theme ships here.
 */
export type ShopThemeId = 'falcon';

export interface ShopTheme {
  id: ShopThemeId;
  brand: string;
  /** Shopify collection handle holding this brand's products. */
  collectionHandle: string;
  logo: { src: string; alt: string; height: number; round?: boolean };
  homeHref: string;
  copy: {
    pageTitle: string;
    metaDescription: string;
    intro: string;
    /** Shown after "Swipe up" (touch) or "Scroll down" (mouse). */
    categoryHint: string;
    productHint: string;
    variantHint: string;
  };
  /** CSS custom properties applied to the shop root. */
  vars: {
    bg: string;
    bgGlow: string;
    surface: string;
    surfaceHi: string;
    border: string;
    text: string;
    muted: string;
    accent: string;
    accent2: string;
    accentInk: string;
    glow: string;
    font: string;
  };
}

export const FALCON_THEME: ShopTheme = {
  id: 'falcon',
  brand: 'Falcon PL',
  collectionHandle: 'falcon',
  logo: { src: '/shop-assets/falcon-coin.webp', alt: 'Falcon PL', height: 34, round: true },
  homeHref: '/',
  copy: {
    pageTitle: 'Falcon PL Shop — coin merch',
    metaDescription: 'Falcon PL coin merch: tees, hoodies, caps and stickers.',
    intro: 'Coin collection',
    categoryHint: 'for styles',
    productHint: 'to pick colour & size',
    variantHint: 'Pick a colour, then your size',
  },
  vars: {
    bg: '#0a0806',
    bgGlow: 'rgba(212, 146, 42, 0.16)',
    surface: 'rgba(28, 22, 16, 0.8)',
    surfaceHi: 'rgba(48, 36, 24, 0.92)',
    border: 'rgba(125, 74, 36, 0.55)',
    text: '#fdf6ee',
    muted: '#c9b49a',
    accent: '#d4922a',
    accent2: '#c07838',
    accentInk: '#1a0f04',
    glow: 'rgba(212, 146, 42, 0.38)',
    font: '"Inter", "Open Sans", system-ui, sans-serif',
  },
};

export const SHOP_THEMES: Record<ShopThemeId, ShopTheme> = { falcon: FALCON_THEME };
