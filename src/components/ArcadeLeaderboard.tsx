// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type {
  AirdropArcadeSummary,
  AllTimeGameEntry,
  OverallAirdropEntry,
} from '@/lib/arcade-airdrop'

const GAMES = [
  { slug: 'falcon-flight', label: 'Flight' },
  { slug: 'ledger-runner', label: 'Run' },
  { slug: 'epoch-rise', label: 'Rise' },
  { slug: 'amendment-apocalypse', label: 'Shoot' },
] as const

type GameTab = 'overall' | (typeof GAMES)[number]['slug']
type PeriodTab = 'daily' | 'all'

const ARCADE_NETWORK = 'testnet' as const

interface DailyEntry {
  rank: number
  address: string
  game: string
  score: number
  updatedAt?: string
}

interface LeaderboardApiResponse {
  network: string
  period?: PeriodTab
  game: string
  dayUtc: string
  historyDates?: {
    scoresSince: string
    plAndRunSumSince: string
    lifetimeTotalSince?: string
    lifetimeTotalSinceIso?: string
  }
  airdropSummary?: AirdropArcadeSummary
  overallEntries?: OverallAirdropEntry[]
  byGame?: Record<string, AllTimeGameEntry[]>
  entries: DailyEntry[] | AllTimeGameEntry[] | OverallAirdropEntry[]
}

function gameLabel(slug: string): string {
  return GAMES.find((g) => g.slug === slug)?.label ?? slug
}

