# Signing, notarization, and the update path — working document

*Started 2026-11-03. This is the document to work from: what each signing route actually
requires of us, what is already built, and what is still a decision. Sections 1–3 are
research + procedure; section 4 is the design for telling operators about new builds and
letting them upgrade in one click; section 5 is the short list of decisions.*

**Status, 2026-11-09.** The decision is taken: **Certum OV code signing (SimplySign)
has been purchased and started**, and §2 is the procedure in force. SignPath Foundation
(§1) is **not** being pursued: `Installers` is MIT as of 2026-11-09, but the
repositories it builds from are private, and their conditions require public,
verifiable builds. Keep §1 only as the fallback research. The listing-node 1.0.13 release is published and attested on chain
(Windows installer `7340bdae…`, Linux archive `9c8a6aea…`), **still unsigned**: the
certificate is in validation. The CI that signs it is prepared and awaiting only the
certificate credentials — see `.github/workflows/listing-node-windows.yml` (Certum via
`ssign`, `environment: signing`) and `CODE_SIGNING_POLICY.md`.

---

## 1. SignPath Foundation — findings 

### What it is

SignPath Foundation (a non-profit arm of SignPath.io, which sells a code-signing service)
holds a Windows code-signing certificate **in its own name** and lets open-source projects
sign their releases with it. Signing runs in SignPath's HSM, integrated into CI; for OSS
projects the service is free. It is not a certificate authority and cannot issue to us.

**The single most important consequence:** the publisher shown on the Windows prompt is
**SignPath Foundation**, not OmniBazaar. That is what gets us past "Unknown publisher" —
but it makes a third party the identity our users trust, and the Foundation may pause the
subscription or **revoke the certificate immediately or retroactively** if a condition is
breached later.

### Their conditions, against our current state

| Condition (their words, abridged) | Us | Verdict |
|---|---|---|
| No malware or unwanted programs | A marketplace node | pass |
| OSI-approved licence, **no commercial dual-licensing**, for all components | Validator is MIT; the bundle is MIT code + Node (MIT) + PostgreSQL (PostgreSQL licence) + ethers/express/pg/winston (MIT) | **pass, verify each shipped file** |
| No proprietary component of any kind | Nothing closed in the installer | pass |
| Actively maintained | Yes | pass |
| **Already released in the form to be signed** | ❗ nothing is published as a release yet | **blocker 1** |
| Functionality documented on the download page | Partial | to do |
| Sign **your own** projects and binaries only | Our own code; upstream `node.exe`/`psql` may be included unsigned in a signed package — explicitly allowed | pass |
| No hacking tools | none | pass |
| Privacy: describe any data sent to systems the user did not specify; show the policy at install; allow disabling | The node sends listings to the gateway **by design**, and no analytics. Needs a privacy statement on the install/download page | **to do** |
| Announce system changes | Installer says it creates a database and autostart in the user profile | pass, restate at install |
| Provide uninstallation | `uninstall` + installer uninstaller, keeps data unless asked | pass |
| **MFA for all team members** on GitHub *and* SignPath | Confirm for you and Chris | **to do** |
| Roles: **Authors / Reviewers / Approvers**, each signing approved by a trusted member | Two-person team; define and publish | **to do** |
| **Code signing policy on the project home page**, with the exact sentence "Free code signing provided by SignPath.io, certificate by SignPath Foundation", team roles with links, and a privacy-policy line | Does not exist | **blocker 2** |
| Artifact metadata: product name/version attributes set and equal in every build | Fixed today in the `.nsi` (`VIProductVersion` came from a hard-coded `1.0.11`); `LegalCopyright` added | pass |
| **Binaries built from source in a verifiable way**, every release manually approved | Our Windows installer is built by hand on a Linux host today | **blocker 3** |
| "We require a certain verifiable reputation" for executable programs | New project name, no download history | **soft risk — they may simply decline** |

### Verdict

