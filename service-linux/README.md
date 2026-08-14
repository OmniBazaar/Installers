# Service Node — Linux package

Headless server install for an OmniCoin L1 **service node** (also called the
"listing node" — one role, two names). A service node hosts **LOCAL P2P listings
and local storage only**: it does **not** serve the aggregated verticals — RWA,
Yield, Predictions, NFT and DEX — those are served by the gateway validators and
are canonical on `app.omnibazaar.com`. It runs **no avalanchego, no AVAX, no
consensus**, and needs **no stake or KYC**; the only barrier is participation
≥ 25, enforced by the node at runtime. Operators earn marketplace fee + referral
revenue — **no block rewards** (removed for service nodes, founder 2026-07-30).
(Desktop operators should use the cross-platform app in `../service-desktop`;
this package is for server-class operators.)

## What it serves (and does not)

- **Serves:** your LOCAL P2P marketplace listings + local storage. Listings a
  seller chooses this node as "home" for are canonical here
  (`https://<username>.omnibazaar.com/listing/<id>`).
- **Does not serve:** the aggregated verticals — RWA, Yield, Predictions, NFT,
  DEX. Those are gateway-validator surfaces, canonical only on
  `app.omnibazaar.com`; a node host that renders them does so with
  `X-Robots-Tag: noindex` + `canonical → app`.
- **Writes nothing to the shared database.** A node relays seller-signed
  listings UP to the gateway REST API (the gateway re-verifies the EIP-712
  signature and is the sole DB writer) and pulls its home listings DOWN via
  `GET /api/v1/node/listings/delta` into its own local-DB replica for serving
  and offline use. No shared-DB credentials are provisioned.

## Install paths

### One-line bootstrap
```bash
curl -fsSL https://get.omnibazaar.com/service-node | sudo bash
```
`bootstrap.sh`: ensures Node, resolves the latest published version **on-chain**,
downloads the signed release + verifier bundle, **verifies the release against
the on-chain `UpdateRegistry` binaryHash** (refuses to install on mismatch),
then runs the repo installer in non-interactive mainnet mode. Provide the wallet
via env first (`STAKING_USERNAME`+`STAKING_PASSWORD` or
`VALIDATOR_WALLET_PRIVATE_KEY`).

### Package (.deb / .rpm)
```bash
# Operator config first:
sudo install -D -m600 service.env.example /etc/omnibazaar/service.env
sudo editor /etc/omnibazaar/service.env       # wallet, host, DB, network
sudo apt install ./omnibazaar-service-node_<ver>_amd64.deb
```
`postinst` sources `/etc/omnibazaar/service.env` and runs the bundled installer
with `OBZ_NONINTERACTIVE=1 OBZ_SKIP_BUILD=1` (the package ships a pre-built
`dist/`). Build the package with `packaging/build-deb.sh` (see its header).

## What it does

- installs Node 20 + the service-node code (or uses the pre-built `dist/` from
  the package);
- derives the operator wallet **locally on first start** from the account
  credentials (`STAKING_USERNAME`/`STAKING_PASSWORD` → `KeyDerivationService`);
  the private key is never written to disk or transmitted;
- generates a **mainnet-correct, qualification-enforcing** systemd unit
  (`dist/service-node.js`, `NODE_TYPE=service`, port 3001 unified socket,
  `SERVICE_MIN_PARTICIPATION=25`, no `SKIP_VALIDATOR_AUTH`);
- enables auto-restart on boot/crash.

The node refuses to serve until its participation score reaches 25 — that gate
lives in `AuthenticationService.SERVICE_THRESHOLDS`, not in the installer.
During Pioneer, a founder / test address can be exempted by adding it to
`PIONEER_FOUNDER_ALLOWLIST` (comma-separated, lowercased) in the node's runtime
environment file — see `packaging/service.env.example`.

## Installer env knobs (set by the package/bootstrap; overridable)

`OBZ_NONINTERACTIVE`, `OBZ_NETWORK`, `OBZ_NODE_ID`, `OBZ_HTTP_HOST/PORT`,
`OBZ_WS_PORT`, `OBZ_P2P_PORT`, `OBZ_DB_*`, `OBZ_SERVICE_MIN_*`, `OBZ_SKIP_BUILD`,
`OBZ_DRY_RUN` (verification only — skips all privileged side effects). Bare
interactive runs keep the original fuji defaults so existing behaviour is
unchanged.

## Manage

```bash
sudo systemctl {start,stop,restart} omnicoin-service-node
sudo journalctl -u omnicoin-service-node -f
curl http://127.0.0.1:3001/health
sudo dpkg -r omnibazaar-service-node      # uninstall (stops the service first)
```
