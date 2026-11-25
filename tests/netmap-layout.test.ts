import { describe, expect, it } from 'vitest'
import { NETWORK_MAP_CONFIG } from '@/config/network-map'
import {
  buildMeshGraph,
  capTopology,
  geoClusters,
  propagationPlan,
  solveForceMesh,
  votePaths,
} from '@/lib/netmap-layout'
import type { NetworkTopology } from '@/lib/netmap-topology'
import type { ScanData } from '@/lib/scan-types'

function mockScan(): ScanData {
  const online = ['v1', 'v3', 'v6', 'v10', 'v12', 'v13', 'falcon-node', 'scottdog', 'scottspersonalnode']
  return {
    height: 969000,
    peers: online.length,
    commit: '4-of-6',
    commit_need: 4,
    committee_size: 6,
    product_version: '2.11.19',
    online_seats: online,
    server_state: 'live',
    product: 'Falcon PL',
    ticker: 'FPL',
    consensus: 'Falcon Consensus',
    network_id: 2300,
    server_version: '2.11.19',
    uptime_seconds: 1000,
    validated_ledger: 969000,
    tip_hash: 'abc',
    state_root: 'def',
    current_fee_drops: 1,
    median_fee_drops: 2,
    open_ledger_fee: 1,
    tx_queue_size: 10,
    mempool: 10,
    max_mempool: 50000,
    fee_multiplier: 1,
    recent_ledgers: [],
    recent_txs: [],
    validators: online.map((id) => ({
      account: id,
      pubkey: id,
      bond_status: 'bonded',
      bonded_amount: '50000',
      composite_score: 100,
      ledger_index: 969000,
      jailed: false,
      lottery_ready: true,
      pack_count: 100,
    })),
    proposers: online.length,
    tps_estimate: 50,
    avg_txs_per_ledger: 100,
    avg_close_seconds: 0.2,
    load_factor: 0,
    load_base: 10000,
    complete_ledgers: '969000',
    reserve_base: 0,
    reserve_inc: 0,
    treasury: 1000,
    epoch: {
      number: 15,
      poolBalanceFalcon: 1000,
      emissionRateFalcon: 3,
      lpAllocationPct: 40,
      lpProviderCount: 0,
      cidEmissionPct: 0.3,
      cidYearlyAvgPct: 15,
      firstClaimEpoch: 1,
      epochClaimable: true,
      lastSettledEpoch: 14,
    },
    last_pack: { height: 969000, packer: 'v13', txs: 100 },
    lottery_winner: 'v6',
    rails: [],
    metrics: { ledgers_sealed: 969000, txs_sealed: 1000, submit_accepted: 1000, fees_burned: 2000 },
  }
}

function mockTopology(): NetworkTopology {
  const edges = [
    { source: 'v1', target: 'v3', mutual: true },
    { source: 'v1', target: 'v6', mutual: true },
    { source: 'v1', target: 'v10', mutual: true },
    { source: 'v1', target: 'scottdog', mutual: false },
    { source: 'v3', target: 'v6', mutual: true },
    { source: 'v3', target: 'v13', mutual: true },
    { source: 'v6', target: 'v12', mutual: true },
    { source: 'v6', target: 'falcon-node', mutual: false },
    { source: 'v10', target: 'scottspersonalnode', mutual: false },
  ]
  const seats = ['v1', 'v3', 'v6', 'v10', 'v12', 'v13', 'falcon-node', 'scottdog', 'scottspersonalnode']
  return {
    hubs: ['v1', 'v3'],
    archives: [],
    nodes: seats.map((id) => ({
      id,
      role: id === 'v1' || id === 'v3' ? 'hub' : 'validator',
      isHub: id === 'v1' || id === 'v3',
      isArchive: false,
      online: true,
      jailed: false,
      inactive: false,
      connectedCount: edges.filter((e) => e.source === id || e.target === id).length,
      inbound: 2,
      outbound: 2,
      tip: 969000,
      version: '2.11.19',
      queried: ['v1', 'v3', 'v6', 'v10', 'v12', 'v13'].includes(id),
    })),
    edges,
    edgeCount: edges.length,
    queriedSeeds: ['5.78.142.246:19301', '5.78.142.246:19303'],
    queriedCount: 6,
    source: 'seed-rpc',
    fetchedAt: Date.now(),
  }
}

describe('organic P2P mesh layout', () => {
  it('places all live hubs as equal peers and attaches wallet ingress to hubs only', () => {
    const graph = buildMeshGraph(NETWORK_MAP_CONFIG, mockScan(), mockTopology(), {
      maxNodes: 44,
      maxEdges: 120,
    })

    expect(graph.hubIds).toEqual(['v1', 'v3'])
    const hubs = graph.nodes.filter((n) => n.isHub)
    expect(hubs.map((h) => h.id).sort()).toEqual(['v1', 'v3'])
    // Both hubs share identical radius & equal peer kind (no single root).
    expect(new Set(hubs.map((h) => h.radius)).size).toBe(1)

    const ingress = graph.edges.filter((e) => e.kind === 'ingress')
    expect(ingress.map((e) => e.target).sort()).toEqual(['v1', 'v3'])
    expect(graph.peerEdgeCount).toBe(9)
  })

  it('enforces mobile node and edge caps while preserving hubs first', () => {
    const graph = buildMeshGraph(NETWORK_MAP_CONFIG, mockScan(), mockTopology(), {
      maxNodes: 44,
      maxEdges: 120,
    })
    const capped = capTopology(graph.nodes, graph.edges, { maxNodes: 5, maxEdges: 4 })
    expect(capped.nodes.length).toBe(5)
    expect(capped.edges.length).toBe(4)
    expect(capped.nodes.some((n) => n.id === 'v1')).toBe(true)
    expect(capped.nodes.some((n) => n.id === 'v3')).toBe(true)
    expect(capped.edges.some((e) => e.source === 'v1' && e.target === 'v3')).toBe(true)
  })

  it('settles without overlapping node centers and computes geo clusters', () => {
    const graph = buildMeshGraph(NETWORK_MAP_CONFIG, mockScan(), mockTopology(), {
      maxNodes: 44,
      maxEdges: 120,
    })
    solveForceMesh(graph.nodes, graph.edges, 220)
    for (let i = 0; i < graph.nodes.length; i++) {
      for (let j = i + 1; j < graph.nodes.length; j++) {
        const a = graph.nodes[i]
        const b = graph.nodes[j]
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        expect(d).toBeGreaterThan(42)
      }
    }
    const clusters = geoClusters(graph.nodes)
    expect(clusters.find((c) => c.id === 'england')?.nodeIds.sort()).toEqual([
      'falcon-node',
      'scottdog',
      'v1',
      'v3',
    ])
  })

  it('computes BFS block propagation and vote paths strictly over real peer edges', () => {
    const graph = buildMeshGraph(NETWORK_MAP_CONFIG, mockScan(), mockTopology(), {
      maxNodes: 44,
      maxEdges: 120,
    })
    const plan = propagationPlan(graph.edges, 'v13')
    expect(plan.hopByNode['v13']).toBe(0)
    expect(plan.hopByNode['v3']).toBe(1)
    expect(plan.hopByNode['v1']).toBe(2)
    expect(plan.hopByNode['__wallet__']).toBeUndefined()

    const votes = votePaths(graph.edges, ['v10', 'v12', 'v13'], 'v13')
    expect(votes.length).toBe(2)
    for (const segs of votes) {
      expect(segs[segs.length - 1][1]).toBe('v13')
    }
  })
})
