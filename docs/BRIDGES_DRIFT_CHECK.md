# Bridges drift check

**Rule:** public faucet docs + live bridge JSON must match Falcon-PL `BRIDGES_2300_STATUS.md` (product **2.9.81**), or explicitly document a verified intentional interim.

| Item | STATUS SoT | Public live |
|------|------------|-------------|
| Product version | 2.9.81 | `docs/BRIDGES-2300.md` and the frozen BTC configs cite 2.9.81 |
| ETH/USDC bridge (live) | FalconQcBridgeV3 `0xEd4eE497F21a9255A59e87535FF2A6097592Cfd4` | `pl-2300-bridge.json` `sepolia.qc_v3` + `pegin_v3: true` |
| Groth16 verifier (current V3) | `0xA03005921E1807587B942ab00cC4212650670aA6` | document in `docs/BRIDGES-2300.md` (legacy V2/initial V3 verifier stays in `sepolia.legacy_verifier_v2`) |
| USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | `sepolia.usdc_token` |
| Live Bitcoin rail / AMM pool | `BTC4` / `btc4-fpl` (Testnet4 BitVM2, since height 692,000) | explorer SoT `LIVE_RAIL_ASSETS`; docs and `btc-spv-bridge.json` `live_rail` / `live_pool_id` |
| Legacy Bitcoin Testnet3 | NUMS/watch `tb1pd6ltq2yu89h37zkwn9jsqcq0svf4pk2upnyf7sfw6rk2v59tkw8sfsdq34`, frozen 16 Oct 2026 | `btc-spv-bridge.json` `watch_address` (historical record; `status: frozen`; deposits/withdrawals stay paused); `bridges.json` `fbtc-native` is frozen |
| FalconDestLock | legacy Kickoff only | `legacy_destlock` — never marketed as live peg-in |

Historical configs (`feth-bridge.json`, `usdc-bridge.json`, archive-1001) stay shipped but labeled **historical**.
