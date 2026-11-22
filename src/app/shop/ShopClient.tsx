// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'

import dynamic from 'next/dynamic'
import { FALCON_THEME } from '@/components/shop/themes'

// The shop reads localStorage / matchMedia on first render, so render it client-only.
const ShopFront = dynamic(() => import('@/components/shop/ShopFront'), {
  ssr: false,
  loading: () => <div style={{ minHeight: '100dvh', background: FALCON_THEME.vars.bg }} aria-busy="true" />,
})

export default function ShopClient() {
  return <ShopFront theme={FALCON_THEME} />
}
