# RPM spec for the OmniBazaar Gateway Validator.
#
# Build (payload + verifier are pre-built by the release pipeline and staged
# into the buildroot by build-rpm.sh, mirroring build-deb.sh):
#   rpmbuild -bb omnibazaar-gateway.spec --define "_version 1.0.0" \
#       --buildroot <staged-root>
#
# NOTE: not build-tested here (rpmbuild is not installed on the dev host); the
# .deb path is the verified one. Keep this in sync with build-deb.sh.

Name:           omnibazaar-gateway
Version:        %{_version}
Release:        1%{?dist}
Summary:        OmniBazaar Gateway Validator
License:        Proprietary
URL:            https://omnibazaar.com
BuildArch:      x86_64
Requires:       curl, ca-certificates, nodejs >= 20

%description
Headless gateway validator for the OmniCoin L1 network. Provisions avalanchego,
the TypeScript gateway services, and a qualification-enforcing systemd unit.
Operator config is read from /etc/omnibazaar/gateway.env.

%files
/opt/omnicoin-validator

%post
# Mirrors the Debian postinst.
INSTALL_ROOT="/opt/omnicoin-validator"
CFG="/etc/omnibazaar/gateway.env"
INSTALLER="$INSTALL_ROOT/Validator/scripts/install-gateway-validator.sh"
if [ ! -f "$CFG" ]; then
  echo "OmniBazaar: create $CFG from $INSTALL_ROOT/gateway.env.example, then run:"
  echo "  sudo OBZ_NONINTERACTIVE=1 OBZ_SKIP_BUILD=1 bash $INSTALLER"
  exit 0
fi
set -a; . "$CFG"; set +a
export OBZ_NONINTERACTIVE=1 OBZ_SKIP_BUILD=1 OBZ_INSTALL_ROOT="$INSTALL_ROOT"
export OBZ_INSTALL_DIR="$INSTALL_ROOT" OBZ_NETWORK="${OBZ_NETWORK:-mainnet}"
bash "$INSTALLER"

%preun
systemctl stop omnicoin-validator.service 2>/dev/null || true
systemctl stop avalanchego.service 2>/dev/null || true
exit 0
