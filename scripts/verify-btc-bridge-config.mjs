#!/usr/bin/env node
/**
 * W3.4 — Script equivalence: portal config watch hash vs optional on-chain tip.
 * Usage: node scripts/verify-btc-bridge-config.mjs [--rpc URL]
 * Exit 1 on local config inconsistency or (if RPC reachable) on-chain mismatch.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const rpc =
  process.argv.includes('--rpc')
    ? process.argv[process.argv.indexOf('--rpc') + 1]
    : process.env.XRPLD_RPC_URL || 'http://46.224.0.140:6005'

function loadJson(rel) {
  return JSON.parse(readFileSync(join(root, rel), 'utf8'))
}

const bridge = loadJson('public/config/btc-spv-bridge.json')
const reserve = loadJson('public/config/protocol-reserve.json')

const errors = []
const bridgeHash = String(bridge.watch_script_hash || '').toUpperCase()
const reserveHash = String(reserve.watch_script_hash || '').toUpperCase()
const bridgeSpk = String(bridge.payment_script_hex || '').toLowerCase()
const reserveSpk = String(reserve.hold_script_pubkey || '').toLowerCase()
const bridgeAddr = String(bridge.watch_address || '').toLowerCase()
const reserveAddr = String(reserve.hold_address || '').toLowerCase()

// Current 2300 rail identifies the watch output by payment_script_hex (P2TR)
// plus watch_address. watch_script_hash is a legacy reserve-field and is
// optional; do not invent one. Require a hash only when no P2TR script is set.
const p2tr = /^5120[0-9a-f]{64}$/.test(bridgeSpk)
const hasHash = /^[0-9A-F]{64}$/.test(bridgeHash)
if (!hasHash && !p2tr) {
  errors.push('btc-spv-bridge.json needs payment_script_hex (P2TR 5120…) or watch_script_hash')
}
if (hasHash && reserveHash && bridgeHash !== reserveHash) {
  errors.push(`watch_script_hash mismatch bridge=${bridgeHash} reserve=${reserveHash}`)
}
if (bridgeSpk && reserveSpk && bridgeSpk !== reserveSpk) {
  errors.push('payment_script_hex / hold_script_pubkey mismatch')
}
if (bridgeAddr && reserveAddr && bridgeAddr !== reserveAddr) {
  errors.push(`watch_address mismatch bridge=${bridgeAddr} reserve=${reserveAddr}`)
}

// Retired addresses must not be current watch
const retired = [
  'mxuamPnEtoMaiRnBnAUnrCZeXTYPVX4hik',
  'tb1qqxf9h0ytl0valyrmfqq53ws48mq88n8rzxcnkcvt2wg98kh8uj5qtzhm5f',
  'tb1q40fswfaq0e5nvnmayutp7qw3s0r0ctgy62p48w0k4zq79wx6w27s6ulwpv',
].map((a) => a.toLowerCase())
if (retired.includes(bridgeAddr)) {
  errors.push(`watch_address is a retired hold: ${bridgeAddr}`)
}

let onChainHash = null
try {
  const body = JSON.stringify({
    method: 'ledger_entry',
    params: [{ btc_bridge_state: true, ledger_index: 'validated' }],
  })
  const r = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(12_000),
  })
  if (r.ok) {
    const j = await r.json()
    const n = j?.result?.node
    if (n?.BtcWatchScriptHash) {
      onChainHash = String(n.BtcWatchScriptHash).toUpperCase()
      if (bridgeHash && onChainHash !== bridgeHash) {
        errors.push(
          `on-chain BtcWatchScriptHash ${onChainHash} ≠ config ${bridgeHash} (RPC ${rpc})`,
        )
      }
    }
  } else {
    console.warn(`warn: RPC HTTP ${r.status} — skipped on-chain check`)
  }
} catch (e) {
  console.warn(`warn: RPC unreachable (${e.message}) — local config only`)
}

if (errors.length) {
  console.error('verify-btc-bridge-config FAILED:')
  for (const e of errors) console.error(' -', e)
  process.exit(1)
}

console.log('verify-btc-bridge-config OK')
console.log('  watch_address', bridge.watch_address)
console.log('  payment_script_hex', bridgeSpk || '(none)')
if (bridgeHash) console.log('  watch_script_hash', bridgeHash)
if (onChainHash) console.log('  on-chain match', onChainHash)
process.exit(0)
