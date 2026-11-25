import { describe, expect, it } from 'vitest'
import { aggregateSeedObservations, type SeedObservation } from '@/lib/netmap-topology'

describe('netmap topology aggregation', () => {
  it('discovers hubs and undirected peer edges dynamically from live node responses', () => {
    const obs: SeedObservation[] = [
      {
        addr: '5.78.142.246:19301',
        status: {
          id: 'v1',
          role: 'hub',
          is_hub: true,
          tip_height: 969000,
          product_version: '2.11.19',
          online_seats: ['v1', 'v3', 'v6', 'scottdog', 'falcon-node'],
          validators: [
            { id: 'v1', jailed: false, v2: { archive: false, inactive: false } },
            { id: 'v3', jailed: false, v2: { archive: false, inactive: false } },
            { id: 'v6', jailed: false, v2: { archive: false, inactive: false } },
            { id: 'scottdog', jailed: false, v2: { archive: false, inactive: false } },
          ],
        },
        health: {
          node: { id: 'v1', role: 'hub', version: '2.11.19' },
          peers: { connected: ['v3', 'v6', 'scottdog', 'falcon-node'], inbound: 2, outbound: 2 },
        },
      },
      {
        addr: '5.78.142.246:19303',
        status: {
          id: 'v3',
          role: 'hub',
          is_hub: true,
          tip_height: 969000,
          product_version: '2.11.19',
          online_seats: ['v1', 'v3', 'v6', 'scottdog', 'falcon-node'],
        },
        health: {
          node: { id: 'v3', role: 'hub', version: '2.11.19' },
          peers: { connected: ['v1', 'v6', 'obs-abc123'], inbound: 2, outbound: 1 },
        },
      },
      {
        addr: '5.78.142.246:19306',
        status: {
          id: 'v6',
          role: 'val',
          is_hub: false,
          tip_height: 969000,
        },
        health: {
          node: { id: 'v6', role: 'validator', version: '2.11.19' },
          peers: { connected: ['v1', 'v3', 'scottdog'], inbound: 3, outbound: 0 },
        },
      },
    ]

    const topo = aggregateSeedObservations(obs, null, 12345)
    expect(topo.source).toBe('seed-rpc')
    expect(topo.queriedCount).toBe(3)
    expect(topo.hubs).toEqual(['v1', 'v3'])
    expect(topo.archives).toEqual([])

    const v1v3 = topo.edges.find((e) => e.source === 'v1' && e.target === 'v3')
    expect(v1v3).toEqual({ source: 'v1', target: 'v3', mutual: true })

    // scottdog wasn't queried directly, so mutual is false while the edge still exists.
    const sdV1 = topo.edges.find((e) => e.source === 'scottdog' && e.target === 'v1')
    expect(sdV1).toEqual({ source: 'scottdog', target: 'v1', mutual: false })

    // Undirected deduplication: v1<->v3, v1<->v6, v3<->v6, v1<->scottdog, v1<->falcon-node, v3<->obs-abc123, v6<->scottdog = 7
    expect(topo.edgeCount).toBe(7)
    expect(topo.nodes.find((n) => n.id === 'obs-abc123')?.role).toBe('observer')
  })

  it('detects 3 hubs and archive flag if live nodes report them', () => {
    const obs: SeedObservation[] = [
      { addr: 's1', status: { id: 'v1', role: 'hub', is_hub: true, archive: true }, health: null },
      { addr: 's2', status: { id: 'v3', role: 'hub', is_hub: true }, health: null },
      { addr: 's3', status: { id: 'v6', role: 'hub', is_hub: true }, health: null },
    ]
    const topo = aggregateSeedObservations(obs)
    expect(topo.hubs).toEqual(['v1', 'v3', 'v6'])
    expect(topo.archives).toEqual(['v1'])
  })

  it('falls back cleanly to gateway status when all seeds time out', () => {
    const topo = aggregateSeedObservations(
      [{ addr: 's1', status: null, health: null }],
      {
        id: 'v1',
        role: 'hub',
        is_hub: true,
        online_seats: ['v1', 'v3', 'v6'],
        validators: [
          { id: 'v1', jailed: false, v2: { archive: false } },
          { id: 'v3', jailed: false, v2: { archive: true } },
        ],
      },
    )
    expect(topo.source).toBe('gateway-fallback')
    expect(topo.hubs).toEqual(['v1'])
    expect(topo.archives).toEqual(['v3'])
    expect(topo.edges).toEqual([])
  })
})
