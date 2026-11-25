// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { PollEvent } from '@/hooks/useNetworkFeed'
import type { Round } from '@/lib/netmap-consensus'
import { phaseAt } from '@/lib/netmap-consensus'
import {
  bulgeCount,
  geoClusters,
  propagationPlan,
  ringFill,
  solveForceMesh,
  stepForceMesh,
  votePaths,
  type MeshEdge,
  type MeshGraph,
  type MeshNode,
  type PropagationHop,
} from '@/lib/netmap-layout'
import { BRIDGE_OPERATORS } from '@/lib/bridge-operators'

export interface PeerMeshProps {
  graph: MeshGraph
  event: PollEvent | null
  maxBulges: number
  selected: string | null
  onSelect: (id: string) => void
  fpsRef?: React.MutableRefObject<HTMLSpanElement | null>
  watchers?: { epoch: string[]; live: string[] }
  consensus?: {
    round: Round | null
    intervalMs: number
    phaseRef?: React.MutableRefObject<HTMLSpanElement | null>
  }
  walletCount?: number | null
  tps?: number | null
  isMobile?: boolean
}

interface PropagationWave {
  at: number
  packer: string
  hops: PropagationHop[]
  maxHop: number
  txs: number
}

interface TxPulse {
  at: number
  durationMs: number
  edgeIdx: number
  size: number
}

const COLORS = {
  bg: '#020617',
  copper: '#C07838',
  gold: '#D4922A',
  goldHot: '#FFC060',
  cream: '#E0DBCA',
  green: '#22C55E',
  greenHot: '#4ADE80',
  cyan: '#38BDF8',
  teal: '#2DD4BF',
  slate: '#475569',
  muted: '#64748B',
}

function edgeCurveControl(a: MeshNode, b: MeshNode, index: number): { cx: number; cy: number } {
  const mx = (a.x + b.x) * 0.5
  const my = (a.y + b.y) * 0.5
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const sign = index % 2 === 0 ? 1 : -1
  const curve = Math.min(26, len * 0.1) * sign
  return {
    cx: mx - (dy / len) * curve,
    cy: my + (dx / len) * curve,
  }
}

