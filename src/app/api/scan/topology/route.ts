// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// GET /api/scan/topology — live peer edges, hub set, and archive flags from node RPCs.

import { NextResponse } from 'next/server'
import { buildNetworkTopology } from '@/lib/netmap-topology'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const topology = await buildNetworkTopology()
    return NextResponse.json(topology, {
      headers: {
        'cache-control': 'public, s-maxage=5, stale-while-revalidate=10',
      },
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    )
  }
}
