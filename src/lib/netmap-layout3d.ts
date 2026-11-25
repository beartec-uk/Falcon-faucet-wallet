// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// Pure 3D force-directed layout + renderer selection for the /scan/map 3D mesh.
// No three.js imports here so it stays testable and out of the initial bundle.

import type { MeshEdge, MeshNode } from '@/lib/netmap-layout'

export type Vec3 = [number, number, number]

type LayoutNode = Pick<MeshNode, 'id' | 'isHub' | 'kind' | 'locationId' | 'locationLabel'>
type LayoutEdge = Pick<MeshEdge, 'source' | 'target' | 'kind'>

export interface Force3DOpts {
  iterations?: number
  /** Ideal spring length between peers (world units). */
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

function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

/**
 * Deterministic 3D force-directed layout over real peer (and ingress) edges.
 * Every node, hub or not, is a free equal peer: nothing is pinned, there is no
 * root, and the result is re-centred on the centroid so no seat sits "on top".
 */
export function solveForceMesh3D(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: Force3DOpts = {},
): Map<string, Vec3> {
  const iterations = opts.iterations ?? 260
  const rest = opts.restLength ?? 3.2
  const repulsion = opts.repulsion ?? 9
  const springK = opts.springK ?? 0.06
  const gravity = opts.centerGravity ?? 0.02
  const geo = opts.geoCohesion ?? 0.025
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

  // Fibonacci-sphere start, ordered by region then id (stable & role-agnostic).
  const ordered = nodes
    .map((node, i) => ({ node, i }))
    .sort(
      (a, b) =>
        a.node.locationId.localeCompare(b.node.locationId) ||
        a.node.id.localeCompare(b.node.id, 'en', { numeric: true }),
    )
  const px = new Float64Array(n)
  const py = new Float64Array(n)
  const pz = new Float64Array(n)
  const golden = Math.PI * (3 - Math.sqrt(5))
  ordered.forEach(({ node, i }, k) => {
    const p = prev?.get(node.id)
    if (p) {
      px[i] = p[0]
      py[i] = p[1]
      pz[i] = p[2]
      return
    }
    const y = 1 - (2 * (k + 0.5)) / n
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const th = k * golden + hashSeed(node.id) * 0.4
    const R = rest * Math.cbrt(n) * 0.9
    px[i] = Math.cos(th) * r * R
    py[i] = y * R
    pz[i] = Math.sin(th) * r * R
  })

  const idx = new Map<string, number>()
  nodes.forEach((node, i) => idx.set(node.id, i))
  const springs: Array<[number, number, number]> = []
  for (const e of edges) {
    const a = idx.get(e.source)
    const b = idx.get(e.target)
    if (a == null || b == null || a === b) continue
    const sameGeo = nodes[a].locationLabel && nodes[a].locationId === nodes[b].locationId
    const len = e.kind === 'ingress' ? rest * 0.85 : sameGeo ? rest * 0.8 : rest
    springs.push([a, b, len])
  }

  const vx = new Float64Array(n)
  const vy = new Float64Array(n)
  const vz = new Float64Array(n)
  const fx = new Float64Array(n)
  const fy = new Float64Array(n)
  const fz = new Float64Array(n)
  const damping = 0.85

  for (let it = 0; it < iterations; it++) {
    fx.fill(0)
    fy.fill(0)
    fz.fill(0)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = px[j] - px[i]
        let dy = py[j] - py[i]
        let dz = pz[j] - pz[i]
        let d2 = dx * dx + dy * dy + dz * dz
        if (d2 < 1e-6) {
          const a = (i * 1.7 + j * 2.3) % (Math.PI * 2)
          dx = Math.cos(a) * 0.01
          dy = Math.sin(a) * 0.01
          dz = 0.01
          d2 = dx * dx + dy * dy + dz * dz
        }
        const d = Math.sqrt(d2)
        const f = repulsion / Math.max(0.25, d2)
        const ux = dx / d
        const uy = dy / d
        const uz = dz / d
        fx[i] -= ux * f
        fy[i] -= uy * f
        fz[i] -= uz * f
        fx[j] += ux * f
        fy[j] += uy * f
        fz[j] += uz * f
      }
    }
    for (const [a, b, len] of springs) {
      const dx = px[b] - px[a]
      const dy = py[b] - py[a]
      const dz = pz[b] - pz[a]
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-3
      const f = springK * (d - len)
      fx[a] += (dx / d) * f
      fy[a] += (dy / d) * f
      fz[a] += (dz / d) * f
      fx[b] -= (dx / d) * f
      fy[b] -= (dy / d) * f
      fz[b] -= (dz / d) * f
    }
    const groups = new Map<string, { x: number; y: number; z: number; c: number }>()
    for (let i = 0; i < n; i++) {
      if (!nodes[i].locationLabel) continue
      const g = groups.get(nodes[i].locationId) ?? { x: 0, y: 0, z: 0, c: 0 }
      g.x += px[i]
      g.y += py[i]
      g.z += pz[i]
      g.c += 1
      groups.set(nodes[i].locationId, g)
    }
    const cool = 1 - it / (iterations * 1.25)
    for (let i = 0; i < n; i++) {
      fx[i] -= px[i] * gravity
      fy[i] -= py[i] * gravity
      fz[i] -= pz[i] * gravity
      const g = nodes[i].locationLabel ? groups.get(nodes[i].locationId) : undefined
      if (g && g.c > 1) {
        fx[i] += (g.x / g.c - px[i]) * geo
        fy[i] += (g.y / g.c - py[i]) * geo
        fz[i] += (g.z / g.c - pz[i]) * geo
      }
      vx[i] = (vx[i] + fx[i]) * damping
      vy[i] = (vy[i] + fy[i]) * damping
      vz[i] = (vz[i] + fz[i]) * damping
      const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i] + vz[i] * vz[i])
      const cap = 0.6 * Math.max(0.15, cool)
      if (sp > cap) {
        vx[i] = (vx[i] / sp) * cap
        vy[i] = (vy[i] / sp) * cap
        vz[i] = (vz[i] / sp) * cap
      }
      px[i] += vx[i]
      py[i] += vy[i]
      pz[i] += vz[i]
    }
  }

  // Re-centre on centroid and scale to target radius (no seat is the origin/root).
  let cx = 0
  let cy = 0
  let cz = 0
  for (let i = 0; i < n; i++) {
    cx += px[i]
    cy += py[i]
    cz += pz[i]
  }
  cx /= n
  cy /= n
  cz /= n
  let maxR = 0
  for (let i = 0; i < n; i++) {
    maxR = Math.max(maxR, Math.hypot(px[i] - cx, py[i] - cy, pz[i] - cz))
  }
  const s = maxR > 1e-6 ? targetRadius / maxR : 1
  for (let i = 0; i < n; i++) {
    out.set(nodes[i].id, [(px[i] - cx) * s, (py[i] - cy) * s, (pz[i] - cz) * s])
  }
  return out
}

/** Control point for a gently arched link a→b, bowed away from the mesh centre. */
export function linkControlPoint(a: Vec3, b: Vec3, bend = 0.18): Vec3 {
  const mx = (a[0] + b[0]) / 2
  const my = (a[1] + b[1]) / 2
  const mz = (a[2] + b[2]) / 2
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
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
