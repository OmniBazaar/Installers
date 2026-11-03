# Code signing policy

**Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by
[SignPath Foundation](https://signpath.org).**

This policy covers the **OmniBazaar listing node** Windows installer
(`omnibazaar-listing-node-<version>-win-x64-setup.exe`) published at
`https://get.omnibazaar.com/node-software/`. Nothing else is signed under this policy: the
macOS and Linux packages are not Authenticode-signed, the web applications ship through
their own distribution channels, and no OmniBazaar artifact is signed by a third party
other than as stated here.

*(The sentence above is required verbatim while the certificate is issued by SignPath
Foundation. When an OmniBazaar certificate is in place — see
[`SIGNING_AND_UPDATE_PATH.md`](SIGNING_AND_UPDATE_PATH.md) §2 — the publisher name becomes
Omni Administration Ltd and this sentence is replaced, not deleted.)*

## What the signature means

A valid signature on that file means two separate things:

1. **Origin.** The binary was produced by an automated build from the source at
   `https://github.com/OmniBazaar/Validator` and `https://github.com/OmniBazaar/Installers`,
   at the commit named in the release record. It is not a hand-assembled artifact.
2. **Identity.** The publisher on the Windows prompt is the entity named in the
   certificate — SignPath Foundation while their certificate is in use, Omni Administration
   Ltd once ours is.

It does **not** mean the software has been security-audited, and it is not a statement about
the marketplace's content.

## Team roles

Code signing is approved by a member of the project team, never automatically by CI.

| Role | Responsibility | Member |
|---|---|---|
| **Author** | May change source and build scripts | [OmniBazaar owners](https://github.com/orgs/OmniBazaar/people?query=role%3Aowner) |
| **Reviewer** | Reviews every change from a non-committer before it merges | [OmniBazaar owners](https://github.com/orgs/OmniBazaar/people?query=role%3Aowner) |
| **Approver** | Decides that a specific release may be signed; clicks the approval in SignPath | Chris (founder), with a second approver to be added before the first public release |

All members use **multi-factor authentication** on both GitHub and SignPath. A release
whose source commit has not been reviewed does not get signed; a signing request that
arrives without a named approval is rejected by the SignPath configuration, not by
goodwill.

## How a release is built

1. A tag on `OmniBazaar/Installers` runs
   `.github/workflows/listing-node-windows.yml`.
2. The workflow builds from **public source only**. Its two third-party inputs are pinned
   by URL **and** SHA-256 in
   [`listing-node-windows/tools.lock.json`](listing-node-windows/tools.lock.json) — Node.js
   20.18.0 and the PostgreSQL 16.4 Windows binaries — so a changed upstream artifact fails
   the build instead of silently changing what we ship.
3. The staged tree is checked for completeness before anything is signed: a missing
   `config/listing-node-surface.json` or a missing PostgreSQL `share/` directory aborts the
   build rather than producing an installer that fails on an operator's machine.
4. The signing request is submitted to SignPath with the SHA-256 of the built installer,
   and is approved by a team member.
5. The signed installer and its SHA-256 are published. The attestation in the on-chain
   `UpdateRegistry` records the hash of the **signed** file, so the hash an operator checks
   is the hash of the bytes they downloaded.

Reproducing a build: the workflow, the two pinned inputs and the staging script are all in
this repository. A rebuild of the same tag on the same Node version produces the same
installer; the hash is published beside every release.

## Privacy

**This program will not transfer any information to other networked systems unless
specifically requested by the user or the person installing or operating it.**

Concretely, the listing node contacts:

- the **gateway** named in its own `listing-node.env` (`GATEWAY_URL`), to sync the listings
  the operator chose to mirror and to relay a seller's signed listing — this is the
  product's function, and it is the only destination it is configured with;
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
provides an uninstaller that never deletes an operator's listings or the node's identity by
default — the identity holds the key the node's fees are paid to.

## Reporting a problem with a signed binary

If you believe a file signed under this policy does not correspond to the published source,
report it to `support@omnibazaar.com` and to
[SignPath](mailto:support@signpath.io). A signature that cannot be traced to a reviewed
commit is treated as a security incident, and the release is withdrawn.
