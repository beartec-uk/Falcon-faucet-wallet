import { describe, expect, it } from 'vitest'
import type { MetricPoint } from '@/lib/metric-history'
import { seriesValues, type NetSample } from '@/lib/net-metrics'
import { latestCounterSeries } from '@/lib/metric-store'
import { previousSampleFromCounters } from '@/lib/scan-metrics'

function pts(...pairs: [number, number][]): MetricPoint[] {
  return pairs.map(([t, v]) => ({ t, v }))
}

function sample(at: number, overrides: Partial<NetSample> = {}): NetSample {
  return {
    t: at,
    height: 1000,
    txs_sealed: 50_000,
    ledgers_sealed: 1000,
    mempool: 12,
    peers: 8,
    online: 3,
    last_pack_txs: 2,
    last_pack_packer: 'v1',
    min_fee: 1,
    fee_multiplier: 1,
    watchers_live: 2,
    watchers_epoch: 4,
    wallets_activated: 10,
    seats: [
      { id: 'v1', tip: 1000, packs: 40, online: true, jailed: false, perf: 1 },
      { id: 'v2', tip: 999, packs: 38, online: true, jailed: false, perf: 0.9 },
    ],
    ...overrides,
  }
}

describe('sample-metrics latest ctr.* path', () => {
  const t0 = 1_700_000_000_000
  const t1 = t0 + 5 * 60_000
  const t2 = t1 + 5 * 60_000
  const now = t2 + 5 * 60_000

  const full: Record<string, MetricPoint[]> = {
    tps: pts([t0, 1.2], [t1, 1.4], [t2, 1.1]),
    blocks_min: pts([t0, 60], [t1, 60], [t2, 60]),
    'seat.v1.packs_min': pts([t0, 12], [t1, 12], [t2, 11]),
    'ctr.txs_sealed': pts([t0, 48_000], [t1, 49_000], [t2, 50_000]),
    'ctr.ledgers_sealed': pts([t0, 800], [t1, 900], [t2, 1000]),
    'ctr.height': pts([t0, 800], [t1, 900], [t2, 1000]),
    'ctr.mempool': pts([t0, 8], [t1, 10], [t2, 12]),
    'ctr.seat.v1.packs': pts([t0, 20], [t1, 30], [t2, 40]),
    'ctr.seat.v2.packs': pts([t0, 18], [t1, 28], [t2, 38]),
    // Older timestamp than ctr.txs_sealed — must be excluded from the prev sample.
    'ctr.seat.gone.packs': pts([t0, 5], [t1, 5]),
  }

  it('keeps only the newest point of each ctr.* key and drops other series', () => {
    const latest = latestCounterSeries(full)
    expect(Object.keys(latest).sort()).toEqual([
      'ctr.height',
      'ctr.ledgers_sealed',
      'ctr.mempool',
      'ctr.seat.gone.packs',
      'ctr.seat.v1.packs',
      'ctr.seat.v2.packs',
      'ctr.txs_sealed',
    ])
    expect(latest['ctr.txs_sealed']).toEqual([{ t: t2, v: 50_000 }])
    expect(latest['ctr.seat.v1.packs']).toEqual([{ t: t2, v: 40 }])
    expect(latest['ctr.seat.gone.packs']).toEqual([{ t: t1, v: 5 }])
    expect(latest.tps).toBeUndefined()
    expect(latest['seat.v1.packs_min']).toBeUndefined()
  })

  it('rebuilds the same previous sample and series values as the full 24h path', () => {
    const latest = latestCounterSeries(full)
    const fromFull = previousSampleFromCounters(full, now)
    const fromLatest = previousSampleFromCounters(latest, now)
    expect(fromLatest).toEqual(fromFull)
    expect(fromLatest?.t).toBe(t2)
    expect(fromLatest?.seats.map((s) => s.id).sort()).toEqual(['v1', 'v2'])

    const live = sample(now, {
      height: 1300,
      txs_sealed: 53_000,
      ledgers_sealed: 1300,
      mempool: 15,
      seats: [
        { id: 'v1', tip: 1300, packs: 52, online: true, jailed: false, perf: 1 },
        { id: 'v2', tip: 1299, packs: 50, online: true, jailed: false, perf: 0.9 },
      ],
    })
    expect(seriesValues(fromLatest, live)).toEqual(seriesValues(fromFull, live))
    expect(seriesValues(fromLatest, live).tps).toEqual(expect.any(Number))
  })

  it('returns null on both paths when the last counter is older than 20 minutes', () => {
    const staleNow = t2 + 21 * 60_000
    expect(previousSampleFromCounters(full, staleNow)).toBeNull()
    expect(previousSampleFromCounters(latestCounterSeries(full), staleNow)).toBeNull()
  })

  it('returns null on both paths when required counters are missing', () => {
    const { 'ctr.txs_sealed': _tx, ...rest } = full
    expect(previousSampleFromCounters(rest, now)).toBeNull()
    expect(previousSampleFromCounters(latestCounterSeries(rest), now)).toBeNull()
  })
})
