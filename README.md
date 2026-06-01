# OmniBazaar Installers

Signed, self-configuring installers and hot-update tooling for the two operator
products:

- **Gateway Validator** — headless Linux server (requires avalanchego + a
  YugabyteDB cluster + stake + KYC-3). Packaged as `.deb`/`.rpm` + a
  `curl | bash` bootstrap that wraps the existing
  `Validator/scripts/install-gateway-validator.sh`.
- **Service Node** — laptop-class, anyone-runs. Packaged as a cross-platform
  Electron desktop app (tray UI, bundled deps) and a headless Linux package
  wrapping `Validator/scripts/install-service-node.sh`.

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

## Known adjacent issues (surfaced, not yet fixed)

- `Coin/scripts/sign-release.js` and `publish-release.js` are **hardcoded to the
  retired fuji testnet** (chain `131313`, `deployments/fuji.json`, a defunct
  RPC). They must be re-pointed at mainnet (chain `88008`,
  `UpdateRegistry 0xA5eb4BF4…`) before any release can be published on-chain.
- As of this writing **no `validator`/`service-node` release is published on
  mainnet** — `verifyArtifact` returns `ok:false` ("No on-chain release found")
  until the first `publishRelease` lands.
