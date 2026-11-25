// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// Pure organic force-directed P2P mesh layout, capping, and propagation helpers.

import type { NetworkMapConfig } from '@/config/network-map'
import type { NetworkTopology } from '@/lib/netmap-topology'
import type { ScanData } from '@/lib/scan-types'
import { seatLag } from '@/lib/net-metrics'

export type MeshNodeKind = 'hub' | 'validator' | 'observer' | 'wallet'

export interface MeshNode {
  id: string
  label: string
  kind: MeshNodeKind
  isHub: boolean
  isArchive: boolean
  online: boolean
  jailed: boolean
  inactive: boolean
  host: string
  locationId: string
  locationLabel: string
  locationColor: string
  note?: string
  degree: number
  tip: number | null
  lag: number | null
  packs: number
  perf: number | null
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  pinned?: boolean
  /** Public seed endpoint probed by /api/scan/topology (tn.queried). */
  isSeed?: boolean
}

export interface MeshEdge {
  id: string
  source: string
  target: string
  kind: 'peer' | 'ingress'
  mutual: boolean
}

export interface MeshGraph {
  nodes: MeshNode[]
  edges: MeshEdge[]
  peerEdgeCount: number
  totalPeerEdges: number
  hubIds: string[]
  archiveIds: string[]
  cappedNodes: number
  cappedEdges: number
}

export interface GeoCluster {
  id: string
  label: string
  color: string
  x: number
  y: number
  r: number
  nodeIds: string[]
}

export interface PropagationHop {
  from: string
  to: string
  hop: number
}

function hashSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

