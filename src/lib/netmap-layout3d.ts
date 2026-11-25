// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// Planar 3D layout (same 2D force mesh, flattened to y=0) + renderer selection
// for /scan/map. No three.js imports, so it stays testable and out of the
// initial bundle.

import { solveForceMesh, stepForceMesh, type ForceOpts, type MeshEdge, type MeshNode } from '@/lib/netmap-layout'

export type Vec3 = [number, number, number]

type LayoutNode = Pick<MeshNode, 'id' | 'isHub' | 'kind' | 'locationId' | 'locationLabel'>
type LayoutEdge = Pick<MeshEdge, 'source' | 'target' | 'kind'>

export interface Force3DOpts {
  iterations?: number
  /** Ideal spring length between peers (world units). Unused for the 2D solver path. */
  restLength?: number
  repulsion?: number
  springK?: number
  centerGravity?: number
  geoCohesion?: number
  /** Final bounding radius the layout is scaled to, before min-separation. */
  targetRadius?: number
  /** Extra world-space gap added on top of each node's visual clearance. */
  gap?: number
  /** Previous positions, reused as the starting point so updates move gently. */
  prev?: Map<string, Vec3>
}

/** Default plane radius for the 3D view (world units). Larger than the old
 *  packed radius of 7 so 3D objects and labels have room to breathe. */
export const DEFAULT_LAYOUT_RADIUS = 12

/** Typical radius of `solveForceMesh` before we scale into world units. */
const LAYOUT_2D_UNIT = 200

/** Looser 2D-solver constants used only for the 3D plane (the Canvas 2D
 *  fallback keeps the library defaults). */
const PLANAR_FORCE: ForceOpts = {
  restLength: 240,
  repulsion: 42_000,
  springK: 0.028,
  centerGravity: 0.01,
  geoCohesion: 0.006,
  minSep: 130,
}

function stubNode(n: LayoutNode): MeshNode {
  return {
    id: n.id,
    label: n.id,
    kind: n.kind,
    isHub: n.isHub,
    isArchive: false,
    online: true,
    jailed: false,
    inactive: false,
    host: '',
    locationId: n.locationId,
    locationLabel: n.locationLabel,
    locationColor: '',
    degree: 0,
    tip: null,
    lag: null,
    packs: 0,
    perf: null,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: n.kind === 'wallet' ? 17 : n.isHub ? 22 : n.kind === 'observer' ? 11 : 16,
  }
}

function stubEdge(e: LayoutEdge): MeshEdge {
  return {
    id: `${e.kind}:${e.source}--${e.target}`,
    source: e.source,
    target: e.target,
    kind: e.kind,
    mutual: true,
  }
}

/**
 * World-space clearance around a node: 3D object radius plus room for the
 * HTML label so two neighbours never sit on top of each other.
 */
export function visualClearance(n: Pick<LayoutNode, 'kind' | 'isHub'>): number {
  if (n.kind === 'wallet') return 1.4
  if (n.isHub) return 1.75
  if (n.kind === 'observer') return 0.9
  return 1.3
}

/**
 * Push overlapping nodes apart on the y=0 plane until every pair is at least
 * `visualClearance(a) + visualClearance(b) + gap` apart, then re-centre.
 * May grow the bounding radius past `targetRadius`.
 */
export function enforceMinSeparation(
  pos: Map<string, Vec3>,
  nodes: LayoutNode[],
  gap = 0.6,
  iterations = 100,
): Map<string, Vec3> {
  const ids = nodes.map((n) => n.id).filter((id) => pos.has(id))
  const n = ids.length
  if (n === 0) return new Map(pos)
  const rad = new Map(nodes.map((node) => [node.id, visualClearance(node)]))
  const x = new Float64Array(n)
  const z = new Float64Array(n)
  ids.forEach((id, i) => {
    const p = pos.get(id)!
    x[i] = p[0]
    z[i] = p[2]
  })

  for (let it = 0; it < iterations; it++) {
    let moved = 0
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = x[j] - x[i]
        let dz = z[j] - z[i]
        let d = Math.hypot(dx, dz)
        const want = (rad.get(ids[i]) ?? 1) + (rad.get(ids[j]) ?? 1) + gap
        if (d < 1e-6) {
          const ang = (i * 1.7 + j * 2.3) % (Math.PI * 2)
          dx = Math.cos(ang)
          dz = Math.sin(ang)
          d = 1e-6
        }
        if (d >= want) continue
        const push = (want - d) * 0.5
        const ux = dx / d
        const uz = dz / d
        x[i] -= ux * push
        z[i] -= uz * push
        x[j] += ux * push
        z[j] += uz * push
        moved++
      }
    }
    if (!moved) break
  }

  let cx = 0
  let cz = 0
  for (let i = 0; i < n; i++) {
    cx += x[i]
    cz += z[i]
  }
  cx /= n
  cz /= n
  const out = new Map(pos)
  ids.forEach((id, i) => out.set(id, [x[i] - cx, 0, z[i] - cz]))
  return out
}