We are **structurally eligible**: all-OSS stack, MIT licence, public repos, an uninstaller,
and no bundled proprietary code. We are **not eligible today** because of three concrete
gaps and one subjective one:

1. Nothing is released in the form we want signed. *(Publishing is our own gated step.)*
2. There is no "Code signing policy" page with their required wording and roles.
3. The Windows build is not a verifiable CI build from public source.
4. Their reputation clause is discretionary: an executable product nobody has downloaded
   is exactly the case they say they are cautious about.

### Prepared on 2026-11-03 (what exists now)

| Gap | State |
|---|---|
| Code signing policy page | **Written**: [`CODE_SIGNING_POLICY.md`](CODE_SIGNING_POLICY.md) — their exact sentence, roles, privacy line, build process, reporting route. Still to be linked from the website download page and the repo READMEs. |
| Verifiable CI build | **Written**: [`.github/workflows/listing-node-windows.yml`](.github/workflows/listing-node-windows.yml) — builds from public source on `windows-latest`, downloads Node and PostgreSQL by the pinned SHA-256 in `tools.lock.json`, verifies both, produces the installer + hash, and has the SignPath submit step ready but inert until the secrets exist. |
| Product-version metadata | **Fixed**: `VIProductVersion` now comes from `-DVERSION` (it was hard-coded `1.0.11` while shipping as 1.0.25), `ProductVersion` and `LegalCopyright` added. A signer's artifact policy requires these to be set and equal in every build. |
| Release exists | Open — needs the publish step. |
| MFA + roles | Roles are written in the policy; MFA to be confirmed on both accounts. |

### What it would take, in order

1. **Publish a real release** (IPFS pin + `publishRelease` attestation) — the same
   `[ASK]` step already pending. SignPath requires the project to *already be released*.
2. **Add the Code signing policy page** to the download page and the repo README, with
   their exact sentence, the Author/Reviewer/Approver roles and links, and the privacy
   line. Small, but it must be live before applying.
3. **Move the Windows packaging into a public GitHub Actions workflow** (`windows-latest`
   or Linux with `makensis`), downloading Node and PostgreSQL by the pinned SHA-256 in
   `tools.lock.json`, and calling SignPath's GitHub action for the signing step. The
   signing request needs a named Approver, so each release is a manual click.
4. **Confirm MFA** on both accounts, and register the project at `signpath.io`.
5. Keep the artifact set to the **listing-node installer only** at first. The gateway
   payload is a server tarball and gains nothing from Authenticode; do not widen scope.

**Effort:** 2–4 days of pipeline work plus their review. **Cost:** zero.
**Risk:** discretionary rejection on reputation; and the publisher name is theirs.

**A useful detail for the fallback:** their terms say *"If you bring your own
certificate, that's it"* — a free OSS SignPath subscription combined with our own
certificate is a supported combination, which is an option if we ever want their CI
integration with our identity on the signature.

---

## 2. Certum OV code signing — findings and the exact steps

> 🟢 **CHOSEN.** Purchased and started 2026-11-09. The signing client used in CI is
> `ssign` (MIT, `https://github.com/Le-Syl21/ssign`), pinned to v0.1.11 by SHA-256 in the
> workflow: it logs in to the SimplySign cloud over HTTPS and signs a PE file from a
> Linux runner, so the release does not depend on a Windows machine or on SimplySign
> Desktop running under a virtual display. The Linux variant of step 4 below therefore
> replaces `signtool`: see `.github/workflows/listing-node-windows.yml`.

### Why Certum

Cheapest publicly-trusted OV certificate: roughly **€139–209/year direct**, or
**$108–167/year** through resellers, and **SimplySign** cloud signing is included, so the
private key lives in Certum's HSM (mandatory since June 2023 — no CA will email a `.pfx`).
The publisher name on the prompt is **OmniBazaar / Omni Administration Ltd**, which is the
reason to prefer this over SignPath for a product we intend to keep.

