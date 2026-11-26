// Copyright (c) BEARTEC. All Rights Reserved.
// Proprietary and confidential. See LICENSE. Not licensed under any OSI licence.
//
// Falcon testnet wallet Activity: account txs + order-book fills (limit fills and
// AMM swaps) + open orders, as display-ready rows. Pure, no I/O, unit-tested.

import { decimalsOf, toDecimalString } from '@/lib/explorer-api/amounts'
import { fAssetLabel } from '@/lib/f-asset-label'

type Obj = Record<string, unknown>

/**
 * Observed wall-clock block interval on 2300 (807,036 → 808,403 over 4h05m ≈ 10.75 s).
 * The node's `sealed_at_ms` is a chain stamp, not wall time (it reads 1970-03-14), so
 * row times are estimated from the tip: now − (tip − height) × interval.
 */
export const PL_BLOCK_MS_ESTIMATE = 10_750
const RIPPLE_EPOCH = 946_684_800

/** Wallet display name for a PL asset code. */
export function assetLabel(asset: string): string {
  return fAssetLabel(asset)
}

/** Base units → grouped human string using the asset's decimals (USDC 6, ETH 18, BTC/BTC4 8, FPL 0). */
export function formatAssetAmount(raw: unknown, asset: string, maxFrac = 8): string {
  let s: string
  try {
    s = toDecimalString(String(raw ?? '0').trim() || '0', decimalsOf(asset))
  } catch {
    return String(raw ?? '')
  }
  const neg = s.startsWith('-')
  const [i, f = ''] = (neg ? s.slice(1) : s).split('.')
  const int = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const frac = f.slice(0, maxFrac).replace(/0+$/, '')
  return `${neg ? '-' : ''}${int}${frac ? `.${frac}` : ''}`
}

/** Estimated unix ms for a block height, or undefined when the tip is unknown. */
export function estimateHeightMs(height: number, tip: number, nowMs: number, blockMs = PL_BLOCK_MS_ESTIMATE): number | undefined {
  if (!(height > 0) || !(tip > 0)) return undefined
  return nowMs - Math.max(0, tip - height) * blockMs
}

export type PlActivityRow = {
  hash: string
  type: string
  amount?: string
  amountAsset?: string
  destination?: string
  account: string
  result: string
  /** Ripple-epoch seconds (wallet fmtDate contract). */
  date?: number
  height?: number
  /** Display overrides for non-payment rows. */
  label?: string
  party?: string | null
  direction?: 'in' | 'out' | 'trade'
  amountLabel?: string
}

const KIND_TYPE: Record<string, string> = {
  pay: 'Payment',
  pay_to_key: 'PayToKey',
  claim: 'Claim',
  asset_pay: 'AssetPay',
  swap_route: 'Swap',
  swap: 'Swap',
  place_limit_order: 'LimitOrder',
  cancel_order: 'CancelOrder',
  add_liquidity: 'AddLiquidity',
  add_liq: 'AddLiquidity',
  remove_liquidity: 'RemoveLiquidity',
  remove_liq: 'RemoveLiquidity',
  lend_supply: 'LendSupply',
  lend_withdraw: 'LendWithdraw',
  lend_borrow: 'LendBorrow',
  lend_repay: 'LendRepay',
  lend_set_price: 'LendSetPrice',
  rail_deposit: 'BridgeDeposit',
  rail_withdraw: 'BridgeWithdraw',
  eth_v3_deposit: 'EthBridgeDeposit',
  rail_challenge: 'BridgeChallenge',
  rail_header: 'RailHeader',
  set_external_addrs: 'LinkAddress',
  set_external_addr: 'LinkAddress',
  vault_open: 'VaultOpen',
  vault_lock: 'VaultLock',
  bond: 'Bond',
  bond_v2: 'Bond',
  unbond: 'Unbond',
  complete_unbond: 'CompleteUnbond',
  unjail: 'Unjail',
  reactivate: 'Reactivate',
  name_reserve: 'NameReserve',
  name_activate: 'NameActivate',
  create_pool: 'CreatePool',
  create_market: 'CreateMarket',
  credit_asset: 'CreditAsset',
  watcher_credit: 'WatcherCredit',
  watcher_heartbeat: 'WatcherHeartbeat',
}

