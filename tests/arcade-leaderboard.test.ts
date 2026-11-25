// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TRACKER_CONFIG } from '@/config/tracker'
import {
  ARCADE_HISTORY_DATES,
  aggregateArcadeHistory,
  computeArcadeAirdropPoints,
  type ArcadeHistoryRow,
} from '@/lib/arcade-airdrop'
import { GAME_FAUCET_MIN_SCORE, GAME_SLUGS } from '@/lib/arcade-store'
import { scoreAccount, windowStart, type ArcadeDay, type TrackerInput } from '@/lib/tracker'

const ROOT = join(__dirname, '..')
const NOW = Date.parse('2026-11-25T03:00:00Z')
const SINCE = windowStart(NOW)

function makeTrackerInput(arcade: ArcadeDay[]): TrackerInput {
  return {
    st: { validators: [], watcher_slots: {}, watcher_work: {}, defi_markets: [] },
    activity: [],
    events: [],
    days: [],
    faucet: [],
    links: [],
    swaps: [],
    arcade,
    arcadeGames: GAME_SLUGS.length,
    feedback: [],
    now: NOW,
  }
}

describe('arcade leaderboard <-> airdrop computation parity', () => {
  it('produces identical airdrop points, playDays, and gamesPlayed as scoreAccount()', () => {
    const history: ArcadeHistoryRow[] = [
      // scott.reynolds.123: 7 distinct days across all 4 games inside 60d window -> max 5.0 pts
      { network: 'testnet', address: 'rJXDhsra8tv1ZoGtQRL1wrRfVDUNtGQaya', plAccount: 'scott.reynolds.123', game: 'amendment-apocalypse', dayUtc: '2026-10-18', score: 173, progress: 225, runs: 2, finalizedClaims: 0 },
      { network: 'testnet', address: 'scott.reynolds.123', plAccount: 'scott.reynolds.123', game: 'falcon-flight', dayUtc: '2026-10-18', score: 516, progress: 300, runs: 5, finalizedClaims: 1 },
      { network: 'testnet', address: 'scott.reynolds.123', plAccount: 'scott.reynolds.123', game: 'ledger-runner', dayUtc: '2026-10-18', score: 992, progress: 400, runs: 4, finalizedClaims: 1 },
      { network: 'testnet', address: 'scott.reynolds.123', plAccount: 'scott.reynolds.123', game: 'amendment-apocalypse', dayUtc: '2026-10-19', score: 1197, progress: 500, runs: 2, finalizedClaims: 0 },
      { network: 'testnet', address: 'scott.reynolds.123', plAccount: 'scott.reynolds.123', game: 'epoch-rise', dayUtc: '2026-10-19', score: 393, progress: 393, runs: 2, finalizedClaims: 0 },
      { network: 'testnet', address: 'scott.reynolds.123', plAccount: 'scott.reynolds.123', game: 'ledger-runner', dayUtc: '2026-10-20', score: 14, progress: 14, runs: 1, finalizedClaims: 0 },
      { network: 'testnet', address: 'scott.reynolds.123', plAccount: 'scott.reynolds.123', game: 'falcon-flight', dayUtc: '2026-10-28', score: 260, progress: 260, runs: 2, finalizedClaims: 0 },
      { network: 'testnet', address: 'scott.reynolds.123', plAccount: 'scott.reynolds.123', game: 'epoch-rise', dayUtc: '2026-11-01', score: 282, progress: 282, runs: 1, finalizedClaims: 0 },
      { network: 'testnet', address: 'scott.reynolds.123', plAccount: 'scott.reynolds.123', game: 'epoch-rise', dayUtc: '2026-11-03', score: 117, progress: 117, runs: 1, finalizedClaims: 0 },
      { network: 'testnet', address: 'scott.reynolds.123', plAccount: 'scott.reynolds.123', game: 'epoch-rise', dayUtc: '2026-11-25', score: 650, progress: 408, runs: 2, finalizedClaims: 1 },
      // Zero-score row must NOT count toward active play days
      { network: 'testnet', address: 'scott.reynolds.123', plAccount: 'scott.reynolds.123', game: 'epoch-rise', dayUtc: '2026-11-24', score: 0, progress: 0, runs: 1, finalizedClaims: 0 },
      // nodesafe: 2 distinct days, 4 games
      { network: 'testnet', address: 'nodesafe', plAccount: 'nodesafe', game: 'falcon-flight', dayUtc: '2026-10-21', score: 264, progress: 600, runs: 8, finalizedClaims: 0 },
      { network: 'testnet', address: 'nodesafe', plAccount: 'nodesafe', game: 'ledger-runner', dayUtc: '2026-10-21', score: 346, progress: 790, runs: 10, finalizedClaims: 0 },
      { network: 'testnet', address: 'nodesafe', plAccount: 'nodesafe', game: 'epoch-rise', dayUtc: '2026-10-21', score: 280, progress: 607, runs: 4, finalizedClaims: 0 },
      { network: 'testnet', address: 'nodesafe', plAccount: 'nodesafe', game: 'amendment-apocalypse', dayUtc: '2026-10-21', score: 55, progress: 55, runs: 2, finalizedClaims: 0 },
      { network: 'testnet', address: 'nodesafe', plAccount: 'nodesafe', game: 'falcon-flight', dayUtc: '2026-10-22', score: 138, progress: 504, runs: 8, finalizedClaims: 0 },
      // Old pre-window PL row (should be excluded from 60d airdropPoints, included in allTimePlayDays)
      { network: 'testnet', address: 'djhoex', plAccount: 'djhoex', game: 'falcon-flight', dayUtc: '2026-08-01', score: 100, progress: 0, runs: 0, finalizedClaims: 0 },
      { network: 'testnet', address: 'djhoex', plAccount: 'djhoex', game: 'ledger-runner', dayUtc: '2026-10-19', score: 416, progress: 844, runs: 3, finalizedClaims: 0 },
      // Legacy pre-Oct 18 r... row without plAccount (excluded from PL airdrop board, preserved in game board)
      { network: 'testnet', address: 'r9UxFwYfFJwhVHHGaCLUVrpTQsaXCqiBkK', plAccount: null, game: 'ledger-runner', dayUtc: '2026-07-20', score: 2150, progress: 0, runs: 0, finalizedClaims: 2 },
    ]

    const board = aggregateArcadeHistory(history, {
      gameSlugs: GAME_SLUGS,
      minScore: GAME_FAUCET_MIN_SCORE,
      airdropWindowSince: SINCE,
      todayUtc: '2026-11-25',
    })

    // Build exact ArcadeDay[] feed mirroring arcadeDaysByPlAccount('testnet', SINCE)
    const trackerArcadeDays: ArcadeDay[] = history
      .filter((r) => r.plAccount !== null && r.dayUtc >= SINCE)
      .map((r) => ({
        account: r.plAccount!,
        game: r.game,
        day: r.dayUtc,
        score: r.score,
      }))
    const inp = makeTrackerInput(trackerArcadeDays)

    for (const entry of board.overallEntries) {
      const trackerRow = scoreAccount(entry.account, inp)
      expect(entry.airdropPoints).toBe(trackerRow.categories.arcade.points)
      expect(entry.airdropCap).toBe(TRACKER_CONFIG.caps.arcade)
      expect(trackerRow.categories.arcade.detail).toBe(
        `${entry.playDays} days played · ${entry.gamesPlayed} games`,
      )
    }

    // Verify expected exact scores
    const scott = board.overallEntries.find((e) => e.account === 'scott.reynolds.123')!
    expect(scott.airdropPoints).toBe(5)
    expect(scott.playDays).toBe(7)
    expect(scott.gamesPlayed).toBe(4)
    expect(scott.earnedPoints).toBe(225 + 800 + 900 + 500 + 393 + 14 + 260 + 282 + 117 + 908)

    const djhoex = board.overallEntries.find((e) => e.account === 'djhoex')!
    expect(djhoex.playDays).toBe(1) // 2026-08-01 outside 60d window
    expect(djhoex.allTimePlayDays).toBe(2)

    // Summary totals equal sum of player entries
    const sumAirdrop =
      Math.round(board.overallEntries.reduce((s, e) => s + e.airdropPoints, 0) * 10) / 10
    const sumEarned = board.overallEntries.reduce((s, e) => s + e.earnedPoints, 0)
    expect(board.airdropSummary.totalAirdropPoints).toBe(sumAirdrop)
    expect(board.airdropSummary.totalEarnedPoints).toBe(sumEarned)
    expect(board.airdropSummary.scoresSince).toBe(ARCADE_HISTORY_DATES.scoresSince)
    expect(board.airdropSummary.plAndRunSumSince).toBe(ARCADE_HISTORY_DATES.plAndRunSumSince)

    // Legacy r... row is marked legacyOnly with earnedPoints = 0 on per-game board
    const runnerLegacy = board.byGame['ledger-runner'].find(
      (e) => e.account === 'r9UxFwYfFJwhVHHGaCLUVrpTQsaXCqiBkK',
    )!
    expect(runnerLegacy.legacyOnly).toBe(true)
    expect(runnerLegacy.earnedPoints).toBe(0)
    expect(runnerLegacy.bestScore).toBe(2150)

    // computeArcadeAirdropPoints matches direct formula
    expect(
      computeArcadeAirdropPoints(
        [{ account: 'x', game: 'falcon-flight', day: '2026-11-25', score: 10 }],
        4,
      ).points,
    ).toBe(0.9)
  })
})

