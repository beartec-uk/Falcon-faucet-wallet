import { describe, expect, it } from 'vitest'
import {
  chooseRenderer,
  DEFAULT_LAYOUT_RADIUS,
  enforceMinSeparation,
  linkControlPoint,
  quadBezier3,
  solveForceMesh3D,
  visualClearance,
  type Vec3,
} from '@/lib/netmap-layout3d'

const ids = ['v1', 'v3', 'v6', 'v10', 'v12', 'v13', 'falcon-node', 'scottdog', 'scottspersonalnode']
const hubs = new Set(['v1', 'v3'])
const loc: Record<string, string> = {
  v1: 'england',
  v3: 'england',
  scottdog: 'england',
  'falcon-node': 'england',
  v10: 'helsinki',
  scottspersonalnode: 'helsinki',
}
const nodes = ids.map((id) => ({
  id,
  isHub: hubs.has(id),
  kind: (hubs.has(id) ? 'hub' : 'validator') as 'hub' | 'validator',
  locationId: loc[id] ?? 'unplaced',
  locationLabel: loc[id] ? loc[id] : '',
}))
const pairs: Array<[string, string]> = [
  ['v1', 'v3'], ['v1', 'v6'], ['v1', 'v10'], ['v1', 'v12'], ['v1', 'falcon-node'],
  ['v3', 'v13'], ['v3', 'scottdog'], ['v3', 'scottspersonalnode'], ['v3', 'v6'],
  ['v6', 'v10'], ['v10', 'v12'], ['v12', 'v13'], ['v13', 'falcon-node'], ['scottdog', 'falcon-node'],
]
const edges = pairs.map(([source, target]) => ({ source, target, kind: 'peer' as const }))
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const gap = 0.6
const minWanted = (a: (typeof nodes)[number], b: (typeof nodes)[number]) =>
  visualClearance(a) + visualClearance(b) + gap

describe('solveForceMesh3D', () => {
  it('is deterministic and places every node', () => {
    const a = solveForceMesh3D(nodes, edges)
    const b = solveForceMesh3D(nodes, edges)
    expect(a.size).toBe(ids.length)
    for (const id of ids) expect(a.get(id)).toEqual(b.get(id))
  })

  it('lays every node on the y=0 plane, centred, and at least as wide as the target radius', () => {
    const pos = solveForceMesh3D(nodes, edges, { targetRadius: DEFAULT_LAYOUT_RADIUS })
    const pts = [...pos.values()]
    for (const p of pts) expect(Math.abs(p[1])).toBeLessThan(1e-9)
    const c = [0, 1, 2].map((k) => pts.reduce((s, p) => s + p[k], 0) / pts.length)
    for (const v of c) expect(Math.abs(v)).toBeLessThan(1e-6)
    const maxR = Math.max(...pts.map((p) => Math.hypot(p[0], p[2])))
    expect(maxR).toBeGreaterThanOrEqual(DEFAULT_LAYOUT_RADIUS - 1e-6)
    const xSpread = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]))
    const zSpread = Math.max(...pts.map((p) => p[2])) - Math.min(...pts.map((p) => p[2]))
    expect(xSpread).toBeGreaterThan(8)
    expect(zSpread).toBeGreaterThan(8)
  })

  it('keeps every pair at least visualClearance + gap apart so objects and labels do not overlap', () => {
    const pos = solveForceMesh3D(nodes, edges)
    const byId = new Map(nodes.map((n) => [n.id, n]))
    let minSlack = Infinity
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const want = minWanted(byId.get(ids[i])!, byId.get(ids[j])!)
        const d = dist(pos.get(ids[i])!, pos.get(ids[j])!)
        minSlack = Math.min(minSlack, d - want)
        expect(d).toBeGreaterThanOrEqual(want - 1e-6)
      }
    }
    expect(minSlack).toBeGreaterThanOrEqual(-1e-6)
  })

  it('keeps nodes apart and peers closer than non-peers on average', () => {
    const pos = solveForceMesh3D(nodes, edges)
    const peerKey = new Set(pairs.map(([a, b]) => [a, b].sort().join('|')))
    let peerSum = 0, peerN = 0, otherSum = 0, otherN = 0, minD = Infinity
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const d = dist(pos.get(ids[i])!, pos.get(ids[j])!)
        minD = Math.min(minD, d)
        if (peerKey.has([ids[i], ids[j]].sort().join('|'))) { peerSum += d; peerN++ } else { otherSum += d; otherN++ }
      }
    }
    expect(minD).toBeGreaterThan(2)
    expect(peerSum / peerN).toBeLessThan(otherSum / otherN)
  })

  it('has no root: no hub is pinned at the centre, and input order does not matter', () => {
    const pos = solveForceMesh3D(nodes, edges)
    const swapped = solveForceMesh3D([...nodes].reverse(), edges)
    for (const id of ids) {
      const a = pos.get(id)!, b = swapped.get(id)!
      expect(dist(a, b)).toBeLessThan(1e-6)
    }
    for (const h of hubs) expect(Math.hypot(pos.get(h)![0], pos.get(h)![2])).toBeGreaterThan(0.3)
  })

  it('reuses previous positions as a warm start and stays on the plane', () => {
    const first = solveForceMesh3D(nodes, edges)
    const again = solveForceMesh3D(nodes, edges, { prev: first, iterations: 20 })
    for (const id of ids) {
      expect(Math.abs(again.get(id)![1])).toBeLessThan(1e-9)
      expect(dist(first.get(id)!, again.get(id)!)).toBeLessThan(3)
    }
  })
})

