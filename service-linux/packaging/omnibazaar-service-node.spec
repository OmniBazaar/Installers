# RPM spec for the OmniBazaar Service Node.
#
# Build (payload + verifier are pre-built by the release pipeline and staged
# into the buildroot by a build-rpm.sh, mirroring build-deb.sh):
#   rpmbuild -bb omnibazaar-service-node.spec --define "_version 1.0.0" \
#       --buildroot <staged-root>
#
# NOTE: not build-tested here (rpmbuild is not installed on the dev host); the
# .deb path is the verified one. Keep this in sync with build-deb.sh.

Name:           omnibazaar-service-node
Version:        %{_version}
Release:        1%{?dist}
Summary:        OmniBazaar Service Node
License:        Proprietary
URL:            https://omnibazaar.com
BuildArch:      x86_64
Requires:       curl, ca-certificates, nodejs >= 20

%description
Headless service node for the OmniCoin L1 network. Serves LOCAL P2P marketplace
listings and local storage only (RWA, Yield, Predictions, NFT and DEX are
gateway-validator surfaces). Provisions a single-node YugabyteDB and installs a
qualification-enforcing systemd unit. No avalanchego, AVAX, stake, or KYC
required. Operator config is read from /etc/omnibazaar/service.env.

%files
/opt/omnicoin-service-node

%post
# Mirrors the Debian postinst.
INSTALL_ROOT="/opt/omnicoin-service-node"
CFG="/etc/omnibazaar/service.env"
INSTALLER="$INSTALL_ROOT/Validator/scripts/install-service-node.sh"
if [ ! -f "$CFG" ]; then
  echo "OmniBazaar: create $CFG from $INSTALL_ROOT/service.env.example, then run:"
  echo "  sudo OBZ_NONINTERACTIVE=1 OBZ_SKIP_BUILD=1 bash $INSTALLER"
  exit 0
fi
set -a; . "$CFG"; set +a
export OBZ_NONINTERACTIVE=1 OBZ_SKIP_BUILD=1
export OBZ_INSTALL_DIR="$INSTALL_ROOT" OBZ_NETWORK="${OBZ_NETWORK:-mainnet}"
bash "$INSTALLER"

%preun
systemctl stop omnicoin-service-node.service 2>/dev/null || true
exit 0
