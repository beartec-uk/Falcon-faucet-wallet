import { describe, expect, it } from 'vitest'
import { fAssetLabel } from '@/lib/f-asset-label'

describe('fAssetLabel', () => {
  it('uses one display style for chain ids and legacy labels', () => {
    expect([fAssetLabel('ETH'), fAssetLabel('FETH'), fAssetLabel('fETH')]).toEqual(['fETH', 'fETH', 'fETH'])
    expect([fAssetLabel('USDC'), fAssetLabel('F-USDC'), fAssetLabel('FUSDC'), fAssetLabel('fUSDC')]).toEqual([
      'fUSDC',
      'fUSDC',
      'fUSDC',
      'fUSDC',
    ])
    expect([fAssetLabel('BTC4'), fAssetLabel('FBTC'), fAssetLabel('BTC')]).toEqual(['fBTC', 'fBTC', 'fBTC'])
    expect([fAssetLabel('FPL'), fAssetLabel(''), fAssetLabel(undefined)]).toEqual(['FPL', 'FPL', 'FPL'])
  })
})
