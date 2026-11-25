# Falcon faucet wallet — 2300 bridges

Aligned to Falcon-PL STATUS SoT: `falcon-pl-rs/crates/fd-pl/docs/BRIDGES_2300_STATUS.md` (**product 2.9.81**, height **692,000+**). Testnet. Auditable, not audited.

| Rail | In | Out |
|------|----|-----|
| ETH Sepolia → FETH | `depositEth(dest20)` on **FalconQcBridgeV3** (live since height 414,000) | burn → 4× OPEN=1 Groth16 Falcon-512 proofs → `openClaim` / `take` |
| USDC Sepolia → F-USDC | `depositUsdc` on **FalconQcBridgeV3** | same |
| Bitcoin Testnet4 → **BTC4** (live) | BitVM2 graph (`fpl-bridge`) + SPV ≥6 confs mints `BTC4`. Live AMM pool: **`btc4-fpl`** (FPL/BTC4). | burn `BTC4` → bonded operator fronts on Testnet4 → `Bitvm2AttestV2` |
| Bitcoin Testnet3 → BTC (legacy) | Frozen **16 Oct 2026**. NUMS/watch pool below. Do not send new deposits. | Exits on this rail remain paused (`btc_withdrawals_enabled=false`). |

`dest20 = sha256(lowercase PL account)[:20]`

| | |
|--|--|
| **FalconQcBridgeV3** (live peg-in / claims) | `0xEd4eE497F21a9255a59e87535FF2A6097592Cfd4` |
| **Groth16Verifier** (current V3) | `0xA03005921E1807587B942ab00cC4212650670aA6` |
| Sepolia USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| FalconQcBridge (V1, legacy) | `0xf8F1471643792eb1cD5d0C31061629777E55bc48` |
| FalconQcBridgeV2 (legacy, anchor 353,130) | `0x811854827627024B38926Ea9DCc0f88ACd5fB23e` |
| FalconDestLock (legacy Kickoff only) | `0xdBF6855b00B78c047A729A21E13bfE5f4C991C05` |
| Live AMM pool | **`btc4-fpl`** (FPL/BTC4) |
| Legacy Testnet3 NUMS/watch pool (frozen 16 Oct 2026) | `tb1pd6ltq2yu89h37zkwn9jsqcq0svf4pk2upnyf7sfw6rk2v59tkw8sfsdq34` |

**Status (aligned to STATUS 2.9.81):**

- **ETH/USDC:** V3 deposits and claims are live since height 414,000 (`pegin_v3=true`, `sepolia.qc_v3`). V1 and V2 contracts are legacy/frozen and kept only so older notes can settle.
- **BTC4 (live):** Bitcoin Testnet4 BitVM2 rail, live since height 692,000. Falcon PL holds no BTC and no operator keys. Live AMM pool is `btc4-fpl`.
- **BTC (Testnet3, frozen 16 Oct 2026):** the custodial NUMS/watch pool is retired. Site flags remain `btc_deposits_enabled=false` and `btc_withdrawals_enabled=false`. Deposits already sent can still be claimed. Do not market 2300 Testnet3 exits as custodialess BitVM2.

Config: `public/config/pl-2300-bridge.json` (ETH/USDC). Legacy Testnet3 watch record: `public/config/btc-spv-bridge.json` (`status: frozen`; pause flags unchanged). Route catalog: `public/config/bridges.json` (`fbtc-native` is frozen).

Protocol SoT: Falcon-PL `falcon-pl-rs/crates/fd-pl/docs/BRIDGES_2300_STATUS.md`.
Public drift check: [BRIDGES_DRIFT_CHECK.md](BRIDGES_DRIFT_CHECK.md).
