// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'

/**
 * Bridged-asset balance with an optional in-flight pending total.
 * Wide layout: `1.234 (0.21)`. At mobile (~390px, below `sm`) the pending
 * amount wraps under the balance as `+0.21 pending` so the row does not overflow.
 */
export default function PendingBridgedBalance({
  balanceLabel,
  pendingLabel,
  onPendingClick,
}: {
  balanceLabel: string
  pendingLabel: string | null
  onPendingClick?: () => void
}) {
  return (
    <div className="shrink-0 min-w-0 max-w-[58%] text-right">
      <div className="flex flex-col items-end sm:flex-row sm:items-baseline sm:justify-end sm:gap-1.5">
        <span className="font-mono text-base font-semibold text-slate-100 tabular-nums leading-tight">
          {balanceLabel}
        </span>
        {pendingLabel ? (
          <button
            type="button"
            onClick={onPendingClick}
            className="font-mono text-[11px] font-semibold text-brand-400 hover:text-brand-300 leading-tight mt-0.5 sm:mt-0"
            title="View in-flight deposits"
          >
            <span className="hidden sm:inline">({pendingLabel})</span>
            <span className="sm:hidden">+{pendingLabel} pending</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}