function formatAccount(addr: string): string {
  if (addr.length <= 20) return addr
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`
}

export default function ArcadeLeaderboard() {
  const [period, setPeriod] = useState<PeriodTab>('all')
  const [tab, setTab] = useState<GameTab>('overall')
  const [dailyEntries, setDailyEntries] = useState<DailyEntry[]>([])
  const [allTimeData, setAllTimeData] = useState<LeaderboardApiResponse | null>(
    null,
  )
  const [dayUtc, setDayUtc] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (period === 'all') {
        const q = new URLSearchParams({
          network: ARCADE_NETWORK,
          period: 'all',
          limit: '50',
        })
        const r = await fetch(`/api/arcade/leaderboard?${q}`, {
          cache: 'no-store',
        })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = (await r.json()) as LeaderboardApiResponse
        setAllTimeData(data)
        setDayUtc(data.dayUtc ?? '')
      } else {
        const q = new URLSearchParams({
          network: ARCADE_NETWORK,
          period: 'daily',
          limit: '25',
        })
        if (tab !== 'overall') q.set('game', tab)
        const r = await fetch(`/api/arcade/leaderboard?${q}`, {
          cache: 'no-store',
        })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = (await r.json()) as LeaderboardApiResponse
        setDailyEntries((data.entries as DailyEntry[]) ?? [])
        setDayUtc(data.dayUtc ?? '')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load leaderboard')
    } finally {
      setLoading(false)
    }
  }, [period, tab])

  useEffect(() => {
    void load()
    const id = window.setInterval(load, 30_000)
    return () => window.clearInterval(id)
  }, [load])

  const summary = allTimeData?.airdropSummary
  const overallEntries = allTimeData?.overallEntries ?? []
  const gameEntries =
    tab !== 'overall' ? (allTimeData?.byGame?.[tab] ?? []) : []

  const scoresSince =
    allTimeData?.historyDates?.scoresSince ??
    summary?.scoresSince ??
    '2026-07-20'
  const plSince =
    allTimeData?.historyDates?.plAndRunSumSince ??
    summary?.plAndRunSumSince ??
    '2026-10-18'

  return (
    <section
      id="leaderboard"
      aria-labelledby="arcade-leaderboard-heading"
      className="scroll-mt-4 w-full max-w-5xl mx-auto px-3 sm:px-6 py-6 sm:py-10 space-y-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-widest text-brand-400">
            Falcon testnet · Testnet Arcade
          </div>
          <h2
            id="arcade-leaderboard-heading"
            className="text-xl sm:text-2xl font-bold text-white mt-0.5"
          >
            Arcade Leaderboard
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            {period === 'daily'
              ? `Best single run today (UTC${dayUtc ? ` · ${dayUtc}` : ''})`
              : 'All-time scores per game & overall airdrop totals'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800/90 text-slate-200 hover:bg-slate-700 border border-slate-700/70 transition-colors"
          >
            Refresh
          </button>
          <a
            href="#arcade-top"
            onClick={(e) => {
              e.preventDefault()
              window.scrollTo({ top: 0, behavior: 'smooth' })
            }}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800/90 text-slate-200 hover:bg-slate-700 border border-slate-700/70 transition-colors"
          >
            ↑ Play
          </a>
          <Link
            href="/airdrop"
            className="text-xs px-2.5 py-1.5 rounded-lg bg-brand-500/15 text-brand-300 hover:bg-brand-500/25 border border-brand-500/30 font-medium transition-colors"
          >
            Airdrop Hub →
          </Link>
        </div>
      </div>

      {/* Period Toggle (Daily vs All-Time) + Game Tabs */}
      <div className="card p-3 sm:p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div
            role="tablist"
            aria-label="Leaderboard timeframe"
            className="inline-flex p-1 rounded-xl bg-slate-950 border border-slate-800 self-start"
          >
            <button
              type="button"
              role="tab"
              aria-selected={period === 'daily'}
              data-testid="lb-period-daily"
              onClick={() => setPeriod('daily')}
              className={`px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
                period === 'daily'
                  ? 'bg-brand-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Daily (UTC)
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={period === 'all'}
              data-testid="lb-period-all"
              onClick={() => setPeriod('all')}
              className={`px-3.5 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
                period === 'all'
                  ? 'bg-brand-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              All-time
            </button>
          </div>

          <div
            role="tablist"
            aria-label="Leaderboard game filter"
            className="flex flex-wrap gap-1.5"
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'overall'}
              data-testid="lb-game-overall"
              onClick={() => setTab('overall')}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium border transition-colors ${
                tab === 'overall'
                  ? 'bg-brand-500/20 text-brand-300 border-brand-500/40'
                  : 'bg-slate-800/70 text-slate-400 border-slate-700/60 hover:text-white'
              }`}
            >
              {period === 'all' ? 'Overall (Airdrop)' : 'All Games'}
            </button>
            {GAMES.map((g) => (
              <button
                key={g.slug}
                type="button"
                role="tab"
                aria-selected={tab === g.slug}
                data-testid={`lb-game-${g.slug}`}
                onClick={() => setTab(g.slug)}
                className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium border transition-colors ${
                  tab === g.slug
                    ? 'bg-brand-500/20 text-brand-300 border-brand-500/40'
                    : 'bg-slate-800/70 text-slate-400 border-slate-700/60 hover:text-white'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        {/* Overall Airdrop Total Summary Cards (All-time mode) */}
        {period === 'all' && summary && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-2 border-t border-slate-800/80">
            <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 px-3 py-2.5">
              <div className="text-[11px] text-slate-500">Airdrop Players</div>
              <div className="text-base sm:text-lg font-mono font-semibold text-white tabular-nums">
                {summary.totalPlayers.toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-500">PL-linked accounts</div>
            </div>
            <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 px-3 py-2.5">
              <div className="text-[11px] text-slate-500">Airdrop Arcade Pts</div>
              <div className="text-base sm:text-lg font-mono font-semibold text-brand-400 tabular-nums">
                {summary.totalAirdropPoints.toLocaleString('en-US', {
                  maximumFractionDigits: 1,
                })}
              </div>
              <div className="text-[10px] text-slate-500">
                Max 5.0 / player (60d)
              </div>
            </div>
            <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 px-3 py-2.5">
              <div className="text-[11px] text-slate-500">Earned Run Pts</div>
              <div className="text-base sm:text-lg font-mono font-semibold text-emerald-400 tabular-nums">
                {summary.totalEarnedPoints.toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-500">
                Since {plSince} UTC
              </div>
            </div>
            <div className="rounded-xl bg-slate-950/70 border border-slate-800/80 px-3 py-2.5">
              <div className="text-[11px] text-slate-500">Lifetime Total</div>
              <div className="text-base sm:text-lg font-mono font-semibold text-sky-300 tabular-nums">
                {(summary.totalLifetimeScore ?? 0).toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-500">
                Tracked since 25 Nov 2026
              </div>
            </div>
            <div className="col-span-2 sm:col-span-1 rounded-xl bg-slate-950/70 border border-slate-800/80 px-3 py-2.5">
              <div className="text-[11px] text-slate-500">Runs · Claims</div>
              <div className="text-base sm:text-lg font-mono font-semibold text-slate-200 tabular-nums">
                {summary.totalRuns.toLocaleString()} ·{' '}
                {summary.totalClaims.toLocaleString()}
              </div>
              <div className="text-[10px] text-slate-500">
                {summary.activeTodayPlayers} active today
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Board Body */}
      <div className="card overflow-hidden">
        {loading && !allTimeData && period === 'all' ? (
          <p className="p-6 text-slate-400 text-sm">Loading leaderboard…</p>
        ) : error ? (
          <div className="p-6 text-sm text-red-400">{error}</div>
        ) : period === 'daily' ? (
          dailyEntries.length === 0 ? (
            <div className="p-6 space-y-2">
              <p className="text-slate-300 text-sm">
                No scores yet today ({dayUtc || 'UTC'}). Play a game above to
                post today&apos;s first run!
              </p>
              <button
                type="button"
                onClick={() => setPeriod('all')}
                className="text-xs font-medium text-brand-400 hover:underline"
              >
                View All-time &amp; Airdrop Totals →
              </button>
            </div>
          ) : (
            <ol className="divide-y divide-slate-800/80">
              {dailyEntries.map((e) => (
                <li
                  key={`${e.rank}-${e.address}-${e.game}`}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-slate-500 font-mono text-xs sm:text-sm w-6 shrink-0">
                      #{e.rank}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-xs sm:text-sm text-slate-200 truncate">
                          {formatAccount(e.address)}
                        </span>
                        {tab === 'overall' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 shrink-0">
                            {gameLabel(e.game)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-mono font-semibold text-sm sm:text-base text-brand-400 tabular-nums">
                      {Math.floor(e.score).toLocaleString()}
                    </div>
                    <div className="text-[10px] text-slate-500">best today</div>
                  </div>
                </li>
              ))}
            </ol>
          )
        ) : tab === 'overall' ? (
          overallEntries.length === 0 ? (
            <p className="p-6 text-slate-400 text-sm">
              No Falcon PL-linked arcade scores recorded yet.
            </p>
          ) : (
            <div>
              <div className="hidden sm:grid sm:grid-cols-12 gap-2 px-4 py-2.5 text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-800/80 bg-slate-950/50">
                <div className="col-span-3">Player (PL Account)</div>
                <div className="col-span-2 text-right">Airdrop Pts</div>
                <div className="col-span-2 text-right">Earned Run Pts</div>
                <div className="col-span-2 text-right">
                  Lifetime Total
                  <div className="text-[9px] font-normal normal-case tracking-normal text-slate-400">
                    since 25 Nov 2026
                  </div>
                </div>
                <div className="col-span-1 text-right">Best</div>
                <div className="col-span-2 text-right">Days · Games</div>
              </div>
              <ol className="divide-y divide-slate-800/80">
                {overallEntries.map((e) => (
                  <li
                    key={e.account}
                    className="px-4 py-3 hover:bg-slate-800/30 transition-colors"
                  >
                    <div className="sm:grid sm:grid-cols-12 sm:items-center sm:gap-2 space-y-1.5 sm:space-y-0">
                      <div className="sm:col-span-3 flex items-center justify-between sm:justify-start gap-2.5 min-w-0">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-slate-500 font-mono text-xs sm:text-sm w-6 shrink-0">
                            #{e.rank}
                          </span>
                          <Link
                            href={`/scan/account/${encodeURIComponent(e.account)}`}
                            className="font-mono text-xs sm:text-sm text-slate-100 hover:text-brand-300 truncate"
                          >
                            {e.account}
                          </Link>
                        </div>
                        <span className="sm:hidden font-mono text-sm font-semibold text-brand-400 tabular-nums shrink-0">
                          {e.airdropPoints.toFixed(1)} / {e.airdropCap}
                        </span>
                      </div>

                      <div className="hidden sm:block sm:col-span-2 text-right font-mono text-sm font-semibold text-brand-400 tabular-nums">
                        {e.airdropPoints.toFixed(1)}{' '}
                        <span className="text-xs text-slate-500 font-normal">
                          / {e.airdropCap}
                        </span>
                      </div>

                      <div className="hidden sm:block sm:col-span-2 text-right font-mono text-sm text-emerald-400 tabular-nums">
                        {e.earnedPoints.toLocaleString()}
                      </div>

                      <div className="hidden sm:block sm:col-span-2 text-right font-mono text-sm text-sky-300 tabular-nums">
                        {(e.lifetimeTotal ?? 0).toLocaleString()}
                      </div>

                      <div className="hidden sm:block sm:col-span-1 text-right font-mono text-sm text-slate-200 tabular-nums">
                        {e.bestScore.toLocaleString()}
                      </div>

                      <div className="hidden sm:block sm:col-span-2 text-right font-mono text-xs text-slate-300 tabular-nums">
                        {e.playDays}d · {e.gamesPlayed}/4 · {e.claims}c
                      </div>

                      {/* Mobile compact stats line */}
                      <div className="sm:hidden flex flex-wrap items-center gap-x-3 gap-y-1 pl-8 text-[11px] text-slate-400 font-mono tabular-nums">
                        <span className="text-emerald-400">
                          Earned {e.earnedPoints.toLocaleString()}
                        </span>
                        <span className="text-sky-300">
                          Lifetime {(e.lifetimeTotal ?? 0).toLocaleString()} (since 25 Nov 2026)
                        </span>
                        <span>Best {e.bestScore.toLocaleString()}</span>
                        <span>
                          {e.playDays}d · {e.gamesPlayed}/4 games
                        </span>
                        <span>
                          {e.runs}r · {e.claims}c
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          )
        ) : gameEntries.length === 0 ? (
          <p className="p-6 text-slate-400 text-sm">
            No all-time scores yet for {gameLabel(tab)}.
          </p>
        ) : (
          <div>
            <div className="hidden sm:grid sm:grid-cols-12 gap-2 px-4 py-2.5 text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-800/80 bg-slate-950/50">
              <div className="col-span-4">Player</div>
              <div className="col-span-2 text-right">Earned Run Pts</div>
              <div className="col-span-2 text-right">
                Lifetime Total
                <div className="text-[9px] font-normal normal-case tracking-normal text-slate-400">
                  since 25 Nov 2026
                </div>
              </div>
              <div className="col-span-2 text-right">Best Run</div>
              <div className="col-span-2 text-right">Days · Runs · Claims</div>
            </div>
            <ol className="divide-y divide-slate-800/80">
              {gameEntries.map((e) => (
                <li
                  key={`${e.game}-${e.rank}-${e.account}`}
                  className="px-4 py-3 hover:bg-slate-800/30 transition-colors"
                >
                  <div className="sm:grid sm:grid-cols-12 sm:items-center sm:gap-2 space-y-1.5 sm:space-y-0">
                    <div className="sm:col-span-4 flex items-center justify-between sm:justify-start gap-2 min-w-0">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-slate-500 font-mono text-xs sm:text-sm w-6 shrink-0">
                          #{e.rank}
                        </span>
                        {e.plAccount ? (
                          <Link
                            href={`/scan/account/${encodeURIComponent(e.plAccount)}`}
                            className="font-mono text-xs sm:text-sm text-slate-100 hover:text-brand-300 truncate"
                          >
                            {e.account}
                          </Link>
                        ) : (
                          <span className="font-mono text-xs sm:text-sm text-slate-300 truncate">
                            {formatAccount(e.account)}
                          </span>
                        )}
                        {e.legacyOnly && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 shrink-0">
                            Pre-Oct 18
                          </span>
                        )}
                      </div>
                      <span className="sm:hidden font-mono text-sm font-semibold text-emerald-400 tabular-nums shrink-0">
                        {e.legacyOnly
                          ? `Best ${e.bestScore.toLocaleString()}`
                          : `${e.earnedPoints.toLocaleString()} pts`}
                      </span>
                    </div>

                    <div className="hidden sm:block sm:col-span-2 text-right font-mono text-sm font-semibold text-emerald-400 tabular-nums">
                      {e.legacyOnly ? '—' : e.earnedPoints.toLocaleString()}
                    </div>

                    <div className="hidden sm:block sm:col-span-2 text-right font-mono text-sm text-sky-300 tabular-nums">
                      {e.legacyOnly && (e.lifetimeTotal ?? 0) === 0
                        ? '—'
                        : (e.lifetimeTotal ?? 0).toLocaleString()}
                    </div>

                    <div className="hidden sm:block sm:col-span-2 text-right font-mono text-sm text-brand-400 tabular-nums">
                      {e.bestScore.toLocaleString()}
                    </div>

                    <div className="hidden sm:block sm:col-span-2 text-right font-mono text-xs text-slate-300 tabular-nums">
                      {e.playDays}d · {e.runs}r · {e.claims}c
                    </div>

                    {/* Mobile compact stats line */}
                    <div className="sm:hidden flex flex-wrap items-center gap-x-3 gap-y-1 pl-8 text-[11px] text-slate-400 font-mono tabular-nums">
                      {!e.legacyOnly && (
                        <>
                          <span className="text-sky-300">
                            Lifetime {(e.lifetimeTotal ?? 0).toLocaleString()} (since 25 Nov 2026)
                          </span>
                          <span>Best {e.bestScore.toLocaleString()}</span>
                        </>
                      )}
                      <span>{e.playDays} {e.playDays === 1 ? 'day' : 'days'}</span>
                      <span>{e.runs} {e.runs === 1 ? 'run' : 'runs'}</span>
                      <span>{e.claims} {e.claims === 1 ? 'claim' : 'claims'}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* History start dates & source explanation */}
      <div className="rounded-xl border border-slate-800/80 bg-slate-900/50 px-4 py-3 text-[11px] sm:text-xs text-slate-400 leading-relaxed space-y-1">
        <p>
          <span className="text-slate-200 font-medium">History &amp; Airdrop Source:</span>{' '}
          Daily best single-run scores are stored from{' '}
          <span className="font-mono text-slate-300">{scoresSince} UTC</span>.
          Falcon PL account linking and accumulated run-sum tracking (
          <span className="font-mono text-slate-300">
            progress + 500 × claims
          </span>
          ) started{' '}
          <span className="font-mono text-slate-300">{plSince} UTC</span>;
          earlier legacy <span className="font-mono">r…</span> rows retain
          best-run scores only.{' '}
          <span className="text-sky-300 font-medium">
            Lifetime total — tracked since 25 Nov 2026
          </span>{' '}
          (<span className="font-mono text-slate-300">2026-11-25 04:39 UTC</span>)
          accumulates uncapped run scores separately from the 500/run claim cap.
        </p>
        <p>
          Overall Airdrop scores (0–5 pts) use the same{' '}
          <span className="font-mono text-slate-300">arcade_scores</span>{' '}
          source and 60-day scoring rule as the{' '}
          <Link href="/airdrop" className="text-brand-400 hover:underline">
            /airdrop Wallet Activity board
          </Link>
          . Game Faucet claim payouts (2,000 FPL per 500 pts) are unchanged.
        </p>
      </div>
    </section>
  )
}
