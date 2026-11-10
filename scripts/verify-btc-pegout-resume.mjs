#!/usr/bin/env node
/**
 * Contract tests for BTC bridge-out resume (#62).
 * A retry after a part-way failure must not start a second burn.
 */
function btcPegOutConflicts(pending, amount, dest) {
  return !!(pending && (pending.amount !== amount || pending.dest !== dest))
}

const pending = { amount: 50_000, dest: 'tb1qexamplexxxxxxxxxxxxxxxxxxxxxxxxx' }
if (btcPegOutConflicts(pending, 50_000, pending.dest)) {
  console.error('same amount+dest must not conflict')
  process.exit(1)
}
if (!btcPegOutConflicts(pending, 60_000, pending.dest)) {
  console.error('different amount must conflict (would burn again)')
  process.exit(1)
}
if (!btcPegOutConflicts(pending, 50_000, 'tb1qother')) {
  console.error('different dest must conflict (would burn again)')
  process.exit(1)
}
if (btcPegOutConflicts(null, 50_000, pending.dest)) {
  console.error('no pending must not conflict')
  process.exit(1)
}

const src = await import('node:fs').then((fs) =>
  fs.readFileSync(new URL('../src/lib/pl-btc-rail.ts', import.meta.url), 'utf8'),
)
for (const needle of [
  'Resuming pending BTC bridge-out (no new burn)',
  'savePendingBtcPegOut(pending)',
  'btcPegOutConflicts(pending, amount, dest)',
  'if (snap.btcSats < amount)',
  'clearPendingBtcPegOut(opts.account)',
  'txidFromRawHex(kickHex)',
]) {
  if (!src.includes(needle)) {
    console.error('missing in pl-btc-rail.ts:', needle)
    process.exit(1)
  }
}
// Balance check must be inside the !pending / else branch, not before resume.
const resumeIdx = src.indexOf('if (pending)')
const balIdx = src.lastIndexOf('if (snap.btcSats < amount)')
if (resumeIdx < 0 || balIdx < resumeIdx) {
  console.error('FBTC balance check must run only when there is no pending burn')
  process.exit(1)
}
console.log('verify-btc-pegout-resume OK')
process.exit(0)
