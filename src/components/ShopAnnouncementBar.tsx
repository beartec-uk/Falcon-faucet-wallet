// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { SHOP_URL } from '@/lib/community-links'
import { dismissShopPromo, isShopPromoDismissed, shouldShowShopBar } from '@/lib/shop/promo'

const storage = () => (typeof window !== 'undefined' ? window.localStorage : null)

/** Slim, dismissible "Falcon PL merch" strip across the top of every page except /shop. */
export default function ShopAnnouncementBar() {
  const pathname = usePathname()
  // Start hidden so SSR and returning visitors who dismissed it never see a flash.
  const [dismissed, setDismissed] = useState(true)
  useEffect(() => setDismissed(isShopPromoDismissed(storage())), [])

  const visible = !dismissed && shouldShowShopBar(pathname)
  useEffect(() => {
    // Lets the marketing home's fixed header sit below the bar (globals.css).
    document.documentElement.classList.toggle('has-shop-bar', visible)
    return () => document.documentElement.classList.remove('has-shop-bar')
  }, [visible])

  if (!visible) return null
  return (
    <div
      role="region"
      aria-label="Shop announcement"
      data-testid="shop-announcement-bar"
      className="shop-announcement-bar relative z-[105] flex h-9 shrink-0 items-center justify-center border-b border-brand-500/30 bg-[#140c05] px-10 text-xs text-slate-200 sm:text-sm"
    >
      <Link
        href={SHOP_URL}
        data-testid="shop-announcement-link"
        className="inline-flex min-w-0 items-center gap-2 hover:text-white"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="shrink-0 text-brand-500" aria-hidden="true">
          <path d="M6 7h12l-1 13H7L6 7Z" strokeLinejoin="round" />
          <path d="M9 9V6a3 3 0 0 1 6 0v3" strokeLinecap="round" />
        </svg>
        <span className="truncate">
          <span className="font-semibold text-brand-500">New:</span> Falcon PL merch
          <span className="hidden sm:inline"> — coin tees, hoodies, caps &amp; stickers</span>
        </span>
        <span className="shrink-0 font-semibold text-brand-500 underline-offset-2 hover:underline">Shop now →</span>
      </Link>
      <button
        type="button"
        onClick={() => {
          dismissShopPromo(storage())
          setDismissed(true)
        }}
        aria-label="Dismiss shop announcement"
        data-testid="shop-announcement-dismiss"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}
