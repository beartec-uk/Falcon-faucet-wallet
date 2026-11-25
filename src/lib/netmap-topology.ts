// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
/**
 * Read-only live peer topology & hub/archive discovery for /scan/map.
 *
 * Queries public Falcon PL seed endpoints (`status_req` + `health_req`) in
 * parallel to read real `is_hub` / `role`, `archive`, and `peers.connected`
 * links rather than hardcoding a single root hub or fixed hub count.
 */

import { num, str } from '@/lib/pl-mesh'
import { PL_NETWORK_ID, plRpc, plRpcAddrs, plStatus } from '@/lib/pl-rpc'

export const DEFAULT_PUBLIC_SEEDS_2300 = [
  '5.78.142.246:19301',
  '5.78.142.246:19303',
  '5.78.142.246:19306',
  '5.78.142.246:19307',
  '5.78.142.246:19312',
  '5.78.142.246:19313',
] as const

export type TopologyRole = 'hub' | 'validator' | 'observer' | 'unknown'

export interface TopologyNode {
  id: string
  role: TopologyRole
  isHub: boolean
  isArchive: boolean
  online: boolean
  jailed: boolean
  inactive: boolean
  connectedCount: number
  inbound: number | null
  outbound: number | null
  tip: number | null
  version: string | null
  queried: boolean
}

export interface TopologyEdge {
  source: string
  target: string
  /** True when both endpoints were queried and each listed the other in peers.connected. */
  mutual: boolean
}

export interface NetworkTopology {
  hubs: string[]
  archives: string[]
  nodes: TopologyNode[]
  edges: TopologyEdge[]
  edgeCount: number
  queriedSeeds: string[]
  queriedCount: number
  source: 'seed-rpc' | 'gateway-fallback'
  fetchedAt: number
}

export interface SeedObservation {
  addr: string
  status?: Record<string, unknown> | null
  health?: Record<string, unknown> | null
}