/**
 * Deterministic force-directed layout on a single plane (y = 0).
 * Uses the same 2D solver as the Canvas mesh (`solveForceMesh`) with looser
 * spacing, then maps (x, y) → (x, 0, z) and enforces a minimum world-space
 * gap so 3D objects and labels do not overlap. Every node, hub or not, is a
 * free equal peer: nothing is pinned, there is no root, and the result is
 * re-centred so no seat sits "on top".
 */
export function solveForceMesh3D(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: Force3DOpts = {},
): Map<string, Vec3> {
  const targetRadius = opts.targetRadius ?? DEFAULT_LAYOUT_RADIUS
  const prev = opts.prev
  // Canonical order so the result never depends on input order (e.g. which hub is listed first).
  nodes = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const n = nodes.length
  if (n === 0) return new Map()
  if (n === 1) return new Map([[nodes[0].id, [0, 0, 0]]])

  const meshNodes = nodes.map(stubNode)
  const meshEdges = edges.map(stubEdge)
  const hasPrev = Boolean(prev && meshNodes.some((node) => prev!.has(node.id)))

  if (hasPrev && prev) {
    const scaleUp = LAYOUT_2D_UNIT / targetRadius
    const placed = meshNodes.filter((node) => prev.has(node.id))
    const missing = meshNodes.filter((node) => !prev.has(node.id))
    for (const node of placed) {
      const p = prev.get(node.id)!
      node.x = p[0] * scaleUp
      node.y = p[2] * scaleUp
      node.vx = 0
      node.vy = 0
    }
    if (missing.length > 0) {
      const cx = placed.reduce((s, node) => s + node.x, 0) / Math.max(1, placed.length)
      const cy = placed.reduce((s, node) => s + node.y, 0) / Math.max(1, placed.length)
      const ring = LAYOUT_2D_UNIT * 0.7
      missing.forEach((node, i) => {
        const th = (i / missing.length) * Math.PI * 2
        node.x = cx + Math.cos(th) * ring
        node.y = cy + Math.sin(th) * ring
        node.vx = 0
        node.vy = 0
      })
    }
    const steps = opts.iterations ?? 120
    for (let i = 0; i < steps; i++) stepForceMesh(meshNodes, meshEdges, PLANAR_FORCE)
  } else {
    solveForceMesh(meshNodes, meshEdges, opts.iterations ?? 180, PLANAR_FORCE)
  }

  // Re-centre on the 2D centroid, scale into world units, flatten to y = 0.
  let cx = 0
  let cz = 0
  for (const node of meshNodes) {
    cx += node.x
    cz += node.y
  }
  cx /= n
  cz /= n
  let maxR = 0
  for (const node of meshNodes) {
    maxR = Math.max(maxR, Math.hypot(node.x - cx, node.y - cz))
  }
  const s = maxR > 1e-6 ? targetRadius / maxR : 1
  const scaled = new Map<string, Vec3>()
  for (const node of meshNodes) {
    scaled.set(node.id, [(node.x - cx) * s, 0, (node.y - cz) * s])
  }
  return enforceMinSeparation(scaled, nodes, opts.gap ?? 0.6)
}

/**
 * Control point for a gently arched link a→b. On the y=0 plane the arch lifts
 * straight up so tubes read as 3D above the floor; otherwise it bows away
 * from the origin (legacy 3D-scatter path).
 */
export function linkControlPoint(a: Vec3, b: Vec3, bend = 0.18): Vec3 {
  const mx = (a[0] + b[0]) / 2
  const my = (a[1] + b[1]) / 2
  const mz = (a[2] + b[2]) / 2
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  const planar = Math.abs(a[1]) < 0.25 && Math.abs(b[1]) < 0.25
  if (planar) return [mx, my + Math.max(0.12, len * bend), mz]
  const ml = Math.hypot(mx, my, mz)
  if (ml < 1e-6) return [mx, my + len * bend, mz]
  const k = (len * bend) / ml
  return [mx + mx * k, my + my * k, mz + mz * k]
}

/** Point on the quadratic Bézier a→c→b at t. */
export function quadBezier3(a: Vec3, c: Vec3, b: Vec3, t: number): Vec3 {
  const u = 1 - t
  return [
    u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
    u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
    u * u * a[2] + 2 * u * t * c[2] + t * t * b[2],
  ]
}

export type RendererMode = '3d' | '2d'

export interface RendererEnv {
  webgl: boolean
  mobile: boolean
  cores?: number | null
  memoryGb?: number | null
  saveData?: boolean
  /** User / URL override (?renderer=2d|3d or the on-page toggle). */
  override?: RendererMode | null
}

/**
 * Pick 3D (WebGL) or the 2D Canvas mesh. 2D when WebGL is missing, data-saver
 * is on, or the device looks low-end; an explicit override wins when possible.
 * prefers-reduced-motion keeps 3D but the scene renders static (no auto-rotate).
 */
export function chooseRenderer(env: RendererEnv): RendererMode {
  if (!env.webgl) return '2d'
  if (env.override) return env.override
  if (env.saveData) return '2d'
  const cores = env.cores ?? null
  const mem = env.memoryGb ?? null
  if ((cores != null && cores <= 2) || (mem != null && mem <= 2)) return '2d'
  if (env.mobile && ((cores != null && cores < 4) || (mem != null && mem < 3))) return '2d'
  return '3d'
}
