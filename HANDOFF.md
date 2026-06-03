# OmniBazaar Installers — HANDOFF

<!-- ============================================================= -->
<!-- DO NOT REMOVE. RETAIN THESE AT THE TOP OF THIS FILE.          -->
<!-- ============================================================= -->

## Repo purpose
Signed, self-configuring installers + trustless hot-update tooling for the two
operator products: **Gateway Validator** (headless Linux) and **Service Node**
(cross-platform Electron desktop + headless Linux). Private repo on V1.

## Key facts (current)
- **Mainnet UpdateRegistry = `0x65263253647a7e9700Df642a92b6074781DCAC81`** (deployer-owned,
  `0x021868f2E3D49C059EF52B539AAa933B437e0321`, sole signer + admin, threshold 1).
  The OLD `0xA5eb4BF4a46B3CfAaC684818f56fD8263f79031D` is DEAD (was owned by the
  compromised `0xaDAD…` deployer) — do not use it.
- **Trust anchor:** the on-chain SHA-256 `binaryHash` in UpdateRegistry, verified at
  install/update time (NOT a lone deployer artifact signature).
- **publishRelease** is gated by `DEFAULT_ADMIN_ROLE` + threshold signatures from
  signers (no `RELEASE_MANAGER_ROLE` — that name doesn't exist on the contract).
- **Toolchain hoists from monorepo root `node_modules`** (ethers 6.16, ts 5.9.2, jest
  29.7). Run Installers tests with `../node_modules/.bin/jest`. service-desktop has its
  own electron/electron-builder install.
- **deployer key:** `~/.avalanche-cli/key/deployer.pk` (no 0x prefix; prepend `0x`).
- Hardhat needs the `chalk@^4.1.2` root override; secret-scan pre-push hook is wired.

## Layout
```
shared/            verifier + hashing + release-reader + cli (Phase 0)
gateway-linux/     bootstrap.sh + packaging (build-deb.sh/postinst/prerm/spec/env.example)
service-linux/     same shape for the headless service node
service-desktop/   Electron app (main/preload/tray/onboarding/dep-provisioner/renderer + i18n×10)
.github/workflows/release.yml   3-OS release matrix (committed locally, see below)
```

## Release lifecycle
build tarball → `node dist/shared/cli.js hash <tarball>` →
`Coin/scripts/sign-release.js --component <id> --version <v> --hash <0x…>` (deployer key
via `ODDAO_SIGNER_KEY`, defaults to mainnet) → `npx hardhat run Coin/scripts/publish-release.js
--network mainnet` → nodes' UpdateCheckService detects it; OmniUpdaterService (opt-in) applies.
Release scripts are repointed to mainnet (chain 88008).

<!-- ============================================================= -->
<!-- END OF RETAINED HEADING SECTION                                -->
<!-- ============================================================= -->

## 2026-06-03 — Installers project Phases 0–5 DONE; first mainnet release LIVE

### What shipped (all committed + pushed except where noted)
- **Phases 0–5 complete:** shared verifier; gateway-linux + service-linux packages;
  service-desktop Electron app (onboarding → derive wallet via Validator
  `node-preflight.ts`, OS dep-provisioner incl. silent Windows WSL2+YugabyteDB, tray,
  i18n×10, electron-builder NSIS/dmg/deb/AppImage); `OmniUpdaterService` (download →
  verify SHA-256 vs on-chain → atomic symlink swap → restart) wired opt-in into both
  entry points via `Validator/src/services/updates/registerUpdater.ts`.
- **Symlink release layout:** both installers create `current`→`Validator` + `releases/`,
  unit `WorkingDirectory=current`, bake `OBZ_RELEASES_DIR/CURRENT_LINK/UPDATER_SYSTEMD_UNIT`
  + opt-in `OBZ_AUTO_UPDATE_*` (default off).
- **Gateway credential fix:** `gateway-validator.ts` now derives its wallet from
  `STAKING_USERNAME/STAKING_PASSWORD` (was only reading `VALIDATOR_WALLET_PRIVATE_KEY`);
  installer + env.example write `STAKING_*`.
- **WebApp /download:** four uniform sections (Wallet, Mobile, Listing/Service Node,
  Gateway Validator) with full requirements + warnings + `useNodeEligibility` gate
  (KYC3/1M-stake/50 for gateway, 25 for listing) + attestation checkbox. Binaries are
  marked **coming-soon**; the gated **curl one-liner is the working install path**.
- **Registry re-keyed on mainnet** (old was compromised-deployer-owned) → new address
  above; rotated across Coin/Validator/Wallet/Mobile/WebApp/Installers + committed/pushed.
- **First on-chain release PUBLISHED:** `validator` v1.0.0 (tx `0x9aaccff4…`, block 499331)
  + `service-node` v1.0.0 (tx `0x62b76f10…`, block 499334), binaryHash
  `0x70965b15c9ac51b7a6c4ddea3d43bea165834b57d4006f7397f027a0e539cede`, not revoked.
- **Fleet rebuilt + rolling-restarted** (all 5 health-gated, quorum kept). Verified live:
  `validator-1:3001/api/v1/updates/status` → `latestVersion 1.0.0`, status `update-available`.
- **Staged `/node-software/`** in `WebApp/public/node-software/`: `install-service-node.sh`
  + `install-gateway.sh` bootstraps, `v1.0.0/` source tarballs (hash matches on-chain),
  verifier bundle (CLI + ethers). RELEASE_BASE defaults to `https://omnibazaar.com/node-software`.
- **CI:** `.github/workflows/release.yml` drafted (self-hosted `[self-hosted,linux,wine]`
  for AppImage/deb/NSIS, GitHub `macos-latest` for dmg+notarize) + `stage-validator.js --slim`.

### BLOCKERS / OPEN ITEMS (next developer)
1. **`release.yml` not pushed** — local commit `e0ee0ca` (Installers, ahead by 1). GitHub
   rejected the push: the cached PAT in `~/.git-credentials` (ends `…SYOG`) has scopes
   `gist, read:org, repo` but **no `workflow`**. Fix: add `workflow` to that classic PAT at
   github.com/settings/tokens (keeps the value → no re-cache), then `git push`. Founder is
   handling the token.
2. **Slim-on-first-run needs the app-side companion change.** `stage-validator.js --slim`
   ships NO node_modules; a slim bundle currently can't run. Implement: on first launch the
   Electron app copies `resources/validator` → writable `userData/runtime/`, runs
   `npm ci --omit=dev` there, and the supervisor (`paths.ts` + `child-supervisor.ts`) runs
   node from that dir. ~half-day + xvfb smoke. Until then, only the non-slim path runs.
3. **Packaged installers (.deb/AppImage/.exe/.dmg) not built/hosted.** Blocked on (2)
   (multi-GB node_modules) + Win/macOS build hosts. The curl-install (source tarball) is
   the only working path today. Win .exe buildable on V1 via Wine; macOS dmg needs a Mac
   runner (Apple Developer $99/yr for notarization, required).
4. **`/node-software/` serving:** files are in the atomically-swapped live `build/` (served
   by express.static) so reachable now, BUT RELEASE_BASE points at `https://omnibazaar.com`
   — confirm that domain resolves to the validator host, or override `OBZ_RELEASE_BASE`.
5. **OmniUpdaterService + a source tarball:** the updater expects a PRE-BUILT bundle for the
   symlink swap; the v1.0.0 release is a SOURCE tarball (build-on-target). Auto-update is
   off-by-default, so fine for now, but reconcile when (2) lands (ship pre-built slim).
6. **`Coin/scripts/deploy-update-registry.js`** fix committed on branch
   `feat/phase2-attestation` (not main) — Coin was checked out there.

### Recommended next steps (in order)
1. Founder: add `workflow` scope → push `e0ee0ca` (lands release.yml + --slim flag).
2. Implement slim-on-first-run runtime-prep (item 2) — unblocks all packaged installers.
3. Stand up the self-hosted GitHub Actions runner on V1 (label `self-hosted,linux,wine`),
   `apt install wine64`; cut a `v1.0.1` tag to exercise release.yml.
4. Confirm `omnibazaar.com/node-software` hosting (or repoint RELEASE_BASE).
5. Optional: persist the new registry address to `memory/deployment-mainnet.md`.

### Open task-tracker items
All session tasks (#27 redeploy registry, #28 sync address, #29 publish release,
#30 stage /node-software, #31 Win/macOS coming-soon + writeup) are **completed**. The
items above are the carried-forward follow-ups, not tracker tasks.
