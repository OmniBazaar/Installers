# OmniBazaar Service Node — Desktop App

A cross-platform desktop launcher (Windows / macOS / Linux) that lets anyone run
an OmniBazaar **service node** without a terminal, Docker, or handling a private
key. It is a thin **supervisor** around the unchanged Validator entry point
(`service-node.js`): all business logic stays in the Validator (the thin-client
invariant). The app onboards the operator, provisions runtime dependencies,
supervises the node process, and surfaces status from the system tray.

> Gateway *validators* use the headless Linux package instead (see
> `../gateway-linux`). This desktop app is the **service-node** surface.

## What it does

1. **Onboarding** — you sign in with your OmniBazaar username + password. The app
   derives your node address locally (via the Validator's `node-preflight`
   script — it never reimplements key derivation) and shows it. Credentials are
   stored encrypted at rest using the OS keychain (Electron `safeStorage`:
   DPAPI on Windows, Keychain on macOS, libsecret on Linux). **No private key is
   ever stored or handled by the launcher** — the node derives the wallet itself
   at startup from the credentials.
2. **Dependency provisioning** — installs a single-node YugabyteDB (the
   production DB engine, so the YEDIS / distributed-lock code stays compatible):
   - **Linux / macOS:** runs the existing `install-yugabyte.sh`.
   - **Windows:** enables WSL2 (one administrator prompt) and provisions
     YugabyteDB *inside* the distro — no Docker. Fails loudly if hardware
     virtualization is disabled in BIOS/UEFI. Before installing anything it
     verifies the host: the `Ubuntu` distribution exists, it is running as **WSL
     version 2** (upgrading it if not), systemd is enabled in `/etc/wsl.conf` and
     actually became PID 1, a `.wslconfig` memory cap is written when the
     operator has none, and lingering is enabled for the database's user-level
     unit. Without those four checks the node installs cleanly and then never
     starts again after a reboot.
3. **Supervised node** — spawns `node dist/service-node.js` with the correct
   environment (`NODE_TYPE=service`, port 3001, `SERVICE_MIN_*` thresholds),
   polls `/health`, and restarts with exponential backoff on a crash.
4. **Tray UI** — start/stop, live status, open the dashboard
   (`http://127.0.0.1:3001`), view logs, check for updates, and a "start on
   login" toggle.

## Qualification

Qualification is **enforced at runtime by the node**, not by the launcher. A
service node serves once its participation score reaches **25**
(`SERVICE_MIN_PARTICIPATION`). Onboarding only *shows* your derived address; the
node itself is the authority and refuses to serve until qualified.

## Updates

"Check for Updates" reads the on-chain `UpdateRegistry` (via the shared
`omnibazaar-artifact latest` command) and reports whether a newer service-node
release is published. The trust anchor is the **on-chain SHA-256 binary hash**.
Automatic download + verify + atomic apply ships in Phase 4
(`OmniUpdaterService`); this release surfaces availability only.

## Build

The launcher hoists its toolchain (tsc, jest, i18next) from the monorepo root;
`electron` + `electron-builder` are local dev dependencies.

```bash
cd Installers/service-desktop
npm install                 # electron + electron-builder (local)

# Build the Validator + WebApp first (their dist/ is bundled):
( cd ../../Validator && npm run build )
( cd ../../WebApp && npm run build )
( cd .. && npm run build )  # builds the shared artifact CLI

npm run build               # compile main + renderer, copy HTML/CSS
npm run stage:validator     # stage Validator + WebApp + shared CLI into staging/
npm run dist:linux          # → release/  (AppImage + .deb)
npm run dist:win            # → release/  (NSIS installer)
npm run dist:mac            # → release/  (dmg, x64 + arm64)
```

Built artifacts are post-signed by publishing their SHA-256 to the on-chain
`UpdateRegistry` (Phase 0 → Coin publish pipeline); OS-native code-signing certs
are deferred, so first-run SmartScreen/Gatekeeper "unknown publisher" warnings
are expected.

## Test & verify

```bash
npm test                    # 49 unit tests (env builder, supervisor backoff,
                            # tray-state, preflight/update parsers, provisioner
                            # dispatch, credential store, i18n ×10 parity)
npm run type-check          # tsc: main + renderer
```

### Manual GUI smoke (desktop runner required)

The Electron GUI cannot launch on a headless server without desktop libraries
(`libgtk-3` etc.). On a real desktop:

```bash
npm run build && npm run stage:validator
npm start                   # launches the tray app + onboarding window
```

Confirm: the onboarding window appears, entering a test account shows a derived
`0x…` address, provisioning installs YugabyteDB, and the tray shows the node
reaching "Running" with the dashboard reachable at `http://127.0.0.1:3001`.

## Uninstall

- **Windows:** Add/Remove Programs → OmniBazaar Service Node. The WSL distro and
  its YugabyteDB persist; remove with `wsl --unregister Ubuntu` if desired.
- **macOS:** delete the app from `/Applications`. Data lives in
  `~/.omnibazaar/`.
- **Linux:** `sudo dpkg -r omnibazaar-service-node` (or delete the AppImage).

User data (`~/.omnibazaar/`) and the encrypted credentials in the app's
`userData` directory are left in place; delete them manually to fully reset.

## Layout

```
service-desktop/
├── src/
│   ├── main.ts              # orchestrator: onboarding, supervisor, tray, IPC
│   ├── preload.ts           # context-bridge typed IPC surface
│   ├── ipc.ts               # IPC channel + payload contract
│   ├── config.ts            # service-node env builder (pure)
│   ├── child-supervisor.ts  # spawn / health-poll / graceful-stop / restart
│   ├── tray.ts + tray-state.ts
│   ├── preflight.ts         # spawn Validator node-preflight, parse JSON
│   ├── credential-store.ts  # safeStorage-backed encrypted credentials
│   ├── settings.ts          # non-secret launcher settings
│   ├── updates.ts           # on-chain version check (shared CLI)
│   ├── i18n.ts + paths.ts
│   ├── dep-provisioner/     # index (dispatch) + unix + windows-wsl2
│   └── renderer/            # onboarding / dashboard / logs (vanilla TS + HTML)
├── locales/                 # en es fr de it pt zh ja ko ru
├── scripts/                 # stage-validator.js, copy-renderer-assets.js
└── electron-builder.yml     # NSIS / dmg / deb + AppImage
```