describe('enforceMinSeparation', () => {
  it('pushes two overlapping hubs apart to at least their clearances plus the gap', () => {
    const a = { id: 'v1', isHub: true, kind: 'hub' as const, locationId: 'e', locationLabel: 'E' }
    const b = { id: 'v3', isHub: true, kind: 'hub' as const, locationId: 'e', locationLabel: 'E' }
    const out = enforceMinSeparation(
      new Map([['v1', [0, 0, 0]], ['v3', [0.4, 0, 0]]]),
      [a, b],
      0.6,
    )
    expect(dist(out.get('v1')!, out.get('v3')!)).toBeGreaterThanOrEqual(
      visualClearance(a) + visualClearance(b) + 0.6 - 1e-6,
    )
    expect(out.get('v1')![1]).toBe(0)
    expect(out.get('v3')![1]).toBe(0)
  })
})

describe('link curves', () => {
  it('lifts planar links above the floor and passes through both endpoints', () => {
    const a: Vec3 = [2, 0, 0]
    const b: Vec3 = [0, 0, 2]
    const c = linkControlPoint(a, b)
    expect(c[1]).toBeGreaterThan(0.1)
    expect(quadBezier3(a, c, b, 0)).toEqual(a)
    expect(quadBezier3(a, c, b, 1)).toEqual(b)
  })
})

describe('chooseRenderer', () => {
  it('falls back to 2D without WebGL even if 3D is requested', () => {
    expect(chooseRenderer({ webgl: false, mobile: false, override: '3d' })).toBe('2d')
  })
  it('honours explicit overrides when WebGL exists', () => {
    expect(chooseRenderer({ webgl: true, mobile: true, cores: 2, override: '3d' })).toBe('3d')
    expect(chooseRenderer({ webgl: true, mobile: false, cores: 16, override: '2d' })).toBe('2d')
  })
  it('uses 2D on data-saver and low-end devices', () => {
    expect(chooseRenderer({ webgl: true, mobile: false, saveData: true })).toBe('2d')
    expect(chooseRenderer({ webgl: true, mobile: false, cores: 2 })).toBe('2d')
    expect(chooseRenderer({ webgl: true, mobile: true, cores: 8, memoryGb: 2 })).toBe('2d')
    expect(chooseRenderer({ webgl: true, mobile: true, cores: 3, memoryGb: 4 })).toBe('2d')
  })
  it('uses 3D on capable phones and desktops', () => {
    expect(chooseRenderer({ webgl: true, mobile: true, cores: 6, memoryGb: 4 })).toBe('3d')
    expect(chooseRenderer({ webgl: true, mobile: false, cores: 8, memoryGb: null })).toBe('3d')
  })
})
