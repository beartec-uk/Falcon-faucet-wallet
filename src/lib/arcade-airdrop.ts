// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
/**
 * Shared Arcade + Airdrop scoring and history aggregation.
 * Imported by BOTH the testnet activity tracker (tracker.ts) and the Arcade
 * leaderboard store/API (arcade-store.ts) so the board and airdrop agree.
 */

import { TRACKER_CONFIG } from '@/config/tracker'

export const ARCADE_HISTORY_DATES = {
  /** Earliest daily best-score row stored in arcade_scores (testnet). */
  scoresSince: '2026-07-20',
  /** Earliest Falcon PL account-linked and run-sum (progress/runs) row. */
  plAndRunSumSince: '2026-10-18',
} as const

export interface ArcadePlayRecord {
  account: string
  game: string
  day: string
  score: number
}

export interface ArcadeAirdropScoreResult {
  points: number
  rawPoints: number
  playDays: number
  gamesPlayed: number
  detail: string
}

/**
 * Exact Arcade category scoring function shared by the testnet airdrop
 * tracker (scoreAccount) and the Arcade All-Time / Overall Airdrop board.
 */
export function computeArcadeAirdropPoints(
  plays: readonly ArcadePlayRecord[],
  arcadeGames: number,
  opts: {
    sinceDay?: string
    cap?: number
    fullDays?: number
  } = {},
): ArcadeAirdropScoreResult {
  const cap = opts.cap ?? TRACKER_CONFIG.caps.arcade
  const fullDays = opts.fullDays ?? TRACKER_CONFIG.arcadeFullDays
  const filtered = plays.filter(
    (x) => x.score > 0 && (!opts.sinceDay || x.day >= opts.sinceDay),
  )
  const playDays = new Set(filtered.map((x) => x.day)).size
  const gamesPlayed = new Set(filtered.map((x) => x.game)).size
  const nGames = Math.max(1, arcadeGames)
  const rawPoints =
    cap *
    (0.6 * Math.min(1, playDays / fullDays) +
      0.4 * Math.min(1, gamesPlayed / nGames))
  const points = Math.round(rawPoints * 10) / 10
  return {
    points,
    rawPoints,
    playDays,
    gamesPlayed,
    detail: `${playDays} days played · ${gamesPlayed} games`,
  }
}

export interface ArcadeHistoryRow {
  network: string
  address: string
  plAccount: string | null
  game: string
  dayUtc: string
  score: number
  progress: number
  runs: number
  finalizedClaims: number
}

export interface AllTimeGameEntry {
  rank: number
  account: string
  plAccount: string | null
  game: string
  /** Sum of run-credit points since 2026-10-18 UTC: unspent progress + finalized claims * minScore. */
  earnedPoints: number
  /** Best single run across all stored days (since 2026-07-20 UTC). */
  bestScore: number
  /** Sum of daily best scores across distinct days. */
  sumDailyBest: number
  runs: number
  claims: number
  playDays: number
  lastPlayedDay: string
  /** True when all rows predate 2026-10-18 run-sum tracking (best single run only). */
  legacyOnly: boolean
}

export interface OverallAirdropEntry {
  rank: number
  account: string
  /** Exact 0..5 category score from computeArcadeAirdropPoints (matches /airdrop tracker). */
  airdropPoints: number
  airdropCap: number
  /** All-time sum of run-credit points across all 4 games (progress + claims * minScore). */
  earnedPoints: number
  /** Highest single run across all games. */
  bestScore: number
  /** Sum of best single run per game. */
  bestScoreSum: number
  /** Distinct UTC play days inside the 60-day airdrop window (score > 0). */
  playDays: number
  /** Distinct games played inside the 60-day airdrop window (score > 0). */
  gamesPlayed: number
  /** Distinct UTC play days across all stored history. */
  allTimePlayDays: number
  /** Distinct games played across all stored history. */
  allTimeGamesPlayed: number
  runs: number
  claims: number
  lastPlayedDay: string
}

export interface AirdropArcadeSummary {
  scoresSince: string
  plAndRunSumSince: string
  airdropWindowSince: string
  totalPlayers: number
  totalAirdropPoints: number
  totalEarnedPoints: number
  totalRuns: number
  totalClaims: number
  totalBestScoreSum: number
  activeTodayPlayers: number
}

export interface AggregatedArcadeHistory {
  byGame: Record<string, AllTimeGameEntry[]>
  overallEntries: OverallAirdropEntry[]
  airdropSummary: AirdropArcadeSummary
}