export function buildMeshGraph(
  cfg: NetworkMapConfig,
  scan: ScanData | null,
  topology: NetworkTopology | null,
  caps: { maxNodes: number; maxEdges: number },
): MeshGraph {
  const locBySeat = new Map<string, { id: string; label: string; color: string; host: string; note?: string }>()
  for (const loc of cfg.locations) {
    for (const h of loc.hosts) {
      for (const s of h.seats) {
        locBySeat.set(s, {
          id: loc.id,
          label: loc.label,
          color: loc.color ?? '#C07838',
          host: h.host,
          note: h.note,
        })
      }
    }
  }

  const onlineSeats = new Set(scan?.online_seats ?? [])
  const scanValidators = new Map((scan?.validators ?? []).map((v) => [v.account, v]))
  const topoNodes = new Map((topology?.nodes ?? []).map((n) => [n.id, n]))
  const hubSet = new Set(topology?.hubs ?? [])
  const archiveSet = new Set(topology?.archives ?? [])

  const allIds = new Set<string>()
  for (const s of onlineSeats) allIds.add(s)
  for (const [id, v] of scanValidators) {
    if (!v.jailed || cfg.showUnplacedOffline || onlineSeats.has(id) || hubSet.has(id)) {
      if (onlineSeats.has(id) || hubSet.has(id) || cfg.showUnplacedOffline) allIds.add(id)
    }
  }
  for (const tn of topology?.nodes ?? []) {
    if (tn.online || tn.isHub || tn.connectedCount > 0 || cfg.showUnplacedOffline) {
      allIds.add(tn.id)
    }
  }

  const rawNodes: MeshNode[] = []
  for (const id of allIds) {
    const tn = topoNodes.get(id)
    const sv = scanValidators.get(id)
    const loc = locBySeat.get(id)
    const isHub = Boolean(tn?.isHub || hubSet.has(id))
    const isArchive = Boolean(tn?.isArchive || archiveSet.has(id))
    const online = onlineSeats.has(id) || Boolean(tn?.online)
    const jailed = Boolean(sv?.jailed || tn?.jailed)
    const inactive = Boolean(tn?.inactive)
    const isObserver = tn?.role === 'observer' || id.startsWith('obs-')
    const kind: MeshNodeKind = isHub ? 'hub' : isObserver ? 'observer' : 'validator'

    const tip = sv?.ledger_index && sv.ledger_index > 0 ? sv.ledger_index : tn?.tip ?? null
    const lag =
      scan && sv
        ? seatLag(scan.height, {
            id,
            online,
            jailed,
            tip: tip ?? 0,
            packs: sv.pack_count ?? 0,
            perf: sv.perf ?? null,
          })
        : null

    const angle = hashSeed(id) * Math.PI * 2
    const dist = 120 + hashSeed(id + ':r') * 120
    rawNodes.push({
      id,
      label: isObserver ? `${id.slice(0, 10)}…` : id,
      kind,
      isHub,
      isArchive,
      isSeed: Boolean(tn?.queried),
      online,
      jailed,
      inactive,
      host: loc?.host ?? '',
      locationId: loc?.id ?? (isObserver ? 'observers' : 'unplaced'),
      locationLabel: loc?.label ?? '',
      locationColor: loc?.color ?? '#64748B',
      note: loc?.note,
      degree: tn?.connectedCount ?? 0,
      tip,
      lag,
      packs: sv?.pack_count ?? 0,
      perf: sv?.perf ?? null,
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      vx: 0,
      vy: 0,
      radius: isHub ? 22 : isObserver ? 11 : 16,
    })
  }

  const hubIds = rawNodes.filter((n) => n.isHub).map((n) => n.id).sort()
  const archiveIds = rawNodes.filter((n) => n.isArchive).map((n) => n.id).sort()

  // Optional Wallet Services ingress node, connected equally to all live hubs (or top online validator).
  const rawEdges: MeshEdge[] = []
  for (const e of topology?.edges ?? []) {
    if (allIds.has(e.source) && allIds.has(e.target)) {
      rawEdges.push({
        id: `peer:${e.source}--${e.target}`,
        source: e.source,
        target: e.target,
        kind: 'peer',
        mutual: e.mutual,
      })
    }
  }

  if (cfg.wallet && rawNodes.length > 0) {
    const targets = hubIds.length
      ? hubIds
      : rawNodes
          .filter((n) => n.online && n.kind === 'validator')
          .sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id))
          .slice(0, 2)
          .map((n) => n.id)
    const wa = hashSeed('__wallet__') * Math.PI * 2
    rawNodes.push({
      id: '__wallet__',
      label: cfg.wallet.label,
      kind: 'wallet',
      isHub: false,
      isArchive: false,
      online: true,
      jailed: false,
      inactive: false,
      host: cfg.wallet.sub,
      locationId: 'ingress',
      locationLabel: '',
      locationColor: '#D4922A',
      degree: targets.length,
      tip: null,
      lag: null,
      packs: 0,
      perf: null,
      x: Math.cos(wa) * 210,
      y: Math.sin(wa) * 210,
      vx: 0,
      vy: 0,
      radius: 17,
    })
    for (const t of targets) {
      rawEdges.push({
        id: `ingress:__wallet__--${t}`,
        source: '__wallet__',
        target: t,
        kind: 'ingress',
        mutual: true,
      })
    }
  }

  const totalPeerEdges = rawEdges.filter((e) => e.kind === 'peer').length
  const capped = capTopology(rawNodes, rawEdges, caps)

  return {
    nodes: capped.nodes,
    edges: capped.edges,
    peerEdgeCount: capped.edges.filter((e) => e.kind === 'peer').length,
    totalPeerEdges,
    hubIds,
    archiveIds,
    cappedNodes: Math.max(0, rawNodes.length - capped.nodes.length),
    cappedEdges: Math.max(0, rawEdges.length - capped.edges.length),
  }
}