const KIND_LABEL: Record<string, string> = {
  swap_route: 'Swap submitted',
  swap: 'Swap submitted',
  place_limit_order: 'Placed limit order',
  cancel_order: 'Cancelled order',
  add_liquidity: 'Added liquidity',
  add_liq: 'Added liquidity',
  remove_liquidity: 'Removed liquidity',
  remove_liq: 'Removed liquidity',
  lend_supply: 'Supplied to lending',
  lend_withdraw: 'Withdrew from lending',
  lend_borrow: 'Borrowed from lending',
  lend_repay: 'Repaid lending debt',
  lend_set_price: 'Updated lend price',
  rail_deposit: 'Bridge deposit',
  rail_withdraw: 'Bridge withdraw',
  eth_v3_deposit: 'ETH bridge deposit',
  rail_challenge: 'Bridge challenge',
  rail_header: 'Submitted rail header',
  set_external_addrs: 'Linked external address',
  set_external_addr: 'Linked external address',
  vault_open: 'Opened vault',
  vault_lock: 'Locked vault',
  pay_to_key: 'Sent (key-bound)',
  bond: 'Bonded validator',
  bond_v2: 'Bonded validator',
  unbond: 'Unbonded stake',
  complete_unbond: 'Completed unbond',
  unjail: 'Unjailed validator',
  reactivate: 'Reactivated validator',
  name_reserve: 'Reserved name',
  name_activate: 'Activated name',
  create_pool: 'Created pool',
  create_market: 'Created lend market',
  credit_asset: 'Credited asset',
  watcher_credit: 'Watcher work credit',
  watcher_heartbeat: 'Watcher heartbeat',
  // fd-pl 2.10.4 account_tx_json collapses every other TxBody variant to "tx".
  tx: 'Chain transaction',
}

const n = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}
const s = (v: unknown) => (v == null ? '' : String(v))
const hasPositiveRaw = (v: unknown) => {
  const str = s(v).trim()
  return /^\d+$/.test(str) && str !== '0'
}
const toRipple = (ms: number | undefined) => (ms == null ? undefined : Math.floor(ms / 1000) - RIPPLE_EPOCH)

function assetFromMarketId(marketId: string): string {
  const m = marketId.trim().toUpperCase()
  if (m.startsWith('LEND-')) return m.slice(5)
  if (m.includes('-')) return m.split('-').pop() || 'FPL'
  return m || 'FPL'
}

function assetsFromPoolId(poolId: string): [string, string] {
  const parts = poolId.trim().toUpperCase().split('-')
  return [parts[0] || 'FPL', parts[1] || 'FPL']
}

export type BuildActivityInput = {
  self: string
  recentTxs: Obj[]
  /** fills_query body.fills (node wire: asset, side=taker side, price, base, quote, taker, maker, maker_order, height). */
  fills: Obj[]
  /** open_orders_query body.orders. */
  orders: Obj[]
  tip: number
  nowMs: number
}