Alternatives for comparison: Sectigo OV from ~$219/yr; SSL.com OV $129/yr + eSigner
~$180/yr (eSigner is the one with a proper REST API); DigiCert ~$400/yr;
**Azure Artifact Signing** $9.99/mo but its public-trust organisation validation requires
**3+ years of verifiable tax history** — check the incorporation date before spending time
on it.

### The one architectural constraint

SimplySign presents the certificate as a virtual smart card through a **Windows/macOS**
client. Our NSIS build runs on a Linux host, so signing has to happen either:

- **(a)** on the `windows-latest` GitHub runner (recommended — no new infrastructure), or
- **(b)** on a Windows VM we keep, or
- **(c)** with SSL.com eSigner instead of Certum, which has a REST API callable from Linux.

### Steps

**1. Order.** `shop.certum.eu` → Code Signing → *Code Signing in the Cloud* (OV/Company).
Buy 2–3 years: renewal repeats the whole validation. Resellers (e.g. sslmentor) are
cheaper for the same Certum product; they add a support layer that is useful for BVI.

**2. Validation — the part that takes a week.** Have ready:

- Registry extract / certificate of incorporation for **Omni Administration Ltd**, exact
  legal name, BVI registered address (the same pack Apple accepted).
- **D-U-N-S number 815516811.** This is what lets them find a BVI entity in an
  independent directory, and it is where applications usually stall.
- **A business telephone number listed in an independent directory** (registry, D&B, or
  the website contact page). They will call it. A mobile-only number fails organization
  validation.
- The requester's passport/ID, and a video or selfie identity check.
- Card payment. BVI entities occasionally draw a request for an apostilled extract; if
  that happens, work through the reseller rather than re-ordering direct.

**3. Issuance and activation.** You receive an activation code, not a file. Install
**SimplySign Desktop** on Windows (or macOS), sign in, and the certificate appears as a
virtual card. Nothing is exported and nothing can be.

**4. Sign.** With the certificate in the store:

```bat
signtool sign /sha1 <cert-thumbprint> /fd sha256 /td sha256 ^
  /tr http://timestamp.digicert.com ^
  omnibazaar-listing-node-<v>-win-x64-setup.exe
```

Two things that are easy to get wrong:

- **Always timestamp** (`/tr`). Without it the signature dies with the certificate, and
  every file already downloaded starts warning again.
- **The uninstaller is a separate executable** embedded in the installer. Add
  `!uninstfinalize 'signtool sign … "%1"'` to the `.nsi`, or the operator sees "Unknown
  publisher" at the worst moment — when they uninstall.

**5. Verify.** `signtool verify /pa /v <file>`. Our build already does this and refuses to
record an artifact whose signature fails.

**6. Wire it in.** The pipeline support is built: `build-artifacts.mjs --sign-command`
runs the signer **between `makensis` and the hash**, so the attested hash describes the
signed bytes. Authenticode changes the file; hash-then-sign would attest something nobody
downloads.

**7. Expectation setting.** An OV signature removes "Unknown publisher" and shows our
name, but a brand-new certificate starts with no reputation: some users still see
"Windows protected your PC" with a named publisher for the first weeks. Reputation
accrues **per certificate**, so keep the same one across releases. EV (~$226–750/yr) is
the only shortcut and is not needed.

---

## 3. Apple notarization — findings and the exact steps

### Facts that decide the shape

1. **The Mac App Store is not required.** Direct distribution with a **Developer ID**
   certificate and notarization opens with no warning at all.
2. **The Mac App Store is also not viable for this product.** Guideline 2.5.2 forbids
   downloading or installing executable code; 2.4.5(iii)/(iv) forbid the long-running
   background processes this node is made of; and a sandbox cannot own a PostgreSQL data
   directory in the user's profile. Keep the store for Mobile and Wallet only.
3. **On Apple silicon an unsigned or unnotarized binary is not warned about — it is
   killed** ("is damaged and can't be opened"). Signing is mandatory there, not polish.