export function capTopology(
  nodes: MeshNode[],
  edges: MeshEdge[],
  caps: { maxNodes: number; maxEdges: number },
): { nodes: MeshNode[]; edges: MeshEdge[] } {
  const maxN = Math.max(1, caps.maxNodes)
  const maxE = Math.max(0, caps.maxEdges)

  const nodePriority = (n: MeshNode) => {
    if (n.isHub) return 0
    if (n.kind === 'wallet') return 1
    if (n.online && !n.jailed && !n.inactive && n.kind === 'validator') return 2
    if (n.online && n.kind === 'observer') return 3
    if (n.degree > 0) return 4
    return 5
  }

  const keptNodes = [...nodes]
    .sort(
      (a, b) =>
        nodePriority(a) - nodePriority(b) ||
        b.degree - a.degree ||
        a.id.localeCompare(b.id, 'en', { numeric: true }),
    )
    .slice(0, maxN)

  const keptById = new Map(keptNodes.map((n) => [n.id, n]))

  const edgePriority = (e: MeshEdge) => {
    if (e.kind === 'ingress') return 3
    const a = keptById.get(e.source)
    const b = keptById.get(e.target)
    if (a?.isHub && b?.isHub) return 0
    if (a?.isHub || b?.isHub) return 1
    if (a?.kind === 'validator' && b?.kind === 'validator') return 2
    return 4
  }

  const keptEdges = edges
    .filter((e) => keptById.has(e.source) && keptById.has(e.target))
    .sort((a, b) => edgePriority(a) - edgePriority(b) || a.id.localeCompare(b.id))
    .slice(0, maxE)

  return { nodes: keptNodes, edges: keptEdges }
}

export interface ForceOpts {
  repulsion?: number
  springK?: number
  restLength?: number
  centerGravity?: number
  geoCohesion?: number
  minSep?: number
  damping?: number
  dt?: number
}

/**
 * Single deterministic step of the 2D organic force-directed P2P mesh.
 * All hubs and validators are equal peers in the force simulation (no pinned root).
 */
export function stepForceMesh(nodes: MeshNode[], edges: MeshEdge[], opts: ForceOpts = {}): number {
  const repulsion = opts.repulsion ?? 26_000
  const springK = opts.springK ?? 0.036
  const restLength = opts.restLength ?? 155
  const centerGravity = opts.centerGravity ?? 0.012
  const geoCohesion = opts.geoCohesion ?? 0.014
  const minSep = opts.minSep ?? 64
  const damping = opts.damping ?? 0.82
  const dt = opts.dt ?? 1

  const n = nodes.length
  if (n === 0) return 0
  const fx = new Float64Array(n)
  const fy = new Float64Array(n)
  const idxById = new Map<string, number>()
  for (let i = 0; i < n; i++) idxById.set(nodes[i].id, i)

  // Pairwise repulsion + minimum separation collision push.
  for (let i = 0; i < n; i++) {
    const a = nodes[i]
    for (let j = i + 1; j < n; j++) {
      const b = nodes[j]
      let dx = b.x - a.x
      let dy = b.y - a.y
      let d2 = dx * dx + dy * dy
      if (d2 < 0.01) {
        const ang = (i * 1.7 + j * 2.3) % (Math.PI * 2)
        dx = Math.cos(ang) * 0.5
        dy = Math.sin(ang) * 0.5
        d2 = 0.25
      }
      const d = Math.sqrt(d2)
      const weight = (a.isHub || b.isHub ? 1.2 : 1) * (a.kind === 'wallet' || b.kind === 'wallet' ? 1.1 : 1)
      const f = (repulsion * weight) / Math.max(400, d2)
      const ux = dx / d
      const uy = dy / d
      fx[i] -= ux * f
      fy[i] -= uy * f
      fx[j] += ux * f
      fy[j] += uy * f

      const want = minSep + (a.radius + b.radius) * 0.65
      if (d < want) {
        const push = (want - d) * 0.28
        fx[i] -= ux * push
        fy[i] -= uy * push
        fx[j] += ux * push
        fy[j] += uy * push
      }
    }
  }

  // Spring attraction along real peer & ingress edges.
  for (const e of edges) {
    const i = idxById.get(e.source)
    const j = idxById.get(e.target)
    if (i == null || j == null) continue
    const a = nodes[i]
    const b = nodes[j]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.hypot(dx, dy) || 1
    const targetLen =
      e.kind === 'ingress'
        ? restLength * 1.15
        : a.locationId === b.locationId && a.locationLabel
          ? restLength * 0.72
          : a.isHub && b.isHub
            ? restLength * 0.92
            : restLength
    const f = springK * (d - targetLen)
    const ux = dx / d
    const uy = dy / d
    fx[i] += ux * f
    fy[i] += uy * f
    fx[j] -= ux * f
    fy[j] -= uy * f
  }

  // Soft geographic cluster cohesion (keeps region peers gently grouped).
  const groupSum = new Map<string, { sx: number; sy: number; c: number }>()
  for (const node of nodes) {
    if (!node.locationLabel) continue
    const g = groupSum.get(node.locationId) ?? { sx: 0, sy: 0, c: 0 }
    g.sx += node.x
    g.sy += node.y
    g.c += 1
    groupSum.set(node.locationId, g)
  }

  let energy = 0
  for (let i = 0; i < n; i++) {
    const node = nodes[i]
    if (node.pinned) {
      node.vx = 0
      node.vy = 0
      continue
    }
    fx[i] -= node.x * centerGravity
    fy[i] -= node.y * centerGravity

    if (node.locationLabel) {
      const g = groupSum.get(node.locationId)
      if (g && g.c > 1) {
        fx[i] += (g.sx / g.c - node.x) * geoCohesion
        fy[i] += (g.sy / g.c - node.y) * geoCohesion
      }
    }

    node.vx = (node.vx + fx[i] * dt) * damping
    node.vy = (node.vy + fy[i] * dt) * damping
    const speed = Math.hypot(node.vx, node.vy)
    if (speed > 24) {
      node.vx = (node.vx / speed) * 24
      node.vy = (node.vy / speed) * 24
    }
    node.x += node.vx * dt
    node.y += node.vy * dt
    energy += node.vx * node.vx + node.vy * node.vy
  }

  return energy / n
}

