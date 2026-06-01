#!/usr/bin/env bash
#
# secret-scan.sh — self-contained secret scanner for the Installers repo.
#
# Leak-prevention guardrail (this repo handles signing flows next to key
# paths). No external dependency on gitleaks/trufflehog so it runs anywhere.
#
# Modes:
#   --staged   Scan only staged (git diff --cached) files. Used by pre-commit.
#   --tracked  Scan all tracked files (git ls-files). Used by pre-push.
#   <files...> Scan an explicit list of files.
#
# Exit 0 = clean (warnings allowed), 1 = a blocking secret was found.
#
set -u

MODE="${1:-} "
RED='\033[0;31m'; YEL='\033[1;33m'; GRN='\033[0;32m'; NC='\033[0m'

# ── Determine the file list ──────────────────────────────────────────────
declare -a FILES=()
case "${1:-}" in
  --staged)
    while IFS= read -r f; do [ -n "$f" ] && FILES+=("$f"); done \
      < <(git diff --cached --name-only --diff-filter=ACM)
    ;;
  --tracked)
    while IFS= read -r f; do [ -n "$f" ] && FILES+=("$f"); done \
      < <(git ls-files)
    ;;
  *)
    shift 0
    FILES=("$@")
    ;;
esac

[ "${#FILES[@]}" -eq 0 ] && { echo -e "${GRN}secret-scan: nothing to scan${NC}"; exit 0; }

# ── Blocked filename patterns (these must never be committed) ────────────
FILENAME_BLOCK='(\.pk$|\.pem$|\.key$|\.keystore$|id_rsa|wallet\.env$|(^|/)deployer|(^|/)keys/|(^|/)signatures/|(^|/)\.env($|\.))'

# ── Blocking content patterns ────────────────────────────────────────────
# Labelled private keys / mnemonics with a real value, key blocks, and
# common provider tokens. Bare 64-hex is intentionally NOT blocked here —
# SHA-256 release hashes are 64-hex and legitimate throughout this repo.
declare -a CONTENT_BLOCK=(
  '-----BEGIN ([A-Z]+ )?PRIVATE KEY-----'
  '(private_?key|secret_?key|mnemonic|seed_?phrase)["'"'"']?[[:space:]]*[:=][[:space:]]*["'"'"'][^"'"'"']{6,}'
  'AKIA[0-9A-Z]{16}'
  'gh[pousr]_[A-Za-z0-9]{30,}'
  'xox[baprs]-[0-9A-Za-z-]{10,}'
)

FAIL=0

for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue

  # 1) Blocked filenames
  if echo "$f" | grep -Eiq "$FILENAME_BLOCK"; then
    echo -e "${RED}BLOCK${NC} secret-bearing filename staged: $f"
    FAIL=1
    continue
  fi

  # 2) Blocked content
  for pat in "${CONTENT_BLOCK[@]}"; do
    if grep -EinI "$pat" "$f" >/dev/null 2>&1; then
      echo -e "${RED}BLOCK${NC} potential secret in $f:"
      grep -EinI "$pat" "$f" | sed 's/^/    /' | head -3
      FAIL=1
    fi
  done

  # 3) Warn-only: bare 64-hex (could be a privkey OR a legit sha256 hash)
  if grep -EoI '0x[a-fA-F0-9]{64}' "$f" >/dev/null 2>&1; then
    echo -e "${YEL}WARN${NC}  64-hex value in $f (ok if it is a SHA-256 hash; verify it is not a private key)"
  fi
done

if [ "$FAIL" -ne 0 ]; then
  echo -e "${RED}secret-scan: BLOCKED — remove the secret(s) above before committing/pushing.${NC}"
  exit 1
fi

echo -e "${GRN}secret-scan: clean${NC}"
exit 0