export function buildPlActivity({ self, recentTxs, fills, orders, tip, nowMs }: BuildActivityInput): PlActivityRow[] {
  const rows: PlActivityRow[] = []
  const when = (h: number) => toRipple(estimateHeightMs(h, tip, nowMs))

  for (const t of recentTxs) {
    const hash = s(t.tx_id)
    if (!hash) continue
    const kind = s(t.kind) || 'tx'
    const height = n(t.height)
    const assetCode =
      kind === 'asset_pay' ||
      kind === 'rail_deposit' ||
      kind === 'rail_withdraw' ||
      kind === 'eth_v3_deposit' ||
      kind === 'credit_asset'
        ? s(t.asset) || 'FPL'
        : 'FPL'
    const rawAmt = t.amount
    const formattedTopAmt = hasPositiveRaw(rawAmt) ? formatAssetAmount(rawAmt, assetCode) : undefined
    const row: PlActivityRow = {
      hash,
      type: KIND_TYPE[kind] ?? 'Tx',
      amount: formattedTopAmt,
      amountAsset: assetLabel(assetCode),
      destination: s(t.destination) ? s(t.destination) : undefined,
      account: s(t.account),
      result: 'tesSUCCESS',
      date: when(height),
      height: height || undefined,
    }

    if (kind === 'pay_to_key') {
      row.direction = 'out'
      row.label = KIND_LABEL.pay_to_key
      row.party = s(t.destination) || null
      if (formattedTopAmt) row.amountLabel = `−${formattedTopAmt} FPL`
    } else if (kind === 'swap_route' || kind === 'swap') {
      const tokenIn = s(t.token_in).toUpperCase()
      const tokenOut = s(t.token_out).toUpperCase()
      const poolId = s(t.pool_id)
      const inAsset = tokenIn || (poolId ? assetsFromPoolId(poolId)[0] : 'FPL')
      const amtInRaw = t.amount_in
      row.direction = 'trade'
      row.label =
        tokenIn && tokenOut
          ? `Swapped ${assetLabel(tokenIn)} → ${assetLabel(tokenOut)}`
          : KIND_LABEL[kind]
      row.party = poolId || (tokenOut ? `→ ${assetLabel(tokenOut)}` : null)
      if (hasPositiveRaw(amtInRaw)) {
        const fmtIn = formatAssetAmount(amtInRaw, inAsset)
        row.amount = fmtIn
        row.amountAsset = assetLabel(inAsset)
        row.amountLabel = `−${fmtIn} ${assetLabel(inAsset)}`
      } else {
        row.amountLabel = '—'
      }
    } else if (kind === 'place_limit_order') {
      const pair = s(t.pair).toUpperCase()
      const base = pair.split('-')[0] || 'FPL'
      const side = s(t.side).toLowerCase()
      row.direction = 'trade'
      row.label = side ? `Placed limit ${side} order` : KIND_LABEL.place_limit_order
      row.party =
        pair && hasPositiveRaw(t.price)
          ? `${pair} @ ${formatAssetAmount(t.price, 'FPL')}`
          : pair || null
      if (hasPositiveRaw(t.amount)) {
        const fmt = formatAssetAmount(t.amount, base)
        row.amount = fmt
        row.amountAsset = assetLabel(base)
        row.amountLabel = `${fmt} ${assetLabel(base)}`
      } else {
        row.amountLabel = '—'
      }
    } else if (kind === 'cancel_order') {
      row.direction = 'trade'
      row.label = KIND_LABEL.cancel_order
      row.party = s(t.order_id) ? `Order #${s(t.order_id)}` : null
      row.amountLabel = '—'
    } else if (kind === 'add_liquidity' || kind === 'add_liq') {
      const poolId = s(t.pool_id)
      const [a0, a1] = poolId ? assetsFromPoolId(poolId) : ['FPL', 'FPL']
      row.direction = 'trade'
      row.label = KIND_LABEL.add_liquidity
      row.party = poolId ? poolId.toUpperCase() : null
      const parts: string[] = []
      if (hasPositiveRaw(t.amt_a)) parts.push(`${formatAssetAmount(t.amt_a, a0)} ${assetLabel(a0)}`)
      if (hasPositiveRaw(t.amt_b)) parts.push(`${formatAssetAmount(t.amt_b, a1)} ${assetLabel(a1)}`)
      row.amountLabel = parts.length ? parts.join(' + ') : '—'
      if (hasPositiveRaw(t.amt_a)) {
        row.amount = formatAssetAmount(t.amt_a, a0)
        row.amountAsset = assetLabel(a0)
      }
    } else if (kind === 'remove_liquidity' || kind === 'remove_liq') {
      const poolId = s(t.pool_id)
      row.direction = 'trade'
      row.label = KIND_LABEL.remove_liquidity
      row.party = poolId ? poolId.toUpperCase() : null
      if (hasPositiveRaw(t.lp_burn)) {
        const fmtLp = formatAssetAmount(t.lp_burn, 'FPL')
        row.amount = fmtLp
        row.amountAsset = 'LP'
        row.amountLabel = `${fmtLp} LP`
      } else {
        row.amountLabel = '—'
      }
    } else if (
      kind === 'lend_supply' ||
      kind === 'lend_withdraw' ||
      kind === 'lend_borrow' ||
      kind === 'lend_repay' ||
      kind === 'lend_set_price'
    ) {
      const mktId = s(t.market_id)
      const mktAsset = mktId ? assetFromMarketId(mktId) : 'FPL'
      const lbl = assetLabel(mktAsset)
      row.label = KIND_LABEL[kind]
      row.party = mktId ? `${lbl} market (${mktId})` : null
      if (kind === 'lend_withdraw') {
        row.direction = 'in'
        if (hasPositiveRaw(t.shares)) {
          const fmtShares = formatAssetAmount(t.shares, mktAsset)
          row.amount = fmtShares
          row.amountAsset = lbl
          row.amountLabel = `+${fmtShares} ${lbl} shares`
        } else {
          row.amountLabel = '—'
        }
      } else if (kind === 'lend_borrow') {
        row.direction = 'in'
        if (hasPositiveRaw(t.amount)) {
          const fmt = formatAssetAmount(t.amount, mktAsset)
          row.amount = fmt
          row.amountAsset = lbl
          row.amountLabel = `+${fmt} ${lbl}`
        } else {
          row.amountLabel = '—'
        }
      } else if (kind === 'lend_supply' || kind === 'lend_repay') {
        row.direction = 'out'
        if (hasPositiveRaw(t.amount)) {
          const fmt = formatAssetAmount(t.amount, mktAsset)
          row.amount = fmt
          row.amountAsset = lbl
          row.amountLabel = `−${fmt} ${lbl}`
        } else {
          row.amountLabel = '—'
        }
      } else {
        row.direction = 'trade'
        row.amountLabel = '—'
      }
    } else if (kind === 'rail_deposit' || kind === 'eth_v3_deposit') {
      row.direction = 'in'
      row.label = KIND_LABEL[kind]
      row.party = s(t.to || t.credit_to) || (s(t.deposit_id) ? `${s(t.deposit_id).slice(0, 12)}…` : null)
      if (formattedTopAmt) {
        row.amountLabel = `+${formattedTopAmt} ${assetLabel(assetCode)}`
      } else {
        row.amountLabel = assetLabel(assetCode)
      }
    } else if (kind === 'rail_withdraw') {
      row.direction = 'out'
      row.label = KIND_LABEL.rail_withdraw
      row.party = s(t.external_to || t.destination) || null
      row.amountLabel = formattedTopAmt ? `−${formattedTopAmt} ${assetLabel(assetCode)}` : '—'
    } else if (kind === 'set_external_addrs' || kind === 'set_external_addr') {
      row.direction = 'trade'
      row.label = KIND_LABEL.set_external_addrs
      row.party = t.chain ? `${s(t.chain)} ${s(t.address)}`.trim() : s(t.address) || null
      row.amountLabel = '—'
    } else if (kind === 'vault_open' || kind === 'vault_lock') {
      row.direction = 'trade'
      row.label = KIND_LABEL[kind]
      row.party = s(t.destination) || null
      row.amountLabel = '—'
    } else if (kind === 'bond' || kind === 'bond_v2' || kind === 'unbond' || kind === 'complete_unbond' || kind === 'unjail' || kind === 'reactivate') {
      row.direction = kind === 'complete_unbond' ? 'in' : 'out'
      row.label = KIND_LABEL[kind]
      row.party = s(t.validator) || null
      row.amountLabel = formattedTopAmt ? `${formattedTopAmt} FPL` : '—'
    } else if (kind === 'tx') {
      row.label = KIND_LABEL.tx
      row.direction = 'trade'
      row.party = 'DeFi / protocol tx'
      row.amountLabel = hasPositiveRaw(t.fee) ? `fee ${formatAssetAmount(t.fee, 'FPL')} FPL` : '—'
    } else if (KIND_LABEL[kind]) {
      row.label = KIND_LABEL[kind]
      row.party = s(t.pool_id || t.market_id || t.validator) || null
      row.direction = 'trade'
      if (!row.amount) row.amountLabel = '—'
    }

    rows.push(row)
  }

  fills.forEach((f, i) => {
    const asset = s(f.asset).toUpperCase()
    const taker = s(f.taker)
    const maker = s(f.maker)
    const isTaker = taker === self
    if (!isTaker && maker !== self) return
    const takerSide = s(f.side).toLowerCase()
    const mySide = isTaker ? takerSide : takerSide === 'buy' ? 'sell' : 'buy'
    const height = n(f.height)
    const base = formatAssetAmount(f.base, asset)
    const quote = formatAssetAmount(f.quote, 'FPL')
    const price = formatAssetAmount(f.price, 'FPL')
    const amm = maker.startsWith('amm:')
    const lbl = assetLabel(asset)
    const amountLabel = mySide === 'buy' ? `+${base} ${lbl} · −${quote} FPL` : `−${base} ${lbl} · +${quote} FPL`
    const mo = f.maker_order == null ? 'amm' : s(f.maker_order)
    rows.push({
      hash: `fill:${height}:${asset}:${mo}:${i}`,
      type: amm && isTaker ? 'Swap' : 'Trade',
      account: taker,
      destination: maker,
      result: 'tesSUCCESS',
      date: when(height),
      height: height || undefined,
      amount: base,
      amountAsset: lbl,
      direction: 'trade',
      label: amm && isTaker
        ? `Swapped ${mySide === 'buy' ? `FPL → ${lbl}` : `${lbl} → FPL`} @ ${price}`
        : isTaker
          ? `Market ${mySide} ${lbl} @ ${price} filled vs`
          : `Limit ${mySide} ${lbl} @ ${price} filled by`,
      party: amm && isTaker ? 'AMM pool' : isTaker ? maker : taker,
      amountLabel,
    })
  })

  for (const o of orders) {
    const pair = s(o.pair).toUpperCase()
    const asset = pair.split('-')[0] || 'FPL'
    const height = n(o.placed_height)
    const lbl = assetLabel(asset)
    const side = s(o.side).toLowerCase()
    const rem = formatAssetAmount(o.remaining ?? o.amount, asset)
    const total = formatAssetAmount(o.amount, asset)
    rows.push({
      hash: `order:${s(o.id)}`,
      type: 'OpenOrder',
      account: self,
      result: 'tesSUCCESS',
      date: when(height),
      height: height || undefined,
      amount: rem,
      amountAsset: lbl,
      direction: 'trade',
      label: `Open limit ${side} #${s(o.id)} @ ${formatAssetAmount(o.price, 'FPL')}`,
      party: `${pair} · ${rem === total ? total : `${rem} of ${total}`} ${lbl}`,
      amountLabel: `${rem} ${lbl}`,
    })
  }

  // Newest first; stable for equal heights (fills keep engine order).
  return rows
    .map((row, idx) => ({ row, idx }))
    .sort((a, b) => (b.row.height ?? 0) - (a.row.height ?? 0) || a.idx - b.idx)
    .map((x) => x.row)
}