function quadPoint(
  ax: number,
  ay: number,
  cx: number,
  cy: number,
  bx: number,
  by: number,
  t: number,
): { x: number; y: number } {
  const u = 1 - t
  return {
    x: u * u * ax + 2 * u * t * cx + t * t * bx,
    y: u * u * ay + 2 * u * t * cy + t * t * by,
  }
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

export default function PeerMeshCanvas({
  graph,
  event,
  maxBulges,
  selected,
  onSelect,
  fpsRef,
  watchers,
  consensus,
  walletCount,
  tps,
  isMobile = false,
}: PeerMeshProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const reducedMotion = useReducedMotion()

  const simRef = useRef<{ nodes: MeshNode[]; edges: MeshEdge[]; byId: Map<string, MeshNode> }>({
    nodes: [],
    edges: [],
    byId: new Map(),
  })

  const viewRef = useRef<{ panX: number; panY: number; zoom: number; userMoved: boolean }>({
    panX: 0,
    panY: 0,
    zoom: 1,
    userMoved: false,
  })

  const [hovered, setHovered] = useState<string | null>(null)
  const hoveredRef = useRef<string | null>(null)
  hoveredRef.current = hovered

  const selectedRef = useRef<string | null>(selected)
  selectedRef.current = selected

  const consensusRef = useRef(consensus)
  consensusRef.current = consensus

  const wavesRef = useRef<PropagationWave[]>([])
  const txPulsesRef = useRef<TxPulse[]>([])
  const flashUntilRef = useRef<Map<string, { until: number; fill: number }>>(new Map())
  const roundRef = useRef<{ h: number; startedAt: number; intervalMs: number; round: Round | null }>({
    h: 0,
    startedAt: Date.now(),
    intervalMs: 3000,
    round: null,
  })
  const recentMaxTxRef = useRef<number>(100)
  const settleEnergyRef = useRef<number>(1)
  const redrawRef = useRef<(() => void) | null>(null)

  function fitViewToNodes(canvas: HTMLCanvasElement, nodes: MeshNode[], mobile: boolean) {
    if (!nodes.length) return
    const rect = canvas.getBoundingClientRect()
    const w = rect.width || canvas.clientWidth || 800
    const h = rect.height || canvas.clientHeight || 600
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const n of nodes) {
      minX = Math.min(minX, n.x - 62)
      maxX = Math.max(maxX, n.x + 62)
      minY = Math.min(minY, n.y - 68)
      maxY = Math.max(maxY, n.y + 62)
    }
    const spanX = Math.max(200, maxX - minX)
    const spanY = Math.max(200, maxY - minY)
    const padX = mobile ? 20 : 52
    const padTop = mobile ? 70 : 64
    const padBottom = mobile ? 50 : 42
    const availW = Math.max(120, w - padX * 2)
    const availH = Math.max(120, h - padTop - padBottom)
    const zoom = Math.max(0.42, Math.min(1.55, Math.min(availW / spanX, availH / spanY)))
    viewRef.current.zoom = zoom
    viewRef.current.panX = -(minX + maxX) * 0.5
    viewRef.current.panY = -(minY + maxY) * 0.5 + (padTop - padBottom) * (0.25 / zoom)
  }

  // Reconcile simulation nodes when graph topology changes (without restarting rAF).
  useEffect(() => {
    const prevById = simRef.current.byId
    const hadPrev = prevById.size > 0
    const nextNodes: MeshNode[] = graph.nodes.map((n) => {
      const old = prevById.get(n.id)
      if (old) {
        return { ...n, x: old.x, y: old.y, vx: old.vx * 0.5, vy: old.vy * 0.5 }
      }
      return { ...n }
    })
    const nextEdges = graph.edges.map((e) => ({ ...e }))
    if (!hadPrev || reducedMotion) {
      solveForceMesh(nextNodes, nextEdges, 200)
      settleEnergyRef.current = 0
    } else {
      for (let i = 0; i < 45; i++) stepForceMesh(nextNodes, nextEdges)
      settleEnergyRef.current = 1
    }
    const byId = new Map(nextNodes.map((n) => [n.id, n]))
    simRef.current = { nodes: nextNodes, edges: nextEdges, byId }
    if (canvasRef.current && !viewRef.current.userMoved) {
      fitViewToNodes(canvasRef.current, nextNodes, isMobile)
    }
    redrawRef.current?.()
  }, [graph, reducedMotion, isMobile])

  // Sync consensus round timing.
  const consensusRound = consensus?.round ?? null
  const consensusInterval = consensus?.intervalMs ?? 3000
  useEffect(() => {
    const r = roundRef.current
    r.round = consensusRound
    r.intervalMs = consensusInterval
    if (consensusRound && consensusRound.height !== r.h) {
      r.h = consensusRound.height
      r.startedAt = Date.now()
    }
    redrawRef.current?.()
  }, [consensusRound, consensusInterval])

  // Trigger block propagation wave + ingress tx pulses on each sealed block poll.
  useEffect(() => {
    if (!event || !event.blocks.length) return
    const now = Date.now()
    const { edges, byId } = simRef.current

    for (const blk of event.blocks) {
      if (blk.txs && blk.txs > recentMaxTxRef.current) {
        recentMaxTxRef.current = blk.txs
      }
      const packerId =
        blk.packer && byId.has(blk.packer)
          ? blk.packer
          : graph.hubIds[0] ?? simRef.current.nodes.find((n) => n.online && n.kind !== 'wallet')?.id ?? ''
      if (packerId) {
        const plan = propagationPlan(edges, packerId)
        wavesRef.current.push({
          at: now,
          packer: packerId,
          hops: plan.hops,
          maxHop: Math.max(1, plan.maxHop),
          txs: blk.txs ?? 0,
        })
        if (wavesRef.current.length > 3) wavesRef.current.shift()
        flashUntilRef.current.set(packerId, {
          until: now + 1500,
          fill: ringFill(blk.txs ?? 0, recentMaxTxRef.current),
        })
      }
    }

    const ingressIndices: number[] = []
    edges.forEach((e, idx) => {
      if (e.kind === 'ingress') ingressIndices.push(idx)
    })
    if (ingressIndices.length > 0 && event.newTxs > 0) {
      const count = Math.min(Math.max(4, Math.floor(maxBulges * 0.25)), bulgeCount(event.newTxs, maxBulges))
      for (let i = 0; i < count; i++) {
        txPulsesRef.current.push({
          at: now + i * 55,
          durationMs: 950,
          edgeIdx: ingressIndices[i % ingressIndices.length],
          size: Math.min(5.5, 2.5 + Math.log1p(event.newTxs) * 0.45),
        })
      }
      if (txPulsesRef.current.length > maxBulges) {
        txPulsesRef.current.splice(0, txPulsesRef.current.length - maxBulges)
      }
    }
    redrawRef.current?.()
  }, [event, graph.hubIds, maxBulges])

  const currentVotePaths = useMemo(() => {
    if (!consensusRound?.packer || !consensusRound.voters.length) return []
    return votePaths(graph.edges, consensusRound.voters, consensusRound.packer)
  }, [graph.edges, consensusRound?.packer, consensusRound?.voters])

  const votePathsRef = useRef(currentVotePaths)
  votePathsRef.current = currentVotePaths

  const walletCountRef = useRef(walletCount)
  walletCountRef.current = walletCount
  const tpsRef = useRef(tps)
  tpsRef.current = tps

  const resetView = () => {
    viewRef.current.userMoved = false
    const canvas = canvasRef.current
    if (!canvas) return
    fitViewToNodes(canvas, simRef.current.nodes, isMobile)
    redrawRef.current?.()
  }

  // Main render & physics loop — pauses completely when document.hidden,
  // and runs once-on-change when prefers-reduced-motion is enabled.
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let alive = true
    let frames = 0
    let lastFpsAt = performance.now()
    let lastIngressSpawn = 0

    const resize = () => {
      const rect = container.getBoundingClientRect()
      const maxDpr = isMobile ? 1.5 : 2
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr)
      const pw = Math.max(1, Math.floor(rect.width * dpr))
      const ph = Math.max(1, Math.floor(rect.height * dpr))
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw
        canvas.height = ph
      }
      if (!viewRef.current.userMoved) {
        fitViewToNodes(canvas, simRef.current.nodes, isMobile)
      }
    }

    const drawFrame = (nowMs: number) => {
      const { nodes, edges, byId } = simRef.current
      if (!reducedMotion && settleEnergyRef.current > 0.004 && nodes.length > 0) {
        settleEnergyRef.current = stepForceMesh(nodes, edges, { dt: 0.9 })
        if (!viewRef.current.userMoved) fitViewToNodes(canvas, nodes, isMobile)
      }

      const maxDpr = isMobile ? 1.5 : 2
      const dpr = Math.min(window.devicePixelRatio || 1, maxDpr)
      const w = canvas.width / dpr
      const h = canvas.height / dpr

      ctx.save()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = COLORS.bg
      ctx.fillRect(0, 0, w, h)

      const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.5, 20, w * 0.5, h * 0.5, Math.max(w, h) * 0.6)
      bgGrad.addColorStop(0, 'rgba(30, 41, 59, 0.34)')
      bgGrad.addColorStop(1, 'rgba(2, 6, 23, 0)')
      ctx.fillStyle = bgGrad
      ctx.fillRect(0, 0, w, h)

      const { zoom, panX, panY } = viewRef.current
      ctx.translate(w * 0.5, h * 0.5)
      ctx.scale(zoom, zoom)
      ctx.translate(panX, panY)

      // 1) Geography cluster halos & labels.
      const clusters = geoClusters(nodes)
      for (const c of clusters) {
        ctx.save()
        ctx.beginPath()
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2)
        ctx.fillStyle = `${c.color}0D`
        ctx.fill()
        ctx.setLineDash([4, 5])
        ctx.lineWidth = 1 / zoom
        ctx.strokeStyle = `${c.color}38`
        ctx.stroke()
        ctx.setLineDash([])

        const fontSize = Math.max(9, Math.min(11, 10 / zoom))
        ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = `${c.color}CC`
        ctx.fillText(c.label.toUpperCase(), c.x, c.y - c.r - 8 / zoom)
        ctx.restore()
      }

      const activeId = hoveredRef.current ?? selectedRef.current
      const round = roundRef.current.round
      const votersSet = new Set(round?.voters ?? [])
      const nextPacker = round?.packer ?? ''
      const { phase, u: phaseU } = phaseAt(nowMs - roundRef.current.startedAt, roundRef.current.intervalMs)

      if (consensusRef.current?.phaseRef?.current) {
        const el = consensusRef.current.phaseRef.current
        const hasRecentSeal = wavesRef.current.some((wv) => nowMs - wv.at < 800)
        const label = hasRecentSeal ? 'seal' : phase
        el.textContent = label
        el.dataset.p = label
      }

      const curves = edges.map((e, idx) => {
        const a = byId.get(e.source)
        const b = byId.get(e.target)
        if (!a || !b) return null
        const { cx, cy } = edgeCurveControl(a, b, idx)
        return { a, b, cx, cy, edge: e }
      })

      // 2) Draw peer & ingress edges.
      for (let i = 0; i < curves.length; i++) {
        const item = curves[i]
        if (!item) continue
        const { a, b, cx, cy, edge } = item
        const touchesActive = activeId != null && (a.id === activeId || b.id === activeId)
        const bothHubs = a.isHub && b.isHub
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.quadraticCurveTo(cx, cy, b.x, b.y)
        if (edge.kind === 'ingress') {
          ctx.setLineDash([5, 5])
          ctx.lineWidth = (touchesActive ? 2 : 1.3) / zoom
          ctx.strokeStyle = touchesActive ? 'rgba(212, 146, 42, 0.8)' : 'rgba(212, 146, 42, 0.35)'
        } else {
          ctx.lineWidth = (touchesActive ? 2.1 : bothHubs ? 1.8 : 1.05) / zoom
          ctx.strokeStyle = touchesActive
            ? 'rgba(212, 146, 42, 0.85)'
            : bothHubs
              ? 'rgba(192, 120, 56, 0.55)'
              : a.online && b.online
                ? 'rgba(56, 189, 248, 0.22)'
                : 'rgba(71, 85, 105, 0.2)'
        }
        ctx.stroke()
        ctx.restore()
      }

      // 3) Animate block propagation wavefront across real peer edges.
      const arrivedAt = new Map<string, number>()
      if (!reducedMotion) {
        const hopMs = 260
        const waveLife = 1600
        wavesRef.current = wavesRef.current.filter((w) => nowMs - w.at < waveLife)
        const curveLookup = new Map<string, number>()
        edges.forEach((e, idx) => {
          curveLookup.set(`${e.source}\0${e.target}`, idx)
          curveLookup.set(`${e.target}\0${e.source}`, idx)
        })

        for (const wave of wavesRef.current) {
          const elapsed = nowMs - wave.at
          for (const hop of wave.hops) {
            const hopStart = (hop.hop - 1) * hopMs
            const localT = (elapsed - hopStart) / hopMs
            if (localT < 0) continue
            const idx = curveLookup.get(`${hop.from}\0${hop.to}`)
            const item = idx != null ? curves[idx] : null
            if (!item) continue
            const fromNode = byId.get(hop.from)
            const toNode = byId.get(hop.to)
            if (!fromNode || !toNode) continue

            if (localT <= 1.6) {
              const fade = localT <= 1 ? 1 : Math.max(0, 1 - (localT - 1) / 0.6)
              ctx.save()
              ctx.beginPath()
              ctx.moveTo(item.a.x, item.a.y)
              ctx.quadraticCurveTo(item.cx, item.cy, item.b.x, item.b.y)
              ctx.lineWidth = 2.4 / zoom
              ctx.strokeStyle = `rgba(255, 192, 96, ${0.65 * fade})`
              ctx.stroke()

              if (localT <= 1) {
                const dirT = fromNode.id === item.a.id ? localT : 1 - localT
                const pt = quadPoint(item.a.x, item.a.y, item.cx, item.cy, item.b.x, item.b.y, dirT)
                ctx.beginPath()
                ctx.arc(pt.x, pt.y, 4.2 / zoom, 0, Math.PI * 2)
                ctx.fillStyle = COLORS.goldHot
                ctx.shadowColor = COLORS.goldHot
                ctx.shadowBlur = 10
                ctx.fill()
              }
              ctx.restore()
            }
            if (localT >= 0.9) {
              const arrivalTime = wave.at + hopStart + hopMs
              const age = nowMs - arrivalTime
              if (age >= 0 && age < 650) {
                arrivedAt.set(toNode.id, Math.max(arrivedAt.get(toNode.id) ?? 0, 1 - age / 650))
              }
            }
          }
        }

        // 4) Continuous subtle wallet tx stream when tps > 0.
        const curTps = tpsRef.current ?? 0
        if (curTps > 0.2 && nowMs - lastIngressSpawn > Math.max(240, 1100 - Math.min(850, curTps * 14))) {
          lastIngressSpawn = nowMs
          const ingEdges = edges.map((e, i) => (e.kind === 'ingress' ? i : -1)).filter((i) => i >= 0)
          if (ingEdges.length > 0) {
            const pick = ingEdges[Math.floor((nowMs / 300) % ingEdges.length)]
            txPulsesRef.current.push({
              at: nowMs,
              durationMs: 900,
              edgeIdx: pick,
              size: Math.min(4.8, 2.3 + Math.log1p(curTps) * 0.45),
            })
          }
        }

        txPulsesRef.current = txPulsesRef.current.filter((p) => nowMs - p.at <= p.durationMs + 200)
        for (const p of txPulsesRef.current) {
          const t = (nowMs - p.at) / p.durationMs
          if (t < 0 || t > 1) continue
          const item = curves[p.edgeIdx]
          if (!item) continue
          const pt = quadPoint(item.a.x, item.a.y, item.cx, item.cy, item.b.x, item.b.y, t)
          ctx.save()
          ctx.beginPath()
          ctx.arc(pt.x, pt.y, p.size / zoom, 0, Math.PI * 2)
          ctx.fillStyle = COLORS.gold
          ctx.shadowColor = COLORS.goldHot
          ctx.shadowBlur = 8
          ctx.fill()
          ctx.restore()
        }

        // 5) Consensus vote sparks moving along real peer edges toward next packer.
        if (phase === 'pulse' && votePathsRef.current.length > 0) {
          const edgeMap = new Map<string, number>()
          edges.forEach((e, idx) => {
            edgeMap.set(`${e.source}\0${e.target}`, idx)
            edgeMap.set(`${e.target}\0${e.source}`, idx)
          })
          for (const segs of votePathsRef.current) {
            const totalSegs = segs.length
            const pos = Math.min(0.999, phaseU) * totalSegs
            const segIdx = Math.floor(pos)
            const segT = pos - segIdx
            const [u, v] = segs[segIdx]
            const idx = edgeMap.get(`${u}\0${v}`)
            const item = idx != null ? curves[idx] : null
            if (!item) continue
            const dirT = u === item.a.id ? segT : 1 - segT
            const pt = quadPoint(item.a.x, item.a.y, item.cx, item.cy, item.b.x, item.b.y, dirT)
            ctx.save()
            ctx.beginPath()
            ctx.arc(pt.x, pt.y, 3.2 / zoom, 0, Math.PI * 2)
            ctx.fillStyle = COLORS.greenHot
            ctx.shadowColor = COLORS.green
            ctx.shadowBlur = 8
            ctx.fill()
            ctx.restore()
          }
        }
      }

      // 6) Draw all nodes as equal peers in their respective roles.
      const breath = reducedMotion ? 0 : Math.sin(nowMs * 0.0032) * 0.5 + 0.5

      for (const n of nodes) {
        const isSel = selectedRef.current === n.id
        const isHov = hoveredRef.current === n.id
        const isPacker = n.id === nextPacker
        const isVoter = votersSet.has(n.id)
        const flash = flashUntilRef.current.get(n.id)
        const flashing = flash && nowMs < flash.until ? (flash.until - nowMs) / 1500 : 0
        const arrivalGlow = arrivedAt.get(n.id) ?? 0

        let ringColor = COLORS.slate
        if (n.kind === 'wallet') ringColor = COLORS.gold
        else if (n.jailed || (!n.online && !n.isHub)) ringColor = COLORS.slate
        else if (isPacker || flashing > 0) ringColor = COLORS.goldHot
        else if (isVoter && (phase === 'vote' || phase === 'pulse')) ringColor = COLORS.greenHot
        else if (n.isHub) ringColor = COLORS.copper
        else if (isVoter) ringColor = COLORS.green
        else if (n.online) ringColor = COLORS.teal

        ctx.save()

        const auraStrength = Math.max(flashing, arrivalGlow, n.isHub && n.online ? 0.25 + breath * 0.12 : 0)
        if (auraStrength > 0.02) {
          const rAura = n.radius * (1.8 + auraStrength * 0.7)
          const grad = ctx.createRadialGradient(n.x, n.y, n.radius * 0.5, n.x, n.y, rAura)
          const rgb = n.isHub && !flashing ? '192, 120, 56' : '255, 192, 96'
          grad.addColorStop(0, `rgba(${rgb}, ${Math.min(0.42, auraStrength * 0.5)})`)
          grad.addColorStop(1, `rgba(${rgb}, 0)`)
          ctx.fillStyle = grad
          ctx.beginPath()
          ctx.arc(n.x, n.y, rAura, 0, Math.PI * 2)
          ctx.fill()
        }

        ctx.beginPath()
        if (n.kind === 'wallet') {
          const r = n.radius
          ctx.moveTo(n.x, n.y - r)
          ctx.lineTo(n.x + r, n.y)
          ctx.lineTo(n.x, n.y + r)
          ctx.lineTo(n.x - r, n.y)
          ctx.closePath()
        } else {
          ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2)
        }
        ctx.fillStyle = n.online ? '#0F172A' : '#090F1D'
        ctx.fill()
        ctx.lineWidth = (isSel || isHov ? 3 : n.isHub ? 2.5 : 2) / zoom
        ctx.strokeStyle = ringColor
        ctx.stroke()

        if (n.isHub) {
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.radius + 4.5, 0, Math.PI * 2)
          ctx.lineWidth = 1.2 / zoom
          ctx.strokeStyle = 'rgba(212, 146, 42, 0.7)'
          ctx.stroke()
        }

        if (isSel || isHov) {
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.radius + (n.isHub ? 9 : 6), 0, Math.PI * 2)
          ctx.lineWidth = 1.4 / zoom
          ctx.strokeStyle = COLORS.cream
          ctx.stroke()
        }

        if (flashing > 0 && flash) {
          ctx.beginPath()
          ctx.arc(n.x, n.y, n.radius + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * flash.fill)
          ctx.lineWidth = 2.6 / zoom
          ctx.strokeStyle = COLORS.goldHot
          ctx.stroke()
        }

        ctx.beginPath()
        ctx.arc(n.x, n.y, n.isHub ? 5.5 : n.kind === 'observer' ? 3 : 4, 0, Math.PI * 2)
        ctx.fillStyle = ringColor
        ctx.fill()

        const labelSize = Math.max(9.5, Math.min(12, (n.isHub ? 11.5 : 10.5) / Math.max(0.7, zoom)))
        ctx.font = `${n.isHub || n.kind === 'wallet' ? '600' : '500'} ${labelSize}px "JetBrains Mono", monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        ctx.lineWidth = 3 / zoom
        ctx.strokeStyle = 'rgba(2, 6, 23, 0.92)'
        const labelY = n.y + n.radius + (n.isHub ? 8 : 5)
        ctx.strokeText(n.label, n.x, labelY)
        ctx.fillStyle = n.online ? COLORS.cream : COLORS.muted
        ctx.fillText(n.label, n.x, labelY)

        const showSub = !isMobile || n.isHub || n.kind === 'wallet' || isSel
        if (showSub) {
          const subParts: string[] = []
          if (n.isHub) subParts.push(n.isArchive ? 'HUB · ARCHIVE' : 'HUB')
          if (n.kind === 'wallet') {
            const wc = walletCountRef.current
            subParts.push(wc == null ? n.host : `${wc.toLocaleString('en-US')} wallets`)
          } else if (n.host) {
            subParts.push(n.host)
          }
          const sub = subParts.join(' · ')
          if (sub) {
            const subSize = Math.max(8, Math.min(9.5, 9 / Math.max(0.75, zoom)))
            ctx.font = `500 ${subSize}px "JetBrains Mono", monospace`
            const subY = labelY + labelSize + 2
            ctx.strokeText(sub, n.x, subY)
            ctx.fillStyle = n.isHub ? COLORS.gold : '#94A3B8'
            ctx.fillText(sub, n.x, subY)
          }
        }

        ctx.restore()
      }

      ctx.restore()

      frames += 1
      if (fpsRef?.current && nowMs - lastFpsAt >= 800) {
        const fps = Math.round((frames * 1000) / (nowMs - lastFpsAt))
        fpsRef.current.textContent = reducedMotion ? 'reduced motion' : `${fps} fps`
        frames = 0
        lastFpsAt = nowMs
      }
    }

    redrawRef.current = () => {
      if (!document.hidden) drawFrame(performance.now())
    }

    const ro = new ResizeObserver(() => {
      resize()
      drawFrame(performance.now())
    })
    ro.observe(container)
    resize()

    const tick = (nowMs: number) => {
      if (!alive) return
      if (!document.hidden) drawFrame(nowMs)
      if (!reducedMotion && !document.hidden) {
        raf = requestAnimationFrame(tick)
      }
    }

    const onVisibility = () => {
      if (!alive) return
      if (document.hidden) {
        if (raf) cancelAnimationFrame(raf)
        raf = 0
        if (fpsRef?.current) fpsRef.current.textContent = 'paused'
      } else {
        drawFrame(performance.now())
        if (!reducedMotion && !raf) raf = requestAnimationFrame(tick)
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    drawFrame(performance.now())
    if (!reducedMotion && !document.hidden) raf = requestAnimationFrame(tick)

    return () => {
      alive = false
      redrawRef.current = null
      if (raf) cancelAnimationFrame(raf)
      document.removeEventListener('visibilitychange', onVisibility)
      ro.disconnect()
    }
  }, [reducedMotion, isMobile, fpsRef])

  const dragRef = useRef<{
    mode: 'none' | 'pan' | 'node'
    nodeId: string | null
    startX: number
    startY: number
    panStartX: number
    panStartY: number
    moved: boolean
  }>({ mode: 'none', nodeId: null, startX: 0, startY: 0, panStartX: 0, panStartY: 0, moved: false })

  const toWorld = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const sx = clientX - rect.left
    const sy = clientY - rect.top
    const { zoom, panX, panY } = viewRef.current
    return {
      x: (sx - rect.width * 0.5) / zoom - panX,
      y: (sy - rect.height * 0.5) / zoom - panY,
    }
  }

  const findHit = (wx: number, wy: number): MeshNode | null => {
    const pad = isMobile ? 12 : 7
    let best: MeshNode | null = null
    let bestD = Infinity
    for (const n of simRef.current.nodes) {
      const d = Math.hypot(n.x - wx, n.y - wy)
      if (d <= n.radius + pad && d < bestD) {
        best = n
        bestD = d
      }
    }
    return best
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x, y } = toWorld(e.clientX, e.clientY)
    const hit = findHit(x, y)
    e.currentTarget.setPointerCapture(e.pointerId)
    if (hit) {
      hit.pinned = true
      dragRef.current = {
        mode: 'node',
        nodeId: hit.id,
        startX: e.clientX,
        startY: e.clientY,
        panStartX: viewRef.current.panX,
        panStartY: viewRef.current.panY,
        moved: false,
      }
    } else {
      dragRef.current = {
        mode: 'pan',
        nodeId: null,
        startX: e.clientX,
        startY: e.clientY,
        panStartX: viewRef.current.panX,
        panStartY: viewRef.current.panY,
        moved: false,
      }
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current
    if (d.mode === 'none') {
      const { x, y } = toWorld(e.clientX, e.clientY)
      const hit = findHit(x, y)
      const nextHov = hit && hit.kind !== 'wallet' ? hit.id : null
      if (nextHov !== hovered) setHovered(nextHov)
      return
    }
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (Math.hypot(dx, dy) > 4) d.moved = true

    if (d.mode === 'node' && d.nodeId) {
      const { x, y } = toWorld(e.clientX, e.clientY)
      const n = simRef.current.byId.get(d.nodeId)
      if (n) {
        n.x = x
        n.y = y
        settleEnergyRef.current = 1
        redrawRef.current?.()
      }
    } else if (d.mode === 'pan') {
      viewRef.current.userMoved = true
      viewRef.current.panX = d.panStartX + dx / viewRef.current.zoom
      viewRef.current.panY = d.panStartY + dy / viewRef.current.zoom
      redrawRef.current?.()
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current
    if (d.mode === 'node' && d.nodeId) {
      const n = simRef.current.byId.get(d.nodeId)
      if (n) n.pinned = false
      if (!d.moved && n && n.kind !== 'wallet') onSelect(n.id)
    }
    dragRef.current = { mode: 'none', nodeId: null, startX: 0, startY: 0, panStartX: 0, panStartY: 0, moved: false }
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    viewRef.current.userMoved = true
    const factor = e.deltaY < 0 ? 1.1 : 0.91
    viewRef.current.zoom = Math.max(0.35, Math.min(2.6, viewRef.current.zoom * factor))
    redrawRef.current?.()
  }

  const hoveredNode = hovered ? simRef.current.byId.get(hovered) ?? null : null
  const liveWatchers = watchers?.live.length ?? 0
  const epochWatchers = watchers?.epoch.length ?? 0

  return (
    <div ref={containerRef} className="relative w-full h-full select-none overflow-hidden">
      <canvas
        ref={canvasRef}
        className={`w-full h-full touch-none ${hovered ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      />

      {/* Bottom-left telemetry pills: Watchers & Bridge Operators (compact on mobile to clear zoom buttons) */}
      <div className="absolute left-2.5 md:left-3 bottom-2.5 md:bottom-3 max-w-[calc(100%-116px)] flex flex-wrap items-center gap-1.5 pointer-events-none">
        <div className="netmap-watch">
          <span className="netmap-watch-dot" data-on={liveWatchers > 0 ? '1' : undefined} />
          watchers {liveWatchers}/{epochWatchers}
        </div>
        <div className="netmap-watch" style={{ borderColor: 'rgba(56, 189, 248, 0.45)' }}>
          <span
            className="netmap-watch-dot"
            style={{ background: BRIDGE_OPERATORS.length ? '#38BDF8' : '#475569' }}
          />
          {BRIDGE_OPERATORS.length
            ? `bridge ops ${BRIDGE_OPERATORS.length}`
            : isMobile
              ? 'bridge · soon'
              : 'BTC bridge operators · coming soon'}
        </div>
      </div>

      {/* Bottom-right zoom / fit controls */}
      <div className="absolute right-2.5 md:right-3 bottom-2.5 md:bottom-3 flex items-center gap-1 bg-[#0F172A]/85 border border-slate-800 rounded-lg p-1 text-xs netmap-mono">
        <button
          type="button"
          onClick={() => {
            viewRef.current.userMoved = true
            viewRef.current.zoom = Math.min(2.6, viewRef.current.zoom * 1.18)
            redrawRef.current?.()
          }}
          className="px-2 py-0.5 text-slate-300 hover:text-[#E0DBCA]"
          aria-label="Zoom in"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => {
            viewRef.current.userMoved = true
            viewRef.current.zoom = Math.max(0.35, viewRef.current.zoom * 0.85)
            redrawRef.current?.()
          }}
          className="px-2 py-0.5 text-slate-300 hover:text-[#E0DBCA]"
          aria-label="Zoom out"
        >
          −
        </button>
        <button
          type="button"
          onClick={resetView}
          className="px-2 py-0.5 text-slate-400 hover:text-[#E0DBCA]"
          aria-label="Reset mesh view"
        >
          fit
        </button>
      </div>

      {/* Hover quick card on desktop */}
      {hoveredNode && !isMobile && (
        <div className="pointer-events-none absolute left-3 top-14 rounded-lg border border-slate-700 bg-[#0F172A]/95 px-3 py-2 text-[11px] netmap-mono shadow-lg space-y-0.5">
          <div className="text-[#D4922A] font-semibold">
            {hoveredNode.id}
            {hoveredNode.isHub && (
              <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded-full border border-[#C07838] text-[#FFC060]">
                {hoveredNode.isArchive ? 'HUB · ARCHIVE' : 'HUB'}
              </span>
            )}
          </div>
          <div className="text-slate-400">
            {[hoveredNode.host, hoveredNode.locationLabel].filter(Boolean).join(' · ') || hoveredNode.kind}
          </div>
          <div className="text-slate-300">
            peers {hoveredNode.degree} · tip {hoveredNode.tip ? `#${hoveredNode.tip.toLocaleString()}` : '—'} · packs{' '}
            {hoveredNode.packs.toLocaleString()}
          </div>
        </div>
      )}
    </div>
  )
}