describe('store + API /api/arcade/leaderboard daily vs all-time', () => {
  beforeEach(() => {
    vi.resetModules()
    delete process.env.DATABASE_URL
    delete process.env.POSTGRES_URL
  })

  it('matches claims progress + consumed claims in all-time totals and serves daily + all-time API payloads', async () => {
    const store = await import('@/lib/arcade-store')
    const { NextRequest } = await import('next/server')
    const { GET } = await import('@/app/api/arcade/leaderboard/route')

    // Two runs in falcon-flight + 1 claim (consumes 500) + 1 run in epoch-rise
    await store.upsertArcadeScore({
      network: 'testnet',
      address: 'scott.reynolds.123',
      plAccount: 'scott.reynolds.123',
      game: 'falcon-flight',
      score: 480,
      runId: 'run-1',
    })
    await store.upsertArcadeScore({
      network: 'testnet',
      address: 'scott.reynolds.123',
      plAccount: 'scott.reynolds.123',
      game: 'falcon-flight',
      score: 210,
      runId: 'run-2',
    })
    const spent = await store.consumeClaimProgress({
      network: 'testnet',
      address: 'scott.reynolds.123',
      game: 'falcon-flight',
    })
    expect(spent).toEqual({ ok: true, progress: 190 })
    await store.logGameClaim({
      network: 'testnet',
      address: 'scott.reynolds.123',
      game: 'falcon-flight',
      scoreAtClaim: 690,
      amountQxrp: 2000,
      txHash: 'TX_DEMO_1',
    })

    await store.upsertArcadeScore({
      network: 'testnet',
      address: 'scott.reynolds.123',
      plAccount: 'scott.reynolds.123',
      game: 'epoch-rise',
      score: 350,
      runId: 'run-3',
    })

    // Daily API (backwards compatible)
    const dailyRes = await GET(
      new NextRequest('http://localhost/api/arcade/leaderboard?network=testnet&game=falcon-flight'),
    )
    const dailyJson = await dailyRes.json()
    expect(dailyRes.status).toBe(200)
    expect(dailyJson.period).toBe('daily')
    expect(dailyJson.entries[0].score).toBe(480) // best single run today

    // All-time API (Overall Airdrop + per-game earned run sums)
    const allRes = await GET(
      new NextRequest('http://localhost/api/arcade/leaderboard?network=testnet&period=all&game=overall'),
    )
    const allJson = await allRes.json()
    expect(allRes.status).toBe(200)
    expect(allJson.period).toBe('all')
    expect(allJson.overallEntries[0].account).toBe('scott.reynolds.123')
    // 190 remaining progress + 500 claimed in falcon-flight + 350 in epoch-rise = 1040
    expect(allJson.overallEntries[0].earnedPoints).toBe(1040)
    expect(allJson.overallEntries[0].claims).toBe(1)
    expect(allJson.byGame['falcon-flight'][0].earnedPoints).toBe(690)
    expect(allJson.byGame['falcon-flight'][0].bestScore).toBe(480)
  })
})

