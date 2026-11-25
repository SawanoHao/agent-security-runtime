#!/usr/bin/env bash
# Build agent-security-runtime_*.deb for Ubuntu
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${ASR_VERSION:-0.1.0}"
ARCH="all"
PKG_NAME="agent-security-runtime"
OUT_DIR="${ROOT}/dist/deb"
STAGE="${OUT_DIR}/stage"
DEB_ROOT="${STAGE}/${PKG_NAME}_${VERSION}_${ARCH}"

export PATH="${HOME}/.local/node/bin:$PATH"

echo "==> build JS artifacts"
cd "$ROOT"
npm run build

echo "==> stage filesystem"
rm -rf "$STAGE"
mkdir -p \
  "$DEB_ROOT/DEBIAN" \
  "$DEB_ROOT/usr/lib/${PKG_NAME}" \
  "$DEB_ROOT/usr/bin" \
  "$DEB_ROOT/usr/share/applications" \
  "$DEB_ROOT/usr/share/doc/${PKG_NAME}" \
  "$DEB_ROOT/etc/${PKG_NAME}" \
  "$DEB_ROOT/var/lib/${PKG_NAME}"

LIB="$DEB_ROOT/usr/lib/${PKG_NAME}"

# Runtime tree (built outputs + manifests for node resolution)
cp "$ROOT/package.json" "$LIB/"
cp "$ROOT/package-lock.json" "$LIB/"
mkdir -p "$LIB/apps/server" "$LIB/apps/web" "$LIB/packages/core" "$LIB/configs"

cp "$ROOT/apps/server/package.json" "$LIB/apps/server/"
cp -a "$ROOT/apps/server/dist" "$LIB/apps/server/"

cp "$ROOT/apps/web/package.json" "$LIB/apps/web/"
cp -a "$ROOT/apps/web/dist" "$LIB/apps/web/"

cp "$ROOT/packages/core/package.json" "$LIB/packages/core/"
cp -a "$ROOT/packages/core/dist" "$LIB/packages/core/"

cp "$ROOT/configs/policy.yaml" "$LIB/configs/"
cp "$ROOT/configs/policy.yaml" "$DEB_ROOT/etc/${PKG_NAME}/policy.yaml"

# Install production node_modules into the staged tree
echo "==> npm ci --omit=dev (staged)"
(
  cd "$LIB"
  npm ci --omit=dev --ignore-scripts
)

# Wrappers + desktop entry
install -m 0755 "$ROOT/packaging/wrappers/asr" "$DEB_ROOT/usr/bin/asr"
install -m 0755 "$ROOT/packaging/wrappers/asr-setup" "$DEB_ROOT/usr/bin/asr-setup"
install -m 0644 "$ROOT/packaging/asr.desktop" \
  "$DEB_ROOT/usr/share/applications/agent-security-runtime.desktop"

# Debian metadata
cp "$ROOT/packaging/debian/control" "$DEB_ROOT/DEBIAN/control"
# Refresh version in control if overridden
sed -i "s/^Version:.*/Version: ${VERSION}/" "$DEB_ROOT/DEBIAN/control"
install -m 0755 "$ROOT/packaging/debian/postinst" "$DEB_ROOT/DEBIAN/postinst"
install -m 0755 "$ROOT/packaging/debian/prerm" "$DEB_ROOT/DEBIAN/prerm"

cp "$ROOT/README.md" "$DEB_ROOT/usr/share/doc/${PKG_NAME}/README"
cat >"$DEB_ROOT/usr/share/doc/${PKG_NAME}/copyright" <<EOF
Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: agent-security-runtime
Source: https://github.com/SawanoHao/agent-security-runtime

Files: *
Copyright: $(date +%Y) SawanoHao
License: Apache-2.0
EOF

# Installed-Size (KiB)
SIZE_KB=$(du -sk "$DEB_ROOT" | awk '{print $1}')
if grep -q '^Installed-Size:' "$DEB_ROOT/DEBIAN/control"; then
  sed -i "s/^Installed-Size:.*/Installed-Size: ${SIZE_KB}/" "$DEB_ROOT/DEBIAN/control"
else
  echo "Installed-Size: ${SIZE_KB}" >>"$DEB_ROOT/DEBIAN/control"
fi

echo "==> dpkg-deb"
mkdir -p "$OUT_DIR"
DEB_FILE="${OUT_DIR}/${PKG_NAME}_${VERSION}_${ARCH}.deb"
dpkg-deb --root-owner-group --build "$DEB_ROOT" "$DEB_FILE"

echo
echo "Built: $DEB_FILE"
ls -lh "$DEB_FILE"
dpkg-deb -I "$DEB_FILE" | sed -n '1,20p'
echo
echo "Install with:"
echo "  sudo dpkg -i $DEB_FILE"
echo "  asr-setup"