4. **`notarytool` accepts `.dmg`, `.pkg`, `.zip`.** A `.tar.gz` cannot be notarized, which
   is why the macOS package is now a `.zip`.
5. **A `.zip` cannot be stapled.** Its ticket is fetched online on first run — fine for a
   network install. A `.pkg` can be stapled for offline verification, but `pkgbuild`
   installs as root, which conflicts with our per-user rule. Recommendation: `.zip` now,
   reconsider `.pkg` only if we need offline installs.
6. **Developer ID Application** is the certificate we need. **Developer ID Installer** is a
   *separate* certificate, needed only for `.pkg`.
7. **The macOS archive we ship today contains no executable code, so fact 3 does not
   apply to it yet.** `omnibazaar-listing-node-<v>-macos.zip` is JavaScript and shell only
   (checked 2026-11-10: 8,641 files, zero Mach-O, zero ELF) and it tells the operator to
   `brew install node postgresql@16`. Gatekeeper only judges Mach-O, so nothing of ours is
   killed on Apple silicon today — and there is nothing for notarization to judge either.
   The kill in fact 3 arrives the moment the archive bundles a Node runtime, which is the
   decision in "Still open" below. Do not describe the current package as notarized or as
   needing notarization; describe it as JavaScript that runs on the operator's own Node.

### Steps

**1. Confirm the certificate (on the Mac).**

```bash
security find-identity -v -p codesigning
# want: "Developer ID Application: Omni Administration Ltd (TEAMID)"
```

If only `Apple Development` appears: Apple Developer portal → Certificates → **+** →
under **Software** choose **Developer ID Application** → Continue → upload the CSR
(`devid.certSigningRequest`) → Continue → Download the `.cer`.

🛑 **That page requires the Account Holder role.** An Admin sees Certificates but not the
Developer ID entries under *Software* — that is the usual reason the option "is not
there". Also, when Apple asks for a **Developer ID Certificate Intermediary**, choose
**G2 Sub-CA (Xcode 11.4.1 or later)**: certificates from the previous authority stop
signing on 1 February 2027, and G2 certificates are valid one year. If the question is
not asked, the portal already issues from G2. Verified against Apple's current account
help, 2026-11-10.

On Linux the CSR is made here, and only the public half leaves the host:

```bash
openssl genrsa -out ~/OmniBazaar/apple/devid.key 2048        # private, 0600
rcodesign generate-certificate-signing-request --pem-file ~/OmniBazaar/apple/devid.key \
  --csr-pem-file ~/OmniBazaar/apple/devid.csr
cp ~/OmniBazaar/apple/devid.csr ~/OmniBazaar/apple/devid.certSigningRequest   # Apple's uploader filters on this
```

**2. Store the notary credential once.** Either an app-specific password
(appleid.apple.com → Sign-In and Security) or, better for CI, an App Store Connect API key
(Users and Access → Integrations → Team Keys, download the `.p8` once):

```bash
xcrun notarytool store-credentials obz-notary \
  --apple-id rickc@omnibazaar.com --team-id TEAMID --password <app-specific>

# or for CI:
xcrun notarytool store-credentials obz-notary \
  --key ~/AuthKey_XXXX.p8 --key-id XXXXXXXXXX --issuer <issuer-uuid>
```

**3. Sign every Mach-O binary in the payload.** This is where submissions fail: one
nested unsigned binary rejects the whole thing, and the log names it. If we bundle Node,
it must be re-signed; the entitlements are the minimum Node needs:

```
com.apple.security.cs.allow-jit
com.apple.security.cs.allow-unsigned-executable-memory
com.apple.security.cs.disable-library-validation
```

```bash
codesign --force --options runtime --timestamp \
  --entitlements ent.plist \
  --sign "Developer ID Application: Omni Administration Ltd (TEAMID)" <binary>
```

`--options runtime` (hardened runtime) is mandatory for notarization.

**4. Build the archive after signing.** Already scripted, and there is one script per
build host — neither needs the other:

