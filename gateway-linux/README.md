# Gateway Validator — Linux package

Headless server install for an OmniCoin L1 **gateway validator**. Gateway
validators run avalanchego + a YugabyteDB cluster + the TypeScript services and
must meet qualification (stake ≥ 1,000,000 XOM, participation ≥ 50, KYC Tier 3)
and hold AVAX for P-Chain fees — i.e. they are cloud-Linux servers, not laptops.

## Install paths

### One-line bootstrap
```bash
curl -fsSL https://get.omnibazaar.com/gateway | sudo bash
```
`bootstrap.sh`: ensures Node, resolves the latest published version **on-chain**,
downloads the signed release + verifier bundle, **verifies the release against
the on-chain `UpdateRegistry` binaryHash** (refuses to install on mismatch),
then runs the repo installer in non-interactive mainnet mode.

### Package (.deb / .rpm)
```bash
# Operator config first:
sudo install -D -m600 gateway.env.example /etc/omnibazaar/gateway.env
sudo editor /etc/omnibazaar/gateway.env       # wallet, host, DB, network
sudo apt install ./omnibazaar-gateway_<ver>_amd64.deb
```
`postinst` sources `/etc/omnibazaar/gateway.env` and runs the bundled installer
with `OBZ_NONINTERACTIVE=1 OBZ_SKIP_BUILD=1` (the package ships a pre-built
`dist/`). Build the package with `packaging/build-deb.sh` (see its header).

## What it does / does NOT do

Provisions everything **except** the consensus-join:
- installs avalanchego (mainnet `v1.14.1`), Node 20, the gateway services;
- generates a **mainnet-correct, qualification-enforcing** systemd unit
  (`dist/gateway-validator.js`, `AVALANCHE_RPC_URL` with blockchain-ID
  `B5gLCyeRWScx…`, `GATEWAY_MIN_{STAKING,PARTICIPATION,KYC}`, no
  `SKIP_VALIDATOR_AUTH`);
- **verifies AVAX funding** (≥ 2 AVAX) on the C-Chain before the join.

The **P-Chain validator registration** (joining consensus) is a **guided manual
step** the installer prints at the end — it is not auto-executed (decision
2026-06-01). A later phase will automate it once the live PoS `addValidator`
flow is verified.

## Installer env knobs (set by the package/bootstrap; overridable)

`OBZ_NONINTERACTIVE`, `OBZ_NETWORK`, `OBZ_AVALANCHEGO_VERSION`, `OBZ_RPC_URL`,
`OBZ_BLOCKCHAIN_ID`, `OBZ_NODE_ID`, `OBZ_HTTP_HOST/PORT`, `OBZ_DB_*`,
`OBZ_GATEWAY_MIN_*`, `OBZ_MIN_AVAX`, `OBZ_SKIP_BUILD`, `OBZ_DRY_RUN`
(verification only — skips all privileged side effects). Bare interactive runs
keep the original fuji defaults so existing behaviour is unchanged.
