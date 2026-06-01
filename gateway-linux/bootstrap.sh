#!/usr/bin/env bash
#
# OmniBazaar Gateway Validator — one-line bootstrap installer (Linux).
#
#   curl -fsSL https://get.omnibazaar.com/gateway | sudo bash
#
# Flow: download the signed validator release + the verifier bundle, verify the
# release against the on-chain UpdateRegistry binaryHash (the trust anchor —
# tampering is caught even though the download host is public), then delegate to
# the repo's install-gateway-validator.sh in non-interactive MAINNET mode.
#
# This script provisions everything EXCEPT the P-Chain consensus-join, which the
# installer prints as guided manual steps after verifying AVAX funding.
#
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

# ── Parameters (env-overridable) ─────────────────────────────────────────
COMPONENT="validator"
VERSION="${OBZ_VERSION:-latest}"                       # explicit semver or "latest"
RELEASE_BASE="${OBZ_RELEASE_BASE:-https://github.com/OmniBazaar/Installers/releases/download}"
WORK_DIR="${OBZ_WORK_DIR:-/tmp/omnibazaar-gateway-install}"

echo -e "${BLUE}=== OmniBazaar Gateway Validator bootstrap ===${NC}"

if [[ $EUID -ne 0 ]]; then
  echo -e "${RED}Error: run as root (sudo).${NC}"; exit 1
fi

# ── Ensure prerequisites ─────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo -e "${YELLOW}Installing Node.js 20.x…${NC}"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
for tool in curl tar; do
  command -v "$tool" >/dev/null 2>&1 || { echo -e "${RED}Missing required tool: $tool${NC}"; exit 1; }
done

mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

# ── Resolve version ──────────────────────────────────────────────────────
# "latest" is resolved on-chain so the bootstrap always tracks the published
# release rather than a hard-coded tag.
if [[ "$VERSION" == "latest" ]]; then
  echo "Resolving latest published $COMPONENT version on-chain…"
  VERSION="$(node -e "
    const { ethers } = require('ethers');
    const RPC='${OMNICOIN_RPC_URL:-https://rpc.omnicoin.net}';
    const REG='${OMNICOIN_UPDATE_REGISTRY:-0xA5eb4BF4a46B3CfAaC684818f56fD8263f79031D}';
    const abi=['function getLatestVersion(string) view returns (string)'];
    (async()=>{const p=new ethers.JsonRpcProvider(RPC);const c=new ethers.Contract(REG,abi,p);
      process.stdout.write(await c.getLatestVersion('${COMPONENT}'));})().catch(()=>process.stdout.write(''));
  " 2>/dev/null)"
  [[ -z "$VERSION" ]] && { echo -e "${RED}No published $COMPONENT release on-chain yet.${NC}"; exit 1; }
  echo "  latest = $VERSION"
fi

TARBALL="omnibazaar-${COMPONENT}-${VERSION}.tar.gz"
VERIFIER="omnibazaar-verifier-${VERSION}.tar.gz"

# ── Download release + verifier bundle ───────────────────────────────────
echo "Downloading $TARBALL …"
curl -fsSL "${RELEASE_BASE}/v${VERSION}/${TARBALL}" -o "$TARBALL"
echo "Downloading verifier bundle …"
curl -fsSL "${RELEASE_BASE}/v${VERSION}/${VERIFIER}" -o "$VERIFIER"
mkdir -p verifier && tar -xzf "$VERIFIER" -C verifier

# ── Verify against on-chain hash (Phase 0 verifier) ──────────────────────
echo -e "${BLUE}Verifying release authenticity against on-chain UpdateRegistry…${NC}"
if ! node verifier/shared/cli.js verify "$TARBALL" --component "$COMPONENT" --version "$VERSION"; then
  echo -e "${RED}✗ Authenticity check FAILED — refusing to install.${NC}"
  exit 1
fi
echo -e "${GREEN}✓ Release verified${NC}"

# ── Extract + delegate to the repo installer (non-interactive mainnet) ───
mkdir -p extracted && tar -xzf "$TARBALL" -C extracted
INSTALLER="$(find extracted -name install-gateway-validator.sh -path '*/scripts/*' | head -1)"
[[ -z "$INSTALLER" ]] && { echo -e "${RED}install-gateway-validator.sh not found in release.${NC}"; exit 1; }
chmod +x "$INSTALLER"

echo -e "${BLUE}Running gateway installer (non-interactive, mainnet)…${NC}"
# Wallet + node identity come from the operator's environment; everything else
# defaults to verified mainnet values inside the installer.
OBZ_NONINTERACTIVE=1 OBZ_NETWORK=mainnet exec bash "$INSTALLER"