```bash
# On a Mac (notarytool + the login keychain):
OBZ_TEAM_ID=TEAMID OBZ_NOTARY_PROFILE=obz-notary \
  ./Installers/listing-node/macos-notarize.sh \
  omnibazaar-listing-node-<v>-macos.zip

# On this Linux build host (apple-codesign; no Mac, no keychain):
OBZ_TEAM_ID=347TJ27QGM \
OBZ_SIGN_P12=~/OmniBazaar/apple/devid.p12 OBZ_SIGN_P12_PASSWORD=… \
OBZ_API_KEY_FILE=~/OmniBazaar/apple/obz-notary-key.json \
  ./Installers/listing-node/macos-notarize-linux.sh \
  omnibazaar-listing-node-<v>-macos.zip
```

`macos-notarize.sh` signs every Mach-O, refuses to submit while anything is unsigned,
submits with `--wait`, prints Apple's own log on failure, and verifies with `spctl`.
`macos-notarize-linux.sh` does the same job with `rcodesign` (apple-codesign 0.29.0,
installed at `~/.local/bin/rcodesign` on this host) and adds one honest guard: if the
archive holds no Mach-O it stops with exit 3 and says so, instead of uploading an archive
that Apple has nothing to judge. Build the key JSON once with
`rcodesign encode-app-store-connect-api-key --api-key <id>.p8 --api-issuer <uuid> --api-key-id <id>`
so the Issuer ID, Key ID and `.p8` travel as one file.

**5. Submit / wait / staple.**

```bash
xcrun notarytool submit <file> --keychain-profile obz-notary --wait
xcrun notarytool log <submission-id> --keychain-profile obz-notary   # only on failure
xcrun stapler staple <file>.pkg     # .pkg/.dmg only; a .zip is not staplable
```

**6. Verify the way an operator will.** Download it in a browser on a **clean** Mac, then:

```bash
xattr -l <file>          # com.apple.quarantine present = Gatekeeper will judge it
spctl --assess --type execute -vv <binary>
codesign -dv --verbose=4 <binary>
```

Double-click must open with no prompt.

**7. CI.** Same commands on `macos-latest`, where `notarytool` and the keychain exist; our
release workflow already has a macOS job for the desktop app. Secrets: `OBZ_TEAM_ID`, the
`.p8`, key id, issuer. Signing from Linux is supported (`macos-notarize-linux.sh`) — what
must never happen is shipping a *Mac-built* artifact re-signed on Linux, because the two
signing stacks are not interchangeable mid-artifact; pick the host, then sign and package
on that host.

**Still open for macOS:** decide **bundle Node + PostgreSQL** (bigger download, every
Mach-O signed, makes notarization meaningful) versus **require `brew install node
postgresql@16`** (smaller, one extra step, what the archive says today); and one real
Apple-silicon run. Bundling changes the archive's SHA-256, so it needs a new version —
not a re-hash of a published one.

---

## 4. Telling operators about new builds, and one-click upgrade

### What already exists (do not rebuild)

- **On-chain `UpdateRegistry`**: components, versions, hashes; deployer-administered,
  already used by the three apps. This is the trust root — a web host cannot forge it.
- **The release pipeline** publishes artifacts under `/node-software/v<ver>/` and records
  what it built (`scripts 7595ed1`).
- The node knows its own version (`Validator/package.json`), has a machine key, a console,
  and an outbound-only network path — the exact shape an update check needs.

### Principle

**The chain beats a web claim.** The node may *learn* that a version exists from the
gateway, but it only *acts* on a version whose hash matches the on-chain record for its
component. Same rule as market labels, for the same reason.

### Notification — three channels, all cheap

1. **Console banner** (the primary surface): "Version 1.0.26 is available — Install now."
   Checked at most every 6 hours, cached, never on page render.
2. **`/health` and `obz-listing-node status`** carry `latestVersion` and
   `updateAvailable`, so the terminal, `doctor`, and any monitoring the operator runs say
   the same thing.