/**
 * Pure aggregation over stored arcade_scores + finalized arcade_claims rows.
 * Both the All-Time per-game board and the Overall Airdrop Total board derive
 * from this single function and computeArcadeAirdropPoints().
 */
export function aggregateArcadeHistory(
  rows: readonly ArcadeHistoryRow[],
  opts: {
    gameSlugs: readonly string[]
    minScore: number
    airdropWindowSince: string
    todayUtc: string
    limit?: number
  },
): AggregatedArcadeHistory {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25))

  // 1. Per-game aggregation (groups by plAccount when present so pre-Oct 18 09:49 r... rows merge with PL names).
  type GameAcc = {
    account: string
    plAccount: string | null
    game: string
    earnedPoints: number
    bestScore: number
    sumDailyBest: number
    runs: number
    claims: number
    days: Set<string>
    lastPlayedDay: string
    hasRunTracking: boolean
  }
  const gameBuckets = new Map<string, Map<string, GameAcc>>()
  for (const slug of opts.gameSlugs) gameBuckets.set(slug, new Map())

  const todayActivePlayers = new Set<string>()

  for (const r of rows) {
    const bucket = gameBuckets.get(r.game)
    if (!bucket) continue

    const identity = (r.plAccount?.trim() || r.address.trim()).toLowerCase()
    const displayAccount = r.plAccount?.trim() || r.address.trim()
    if (r.dayUtc === opts.todayUtc && r.score > 0) {
      todayActivePlayers.add(identity)
    }

    const rowHasRunTracking =
      r.runs > 0 ||
      r.progress > 0 ||
      r.plAccount !== null ||
      r.dayUtc >= ARCADE_HISTORY_DATES.plAndRunSumSince
    const rowEarned = rowHasRunTracking
      ? Math.floor(Math.max(0, r.progress)) +
        Math.max(0, r.finalizedClaims) * opts.minScore
      : 0

    let acc = bucket.get(identity)
    if (!acc) {
      acc = {
        account: displayAccount,
        plAccount: r.plAccount?.trim() || null,
        game: r.game,
        earnedPoints: 0,
        bestScore: 0,
        sumDailyBest: 0,
        runs: 0,
        claims: 0,
        days: new Set(),
        lastPlayedDay: r.dayUtc,
        hasRunTracking: false,
      }
      bucket.set(identity, acc)
    }

    if (r.plAccount?.trim() && !acc.plAccount) {
      acc.plAccount = r.plAccount.trim()
      acc.account = r.plAccount.trim()
    }
    acc.earnedPoints += rowEarned
    acc.bestScore = Math.max(acc.bestScore, Math.floor(Math.max(0, r.score)))
    acc.sumDailyBest += Math.floor(Math.max(0, r.score))
    acc.runs += Math.max(0, Math.floor(r.runs))
    acc.claims += Math.max(0, Math.floor(r.finalizedClaims))
    if (r.score > 0) acc.days.add(r.dayUtc)
    if (r.dayUtc > acc.lastPlayedDay) acc.lastPlayedDay = r.dayUtc
    if (rowHasRunTracking) acc.hasRunTracking = true
  }

  const byGame: Record<string, AllTimeGameEntry[]> = {}
  for (const [slug, bucket] of gameBuckets) {
    const list: AllTimeGameEntry[] = [...bucket.values()]
      .filter((a) => a.bestScore > 0 || a.earnedPoints > 0 || a.runs > 0 || a.claims > 0)
      .sort(
        (a, b) =>
          b.earnedPoints - a.earnedPoints ||
          b.bestScore - a.bestScore ||
          b.days.size - a.days.size ||
          a.account.localeCompare(b.account),
      )
      .slice(0, limit)
      .map((a, idx) => ({
        rank: idx + 1,
        account: a.account,
        plAccount: a.plAccount,
        game: a.game,
        earnedPoints: a.earnedPoints,
        bestScore: a.bestScore,
        sumDailyBest: a.sumDailyBest,
        runs: a.runs,
        claims: a.claims,
        playDays: a.days.size,
        lastPlayedDay: a.lastPlayedDay,
        legacyOnly: !a.hasRunTracking,
      }))
    byGame[slug] = list
  }

  // 2. Overall Airdrop aggregation (pl_account IS NOT NULL — exact match to arcadeDaysByPlAccount + tracker.ts).
  type PlAcc = {
    account: string
    plays: ArcadePlayRecord[]
    earnedPoints: number
    bestByGame: Map<string, number>
    runs: number
    claims: number
    lastPlayedDay: string
  }
  const plBuckets = new Map<string, PlAcc>()

  // First collapse to MAX(score) per (plAccount, game, dayUtc), mirroring arcadeDaysByPlAccount GROUP BY.
  const dayGameMax = new Map<string, number>()
  for (const r of rows) {
    const pl = r.plAccount?.trim()
    if (!pl) continue
    const k = `${pl}|${r.game}|${r.dayUtc}`
    dayGameMax.set(k, Math.max(dayGameMax.get(k) ?? 0, Math.floor(Math.max(0, r.score))))

    let acc = plBuckets.get(pl)
    if (!acc) {
      acc = {
        account: pl,
        plays: [],
        earnedPoints: 0,
        bestByGame: new Map(),
        runs: 0,
        claims: 0,
        lastPlayedDay: r.dayUtc,
      }
      plBuckets.set(pl, acc)
    }

    acc.earnedPoints +=
      Math.floor(Math.max(0, r.progress)) +
      Math.max(0, r.finalizedClaims) * opts.minScore
    acc.bestByGame.set(
      r.game,
      Math.max(acc.bestByGame.get(r.game) ?? 0, Math.floor(Math.max(0, r.score))),
    )
    acc.runs += Math.max(0, Math.floor(r.runs))
    acc.claims += Math.max(0, Math.floor(r.finalizedClaims))
    if (r.dayUtc > acc.lastPlayedDay) acc.lastPlayedDay = r.dayUtc
  }

  for (const [k, maxScore] of dayGameMax) {
    const [pl, game, day] = k.split('|')
    const acc = plBuckets.get(pl)
    if (acc) acc.plays.push({ account: pl, game, day, score: maxScore })
  }

  const allOverall: OverallAirdropEntry[] = [...plBuckets.values()]
    .map((acc) => {
      const windowEval = computeArcadeAirdropPoints(
        acc.plays,
        opts.gameSlugs.length,
        {
          sinceDay: opts.airdropWindowSince,
          cap: TRACKER_CONFIG.caps.arcade,
          fullDays: TRACKER_CONFIG.arcadeFullDays,
        },
      )
      const allTimeEval = computeArcadeAirdropPoints(
        acc.plays,
        opts.gameSlugs.length,
        {
          cap: TRACKER_CONFIG.caps.arcade,
          fullDays: TRACKER_CONFIG.arcadeFullDays,
        },
      )
      let bestScore = 0
      let bestScoreSum = 0
      for (const s of acc.bestByGame.values()) {
        bestScore = Math.max(bestScore, s)
        bestScoreSum += s
      }
      return {
        rank: 0,
        account: acc.account,
        airdropPoints: windowEval.points,
        airdropCap: TRACKER_CONFIG.caps.arcade,
        earnedPoints: acc.earnedPoints,
        bestScore,
        bestScoreSum,
        playDays: windowEval.playDays,
        gamesPlayed: windowEval.gamesPlayed,
        allTimePlayDays: allTimeEval.playDays,
        allTimeGamesPlayed: allTimeEval.gamesPlayed,
        runs: acc.runs,
        claims: acc.claims,
        lastPlayedDay: acc.lastPlayedDay,
      }
    })
    .sort(
      (a, b) =>
        b.airdropPoints - a.airdropPoints ||
        b.earnedPoints - a.earnedPoints ||
        b.playDays - a.playDays ||
        a.account.localeCompare(b.account),
    )

  const totalPlayers = allOverall.length
  const totalAirdropPoints =
    Math.round(allOverall.reduce((s, e) => s + e.airdropPoints, 0) * 10) / 10
  const totalEarnedPoints = allOverall.reduce((s, e) => s + e.earnedPoints, 0)
  const totalRuns = allOverall.reduce((s, e) => s + e.runs, 0)
  const totalClaims = allOverall.reduce((s, e) => s + e.claims, 0)
  const totalBestScoreSum = allOverall.reduce((s, e) => s + e.bestScoreSum, 0)

  const overallEntries = allOverall
    .slice(0, limit)
    .map((e, idx) => ({ ...e, rank: idx + 1 }))

  return {
    byGame,
    overallEntries,
    airdropSummary: {
      scoresSince: ARCADE_HISTORY_DATES.scoresSince,
      plAndRunSumSince: ARCADE_HISTORY_DATES.plAndRunSumSince,
      airdropWindowSince: opts.airdropWindowSince,
      totalPlayers,
      totalAirdropPoints,
      totalEarnedPoints,
      totalRuns,
      totalClaims,
      totalBestScoreSum,
      activeTodayPlayers: todayActivePlayers.size,
    },
  }
}
