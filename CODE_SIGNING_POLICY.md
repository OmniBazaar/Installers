# Code signing policy

This policy covers **OmniBazaar software for Windows**: the listing-node installer
(`omnibazaar-listing-node-<version>-win-x64-setup.exe`) and the uninstaller embedded in
it. Nothing else is signed under this policy: the macOS and Linux packages are not
Authenticode-signed (macOS uses Apple notarization), and the web applications ship
through their own distribution channels.

The certificate is issued by **Certum** (Asseco) to **Omni Administration Ltd**; the
private key never leaves Certum's hardware security module, and signing is performed in
the cloud through **SimplySign**, using the open-source [`ssign`](https://github.com/Le-Syl21/ssign)
client (MIT licence). The publisher named on the Windows prompt is therefore
**Omni Administration Ltd**.

## What the signature means

A valid signature on that file means two separate things:

1. **Origin.** The binary was produced by an automated build from the source at
   `https://github.com/OmniBazaar/Installers` (which checks out
   `https://github.com/OmniBazaar/Validator` at the commit named in the release record),
   and was signed by the release workflow, not hand-assembled and signed on a desk.
2. **Identity.** The publisher is the legal entity named in the certificate,
   Omni Administration Ltd.

It does **not** mean the software has been security-audited, and it is not a statement
about the marketplace's content.

## What the installer checks about itself

The published installer verifies its own signature before it copies a single file, and
refuses to run if the signature is missing, invalid, or issued to anyone else. Because
the entire payload (the node, its dependencies and the bundled PostgreSQL) is inside
that one executable, a valid signature covers every file the installer will write. The
uninstaller is signed the same way, at build time, so removing the software does not
raise an "Unknown publisher" prompt.

## How a release is built and signed

1. A tag on `OmniBazaar/Installers` (`listing-node-v<version>`) runs
   `.github/workflows/listing-node-windows.yml`.
2. The job declares the `signing` GitHub Environment. Its required-reviewer rule is the
   approval step: the certificate credentials are not readable until a team member
   approves the run.
3. The workflow builds from **reviewable source only** (the build script and workflow are in this repository). Its third-party inputs
   are pinned by URL **and** SHA-256: Node.js 20.18.0 and the PostgreSQL 16.4 Windows
   binaries in [`listing-node-windows/tools.lock.json`](listing-node-windows/tools.lock.json),
   and `ssign` v0.1.11 in the workflow itself. A changed upstream artifact fails the
   build instead of silently changing what we ship.
4. The staged tree is checked for completeness before anything is signed: a missing
   `config/listing-node-surface.json` or a missing PostgreSQL `share/` directory aborts
   the build rather than producing an installer that fails on an operator's machine.
5. `makensis` compiles the installer; the signer runs on the installer **and** on the
   embedded uninstaller; the signature is verified (`osslsigncode verify` / `signtool
   verify`); only then is the SHA-256 computed. Authenticode changes the bytes, so the
   hash published in the release record — and attested on the OmniCoin chain — always
   describes the signed file an operator downloads.
6. A release whose source commit has not been reviewed does not get signed, and a
   signing run without an approval does not start.

Reproducing a build: the workflow, the pinned inputs and the staging script are all in
the repository. The hash of every artifact is published beside the release, and
`obz-listing-node verify --archive <file>` compares a download with the hash recorded in
the on-chain `UpdateRegistry`.

## Team roles

Code signing is approved by a member of the project team, never automatically by CI.

| Role | Responsibility | Member |
|---|---|---|
| **Author** | May change source and build scripts | [OmniBazaar owners](https://github.com/orgs/OmniBazaar/people?query=role%3Aowner) |
| **Reviewer** | Reviews every change from a non-committer before it merges | [OmniBazaar owners](https://github.com/orgs/OmniBazaar/people?query=role%3Aowner) |
| **Approver** | Decides that a specific release may be signed; approves the run | Chris (founder), with a second approver to be added before the first public release |

All members use **multi-factor authentication** on GitHub and on the Certum account. The
SimplySign one-time code is itself the second factor for every signature.

## Privacy

**This program will not transfer any information to other networked systems unless
specifically requested by the user or the person installing or operating it.**

Concretely, the listing node contacts:

- the **gateway** named in its own `listing-node.env` (`GATEWAY_URL`), to sync the
  listings the operator chose to mirror and to relay a seller's signed listing — the
  product's function, and the only destination it is configured with;
- the **OmniCoin RPC endpoint** named in its own build configuration, to read its
  registration and its fee balance and to send `registerNode` and its own fee claim;
- the **gas faucet** on that same gateway, once, when the operator registers the node;
- nothing else. There is no analytics, no telemetry, no update check to a third party, no
  advertising identifier, and no account requirement.

The full product privacy policy is at `https://omnibazaar.com/privacy`. Withdrawing
consent is uninstalling: `obz-listing-node uninstall` removes the software and keeps the
operator's data unless they also ask for it to be deleted.

The installer states what it creates before it creates it (a database cluster and an
autostart entry inside the operator's own profile, with no administrator rights), and
provides an uninstaller that never deletes an operator's listings or the node's identity
by default — the identity holds the key the node's fees are paid to.

## Reporting a problem with a signed binary

If you believe a file signed under this policy does not correspond to the published
source, report it to `support@omnibazaar.com`. A signature that cannot be traced to a
reviewed commit is treated as a security incident, and the release is withdrawn.
