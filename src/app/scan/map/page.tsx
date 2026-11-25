// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import type { Metadata } from 'next'
import { pageMeta } from '@/lib/seo'
import NetworkMapClient from '@/components/netmap/NetworkMapClient'

export const metadata: Metadata = pageMeta(
  '/scan/map',
  'Live network map',
  'Live organic peer-to-peer mesh map of the Falcon PL 2300 network.',
)

export default function NetworkMapPage() {
  return <NetworkMapClient />
}
