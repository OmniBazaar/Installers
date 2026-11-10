#!/bin/sh
# Sign and notarize the macOS listing-node archive from Linux, with apple-codesign.
#
# `macos-notarize.sh` beside this file does the same job on a Mac. This one exists
# because the build host is Linux and we do not want a Mac in the release loop: the
# Developer ID key and the App Store Connect key are files, and nothing about the
# process needs a keychain.
#
# What it does, in the order Apple requires:
#
#   1. Extracts the archive and finds every Mach-O binary in it.
#   2. Refuses to do anything if there are none — see "Why that matters" below.
#   3. Signs each Mach-O with the Developer ID key, hardened runtime, timestamped.
#   4. Verifies its own signatures before uploading.
#   5. Rebuilds the .zip and submits it to Apple, waits, and reports the verdict.
#
# Why that matters: notarization is a verdict on executable code. Today's macOS
# archive is JavaScript and shell only, so Apple has nothing to judge and Gatekeeper
# never kills it — an operator on Apple silicon installs Node with Homebrew and runs
# `install.sh`. The step becomes real the moment the archive bundles a Node runtime
# (`build-artifacts.mjs --node-runtime <dir>`), because then the archive carries
# `node/bin/node` and an unsigned one is deleted on first run. This script signs it.
#
# Required:
#   OBZ_TEAM_ID              Apple Developer Team ID (10 characters).
#   OBZ_SIGN_P12             .p12 holding the Developer ID Application certificate
#                            and its private key (exported once, kept private).
#   OBZ_SIGN_P12_PASSWORD    password for that .p12.
#
# Notarization credential — one of:
#   OBZ_API_KEY_FILE         JSON from `rcodesign encode-app-store-connect-api-key`
#                            (recommended: Issuer ID, Key ID and .p8 in one file), or
#   OBZ_API_KEY_ID + OBZ_API_ISSUER with AuthKey_<ID>.p8 in ~/.appstoreconnect/private_keys/
#
# Optional:
#   OBZ_SIGN_IDENTITY_NAME   team name for the signature (default: Omni Administration Ltd)
#   OBZ_NOTARY_TIMEOUT       max seconds to wait for Apple (default: 900)
#
# Usage: OBZ_TEAM_ID=… OBZ_SIGN_P12=… OBZ_API_KEY_FILE=… \
#          ./macos-notarize-linux.sh <omnibazaar-listing-node-<version>-macos.zip>
#
# 🛑 Signing rewrites the archive, so its SHA-256 changes. Rebuild the artifact
# manifest and republish — never notarize a copy that has already been attested on
# chain, because the attested hash would then describe a file nobody downloads.
set -eu

archive="${1:-}"
if [ -z "$archive" ] || [ ! -f "$archive" ]; then
  echo "usage: $0 <omnibazaar-listing-node-<version>-macos.zip>" >&2
  exit 2
fi
archive=$(cd "$(dirname "$archive")" && pwd)/$(basename "$archive")

if ! command -v rcodesign >/dev/null 2>&1; then
  echo "rcodesign is not installed. Install apple-codesign:" >&2
  echo "  https://github.com/indygreg/apple-platform-rs/releases  (single binary, no runtime)" >&2
  echo "  or: cargo install apple-codesign" >&2
  exit 2
fi

team_name="${OBZ_SIGN_IDENTITY_NAME:-Omni Administration Ltd}"
timeout_s="${OBZ_NOTARY_TIMEOUT:-900}"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
payload="$work/payload"   # what goes back into the archive — nothing else may live here
mkdir -p "$payload"

echo "Extracting $archive"
unzip -q "$archive" -d "$payload"

# A nested unsigned binary rejects the whole submission, so find them all first.
# The executable bit is not reliable in an archive built on another host, so the
# magic bytes decide.
echo "Looking for Mach-O binaries…"
macho_list="$work/mach-o-list.txt"
: > "$macho_list"
find "$payload" -type f | while IFS= read -r f; do
  if file -b "$f" 2>/dev/null | grep -q "^Mach-O"; then
    printf '%s\n' "$f"
  fi
done > "$macho_list"
count=$(wc -l < "$macho_list" | tr -d ' ')

if [ "$count" -eq 0 ]; then
  cat >&2 <<'MSG'
This archive contains no Mach-O binary, so there is nothing to sign and nothing for
Apple to notarize. That is expected for the current macOS package: it is JavaScript
and shell, and it asks the operator to install Node with Homebrew.

To make notarization meaningful, build the archive with a bundled runtime:

  node build-artifacts.mjs --platforms macos --node-runtime /path/to/macos-node-dir

Then the archive carries node/bin/node, and this script signs it.
MSG
  exit 3
