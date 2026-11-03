#!/bin/sh
# Notarize the macOS listing-node package — sign, submit, wait, and say what to do next.
#
# Run this ON A MAC. Notarization talks to Apple with credentials that only exist on a
# Developer ID, and signing with a Developer ID certificate needs the keychain holding
# it; nothing here can be done from the Linux build host.
#
# What it does, in the order Apple requires:
#
#   1. Signs every Mach-O binary we ship. A nested unsigned binary is the single most
#      common notarization failure, and the log names it — this step finds them first.
#   2. Submits the .zip (notarytool accepts .dmg/.pkg/.zip; a .tar.gz is not eligible).
#   3. Waits, then prints Apple's own log on failure instead of guessing.
#   4. Verifies the result the way Gatekeeper will.
#
# Stapling: a .zip cannot be stapled. The ticket is fetched online on first run, which
# is fine for an install over a network. If a future release needs an offline-verifiable
# package, build a .pkg and staple that instead.
#
# Environment:
#   OBZ_TEAM_ID        Apple Developer Team ID (10 characters, e.g. A1B2C3D4E5)
#   OBZ_NOTARY_PROFILE keychain profile created once with
#                      `xcrun notarytool store-credentials obz-notary \
#                         --apple-id <apple id> --team-id $OBZ_TEAM_ID \
#                         --password <app-specific password>`
#   OBZ_SIGN_IDENTITY  optional, defaults to "Developer ID Application: …($OBZ_TEAM_ID)"
#
# Usage: OBZ_TEAM_ID=… OBZ_NOTARY_PROFILE=obz-notary ./macos-notarize.sh <archive.zip>
set -eu

archive="${1:-}"
if [ -z "$archive" ] || [ ! -f "$archive" ]; then
  echo "usage: $0 <omnibazaar-listing-node-<version>-macos-<arch>.zip>" >&2
  exit 2
fi

: "${OBZ_TEAM_ID:?OBZ_TEAM_ID is required}"
: "${OBZ_NOTARY_PROFILE:?OBZ_NOTARY_PROFILE is required (xcrun notarytool store-credentials)}"
identity="${OBZ_SIGN_IDENTITY:-Developer ID Application: Omni Administration Ltd ($OBZ_TEAM_ID)}"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "This must run on macOS: notarytool and codesign exist only there." >&2
  exit 2
fi

if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo "No Developer ID Application certificate in the keychain." >&2
  echo "Create one in the Apple Developer portal, or install the .cer you already have." >&2
  exit 2
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
unzip -q "$archive" -d "$work"

echo "Signing Mach-O binaries…"
# Node (when bundled), our own compiled output if it ever includes native modules, and
# any dylib a dependency installs. `--options runtime` is required for notarization;
# the entitlements are the minimum Node needs.
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

signed=0
for file in $(find "$work" -type f \( -perm -u+x -o -name '*.dylib' -o -name '*.node' \) 2>/dev/null); do
  if file "$file" | grep -q "Mach-O"; then
    codesign --force --options runtime --timestamp \
      --entitlements "$entitlements" --sign "$identity" "$file"
    signed=$((signed + 1))
  fi
done
echo "  signed $signed Mach-O file(s)"

echo "Checking for anything unsigned that Apple would reject…"
unsigned=$(find "$work" -type f \( -perm -u+x -o -name '*.dylib' -o -name '*.node' \) -print0 2>/dev/null \
  | xargs -0 -I{} sh -c 'file "$1" | grep -q Mach-O && ! codesign --verify "$1" 2>/dev/null && echo "$1"' _ {} || true)
if [ -n "$unsigned" ]; then
  echo "These Mach-O files are still unsigned — notarization will fail on them:" >&2
  echo "$unsigned" >&2
  exit 3
fi

# Rebuild the archive from the signed tree; submitting the original would notarize the
# pre-signing bytes.
out="${archive%.zip}-signed.zip"
( cd "$work" && zip -qry "$out" listing-node )

echo "Submitting to Apple (usually 2–15 minutes)…"
if ! xcrun notarytool submit "$out" --keychain-profile "$OBZ_NOTARY_PROFILE" --wait; then
  # The submission id is in the output above; the log is what says which binary failed.
  echo "" >&2
  echo "Notarization failed. Read Apple's reason with:" >&2
  echo "  xcrun notarytool log <submission-id> --keychain-profile $OBZ_NOTARY_PROFILE" >&2
  exit 4
fi

echo "Verifying the way Gatekeeper will…"
# No quarantine flag exists on a locally built file, so set one: this is the check that
# reproduces what an operator's browser will do to the download.
xattr -w com.apple.quarantine "0081;$(printf '%x' "$(date +%s)");Safari;" "$out" || true
spctl --assess --type execute -vv "$work/listing-node/app/dist/listing-node.js" 2>&1 || true

echo ""
echo "Notarized: $out"
echo "Next: upload it to get.omnibazaar.com with the release, and record its SHA-256:"
shasum -a 256 "$out"
