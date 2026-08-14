# OmniBazaar Installers

Signed, self-configuring installers and hot-update tooling for the two operator
products:

- **Gateway Validator** — headless Linux server (requires avalanchego + a
  YugabyteDB cluster + stake + KYC-3). Packaged as `.deb`/`.rpm` + a
  `curl | bash` bootstrap that wraps `install-gateway-validator.sh`.
  → [`gateway-linux/`](gateway-linux/README.md)
- **Service Node** (also the "listing node" — one role, two names) — laptop-
  class, anyone-runs, LOCAL P2P listings + local storage only (the RWA / Yield /
  Predictions / NFT / DEX verticals are gateway-validator surfaces, canonical on
  `app.omnibazaar.com`). Two surfaces:
  - a cross-platform **Electron desktop app** (tray UI, onboarding, bundled
    deps; silent WSL2 + YugabyteDB on Windows) → [`service-desktop/`](service-desktop/README.md)
  - a **headless Linux package** wrapping `install-service-node.sh`
    → [`service-linux/`](service-linux/README.md)

All three verify every artifact against the on-chain trust anchor (below) and
share the `shared/` verification primitives.

This directory is **build/packaging tooling**; it does not change the running
production validators, which keep their current systemd units and manual
`update-validator.sh` flow until an operator opts into the hot updater.

## Authenticity model (no separate artifact signature)

What an installer or node ultimately trusts is the **on-chain SHA-256 hash**
recorded in `UpdateRegistry` (`Coin/contracts/UpdateRegistry.sol`), approved by
the ODDAO signer set. The trust chain is:

1. ODDAO signers run `Coin/scripts/sign-release.js` over
   `(component, version, binaryHash, …)` and collect threshold signatures.
2. The release manager submits them via `Coin/scripts/publish-release.js`,
   writing the artifact's `binaryHash` on-chain.
3. At install/update time, this package recomputes the downloaded artifact's
   SHA-256 and asserts it equals the on-chain `binaryHash`, that the version is
   not revoked, and that it meets the enforced minimum version.

This is stronger than a lone deployer signature on the artifact (which a single
compromised key could re-sign) and reuses the already-deployed registry.

## `shared/` — verification + hashing primitives

| Module | Purpose |
|---|---|
| `artifact-hash.ts` | `hashFile` / `hashBuffer` → 0x-prefixed SHA-256 (the value published on-chain). |
| `registry-config.ts` | Canonical mainnet RPC / chain-id / registry address (mirrors `omnicoin-integration.ts`) + env overrides. |
| `release-reader.ts` | `ReleaseReader` interface + `EthersReleaseReader` (reads `UpdateRegistry` views). Injectable for tests. |
| `artifact-verifier.ts` | `verifyArtifact(...)` → hash-match + not-revoked + minimum-met. Never throws on an authenticity failure. |
| `semver.ts` | `parseSemver` / `compareSemver` / `meetsMinimum`. |
| `cli.ts` | `omnibazaar-artifact hash <file>` and `verify <file> --component <id> [--version …]`. |

## CLI

```bash
# Compute the hash an ODDAO signer passes to sign-release.js --hash
node dist/shared/cli.js hash ./omnibazaar-gateway-1.0.0.tar.gz

# Verify a downloaded artifact against the on-chain record (exit 0 = authentic)
node dist/shared/cli.js verify ./omnibazaar-gateway-1.0.0.tar.gz \
  --component validator --version 1.0.0
```

Env overrides: `OMNICOIN_RPC_URL`, `OMNICOIN_UPDATE_REGISTRY`.

## Build / test

```bash
npm run type-check   # tsc --noEmit
npm test             # jest (ts-jest)
npm run build        # tsc → dist/
```

(Toolchain is hoisted from the monorepo root; no per-package `npm install`
needed on V1.)

## Release & update lifecycle (end to end)

1. **Build** the artifact (`omnibazaar-<component>-<ver>.tar.gz`) for a target.
2. **Hash** it: `node dist/shared/cli.js hash <tarball>`.
3. **Sign** (ODDAO signers): `Coin/scripts/sign-release.js --component <id>
   --version <ver> --hash <0x…> [--min-version <ver>]` — defaults to mainnet
   (chain `88008`); each signer produces a signature file.
4. **Publish**: `npx hardhat run Coin/scripts/publish-release.js --network
   mainnet` collects the threshold signatures and writes the `binaryHash`
   on-chain to `UpdateRegistry`.
5. **Detect**: every node's `UpdateCheckService` polls the registry (30 min) +
   subscribes to `ReleasePublished`/`ReleaseRevoked` events, emitting
   `updates:available` / `updates:mandatory` / `updates:revoked`.
6. **Apply** (opt-in): `OmniUpdaterService` downloads the artifact, **re-verifies
   SHA-256 against the on-chain `binaryHash`**, stages `releases/<ver>/`, swaps
   the `current` symlink atomically, and restarts. Enable per node via
   `OBZ_RELEASES_DIR` + `OBZ_CURRENT_LINK` (+ `OBZ_UPDATER_SYSTEMD_UNIT`,
   `OBZ_AUTO_UPDATE_MANDATORY`); the desktop tray's "Check for Updates" drives
   the same path. Revoke a bad release with `Coin/scripts/revoke-release.js
   --network mainnet`.

## Status & remaining work

Done (Phases 0–5): `shared/` verification primitives; gateway-linux + service-
linux packages; service-desktop Electron app (i18n ×10); release scripts
**repointed to mainnet** (chain `88008`, `UpdateRegistry 0xA5eb4BF4…`);
`OmniUpdaterService` built, tested, and wired into both entry points (opt-in).

Both installers now establish the **symlink release layout** (`current` → the
installed `Validator/` tree + a `releases/` dir) and bake the updater env into
the systemd unit, so `OmniUpdaterService` can atomically hot-swap; the gateway
now derives its wallet from `STAKING_USERNAME`/`STAKING_PASSWORD` like the
service node (the Phase-1 credential gap is closed). Auto-application stays
**opt-in** (`OBZ_AUTO_UPDATE_MANDATORY`/`OBZ_AUTO_UPDATE_OPTIONAL`, default off).

Remaining / known caveats:
- **No `validator`/`service-node` release is published on mainnet yet** —
  `verifyArtifact` returns `ok:false` ("No on-chain release found") until the
  first `publishRelease` lands. Auto-update is therefore inert until then.
- **External-validator P-Chain self-registration** on the PoS subnet is a guided
  manual step (decision 2026-06-01), not yet automated.
- **OS code-signing certs** (Authenticode / Apple notarization) deferred —
  first-run "unknown publisher" warnings are expected.
