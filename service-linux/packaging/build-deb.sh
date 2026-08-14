#!/usr/bin/env bash
#
# build-deb.sh — assemble the omnibazaar-service-node .deb from a pre-built payload.
#
# Prerequisites (built by the release pipeline, not here):
#   --payload  DIR  A built Validator tree containing dist/, node_modules
#                   (production), scripts/, systemd/, and WebApp/build under it.
#   --verifier DIR  The Installers verifier (the `dist/` of @omnibazaar/installers,
#                   i.e. shared/cli.js + shared/*.js).
#   --version  X    Package/semver version (must match the on-chain release).
#   --out      DIR  Output directory for the .deb (default: ./out).
#
# Usage:
#   ./build-deb.sh --payload /path/to/Validator --verifier /path/to/Installers/dist \
#                  --version 1.0.0 --out ./out
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAYLOAD=""; VERIFIER=""; VERSION=""; OUT="$HERE/out"; ARCH="amd64"

while [ $# -gt 0 ]; do
  case "$1" in
    --payload)  PAYLOAD="$2"; shift 2;;
    --verifier) VERIFIER="$2"; shift 2;;
    --version)  VERSION="$2"; shift 2;;
    --out)      OUT="$2"; shift 2;;
    --arch)     ARCH="$2"; shift 2;;
    *) echo "Unknown arg: $1"; exit 2;;
  esac
done

[ -n "$PAYLOAD" ] && [ -d "$PAYLOAD" ] || { echo "--payload <built Validator dir> required"; exit 2; }
[ -n "$VERIFIER" ] && [ -d "$VERIFIER" ] || { echo "--verifier <Installers dist dir> required"; exit 2; }
[ -n "$VERSION" ] || { echo "--version <semver> required"; exit 2; }
command -v dpkg-deb >/dev/null 2>&1 || { echo "dpkg-deb not installed"; exit 2; }

PKG="omnibazaar-service-node"
ROOT="$(mktemp -d)"
INSTALL_ROOT="$ROOT/opt/omnicoin-service-node"

echo "Assembling $PKG $VERSION ($ARCH)…"
mkdir -p "$INSTALL_ROOT/Validator" "$INSTALL_ROOT/verifier" "$ROOT/DEBIAN" "$ROOT/etc/omnibazaar"

cp -a "$PAYLOAD/." "$INSTALL_ROOT/Validator/"
cp -a "$VERIFIER/." "$INSTALL_ROOT/verifier/"
cp -a "$HERE/service.env.example" "$INSTALL_ROOT/service.env.example"

# Control file. No avalanchego dependency — service nodes run business logic only.
cat > "$ROOT/DEBIAN/control" <<EOF
Package: $PKG
Version: $VERSION
Section: net
Priority: optional
Architecture: $ARCH
Depends: curl, ca-certificates, nodejs (>= 20)
Maintainer: OmniBazaar <ops@omnibazaar.com>
Description: OmniBazaar Service Node
  Headless service node for the OmniCoin L1 network. Serves LOCAL P2P
  marketplace listings and local storage only (RWA, Yield, Predictions, NFT and
  DEX are gateway-validator surfaces). Provisions a single-node YugabyteDB and
  installs a qualification-enforcing systemd unit. No avalanchego, AVAX, stake,
  or KYC required. Operator config is read from /etc/omnibazaar/service.env.
EOF

install -m 0755 "$HERE/postinst" "$ROOT/DEBIAN/postinst"
install -m 0755 "$HERE/prerm"    "$ROOT/DEBIAN/prerm"

# Note: /etc/omnibazaar/service.env is operator-created (not shipped), so it is
# intentionally NOT a packaged conffile; the .example template ships under /opt.

mkdir -p "$OUT"
DEB="$OUT/${PKG}_${VERSION}_${ARCH}.deb"
dpkg-deb --build --root-owner-group "$ROOT" "$DEB"
rm -rf "$ROOT"

echo "Built: $DEB"
dpkg-deb -I "$DEB" | sed 's/^/  /'
