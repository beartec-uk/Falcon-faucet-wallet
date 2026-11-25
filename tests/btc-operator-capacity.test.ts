import { describe, expect, it } from 'vitest'
import {
  operatorAvailableSats,
  operatorCapacityFromFeed,
  parseSats,
} from '@/lib/btc-operator-capacity'

describe('parseSats', () => {
  it('accepts finite non-negative numbers and numeric strings', () => {
    expect(parseSats(0)).toBe(0)
    expect(parseSats(149612240594)).toBe(149612240594)
    expect(parseSats('8728735795')).toBe(8728735795)
    expect(parseSats(' 99 ')).toBe(99)
  })

  it('rejects NaN, inf, negatives, and junk', () => {
    expect(parseSats(Number.NaN)).toBeNull()
    expect(parseSats(Number.POSITIVE_INFINITY)).toBeNull()
    expect(parseSats(-1)).toBeNull()
    expect(parseSats('')).toBeNull()
    expect(parseSats('nope')).toBeNull()
    expect(parseSats(undefined)).toBeNull()
    expect(parseSats(null)).toBeNull()
  })
})

describe('operatorAvailableSats', () => {
  it('prefers availableSats (the /api/scan/btc-operators field) over btc_available_sats', () => {
    expect(operatorAvailableSats({ availableSats: 10, btc_available_sats: 99 })).toBe(10)
  })

  it('falls back to btc_available_sats, then available_sats, and ignores NaN', () => {
    expect(operatorAvailableSats({ btc_available_sats: '8728735795' })).toBe(8728735795)
    expect(operatorAvailableSats({ available_sats: 5 })).toBe(5)
    expect(operatorAvailableSats({ availableSats: Number.NaN, btc_available_sats: 7 })).toBe(7)
    expect(operatorAvailableSats({ availableSats: 'bad', btc_available_sats: -3 })).toBe(0)
    expect(operatorAvailableSats({})).toBe(0)
    expect(operatorAvailableSats(null)).toBe(0)
  })
})

describe('operatorCapacityFromFeed', () => {
  it('reads the live camelCase payload and reports real BTC amounts', () => {
    const cap = operatorCapacityFromFeed({
      configured: true,
      ok: true,
      operators: [
        { name: 'fpl-op-brain', availableSats: 149612240594 },
        { name: 'fpl-op-falcon2', availableSats: 9988269449 },
        { name: 'fpl-op-falcon1', availableSats: 8728735795 },
      ],
    })
    expect(cap.onlineCount).toBe(3)
    expect(cap.maxSingleBtc).toBeCloseTo(1496.12240594, 8)
    expect(cap.totalBtc).toBeCloseTo(1683.29245838, 8)
  })

  it('still works with the legacy btc_available_sats field', () => {
    const cap = operatorCapacityFromFeed({
      operators: [
        { name: 'a', btc_available_sats: '100000000' },
        { name: 'b', btc_available_sats: 200000000, online: false },
      ],
    })
    // online !== false keeps both when we filter; b is online: false so only a is active
    expect(cap.onlineCount).toBe(1)
    expect(cap.maxSingleBtc).toBe(1)
    expect(cap.totalBtc).toBe(1)
  })

  it('uses totals when provided and returns zeros for empty/invalid payloads', () => {
    expect(
      operatorCapacityFromFeed({
        operators: [{ availableSats: 1 }],
        totals: { available_sats: '300000000' },
      }).totalBtc,
    ).toBe(3)
    expect(operatorCapacityFromFeed(null)).toEqual({ maxSingleBtc: 0, totalBtc: 0, onlineCount: 0 })
    expect(operatorCapacityFromFeed({ operators: 'nope' })).toEqual({ maxSingleBtc: 0, totalBtc: 0, onlineCount: 0 })
  })
})