export function solveForceMesh(nodes: MeshNode[], edges: MeshEdge[], iterations = 180, opts: ForceOpts = {}): void {
  // Place nodes initially in a clean evenly spaced circle ordered by region/id so
  // layout is reproducible and symmetric across all equal hubs.
  const ordered = [...nodes].sort(
    (a, b) => a.locationId.localeCompare(b.locationId) || a.id.localeCompare(b.id, 'en', { numeric: true }),
  )
  const baseR = Math.max(120, Math.min(260, ordered.length * 16))
  ordered.forEach((node, idx) => {
    if (node.pinned) return
    const theta = (idx / Math.max(1, ordered.length)) * Math.PI * 2 - Math.PI / 2
    const jitter = (hashSeed(node.id + ':init') - 0.5) * 32
    node.x = Math.cos(theta) * (baseR + jitter)
    node.y = Math.sin(theta) * (baseR + jitter)
    node.vx = 0
    node.vy = 0
  })

  for (let i = 0; i < iterations; i++) {
    const energy = stepForceMesh(nodes, edges, opts)
    if (i > 40 && energy < 0.02) break
  }
}

export function geoClusters(nodes: MeshNode[]): GeoCluster[] {
  const byLoc = new Map<string, MeshNode[]>()
  for (const n of nodes) {
    if (!n.locationLabel) continue
    const arr = byLoc.get(n.locationId) ?? []
    arr.push(n)
    byLoc.set(n.locationId, arr)
  }
  const clusters: GeoCluster[] = []
  for (const [id, list] of byLoc) {
    const cx = list.reduce((s, n) => s + n.x, 0) / list.length
    const cy = list.reduce((s, n) => s + n.y, 0) / list.length
    let maxD = 0
    for (const n of list) maxD = Math.max(maxD, Math.hypot(n.x - cx, n.y - cy) + n.radius)
    clusters.push({
      id,
      label: list[0].locationLabel,
      color: list[0].locationColor,
      x: cx,
      y: cy,
      r: maxD + 30,
      nodeIds: list.map((n) => n.id),
    })
  }
  return clusters.sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * BFS hop-by-hop propagation plan outward from `packerId` over real peer edges.
 */
export function propagationPlan(
  edges: Pick<MeshEdge, 'source' | 'target' | 'kind'>[],
  packerId: string,
): { hopByNode: Record<string, number>; hops: PropagationHop[]; maxHop: number } {
  const hopByNode: Record<string, number> = {}
  const hops: PropagationHop[] = []
  if (!packerId) return { hopByNode, hops, maxHop: 0 }

  const adj = new Map<string, string[]>()
  for (const e of edges) {
    if (e.kind !== 'peer') continue
    const a = adj.get(e.source) ?? []
    a.push(e.target)
    adj.set(e.source, a)
    const b = adj.get(e.target) ?? []
    b.push(e.source)
    adj.set(e.target, b)
  }
  for (const list of adj.values()) list.sort()

  hopByNode[packerId] = 0
  const q: string[] = [packerId]
  let maxHop = 0
  while (q.length > 0) {
    const cur = q.shift()!
    const nextHop = hopByNode[cur] + 1
    for (const nb of adj.get(cur) ?? []) {
      if (hopByNode[nb] === undefined) {
        hopByNode[nb] = nextHop
        maxHop = Math.max(maxHop, nextHop)
        hops.push({ from: cur, to: nb, hop: nextHop })
        q.push(nb)
      }
    }
  }
  return { hopByNode, hops, maxHop }
}

/** Shortest peer-edge paths from each voter to `packerId` (returns segment pairs [u, v]). */
export function votePaths(
  edges: Pick<MeshEdge, 'source' | 'target' | 'kind'>[],
  voters: string[],
  packerId: string,
): Array<[string, string][]> {
  if (!packerId) return []
  const adj = new Map<string, string[]>()
  for (const e of edges) {
    if (e.kind !== 'peer') continue
    const a = adj.get(e.source) ?? []
    a.push(e.target)
    adj.set(e.source, a)
    const b = adj.get(e.target) ?? []
    b.push(e.source)
    adj.set(e.target, b)
  }
  for (const list of adj.values()) list.sort()

  // Reverse BFS from packerId gives shortest path parent toward packerId.
  const nextTowardPacker = new Map<string, string>()
  const visited = new Set<string>([packerId])
  const q: string[] = [packerId]
  while (q.length > 0) {
    const cur = q.shift()!
    for (const nb of adj.get(cur) ?? []) {
      if (!visited.has(nb)) {
        visited.add(nb)
        nextTowardPacker.set(nb, cur)
        q.push(nb)
      }
    }
  }

  const paths: Array<[string, string][]> = []
  for (const v of voters) {
    if (!v || v === packerId || !nextTowardPacker.has(v)) continue
    const segs: [string, string][] = []
    let cur = v
    let guard = 0
    while (cur !== packerId && guard++ < 16) {
      const nxt = nextTowardPacker.get(cur)
      if (!nxt) break
      segs.push([cur, nxt])
      cur = nxt
    }
    if (segs.length) paths.push(segs)
  }
  return paths
}

/** Fill fraction for the packer ring: block txs vs. the biggest recent block (floor 100). */
export function ringFill(txs: number, recentMax: number): number {
  const denom = Math.max(100, recentMax)
  return Math.max(0.04, Math.min(1, txs / denom))
}

/** Bulges for an interval of `newTxs` sealed txs: 1 per 10 txs, at least 1, at most `cap`. */
export function bulgeCount(newTxs: number, cap: number): number {
  if (!(newTxs > 0)) return 0
  return Math.max(1, Math.min(cap, Math.ceil(newTxs / 10)))
}
