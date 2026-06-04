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

### 2026-06-04 (later) — Blocker C fixed, runner up, registry merged, hosting wired

- **Blocker C — FIXED + verified** (`c376e9e`). `stage-validator.js` now transpiles each
  unpublished `@omnibazaar/*` workspace dep to CommonJS with esbuild and stages it as a
  `file:` dep (also fixes a Node-version crash: those packages ship as TS source, which only
  loads on Node ≥22.18; Electron 32 bundles Node 20). Verified on Linux: full `npm install`
  resolves 1400 pkgs with no 404/ENOENT; staged liquidity-config loads as plain CJS; bcrypt
  prebuilds + sharp platform pkgs present despite `--ignore-scripts` (66 `.node`). `--slim`
  dropped from `release.yml`. **Still needs the runner smoke** (packaged electron-builder run)
  and **cross-platform native handling** (Windows-via-Wine on the Linux runner would bundle
  Linux binaries — Win/macOS need per-target staging). Bundle is ~1.2 GB.
- **Self-hosted runner — UP** (`v1-selfhosted`, online, labels `self-hosted,Linux,X64,wine`,
  systemd `active`+`enabled`; Wine 6.0.3 installed). Matches `release.yml` `runs-on`.
  **Do NOT cut a release tag until** Blocker-C cross-platform native is sorted — `--win` on
  Wine still ships Linux binaries.
- **`get.omnibazaar.com` hosting — wired, pending DNS** (`94ed9ab` + WebApp `e5d2717`,
  unpushed). Bootstraps + WebApp `/download` now default to `https://get.omnibazaar.com/node-software`
  and provision **Node 22**. Founder action in the morning: DNS A-record + Nginx vhost +
  WebApp redeploy — exact steps in `Installers/get-omnibazaar-hosting.md`.
- **Coin registry fix — DONE.** `feat/phase2-attestation` (116 commits, all completed/deployed
  work) fast-forward-merged to `main` (`7cb73d7..82df603`); the `deploy-update-registry.js` +
  `mainnet.json` fix rode along. main was a straggler since 2026-05-17.

### Adjacent issues surfaced (not yet actioned)
- **Node-version coupling (systemic).** The Validator requires Node ≥22.18 at runtime because
  `@omnibazaar/liquidity-config` ships as TS source. Installers now provision Node 22, but the
  robust fix is to **ship that package as built JS** (or have the Validator build bundle it),
  which also helps WebApp. Until then, any consumer on Node <22.18 crashes when the liquidity
  scheduler loads.
- **Cross-platform native + bundle size** for packaged installers (see Blocker C).

### 2026-06-04 (latest) — native-OS build split, Electron bumped, polyrepo CI wired

- **CSW B — native-OS build split** (`0f9b3bf`). `release.yml` now builds each OS on its own
  runner: `desktop-linux` (self-hosted), `desktop-windows` (`windows-latest`), `desktop-macos`
  (`macos-latest`). Fixes the cross-platform native problem (sharp ships per-platform via
  optionalDependencies; cross-building bundled the wrong libs). **Wine is now moot** — the
  Linux job no longer needs it (the runner still has it installed, harmless).
- **Electron bumped 32 (EOL) → 42 + electron-builder 25 → 26** (`8f706a6`). 32 was past
  end-of-life (no security patches). Verified: type-check + build + 50 tests + 0 vulns.
- **CSW D — polyrepo workspace reconstruction in CI** (`66bcca2`). Each job reconstructs the
  build workspace from the separate repos: committed root manifest at `ci/workspace/package.json`
  + composite action `.github/actions/reconstruct-workspace` (checks out Validator/WebApp/Packages,
  restores manifest, npm-installs workspace, builds Validator + WebApp). esbuild made an explicit
  service-desktop dep. **Polyrepo retained — no monorepo.**

### 🔑 FOUNDER ACTIONS — both DONE 2026-06-04
1. **`OBZ_CHECKOUT_TOKEN` — SET + VERIFIED.** Holds a Rick-Crites repo-scoped classic PAT;
   the `ci-selftest.yml` workflow (manual `gh workflow run ci-selftest.yml`) checks out all 3
   sibling repos green. NOTE: that PAT is broad (admin:org etc.); a fine-grained **read-only**
   PAT scoped to the 3 repos would be tighter — worth rotating to, since the self-hosted runner
   (V1, deployer-key host) can read repo secrets. `gh auth token` is broken in this env (returns
   an error string) — set the secret from the `.git-credentials` PAT via `printf '%s' "$PAT" | gh secret set …`.
2. **`get.omnibazaar.com` — LIVE.** Already served by the existing `*.omnibazaar.com` wildcard
   nginx vhost → validator `:3001`, valid wildcard TLS. Verified: `/node-software/install-gateway.sh`
   + `/node-software/v1.0.0/…tar.gz` both HTTP 200. No new vhost needed. (Optional: the short
   `/gateway`,`/service-node` URLs in the script comments aren't wired — full `/node-software/…`
   paths work; add redirects only if you want the short form.)

**Versioning:** desktop app is now **0.9.1**; use **v0.9.x** tags while the pipeline is unproven.
⚠️ The on-chain UpdateRegistry already has validator+service-node at **1.0.0** — do NOT publish an
on-chain 0.9.x release (it's *older* than 1.0.0, so UpdateCheckService won't treat it as an update).
Keep installer/desktop testing at 0.9.x; only re-publish on-chain when cutting a real release ≥1.0.1.

Next: set macOS signing secrets (CSC_LINK etc.), then cut a `v0.9.1` tag to exercise the full
pipeline — the first end-to-end packaged smoke (still unverified here).

### Still open
- **First packaged smoke** (.deb/AppImage/.exe/.dmg actually built + launched): unblocked once
  `OBZ_CHECKOUT_TOKEN` is set + a tag is cut. macOS dmg needs Apple Developer $99/yr notarization.
- **Node-version coupling (systemic):** ship `@omnibazaar/liquidity-config` as built JS to drop
  the Node ≥22.18 runtime requirement entirely (CSW presented; LOW urgency — both paths work now).
- **Bundle size** ~1.2 GB: defer a targeted prune until the first packaged smoke shows what the
  service-node actually loads.
- **OmniUpdaterService vs source tarball:** updater expects a pre-built bundle; v1.0.0 is a
  source tarball. Auto-update off-by-default, so fine for now.
