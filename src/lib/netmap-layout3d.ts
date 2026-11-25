// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// Planar 3D layout (same 2D force mesh, flattened to y=0) + renderer selection
// for /scan/map. No three.js imports, so it stays testable and out of the
// initial bundle.

import { solveForceMesh, stepForceMesh, type MeshEdge, type MeshNode } from '@/lib/netmap-layout'

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
  /** Final bounding radius the layout is scaled to. */
  targetRadius?: number
  /** Previous positions, reused as the starting point so updates move gently. */
  prev?: Map<string, Vec3>
}

/** Typical radius of `solveForceMesh` before we scale into world units. */
const LAYOUT_2D_UNIT = 200

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
 * Deterministic force-directed layout on a single plane (y = 0).
 * Uses the same 2D solver as the Canvas mesh (`solveForceMesh`), then maps
 * (x, y) → (x, 0, z). Every node, hub or not, is a free equal peer: nothing
 * is pinned, there is no root, and the result is re-centred so no seat sits
 * "on top".
 */
export function solveForceMesh3D(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: Force3DOpts = {},
): Map<string, Vec3> {
  const targetRadius = opts.targetRadius ?? 7
  const prev = opts.prev
  // Canonical order so the result never depends on input order (e.g. which hub is listed first).
  nodes = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const n = nodes.length
  const out = new Map<string, Vec3>()
  if (n === 0) return out
  if (n === 1) {
    out.set(nodes[0].id, [0, 0, 0])
    return out
  }

  const meshNodes = nodes.map(stubNode)
  const meshEdges = edges.map(stubEdge)
  const hasPrev = Boolean(prev && meshNodes.some((n) => prev!.has(n.id)))

  if (hasPrev && prev) {
    const scaleUp = LAYOUT_2D_UNIT / targetRadius
    const placed = meshNodes.filter((n) => prev.has(n.id))
    const missing = meshNodes.filter((n) => !prev.has(n.id))
    for (const n of placed) {
      const p = prev.get(n.id)!
      n.x = p[0] * scaleUp
      n.y = p[2] * scaleUp
      n.vx = 0
      n.vy = 0
    }
    if (missing.length > 0) {
      const cx = placed.reduce((s, n) => s + n.x, 0) / Math.max(1, placed.length)
      const cy = placed.reduce((s, n) => s + n.y, 0) / Math.max(1, placed.length)
      const ring = LAYOUT_2D_UNIT * 0.6
      missing.forEach((n, i) => {
        const th = (i / missing.length) * Math.PI * 2
        n.x = cx + Math.cos(th) * ring
        n.y = cy + Math.sin(th) * ring
        n.vx = 0
        n.vy = 0
      })
    }
    const steps = opts.iterations ?? 120
    for (let i = 0; i < steps; i++) stepForceMesh(meshNodes, meshEdges)
  } else {
    solveForceMesh(meshNodes, meshEdges, opts.iterations ?? 180)
  }

  // Re-centre on the 2D centroid, scale into world units, flatten to y = 0.
  let cx = 0
  let cz = 0
  for (const n of meshNodes) {
    cx += n.x
    cz += n.y
  }
  cx /= n
  cz /= n
  let maxR = 0
  for (const node of meshNodes) {
    maxR = Math.max(maxR, Math.hypot(node.x - cx, node.y - cz))
  }
  const s = maxR > 1e-6 ? targetRadius / maxR : 1
  for (const node of meshNodes) {
    out.set(node.id, [(node.x - cx) * s, 0, (node.y - cz) * s])
  }
  return out
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