export function plTopologySeedAddrs(): string[] {
  const fromEnv = (process.env.FALCON_PL_SEEDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const rawRpc = plRpcAddrs().filter((a) => !/^https?:\/\//i.test(a) && !/^(127\.0\.0\.1|localhost|::1)(:|$)/i.test(a))
  const defaults = PL_NETWORK_ID === 2300 ? [...DEFAULT_PUBLIC_SEEDS_2300] : []
  const out: string[] = []
  for (const addr of [...fromEnv, ...rawRpc, ...defaults]) {
    if (!out.includes(addr)) out.push(addr)
  }
  return out
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function asStrList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []
}

function normalizeRole(raw: string, isHub: boolean): TopologyRole {
  if (isHub || raw === 'hub') return 'hub'
  if (raw === 'val' || raw === 'validator') return 'validator'
  if (raw === 'observer') return 'observer'
  return 'unknown'
}

export function aggregateSeedObservations(
  observations: SeedObservation[],
  fallbackStatus?: Record<string, unknown> | null,
  fetchedAt = Date.now(),
): NetworkTopology {
  const nodeMap = new Map<string, TopologyNode>()
  const onlineSet = new Set<string>()
  const validatorIds = new Set<string>()
  const archiveSet = new Set<string>()
  const directedEdges = new Set<string>()
  const queriedIds = new Set<string>()
  const queriedSeeds: string[] = []

  const upsert = (id: string): TopologyNode => {
    const existing = nodeMap.get(id)
    if (existing) return existing
    const created: TopologyNode = {
      id,
      role: id.startsWith('obs-') ? 'observer' : 'unknown',
      isHub: false,
      isArchive: false,
      online: false,
      jailed: false,
      inactive: false,
      connectedCount: 0,
      inbound: null,
      outbound: null,
      tip: null,
      version: null,
      queried: false,
    }
    nodeMap.set(id, created)
    return created
  }

  const ingestStatusBody = (st: Record<string, unknown>) => {
    for (const s of asStrList(st.online_seats)) onlineSet.add(s)
    const vals = Array.isArray(st.validators) ? (st.validators as Record<string, unknown>[]) : []
    for (const v of vals) {
      const id = str(v.id).trim()
      if (!id) continue
      validatorIds.add(id)
      const v2 = asObj(v.v2)
      const isArch = Boolean(v2?.archive ?? v.archive)
      if (isArch) archiveSet.add(id)
      const n = upsert(id)
      n.jailed = Boolean(v.jailed)
      n.inactive = Boolean(v2?.inactive ?? v.inactive)
      if (isArch) n.isArchive = true
      if (n.role === 'unknown') n.role = 'validator'
      const advTip = num(v.last_advertised_tip, Number.NaN)
      if (Number.isFinite(advTip) && (n.tip == null || advTip > n.tip)) n.tip = advTip
    }
    const selfId = str(st.id).trim()
    if (selfId) {
      const isHub = Boolean(st.is_hub) || str(st.role) === 'hub'
      const n = upsert(selfId)
      n.role = normalizeRole(str(st.role), isHub)
      if (isHub) n.isHub = true
      if (Boolean(st.archive)) {
        n.isArchive = true
        archiveSet.add(selfId)
      }
      const tip = num(st.tip_height, Number.NaN)
      if (Number.isFinite(tip)) n.tip = tip
      const ver = str(st.product_version).trim()
      if (ver) n.version = ver
      n.online = true
    }
  }

  let validObs = 0
  for (const obs of observations) {
    const st = asObj(obs.status)
    const hl = asObj(obs.health)
    if (!st && !hl) continue
    validObs += 1
    queriedSeeds.push(obs.addr)

    if (st) ingestStatusBody(st)

    const hNode = asObj(hl?.node)
    const hPeers = asObj(hl?.peers)
    const hChain = asObj(hl?.chain)
    const id = str(st?.id || hNode?.id).trim()
    if (!id) continue
    queriedIds.add(id)

    const n = upsert(id)
    n.queried = true
    n.online = true
    const rawRole = str(st?.role || hNode?.role)
    const isHub = Boolean(st?.is_hub) || rawRole === 'hub'
    n.role = normalizeRole(rawRole, isHub)
    if (isHub) n.isHub = true
    const ver = str(st?.product_version || hNode?.version).trim()
    if (ver) n.version = ver
    const tip = num(st?.tip_height ?? hChain?.local_height, Number.NaN)
    if (Number.isFinite(tip)) n.tip = tip

    if (hPeers) {
      const conn = asStrList(hPeers.connected)
      const inb = num(hPeers.inbound, Number.NaN)
      const outb = num(hPeers.outbound, Number.NaN)
      if (Number.isFinite(inb)) n.inbound = inb
      if (Number.isFinite(outb)) n.outbound = outb
      for (const peerId of conn) {
        if (!peerId || peerId === id) continue
        directedEdges.add(`${id}->${peerId}`)
        const p = upsert(peerId)
        if (p.role === 'unknown') {
          p.role = peerId.startsWith('obs-') ? 'observer' : validatorIds.has(peerId) ? 'validator' : 'unknown'
        }
      }
      for (const seat of Array.isArray(hPeers.seats) ? (hPeers.seats as Record<string, unknown>[]) : []) {
        const sid = str(seat.id).trim()
        const stip = num(seat.tip, Number.NaN)
        if (sid && Number.isFinite(stip)) {
          const pn = upsert(sid)
          if (pn.tip == null || stip > pn.tip) pn.tip = stip
        }
      }
    }
  }

  if (validObs === 0 && fallbackStatus) {
    ingestStatusBody(fallbackStatus)
  }

  for (const id of onlineSet) {
    const n = upsert(id)
    n.online = true
    if (n.role === 'unknown') n.role = 'validator'
  }
  for (const id of archiveSet) {
    upsert(id).isArchive = true
  }

  // Deduplicate undirected peer edges and compute per-node connected degree.
  const edgeKeys = new Set<string>()
  const edges: TopologyEdge[] = []
  const degree = new Map<string, number>()

  for (const dir of directedEdges) {
    const sep = dir.indexOf('->')
    if (sep <= 0) continue
    const a = dir.slice(0, sep)
    const b = dir.slice(sep + 2)
    if (!a || !b || a === b) continue
    const [u, v] = a < b ? [a, b] : [b, a]
    const key = `${u}\0${v}`
    if (edgeKeys.has(key)) continue
    edgeKeys.add(key)
    const mutual =
      queriedIds.has(u) && queriedIds.has(v)
        ? directedEdges.has(`${u}->${v}`) && directedEdges.has(`${v}->${u}`)
        : false
    edges.push({ source: u, target: v, mutual })
    degree.set(u, (degree.get(u) ?? 0) + 1)
    degree.set(v, (degree.get(v) ?? 0) + 1)
  }

  edges.sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target))
  for (const [id, n] of nodeMap) {
    n.connectedCount = degree.get(id) ?? 0
  }

  const nodes = [...nodeMap.values()].sort(
    (a, b) =>
      Number(b.isHub) - Number(a.isHub) ||
      Number(b.online) - Number(a.online) ||
      a.id.localeCompare(b.id, 'en', { numeric: true }),
  )

  return {
    hubs: nodes.filter((n) => n.isHub).map((n) => n.id),
    archives: nodes.filter((n) => n.isArchive).map((n) => n.id),
    nodes,
    edges,
    edgeCount: edges.length,
    queriedSeeds,
    queriedCount: validObs,
    source: validObs > 0 ? 'seed-rpc' : 'gateway-fallback',
    fetchedAt,
  }
}

async function querySeed(addr: string, timeoutMs = 2800): Promise<SeedObservation> {
  const [stRes, hlRes] = await Promise.allSettled([
    plRpc({ type: 'status_req', include_accounts: false, brief: true }, { addr, timeoutMs }),
    plRpc({ type: 'health_req' }, { addr, timeoutMs }),
  ])
  const stWire = stRes.status === 'fulfilled' ? stRes.value : null
  const hlWire = hlRes.status === 'fulfilled' ? hlRes.value : null
  return {
    addr,
    status: stWire && stWire.type !== 'err' ? asObj(stWire.body) : null,
    health: hlWire && hlWire.type === 'health' ? asObj(hlWire.body) : null,
  }
}

const CACHE_TTL_MS = 5_000
let cached: { at: number; data: NetworkTopology } | null = null
let inflight: Promise<NetworkTopology> | null = null

export async function buildNetworkTopology(now = Date.now()): Promise<NetworkTopology> {
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.data
  if (inflight) return inflight

  inflight = (async () => {
    const seeds = plTopologySeedAddrs()
    const obs = await Promise.all(seeds.map((addr) => querySeed(addr)))
    const hasAny = obs.some((o) => o.status || o.health)
    const fallbackStatus = hasAny ? null : await plStatus(false).catch(() => null)
    const data = aggregateSeedObservations(obs, fallbackStatus, Date.now())
    cached = { at: Date.now(), data }
    return data
  })().finally(() => {
    inflight = null
  })

  return inflight
}

export function _resetTopologyCache() {
  cached = null
  inflight = null
}