fi
echo "  found $count Mach-O file(s)"

# Credentials are checked only after we know there is something to sign: on a
# JavaScript-only archive the answer is "nothing to notarize", and demanding a key
# first would send the operator looking for a credential they do not need.
: "${OBZ_TEAM_ID:?OBZ_TEAM_ID is required (Apple Developer Team ID, 10 characters)}"
: "${OBZ_SIGN_P12:?OBZ_SIGN_P12 is required (Developer ID Application .p12)}"
: "${OBZ_SIGN_P12_PASSWORD:?OBZ_SIGN_P12_PASSWORD is required}"
[ -f "$OBZ_SIGN_P12" ] || { echo "no .p12 at $OBZ_SIGN_P12" >&2; exit 2; }

notary_args=""
if [ -n "${OBZ_API_KEY_FILE:-}" ]; then
  [ -f "$OBZ_API_KEY_FILE" ] || { echo "no API key file at $OBZ_API_KEY_FILE" >&2; exit 2; }
  notary_args="--api-key-file $OBZ_API_KEY_FILE"
elif [ -n "${OBZ_API_KEY_ID:-}" ] && [ -n "${OBZ_API_ISSUER:-}" ]; then
  notary_args="--api-key $OBZ_API_KEY_ID --api-issuer $OBZ_API_ISSUER"
else
  echo "No notarization credential. Set OBZ_API_KEY_FILE, or OBZ_API_KEY_ID + OBZ_API_ISSUER." >&2
  echo "Create the key at https://appstoreconnect.apple.com/access/api — the .p8 downloads once." >&2
  exit 2
fi

entitlements="$work/entitlements.plist"
cat > "$entitlements" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.cs.allow-jit</key><true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key><true/>
  <key>com.apple.security.cs.disable-library-validation</key><true/>
</dict></plist>
PLIST

echo "Signing"
while IFS= read -r f; do
  # `--for-notarization` supplies the three things Apple demands and people forget:
  # a Developer ID certificate, a secure timestamp, and the hardened runtime flag.
  if ! rcodesign sign --for-notarization \
      --p12-file "$OBZ_SIGN_P12" --p12-password "$OBZ_SIGN_P12_PASSWORD" \
      --team-name "$team_name" --entitlements-xml-file "$entitlements" "$f"; then
    echo "signing failed: $f" >&2
    exit 4
  fi
done < "$macho_list"

echo "Checking what Apple checks before uploading"
# rcodesign's own `verify` warns that it does not check everything, so it is only half
# the answer. The other half is the two properties the notary service actually requires
# and which are visible in the signature: the hardened runtime flag and a secure
# timestamp. A signature missing either is rejected by Apple, not by us.
while IFS= read -r f; do
  if ! rcodesign verify "$f" >/dev/null 2>&1; then
    echo "signature verification failed: $f" >&2
    rcodesign print-signature-info "$f" >&2 || true
    exit 4
  fi
  info=$(rcodesign print-signature-info "$f" 2>/dev/null || true)
  case "$info" in
    *"CodeSignatureFlags(RUNTIME)"*) ;;
    *) echo "hardened runtime flag missing on $f — Apple would reject it" >&2; exit 4 ;;
  esac
  case "$info" in
    *"signing_time:"*) ;;
    *) echo "no secure timestamp on $f — Apple would reject it" >&2; exit 4 ;;
  esac
done < "$macho_list"
echo "  signed, hardened, timestamped"

echo "Repacking"
# Replace only the signed copy of the archive; the file name and location stay the
# same so the release step finds it where it expects it. The zip is built from the
# extracted payload alone, so the working files beside it never enter the archive.
rm -f "$archive"
(cd "$payload" && zip -qry "$archive" .) || { echo "repack failed" >&2; exit 4; }
echo "  $archive ($(wc -c < "$archive" | tr -d ' ') bytes)"

echo "Submitting to Apple (waiting up to ${timeout_s}s)"
# `$notary_args` is deliberately unquoted: it is one or two flag/value pairs built above.
if ! rcodesign notary-submit $notary_args --wait --max-wait-seconds "$timeout_s" "$archive"; then
  cat >&2 <<'MSG'
Submission failed. Apple's verdict, not ours, is the answer — read it with the
submission id printed above:

  rcodesign notary-log --api-key-file <key.json> <submission-id>
MSG
  exit 5
fi

cat <<MSG
Notarized. Reminders:
  • A .zip cannot be stapled, so nothing more is needed here — the ticket is
    fetched online the first time the node runs (see SIGNING_AND_UPDATE_PATH.md §3).
  • The archive's SHA-256 has changed. Rebuild the artifact manifest and publish
    the new hash; do not attest this file against the old one.
MSG
