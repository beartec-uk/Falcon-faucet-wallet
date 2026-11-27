// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import { permanentRedirect } from 'next/navigation'

/** Marketplace moved into the wallet Swap tab (all f-assets). */
export default function MarketplaceRedirect() {
  permanentRedirect('/swap')
}