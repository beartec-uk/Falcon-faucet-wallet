// Audit 6: network map bridge operators come from /api/scan/btc-operators.
import { describe, expect, it } from 'vitest'
import { OPERATOR_LIVE_WINDOW_SEC, operatorsFromFeed } from '@/lib/bridge-operators'

describe('operatorsFromFeed', () => {
  it('maps the feed and marks stale heartbeats offline', () => {
    const now = 1_795_722_000
    const body = {
      configured: true,
      operators: [
        { name: 'fpl-op-brain', lastSeen: now - 60 },
        { name: 'fpl-op-falcon1', lastSeen: now - OPERATOR_LIVE_WINDOW_SEC - 1 },
        { name: '', lastSeen: now },
        { lastSeen: now },
      ],
    }
    expect(operatorsFromFeed(body, now)).toEqual([
      { name: 'fpl-op-brain', live: true },
      { name: 'fpl-op-falcon1', live: false },
    ])
  })
  it('is empty-safe', () => {
    expect(operatorsFromFeed(null)).toEqual([])
    expect(operatorsFromFeed({ error: 'x' })).toEqual([])
  })
})
