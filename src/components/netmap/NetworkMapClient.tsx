// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { NETWORK_MAP_CONFIG as CFG } from '@/config/network-map'
import { useNetworkFeed, useNetworkTopology, type SealedBlock } from '@/hooks/useNetworkFeed'
import { buildMeshGraph } from '@/lib/netmap-layout'
import { rateBetween, seatKey, seatLag, type NetSample } from '@/lib/net-metrics'
import type { MetricPoint } from '@/lib/metric-history'
import TrendChart from '@/components/explorer/TrendChart'
import MetricModal, { seatOptions } from '@/components/explorer/MetricModal'
import { nextInterval, nextRound, sealedRound } from '@/lib/netmap-consensus'

const PeerMeshCanvas = dynamic(() => import('@/components/netmap/PeerMeshCanvas'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">
      Loading peer mesh…
    </div>
  ),
})

const LIVE_WINDOW_MS = 5 * 60_000

function liveSeries(samples: NetSample[]) {
  const tps: MetricPoint[] = []
  const bpm: MetricPoint[] = []
  const mem: MetricPoint[] = []
  for (let i = 0; i < samples.length; i++) {
    mem.push({ t: samples[i].t, v: samples[i].mempool })
    if (i === 0) continue
    const r = rateBetween(samples[Math.max(0, i - 4)], samples[i])
    if (r) {
      tps.push({ t: samples[i].t, v: r.tps })
      bpm.push({ t: samples[i].t, v: r.blocks_min })
    }
  }
  return { tps, bpm, mem }
}

