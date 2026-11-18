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
RELEASE_BASE="${OBZ_RELEASE_BASE:-https://get.omnibazaar.com/node-software}"
WORK_DIR="${OBZ_WORK_DIR:-}"   # empty = a private mktemp dir, below

echo -e "${BLUE}=== OmniBazaar Gateway Validator bootstrap ===${NC}"

if [[ $EUID -ne 0 ]]; then
  echo -e "${RED}Error: run as root (sudo).${NC}"; exit 1
fi

# ── Node Operator Terms acceptance gate ──────────────────────────────────
# The documented install path is piped + non-interactive (curl | sudo bash),
# so consent is collected via an explicit env var rather than a TTY prompt.
NODE_TERMS_URL="${OBZ_NODE_TERMS_URL:-https://app.omnibazaar.com/node-terms}"
case "${OBZ_ACCEPT_NODE_TERMS:-}" in
  1|y|yes|true|Y|YES|TRUE) ;;
  *)
    echo -e "${YELLOW}"
    echo "You must accept the OmniBazaar Node Operator Terms and Conditions"
    echo "before installing a node."
    echo
    echo "  Read them here: ${NODE_TERMS_URL}"
    echo
    echo "Operating a node carries technical, financial, and regulatory risk,"
    echo "including the risk of slashing and the loss of staked XOM and rewards."
    echo "You are an independent operator, not an agent of OMNI, and you are"
    echo "solely responsible for legal and regulatory compliance in your"
    echo "jurisdiction."
    echo
    echo "To accept and proceed, re-run with OBZ_ACCEPT_NODE_TERMS=1, e.g.:"
    echo "  curl -fsSL https://get.omnibazaar.com/gateway | sudo OBZ_ACCEPT_NODE_TERMS=1 bash"
    echo -e "${NC}"
    exit 1
    ;;
esac
echo -e "${GREEN}Node Operator Terms accepted (OBZ_ACCEPT_NODE_TERMS).${NC}"
# Record an auditable acceptance marker on the host.
ACCEPT_DIR="${OBZ_STATE_DIR:-/etc/omnibazaar}"
mkdir -p "$ACCEPT_DIR" 2>/dev/null && \
  printf 'accepted_at=%s\ncomponent=%s\nversion=%s\nterms_url=%s\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$COMPONENT" "$VERSION" "$NODE_TERMS_URL" \
    > "$ACCEPT_DIR/node-terms-accepted.txt" 2>/dev/null || true

# ── Ensure prerequisites ─────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo -e "${YELLOW}Installing Node.js 20.x…${NC}"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
for tool in curl tar; do
  command -v "$tool" >/dev/null 2>&1 || { echo -e "${RED}Missing required tool: $tool${NC}"; exit 1; }
done

# A fixed path under /tmp can be pre-created (or symlinked) by a local user, and
# this script verifies the tarball then extracts it as root. A private 0700
# directory removes the window: nobody else can swap the file between the check
# and the extraction.
if [[ -z "$WORK_DIR" ]]; then
  WORK_DIR="$(mktemp -d /tmp/omnibazaar-install.XXXXXXXX)"
  chmod 700 "$WORK_DIR"
  trap 'rm -rf "$WORK_DIR"' EXIT
fi
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
    const REG='${OMNICOIN_UPDATE_REGISTRY:-0xd8E2a242dd344BE4A61c3DdD4332717766EB648B}';
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
# The verifier is the code that decides whether the release is authentic, and it
# arrives from the same host as the release. Until its hash is anchored on-chain,
# pin it here: OBZ_VERIFIER_SHA256=<sha256> makes the script refuse a bundle that
# does not match the value published in the repository for this version.
if [[ -n "${OBZ_VERIFIER_SHA256:-}" ]]; then
  actual="$(sha256sum "$VERIFIER" | awk '{print $1}')"
  if [[ "$actual" != "${OBZ_VERIFIER_SHA256}" ]]; then
    echo -e "${RED}✗ Verifier bundle hash mismatch — refusing to run it.${NC}"
    echo "  expected ${OBZ_VERIFIER_SHA256}"
    echo "  actual   ${actual}"
    exit 1
  fi
  echo -e "${GREEN}✓ Verifier bundle matches the pinned hash${NC}"
else
  echo -e "${YELLOW}⚠ OBZ_VERIFIER_SHA256 is not set: the verifier's own integrity is not anchored.${NC}"
  echo -e "${YELLOW}  Pin it from https://omnibazaar.com/releases before trusting a node install.${NC}"
fi
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
