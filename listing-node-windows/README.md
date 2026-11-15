# Listing node on Windows

The Windows product is **one directory** copied into the operator's own profile, plus
one shortcut. No service, no administrator rights, no machine-wide state, and no
PowerShell copy of the installer's logic — the decisions live in
`Validator/src/cli/listingNodeManage.ts`, which the Linux installer drives too.

```
listing-node-windows/
├── build-bundle.mjs                assembles out/ and refuses an incomplete bundle
├── omnibazaar-listing-node.nsi     NSIS 3 — copies, shortcuts, first run
├── out/                            the staged bundle (not committed)
└── README.md
```

**NSIS, not Inno Setup — decided on evidence.** Inno's compiler runs only on Windows,
and its installer does not complete under Wine 6, so an Inno build could not be
produced by this build host at all. NSIS compiles here, which means the artifact we
hash and attest is the artifact this pipeline built, on the machine that also signs
and publishes.

## What gets installed, and where

| Piece | Path | Notes |
|---|---|---|
| Program, node runtime | `%LOCALAPPDATA%\OmniBazaar\ListingNode\app` | per user, never Program Files |
| PostgreSQL | `%LOCALAPPDATA%\OmniBazaar\ListingNode\pgsql` | beside the program, deleted on uninstall |
| Database cluster | `…\ListingNode\data` | `initdb` on first run, loopback only |
| Identity (key, node address, database URL) | `…\ListingNode\config\listing-node.env` | written once, never overwritten |
| Node log | `…\ListingNode\logs\listing-node.log` | rotated at 10 MB, five kept |
| PostgreSQL log | `…\ListingNode\data\pg_log` | the server rotates its own (see below) |

Two accounts on one machine therefore get two independent nodes, which is the
behaviour a database inside a user profile implies.

## What the operator gets, and what they can change

The Start Menu folder opens the operator console at **http://127.0.0.1:3200/**. It
answers on loopback only and refuses any request whose `Host` header names something
else, so a web page the operator visits cannot read it. It shows the node's address,
how many listings the replica holds, when it last synced, the jobs that are running and
the log, and it carries the four settings an operator may change — gateway, port,
discovery scope and region — with the exact sentence to follow to make a change take
effect. Every other key in `listing-node.env` is refused: the node's key, its address
and its database address are identity, not preferences.

The terminal equivalent is the same code:

```
obz-listing-node config                          # show the four settings
obz-listing-node config --set NODE_PORT=3210     # validate, write, say what to do
obz-listing-node restart                         # what makes a saved setting real
```

A saved setting is **not** a live one — the running node read its file at boot, and the
console shows "saved — needs a restart" until it is restarted. That state is invisible
from anywhere else, which is why it is stated twice: on the row and above the table.

## Building a bundle

```
NODE_WINDOWS_ZIP=node-v20.18.0-win-x64.zip \
PG_WINDOWS_ZIP=postgresql-16.4-1-windows-x64-binaries.zip \
  node build-bundle.mjs --validator ../../Validator --out ./out
```

Or, with both already extracted: `--node-runtime <dir> --pg-dir <dir>`. Then:

```
mkdir -p dist && makensis -DVERSION=1.0.11 omnibazaar-listing-node.nsi
```

Yields `dist/omnibazaar-listing-node-1.0.11-win-x64-setup.exe` (52 MB, 2025-11-01).
`dist/` and `out/` are gitignored: a build output must never look like a source change. The
nine-digit per-file manifest is inside the bundle as `bundle-manifest.json`.

`tools.lock.json` pins the two third-party inputs (Node and PostgreSQL for Windows)
by URL and SHA-256, so a rebuild is reproducible and a changed upstream artifact is
visible rather than assumed. That file is the tracked "recipe"; the zips and the
resulting installer are not tracked anywhere.

The bundle is refused unless every required part is present. Three of them were
learned by running it, not by reading it:

1. **`config/listing-node-surface.json`** — the node reads it at boot from
   `join(__dirname, "..", "config")`. A bundle without `config/` installs perfectly
   and then every start dies with `ENOENT … listing-node-surface.json`.
2. **`pgsql/lib` and `pgsql/share`** — staging only `pgsql/bin` makes `initdb` fail
   with `could not access file "$libdir/dict_snowball"`. The text-search
   dictionaries are data files.
