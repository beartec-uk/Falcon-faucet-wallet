// Copyright (c) 2025-2026 BEARTEC. All rights reserved. See LICENSE.
'use client'

import { operatorCapacityFromFeed } from '@/lib/btc-operator-capacity'
import { tn4DepositStatusView, type Tn4StatusInput } from '@/lib/tn4-deposit-status'
import PendingBridgedBalance from '@/components/PendingBridgedBalance'
import { pendingLabelForAsset, type BridgedPendingTotals } from '@/lib/pending-bridged-deposits'

const CONFIRM_TX = 'ab'.repeat(32)

type Fixture = { title: string; d: Tn4StatusInput; fundingSats?: number }

const FIXTURES: Fixture[] = [
  { title: 'awaiting_funding', d: { state: 'awaiting_funding', address: 'tb1qawaitingfundingexample000000000000000', last_error: null } },
  { title: 'funded (preparing)', d: { state: 'funded', address: 'tb1qfunded0000000000000000000000000000000', last_error: null }, fundingSats: 15_000_000 },
  { title: 'funded + waiting_ceremony_slot', d: { state: 'funded', address: 'tb1qqueued0000000000000000000000000000000', last_error: 'waiting_ceremony_slot' }, fundingSats: 12_000_000 },
  { title: 'awaiting_signature', d: { state: 'awaiting_signature', address: 'tb1qready00000000000000000000000000000000', last_error: null, peg_in_confirm_txid: CONFIRM_TX }, fundingSats: 20_000_000 },
  { title: 'signed (reserved txid, no link)', d: { state: 'signed', address: 'tb1qsigned0000000000000000000000000000000', last_error: null, peg_in_confirm_txid: CONFIRM_TX }, fundingSats: 20_000_000 },
  { title: 'presigned (reserved txid, no link)', d: { state: 'presigned', address: 'tb1qpresigned000000000000000000000000000', last_error: null, peg_in_confirm_txid: CONFIRM_TX }, fundingSats: 20_000_000 },
  { title: 'broadcasting (not yet seen)', d: { state: 'broadcasting', address: 'tb1qbroadcast000000000000000000000000000', last_error: null, peg_in_confirm_txid: CONFIRM_TX } },
  { title: 'peg_in_confirmed (link + confs)', d: { state: 'peg_in_confirmed', address: 'tb1qconfirmed00000000000000000000000000', last_error: null, peg_in_confirm_txid: CONFIRM_TX, confirmations: 3 }, fundingSats: 20_000_000 },
  { title: 'awaiting_mint', d: { state: 'awaiting_mint', address: 'tb1qminting00000000000000000000000000000', last_error: null, peg_in_confirm_txid: CONFIRM_TX, confirmations: 6 } },
]

const LIVE_CAP = operatorCapacityFromFeed({
  operators: [
    { name: 'fpl-op-brain', availableSats: 149612240594 },
    { name: 'fpl-op-falcon2', availableSats: 9988269449 },
    { name: 'fpl-op-falcon1', availableSats: 8728735795 },
  ],
})


const WALLET_PENDING: BridgedPendingTotals = { fbtcSats: 21_000_000, fusdc: 0, feth: 0 }

const WALLET_ROWS: Array<{ id: 'fusdc' | 'feth' | 'fbtc'; symbol: string; subtitle: string; balance: string }> = [
  { id: 'fusdc', symbol: 'fUSDC', subtitle: 'Bridged USDC on Falcon', balance: '12.5000' },
  { id: 'feth', symbol: 'fETH', subtitle: 'Bridged ETH on Falcon', balance: '0.500000' },
  { id: 'fbtc', symbol: 'fBTC', subtitle: 'Bridged BTC on Falcon', balance: '1.23400000' },
]

function fmt(n: number, d: number) {
  return n.toFixed(d).replace(/\.?0+$/, '')
}

export default function BridgeUiPreview() {
  return (
    <div className="min-h-screen bg-[#020617] text-[#E0DBCA] p-4 md:p-8">
      <h1 className="text-sm font-semibold mb-4">Bridge deposit UI preview (not production)</h1>
      <div
        data-testid="operator-capacity"
        className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 mb-6 max-w-xl"
      >
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2">
          Operator capacity
        </div>
        <div className="flex flex-wrap justify-between gap-2 text-[11px] text-slate-500">
          <span>
            Max single bridge-out:{' '}
            <span className="font-mono text-slate-300">{fmt(LIVE_CAP.maxSingleBtc, 6)} BTC</span>
          </span>
          <span>
            Operator liquidity:{' '}
            <span className="font-mono text-slate-400">{fmt(LIVE_CAP.totalBtc, 4)} BTC</span>{' '}
            ({LIVE_CAP.onlineCount} online)
          </span>
        </div>
      </div>
      <div
        data-testid="bridged-assets"
        className="rounded-xl border border-slate-800 bg-[#0F172A] p-4 mb-6 w-full max-w-xl"
      >
        <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-3">
          Bridged assets
        </div>
        <div className="space-y-2">
          {WALLET_ROWS.map((row) => (
            <div key={row.id} data-testid={`asset-${row.id}`} className="wallet-asset-row rounded-xl border border-slate-800 bg-slate-950/40 px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">{row.symbol}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5 leading-snug">{row.subtitle}</div>
                </div>
                <PendingBridgedBalance
                  balanceLabel={row.balance}
                  pendingLabel={pendingLabelForAsset(row.id, WALLET_PENDING)}
                />
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-600 mt-2">F-USDC and FETH have no account-scoped pending-deposit API, so only FBTC shows a pending total. At a 390px viewport the amount wraps under the balance as “+0.21 pending”.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 max-w-4xl">
        {FIXTURES.map(({ title, d, fundingSats }) => {
          const status = tn4DepositStatusView(d)
          const sats = fundingSats
          return (
            <div key={title} data-testid={`status-${d.state}`} className="rounded-xl border border-brand-500/25 bg-brand-500/5 p-4 space-y-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">{title}</div>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">
                    BTC → FBTC
                    {sats ? ` · ${(sats / 1e8).toFixed(4)} BTC` : ''}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{status.label}</p>
                </div>
                {status.showConfirmButton && (
                  <button
                    type="button"
                    className="px-2.5 py-1 rounded-lg bg-brand-500 text-slate-950 font-semibold text-xs"
                  >
                    Confirm
                  </button>
                )}
              </div>
              {status.explorerHref && status.explorerLabel ? (
                <a
                  href={status.explorerHref}
                  className="block text-[11px] font-mono text-brand-400/90 truncate"
                >
                  {status.explorerLabel}
                </a>
              ) : (
                <p className="text-[11px] text-slate-600">No Bitcoin tx link yet</p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