export default function NetworkMapClient() {
  const feed = useNetworkFeed(CFG.pollMs)
  const topoFeed = useNetworkTopology(CFG.topologyPollMs)
  const { data, live, blocks, event } = feed
  const { topology } = topoFeed

  const [selected, setSelected] = useState<string | null>(null)
  const [modal, setModal] = useState<string | null>(null)
  const [mobileDrawer, setMobileDrawer] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const fpsRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(max-width: 767px)')
    setIsMobile(mq.matches)
    const onChange = () => setIsMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const w = data?.watchers
  const prevW = useRef<{ epoch: Set<string>; work: Record<string, number>; slots: Record<string, number> } | null>(null)
  const [toast, setToast] = useState<{ at: number; names: string[] } | null>(null)
  const wKey = w ? `${w.epoch_accounts.join(',')}|${JSON.stringify(w.work)}|${JSON.stringify(w.slots ?? {})}` : ''
  useEffect(() => {
    if (!w) return
    const p = prevW.current
    prevW.current = { epoch: new Set(w.epoch_accounts), work: w.work, slots: w.slots ?? {} }
    if (!p) return
    const joined = w.epoch_accounts.filter((a) => !p.epoch.has(a))
    if (!joined.length) return
    setToast({ at: Date.now(), names: joined })
  }, [wKey, w])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3500)
    return () => clearTimeout(t)
  }, [toast])

  const watcherProps = useMemo(
    () => (w ? { epoch: w.epoch_accounts, live: w.live } : undefined),
    [wKey, w?.live.join(',')], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const caps = useMemo(
    () =>
      isMobile
        ? { maxNodes: CFG.maxNodesMobile, maxEdges: CFG.maxEdgesMobile }
        : { maxNodes: CFG.maxNodesDesktop, maxEdges: CFG.maxEdgesDesktop },
    [isMobile],
  )

  // Rebuild mesh structure when seat set, online flags, or live topology snapshot changes.
  const seatIdsKey = (data?.validators ?? [])
    .filter((v) => !v.jailed)
    .map((v) => `${v.account}:${(data?.online_seats ?? []).includes(v.account) ? 1 : 0}`)
    .join(',')
  const topoKey = topology
    ? `${topology.fetchedAt}|${topology.hubs.join(',')}|${topology.edgeCount}`
    : 'none'

  const graph = useMemo(
    () => buildMeshGraph(CFG, data, topology, caps),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [seatIdsKey, topoKey, caps.maxNodes, caps.maxEdges],
  )

  const last = live.samples[live.samples.length - 1] ?? null

  // Block cadence (EWMA) from observed heights; drives estimated round phase.
  const phaseRef = useRef<HTMLSpanElement | null>(null)
  const cadence = useRef<{ h: number; t: number; ms: number }>({ h: 0, t: 0, ms: 0 })
  const [intervalMs, setIntervalMs] = useState(3000)
  useEffect(() => {
    if (!data) return
    const c = cadence.current
    const now = Date.now()
    if (c.h && data.height > c.h) {
      c.ms = nextInterval(c.ms, data.height - c.h, now - c.t)
      setIntervalMs(c.ms)
    }
    if (!c.h || data.height !== c.h) {
      c.h = data.height
      c.t = now
    }
  }, [data])

  const round = useMemo(() => (data ? nextRound(data) : null), [data])
  const sealed = useMemo(() => (data ? sealedRound(data) : null), [data])
  const roundKey = round ? `${round.height}|${round.packer}|${round.voters.join(',')}` : ''
  const consensusView = useMemo(
    () => ({ round, intervalMs, phaseRef }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roundKey, intervalMs],
  )

  const series = useMemo(() => liveSeries(live.samples), [live.samples, live.samples.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const onSelect = useCallback((id: string) => {
    setSelected(id)
    setModal(id)
  }, [])

  const sel = selected && last ? last.seats.find((s) => s.id === selected) : null
  const selNode = selected ? graph.nodes.find((n) => n.id === selected) ?? null : null
  const onlineN = data?.online_seats?.length ?? 0
  const hubList = graph.hubIds
  const archiveList = graph.archiveIds

  const sidebarContent = (
    <>
      <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Live · last 5 min</div>
      <div className="grid grid-cols-3 md:grid-cols-1 gap-2 md:gap-3">
        <Spark label="tx/s" value={live.rate60s?.tps} digits={1} series={series.tps} hint="60s avg" />
        <Spark label="blocks / min" value={live.rate60s?.blocks_min} digits={1} series={series.bpm} hint="60s avg" />
        <Spark
          label="mempool"
          value={data?.mempool}
          digits={0}
          series={series.mem}
          hint={`max ${data?.max_mempool?.toLocaleString() ?? '—'}`}
        />
      </div>

      {/* Live topology summary (real hubs & peer links) */}
      <div className="rounded-xl border border-slate-800 p-3 text-xs netmap-mono space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-sans">Live mesh</span>
          <span className="text-[10px] text-slate-500">
            {topology?.source === 'seed-rpc'
              ? `${topology.queriedCount} seeds probed`
              : topology
                ? 'gateway fallback'
                : 'probing…'}
          </span>
        </div>
        <div className="text-[#E0DBCA]">
          {hubList.length} {hubList.length === 1 ? 'hub' : 'hubs'} · {graph.totalPeerEdges} peer{' '}
          {graph.totalPeerEdges === 1 ? 'edge' : 'edges'}
        </div>
        <div className="text-slate-400">
          hubs{' '}
          <span className="text-[#D4922A]">{hubList.length ? hubList.join(', ') : 'none reported'}</span>
        </div>
        <div className="text-slate-500">
          archives{' '}
          <span>{archiveList.length ? archiveList.join(', ') : 'none flagged'}</span>
        </div>
        {graph.cappedNodes > 0 || graph.cappedEdges > 0 ? (
          <div className="text-[10px] text-slate-500">
            mobile cap: showing {graph.nodes.length}/{graph.nodes.length + graph.cappedNodes} nodes,{' '}
            {graph.peerEdgeCount}/{graph.totalPeerEdges} peer edges
          </div>
        ) : null}
      </div>

      <ConsensusPanel round={round} sealed={sealed} intervalMs={intervalMs} phaseRef={phaseRef} />

      <div className="rounded-xl border border-slate-800 p-3 text-xs space-y-1.5">
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-1">Legend</div>
        <Legend c="#C07838" t={`Equal peer hubs (${hubList.length || 0} live)`} />
        <Legend c="#FFC060" t="Packer (lottery winner) · ring = block txs" />
        <Legend c="#4ADE80" t="Committee voter this round" />
        <Legend c="#2DD4BF" t="Online validator (non-committee)" />
        <Legend c="#475569" t="Observer / inactive / jailed" />
        <Legend c="#D4922A" t="Wallet services → hubs tx stream" dot />
        <Legend c="#FFC060" t="Block propagation wave across peer edges" dot />
        <Legend c="#4ADE80" t="Vote pulse along peer edges → packer" dot />
        <Legend c="#F5E7C8" t="Watchers (bright = live this slot)" dot />
        <Legend c="#38BDF8" t="BTC bridge operators (coming soon)" dot />
      </div>

      <div className="rounded-xl border border-slate-800 p-3 text-xs min-h-[110px]">
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500 mb-2">Node</div>
        {selected ? (
          <div className="space-y-1 netmap-mono">
            <div className="text-sm text-[#D4922A]">
              {selected}
              {selNode?.isHub ? (
                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full border border-[#C07838] text-[#FFC060]">
                  {selNode.isArchive ? 'HUB · ARCHIVE' : 'HUB'}
                </span>
              ) : null}
            </div>
            <div className="text-slate-400">
              {[selNode?.host, selNode?.locationLabel].filter(Boolean).join(' · ') || '—'}
            </div>
            {sel && (
              <>
                <div>
                  status {sel.jailed ? 'jailed' : sel.online ? 'online' : 'offline'} · peers{' '}
                  {selNode?.degree ?? 0}
                </div>
                <div>
                  tip {sel.tip ? `#${sel.tip.toLocaleString()}` : 'not advertised'} · lag{' '}
                  {seatLag(last!.height, sel) ?? '—'}
                </div>
                <div>
                  packs {sel.packs.toLocaleString()} · perf {sel.perf == null ? '—' : sel.perf.toFixed(3)}
                </div>
              </>
            )}
            <button
              type="button"
              onClick={() => setModal(selected)}
              className="mt-2 text-[#C07838] hover:text-[#D4922A]"
            >
              Open 24h graphs →
            </button>
          </div>
        ) : (
          <div className="text-slate-500">Click or tap a node for its details and 24h graphs.</div>
        )}
      </div>

      <p className="text-[10px] text-slate-600 leading-relaxed mt-auto">
        Hub roles and peer links come live from <span className="netmap-mono">/api/scan/topology</span> (seed{' '}
        <span className="netmap-mono">status_req</span> + <span className="netmap-mono">health_req</span>); blocks,
        committees and txs come from <span className="netmap-mono">/api/scan</span>. Host &amp; geography labels live
        in <span className="netmap-mono">src/config/network-map.ts</span>.
      </p>
    </>
  )

  return (
    <div
      className="netmap-root fixed inset-0 bg-[#020617] text-[#E0DBCA] overflow-hidden"
      style={{ fontFamily: 'var(--font-inter), Inter, sans-serif' }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* Main organic peer-to-peer mesh viewport */}
      <div className="absolute inset-0 right-0 md:right-[340px] bottom-[76px] md:bottom-[86px]">
        {data ? (
          <PeerMeshCanvas
            graph={graph}
            event={event}
            maxBulges={CFG.maxBulges}
            selected={selected}
            onSelect={onSelect}
            fpsRef={fpsRef}
            watchers={watcherProps}
            consensus={consensusView}
            walletCount={data.wallets?.activated ?? null}
            tps={live.rate60s?.tps ?? null}
            isMobile={isMobile}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm px-4 text-center">
            {feed.error
              ? `Status unavailable: ${feed.error}. Retrying…`
              : 'Connecting to Falcon PL mesh…'}
          </div>
        )}
      </div>

      {/* Top bar */}
      <div className="absolute top-0 left-0 right-0 md:right-[340px] flex flex-wrap items-center gap-2 md:gap-4 px-3 md:px-4 py-2.5 md:py-3 pointer-events-none bg-gradient-to-b from-[#020617]/90 via-[#020617]/55 to-transparent">
        <Link
          href="/scan"
          className="pointer-events-auto text-xs text-slate-400 hover:text-[#E0DBCA] border border-slate-800 rounded-lg px-2.5 py-1 bg-[#0F172A]/85"
        >
          ← Explorer
        </Link>
        <h1 className="text-xs md:text-sm font-semibold tracking-wide">
          Falcon PL <span className="text-[#C07838]">P2P mesh</span>
        </h1>
        <span className="netmap-mono text-[10px] md:text-[11px] text-slate-400">
          #{data?.height?.toLocaleString() ?? '—'} · {onlineN} online · {hubList.length}{' '}
          {hubList.length === 1 ? 'hub' : 'hubs'} · {graph.totalPeerEdges} edges
          {!isMobile && feed.lastPollMs != null ? ` · rtt ${feed.lastPollMs}ms` : ''}
        </span>
        <span ref={fpsRef} className="hidden sm:inline netmap-mono text-[11px] text-slate-600 ml-auto" />
        <button
          type="button"
          onClick={() => setMobileDrawer((v) => !v)}
          className="md:hidden pointer-events-auto ml-auto text-[11px] netmap-mono text-[#E0DBCA] border border-slate-700 rounded-lg px-2.5 py-1 bg-[#0F172A]/90"
        >
          {mobileDrawer ? 'Close' : 'Stats & Legend'}
        </button>
      </div>

      {/* Desktop side panel */}
      <aside className="hidden md:flex flex-col gap-3 absolute top-0 right-0 bottom-0 w-[340px] bg-[#0F172A] border-l border-slate-800 p-4 overflow-y-auto">
        {sidebarContent}
      </aside>

      {/* Mobile slide-over drawer */}
      {mobileDrawer && (
        <aside className="md:hidden fixed inset-x-0 top-12 bottom-[76px] z-20 bg-[#0F172A]/98 border-t border-slate-800 p-3.5 overflow-y-auto flex flex-col gap-3">
          {sidebarContent}
        </aside>
      )}

      {toast && (
        <div
          key={toast.at}
          className="netmap-toast absolute top-14 left-1/2 -translate-x-1/2 md:left-[calc(50%-170px)] rounded-lg border border-[#D4922A] bg-[#0F172A]/95 px-3 py-1.5 text-xs netmap-mono"
        >
          <span className="text-[#D4922A]">new watcher</span> · {toast.names.slice(0, 3).join(', ')}
          {toast.names.length > 3 ? ` +${toast.names.length - 3}` : ''}
        </div>
      )}

      {/* Block ticker */}
      <BlockTicker blocks={blocks} />

      {modal && (
        <MetricModal
          metric={seatKey(modal, 'lag')}
          options={seatOptions(modal, {
            tip: sel?.tip ? `#${sel.tip.toLocaleString()}` : 'not advertised',
            lag: sel && last ? String(seatLag(last.height, sel) ?? 'not advertised') : undefined,
            packs: sel ? `${sel.packs.toLocaleString()} total` : undefined,
            perf: sel?.perf == null ? undefined : sel.perf.toFixed(3),
          })}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}

function Spark({
  label,
  value,
  digits,
  series,
  hint,
}: {
  label: string
  value: number | null | undefined
  digits: number
  series: MetricPoint[]
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-[#020617]/50 px-2.5 md:px-3 pt-2 pb-1">
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[10px] md:text-[11px] text-slate-400 truncate">{label}</span>
        <span className="netmap-mono text-sm md:text-lg text-[#E0DBCA]">
          {value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits)}
        </span>
      </div>
      <TrendChart series={series} windowMs={LIVE_WINDOW_MS} compact height={40} gapMs={30_000} idSuffix={`-sp-${label}`} />
      {hint && <div className="text-[9px] text-slate-600 -mt-0.5 mb-0.5">{hint}</div>}
    </div>
  )
}

function ConsensusPanel({
  round,
  sealed,
  intervalMs,
  phaseRef,
}: {
  round: ReturnType<typeof nextRound> | null
  sealed: ReturnType<typeof sealedRound>
  intervalMs: number
  phaseRef: React.MutableRefObject<HTMLSpanElement | null>
}) {
  return (
    <div className="rounded-xl border border-slate-800 p-3 text-xs netmap-mono space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500 font-sans">Consensus round</span>
        <span ref={phaseRef} className="netmap-phase">
          waiting
        </span>
      </div>
      {round ? (
        <>
          <div className="text-[#E0DBCA]">
            #{round.height.toLocaleString()} · {round.need}-of-{round.voters.length}
          </div>
          <div className="text-slate-400">
            packer <span className="text-[#FFC060]">{round.packer || '—'}</span>
          </div>
          <div className="text-slate-400 leading-snug">
            voters{' '}
            {round.voters.map((v, i) => (
              <span key={v} className={v === round.packer ? 'text-[#FFC060]' : 'text-[#4ADE80]'}>
                {v}
                {i < round.voters.length - 1 ? ', ' : ''}
              </span>
            ))}
          </div>
          {sealed && (
            <div className="text-slate-500 leading-snug">
              tip #{sealed.height.toLocaleString()} sealed by {sealed.packer || '?'} · committee{' '}
              {sealed.voters.join(', ')}
            </div>
          )}
          <div className="text-[10px] pt-0.5" style={{ color: round.estimated ? '#D4922A' : '#64748B' }}>
            {round.estimated
              ? 'committee ESTIMATED (rotation over online seats; node does not expose it)'
              : 'committee + packer from node (next_committee, lottery_winner_next)'}
            {' · '}phase timing estimated, ~{(intervalMs / 1000).toFixed(1)}s / block
          </div>
        </>
      ) : (
        <div className="text-slate-500">Waiting for status…</div>
      )}
    </div>
  )
}

function Legend({ c, t, dot }: { c: string; t: string; dot?: boolean }) {
  return (
    <div className="flex items-center gap-2 text-slate-300">
      <span
        className={dot ? 'w-1.5 h-1.5 rounded-full shrink-0' : 'w-2.5 h-2.5 rounded-full shrink-0'}
        style={{ background: c, boxShadow: `0 0 8px ${c}` }}
      />
      <span>{t}</span>
    </div>
  )
}

function BlockTicker({ blocks }: { blocks: SealedBlock[] }) {
  return (
    <div className="absolute left-0 right-0 md:right-[340px] bottom-0 h-[76px] md:h-[86px] border-t border-slate-800 bg-[#0F172A]/95 flex items-center gap-2 px-3 overflow-x-auto">
      <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500 w-12 md:w-14 shrink-0 leading-tight">
        sealed blocks
      </div>
      {blocks.length === 0 && <div className="text-xs text-slate-600">Waiting for the next block…</div>}
      {blocks.slice(0, 24).map((b, i) => (
        <div
          key={b.height}
          className={`netmap-block shrink-0 rounded-lg border px-2 md:px-2.5 py-1 md:py-1.5 netmap-mono ${
            i === 0 ? 'border-[#D4922A] netmap-block-new' : 'border-slate-700'
          }`}
        >
          <div className="text-[11px] text-[#D4922A]">#{b.height.toLocaleString()}</div>
          <div className="text-[10px] text-slate-400">{b.packer ?? 'packer ?'}</div>
          <div className="text-[10px] text-slate-500">{b.txs == null ? '— tx' : `${b.txs} tx`}</div>
        </div>
      ))}
    </div>
  )
}

const CSS = `
.netmap-mono{font-family:var(--font-mono),'JetBrains Mono',monospace}
.netmap-phase{font-size:10px;padding:1px 8px;border-radius:999px;border:1px solid #334155;color:#94A3B8;text-transform:uppercase;letter-spacing:.12em}
.netmap-phase[data-p=vote],.netmap-phase[data-p=pulse]{border-color:#22C55E;color:#86EFAC}
.netmap-phase[data-p=seal]{border-color:#D4922A;color:#FFD08A}
.netmap-phase[data-p=beam]{border-color:#C07838;color:#E0B080}
.netmap-watch{font-family:var(--font-mono),'JetBrains Mono',monospace;font-size:10px;color:#E0DBCA;white-space:nowrap;padding:2px 8px;border-radius:999px;border:1px solid #D4922A88;background:#020617cc;user-select:none}
.netmap-watch-dot{display:inline-block;width:6px;height:6px;border-radius:999px;margin-right:6px;background:#475569}
.netmap-watch-dot[data-on]{background:#F5E7C8;box-shadow:0 0 8px #D4922A}
@keyframes netmap-toast{0%{opacity:0;transform:translate(-50%,-8px)}10%,85%{opacity:1;transform:translate(-50%,0)}100%{opacity:0}}
.netmap-toast{animation:netmap-toast 3.5s ease-out forwards}
@keyframes netmap-drop{0%{transform:translateY(-38px) scale(.9);opacity:0;box-shadow:0 0 0 #D4922A}40%{opacity:1;box-shadow:0 0 18px #D4922A}100%{transform:none;box-shadow:0 0 0 transparent}}
.netmap-block-new{animation:netmap-drop .7s ease-out}
.netmap-block{background:#020617;min-width:86px}
`