3. **Release announcement** for gateway validators: the release email/Telegram already
   exists for apps; add the node components to it with the exact command, not prose.

No mailing list, no account, no phone-home: the node asks the gateway for the latest
version the same way it already syncs.

### One-click upgrade

`obz-listing-node update` performs, in order, and stops at the first failure:

1. Ask the gateway for the latest version for this component; read the on-chain hash.
2. Download to a temp file; verify **SHA-256** against the on-chain record; verify the
   signature when the build is signed.
3. **Stop** the node and the database.
4. Swap `app/` → `app.previous/` (one rollback slot; never a downgrade).
5. Apply migrations (idempotent, already proven).
6. Start, then **poll `/health`** — the same rule `start` already follows.
7. On failure: swap back, start the previous version, and report both the failure and the
   rollback.

The console button calls the same code. On Windows the swap cannot happen inside the
process whose files are being replaced, so the console spawns the updater **detached**,
which waits for the node to exit and then performs steps 3–7 — the same class of trap as
the console-ownership defect, and the reason the updater is a separate entry point rather
than a function call.

### Explicitly not doing

- **No silent auto-install by default.** These machines run databases; a bad update at
  03:00 is an outage the operator cannot explain. Default is *notify + one click*;
  `OBZ_AUTO_UPDATE=1` opts in for people who want it.
- **No downgrades, no skipping migrations, no partial swaps.**
- **No update from an unattested source**, even with a valid signature: both must agree.

### Phases

| Phase | Work | State |
|---|---|---|
| P1 | Version + latest from the registry, console card, `/health` fields, `status` line | **done** (`Validator 676e8a72`). Verified live: running 1.0.11, latest 1.0.11, `/health` reports `version`/`latestVersion`/`updateAvailable`. |
| P2 | `obz-listing-node update`: verify the registry's SHA-256, swap, migrate, start, roll back on failure (Linux/macOS) | **done** (`Validator 676e8a72`). Refuses a revoked release, refuses when the registry knows no hash, never reports "up to date" after a failed check. |
| P3 | Console "Install the update" button through a detached updater; Windows gets the installer instead | **done for the page and the API**; Windows returns 409 with the installer URL by design. |
| P4 | Gateway-validator upgrade script: download → verify against registry → stop → swap → start → probe a real API route (`/api/v1/node-storefronts`), one host at a time | not started |

Decided 2026-11-03: **notify-only with a one-click button** — no silent auto-install, as
documented above. macOS ships as **`.zip`**, so notarization is a later addition to the same
artifact rather than a change of shape.

### Two decisions inside this

- **Should `listing-node` become its own `UpdateRegistry` component?** Today its artifacts
  ride the `service-node` component. A separate component makes "the latest node version"
  unambiguous and keeps the gateway payload's version independent. Recommended.
- **Where does the latest-version read live?** A gateway endpoint mirroring the registry,
  so a node behind carrier-grade NAT never needs a chain RPC for the check — but the value
  is only trusted when it matches the on-chain hash. Recommended.

---

## 5. Decisions needed

1. **SignPath Foundation application** — free, but the publisher becomes *SignPath
   Foundation* and they can revoke retroactively. Recommend: **apply**, as a bridge, and
   keep Certum as the destination.
2. **Certum OV** — ~$130–180/year for 2–3 years. Recommend: **buy**, because our own name
   is the durable answer, and sign on the Windows runner.
3. **macOS package** — `.zip` (per-user, ticket fetched online) vs `.pkg` (root, stapled).
   Recommend: **`.zip` now**.
4. **Auto-update default** — notify-only (recommended) vs auto-install.
5. **`listing-node` as its own `UpdateRegistry` component** — recommended.

---

*Publishing a release is still the one gate that everything in §1 and the first release of
§4 waits on, and it needs the founder's approval (`[ASK]`: IPFS pin + `publishRelease`).*