3. **The manifest is the record** — `bundle-manifest.json` lists every file with its
   SHA-256, so a release attestation hashes a list rather than a single archive.

## Proving it before signing

The installer's behaviour is `obz-listing-node <command>`, so it is testable without
Windows. This was run on Linux, against real PostgreSQL 16 binaries, as a non-root
user, with the bundle staged exactly as above:

```
install   → initdb, cluster on 127.0.0.1:55440, role + database, 2 migrations, identity
start     → node detached, log opened, pid recorded
status    → database running, node running, /health 200 with both jobs
catalogue → GET /api/v1/marketplace/listings 200 {"scope":"own", …}
rotate    → 11 MB log rotated to listing-node.log.1
uninstall → program removed, data/ and config/ kept
reinstall → identity kept (same node address), schema re-applied, /health 200
```

## When an install "did nothing"

Symptom seen in the first Windows test: the installer completes, the manager reports
a database that will not start, and afterwards neither the install folder nor a log
exists. Before reading anything else, three checks on the SAME machine that ran the
installer:

```
type "%TEMP%\omnibazaar-install-path.txt"      where the installer actually wrote
dir "%LOCALAPPDATA%\OmniBazaar\ListingNode"    what landed there
dir C:\OmniBazaar                             in case $LOCALAPPDATA expanded empty
```

The installer now writes that first file before copying anything, and aborts with a
message if `app\node.exe` is missing afterwards — antivirus and Controlled Folder
Access are the usual reasons a copy silently does not land.

## What still needs a Windows virtual machine

These cannot be proven anywhere else, and P4's exit criteria name them:

- `%LOCALAPPDATA%` with a non-ASCII account name and a space in it;
- PostgreSQL starting from a path with a space (argument passing is argv, never a
  shell string — but that is an assertion until it runs);
- a first run with Windows Defender holding a handle on a freshly written file;
- logon autostart through the Startup folder;
- uninstall keeping data, and the `--purge` path deleting it;
- clean Windows 10 22H2 and Windows 11 images, install → list an item → see it in
  search → buy from a second machine → uninstall.

## Signing

The certificate is **Certum OV through SimplySign**, issued to Omni Administration Ltd.
Signing is part of the build, not a later step: `build-artifacts.mjs` runs the signer
between `makensis` and hashing, so the attested hash always describes the signed bytes.

- **CI:** `.github/workflows/listing-node-windows.yml` builds and signs on
  `ubuntu-latest` with `ssign` (pinned by SHA-256), behind a `signing` environment that
  needs a human approval. Secrets: `CERTUM_EMAIL`, `CERTUM_OTP` (the TOTP seed).
- 🛑 **The approval does not exist yet.** The `signing` environment was created on
  2026-11-15 and GitHub refused the required-reviewer rule: protection rules on a
  *private* repository need GitHub Pro/Team/Enterprise, and `OmniBazaar` is on the Free
  plan. An environment with no protection rule is worse than none, because the workflow
  looks gated. Until the plan is upgraded or `Installers` is made public (it is MIT, and
  `CODE_SIGNING_POLICY.md` already publishes it as the build source), **do not store
  `CERTUM_EMAIL`/`CERTUM_OTP`**: a tag push would then sign without an approval.
- **Capture the TOTP seed, not just the QR.** `CERTUM_OTP` is the base32 seed behind the
  SimplySign QR code shown once at activation (ssign accepts the seed or the full
  `otpauth://` URI). Scanning it only into a phone leaves CI with nothing to log in
  with, and the fix is a QR re-issue at Certum.
- **Locally / from `/publish`:** export the same two variables plus
  `OBZ_LISTING_NODE_SIGN_COMMAND` and `OBZ_LISTING_NODE_UNINST_SIGN_COMMAND`; see
  `/publish` §2e.
- **The uninstaller is signed too** (`!uninstfinalize`), so uninstalling does not raise
  "Unknown publisher".
- **The installer checks itself.** A build made with `--verify-signature` refuses to run
  unless its own Authenticode signature is valid and issued to Omni — the entire payload
  is inside that executable, so one valid signature covers every file it writes.

Until the certificate is issued, the published installer is unsigned and SmartScreen
shows "Windows protected your PC"; that prompt is the honest current state.
