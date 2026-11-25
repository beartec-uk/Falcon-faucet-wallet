// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
// Pure helpers for merging server-side TN4 deposits with local rows and
// applying the Dismiss visibility rule. No I/O.

import type { Tn4Deposit } from '@/lib/tn4-bridge'

export const TN4_TERMINAL_STATES = new Set(['expired', 'failed', 'minted'])

/** States that require explicit user action (Confirm button) and must never stay hidden. */
export const TN4_ACTION_REQUIRED_STATES = new Set(['awaiting_signature'])

export function isTn4ActionRequired(d: Pick<Tn4Deposit, 'state'>): boolean {
  return TN4_ACTION_REQUIRED_STATES.has(d.state)
}

/** Dismiss is only permitted for terminal or informational rows. */
export function isTn4Dismissible(d: Pick<Tn4Deposit, 'state'>): boolean {
  return !isTn4ActionRequired(d)
}

/**
 * Merge server deposits (`/api/bridge/tn4/v1/deposits?account=...`) with any
 * local rows (e.g. a freshly-seeded deposit before intake indexes it), deduped
 * by `id`. Server state is authoritative while preserving locally-seeded
 * `funding` / `funding_sats` / `depositor_request` when the server omits them.
 */
export function mergeTn4Deposits(
  localRows: readonly Tn4Deposit[],
  serverRows: readonly Tn4Deposit[],
): Tn4Deposit[] {
  const byId = new Map<string, Tn4Deposit>()

  for (const row of localRows) {
    if (row && typeof row.id === 'string' && row.id) {
      byId.set(row.id, row)
    }
  }

  for (const srv of serverRows) {
    if (!srv || typeof srv.id !== 'string' || !srv.id) continue
    const prev = byId.get(srv.id)
    if (!prev) {
      byId.set(srv.id, srv)
    } else {
      byId.set(srv.id, {
        ...prev,
        ...srv,
        funding: srv.funding ?? prev.funding ?? null,
        funding_sats: srv.funding_sats ?? prev.funding_sats ?? null,
        depositor_request: srv.depositor_request ?? prev.depositor_request,
      })
    }
  }

  return Array.from(byId.values()).sort(
    (a, b) => (b.created - a.created) || (b.updated - a.updated) || a.id.localeCompare(b.id),
  )
}

/**
 * Active bridges list: all non-terminal TN4 deposits except dismissed
 * informational rows. Dismissed rows that enter a user-action state (such as
 * `awaiting_signature`) always reappear so the user never misses Confirm.
 */
export function selectActiveTn4Deposits(
  deposits: readonly Tn4Deposit[],
  dismissedIds: readonly string[],
): Tn4Deposit[] {
  const dismissed = new Set(dismissedIds)
  return deposits.filter((d) => {
    if (TN4_TERMINAL_STATES.has(d.state)) return false
    if (isTn4ActionRequired(d)) return true
    return !dismissed.has(d.id)
  })
}

export function selectDoneTn4Deposits(
  deposits: readonly Tn4Deposit[],
  dismissedIds: readonly string[],
): Tn4Deposit[] {
  const dismissed = new Set(dismissedIds)
  return deposits.filter((d) => d.state === 'minted' && !dismissed.has(d.id))
}