describe('unified /arcade#leaderboard routing & redirect', () => {
  it('removes separate /arcade/leaderboard page and redirects permanently to /arcade#leaderboard', async () => {
    expect(existsSync(join(ROOT, 'src/app/arcade/leaderboard/page.tsx'))).toBe(false)
    expect(existsSync(join(ROOT, 'src/app/arcade/leaderboard/layout.tsx'))).toBe(false)

    const nextConfigMod = await import('../next.config.mjs')
    const redirects = await nextConfigMod.default.redirects()
    expect(redirects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: '/arcade/leaderboard',
          destination: '/arcade#leaderboard',
          permanent: true,
        }),
      ]),
    )
  })

  it('embeds ONE id="leaderboard" in /arcade with header jump, updated links, and start dates', () => {
    const arcadePage = readFileSync(join(ROOT, 'src/app/arcade/page.tsx'), 'utf8')
    const board = readFileSync(join(ROOT, 'src/components/ArcadeLeaderboard.tsx'), 'utf8')
    const prizes = readFileSync(join(ROOT, 'src/components/ArcadePrizes.tsx'), 'utf8')
    const sitemap = readFileSync(join(ROOT, 'src/app/sitemap.ts'), 'utf8')

    expect(arcadePage).toContain('href="#leaderboard"')
    expect(arcadePage).toContain('<ArcadeLeaderboard />')
    expect(arcadePage).not.toContain('/arcade/leaderboard')

    expect(board).toContain('id="leaderboard"')
    expect(board).toContain('Daily (UTC)')
    expect(board).toContain('All-time')
    expect(board).toContain('Overall (Airdrop)')
    expect(board).toContain('2026-07-20')
    expect(board).toContain('2026-10-18')

    expect(prizes).toContain('href="/arcade#leaderboard"')
    expect(prizes).not.toContain('/arcade/leaderboard')
    expect(sitemap).not.toContain('/arcade/leaderboard')
  })
})
