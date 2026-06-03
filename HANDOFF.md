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

### 2026-06-04 update — git push fixed, slim de-scoped, real desktop blocker found

- **(was #1) `release.yml` push — RESOLVED.** Root cause was NOT the `.git-credentials`
  PAT (it had `workflow`). V1 git authenticates github.com via the **`gh` CLI OAuth
  helper** (`~/.gitconfig` empty-`helper=` wipes `store` for github.com), and that
  `gho_` token lacked `workflow`. Fixed with `gh auth refresh -h github.com -s workflow`.
  `e0ee0ca` (release.yml) + HANDOFF are pushed; main in sync. See memory
  `git_auth_v1_gh_credential_helper.md`.
- **(was #2) Slim-on-first-run — DE-SCOPED (recommend non-slim for this operator app).**
  Verified: the "multi-GB node_modules" premise is the 8.3 GB *dev monorepo*; a prod-only
  Validator bundle is far smaller. Slim first-run would need a guaranteed `npm` (provisioner
  installs only Yugabyte+IPFS) and would compile native modules (`bcrypt`, `sharp`) on the
  user's machine — unacceptable for a real-money installer. Two latent build blockers were
  fixed regardless (commit `6c2ec12`): vendor-tarballs now travel with the staged manifest;
  the supervised child now spawns with `ELECTRON_RUN_AS_NODE` (was launching a 2nd Electron
  GUI). Unit-tested + type-check + build green (50 tests). Not runtime-smoke-tested (no
  electron-builder/xvfb/Win/macOS here).
- **NEW Blocker C (real desktop-packaging blocker).** `stage-validator.js` does
  `npm install --omit=dev` on a copied manifest in isolation; this **404s on the
  workspace-internal unpublished dep `@omnibazaar/liquidity-config`** and is non-reproducible
  (Validator has no own lockfile, only the root workspace lock). Staging must reproduce
  workspace resolution (copy the resolved prod closure via node-file-trace/npm-packlist, or
  stage internal pkgs as `file:` deps + use the root lock). **Founder decision on packaging
  approach.** The desktop app was never successfully staged once (no `staging/`, no output).
- **(was #4) `/node-software` hosting — CONFIRMED BROKEN.** `RELEASE_BASE` default
  `https://omnibazaar.com/node-software` does not work: `omnibazaar.com` → `192.249.121.28`
  (NOT the validator host), and it **406s curl** / 301-redirects browsers — it serves none of
  the staged files. The validator host (`65.108.205.116:3001/node-software`) serves them
  (HTTP 200). **Needs infra:** a curl-friendly HTTPS host/subdomain for `/node-software`
  (don't hardcode the validator IP+http into the bootstrap default).

### Carried-forward open items
3. **Packaged installers (.deb/AppImage/.exe/.dmg) not built/hosted.** Blocked on Blocker C
   (workspace staging) + Win/macOS build hosts. Source-tarball curl-install is the only
   working path. Win .exe buildable on V1 via Wine; macOS dmg needs a Mac runner (Apple
   Developer $99/yr for notarization).
5. **OmniUpdaterService + a source tarball:** updater expects a PRE-BUILT bundle for the
   symlink swap; v1.0.0 is a SOURCE tarball (build-on-target). Auto-update is off-by-default,
   so fine for now; reconcile when packaging lands.
6. **`Coin/scripts/deploy-update-registry.js`** fix is on branch `feat/phase2-attestation`
   (commit `82df603`, 2-file: script + `mainnet.json`), 116 commits ahead of `main` (main
   fully contained). Not operationally blocking (registry already deployed); lands when the
   branch merges, or cherry-pick if the deployer wants the corrected script on main sooner.

### Recommended next steps (in order)
1. **ASK-class — founder:** stand up the self-hosted GitHub Actions runner on V1
   (label `self-hosted,linux,wine`), `apt install wine64`; cut a `v1.0.1` tag to exercise
   `release.yml`.
2. **Founder decision:** desktop packaging approach (Blocker C) — workspace-aware staging.
3. **Infra:** stand up a curl-friendly HTTPS host for `/node-software` (or set
   `OBZ_RELEASE_BASE` in the published install one-liners).
4. Persist the new registry address to `memory/deployment-mainnet.md`. **(done 2026-06-04.)**

### Open task-tracker items
All session tasks (#27 redeploy registry, #28 sync address, #29 publish release,
#30 stage /node-software, #31 Win/macOS coming-soon + writeup) are **completed**. The
items above are the carried-forward follow-ups, not tracker tasks.
