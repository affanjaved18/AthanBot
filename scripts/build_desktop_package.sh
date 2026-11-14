#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export COPYFILE_DISABLE=1

target=${1:-}
arch=${2:-x64}
case "$target:$arch" in
  linux:x64) suffix=linux-x64.tar.xz; deb_arch=amd64 ;;
  linux:arm64) suffix=linux-arm64.tar.xz; deb_arch=arm64 ;;
  windows:x64) suffix=win-x64.zip ;;
  windows:arm64) suffix=win-arm64.zip ;;
  *) echo "Usage: $0 linux|windows [x64|arm64]" >&2; exit 1 ;;
esac

version=$(node -p 'require("./package.json").version')
out="$PWD/dist"
mkdir -p "$out"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

node_url=${ATHANBOT_NODE_URL:-https://nodejs.org/dist/latest-v24.x}
curl -fsSL "$node_url/SHASUMS256.txt" -o "$work/SHASUMS256.txt"
archive=$(awk -v suffix="-$suffix" 'substr($2, length($2) - length(suffix) + 1) == suffix { print $2; exit }' "$work/SHASUMS256.txt")
test -n "$archive"
curl -fsSL "$node_url/$archive" -o "$work/$archive"
(cd "$work" && awk -v archive="$archive" '$2 == archive' SHASUMS256.txt | shasum -a 256 -c -)
case "$target" in
  linux) tar -xf "$work/$archive" -C "$work"; runtime="$work/${archive%.tar.xz}"; app="$work/deb/usr/lib/athanbot" ;;
  windows) unzip -q "$work/$archive" -d "$work"; runtime="$work/${archive%.zip}"; app="$work/app" ;;
esac

mkdir -p "$app/audio"
cp package.json "$app/"
cp -R src vendor "$app/"
cp audio/README.md audio/malmo-fajr.opus audio/prophets-mosque.ogg "$app/audio/"
cp "$runtime/LICENSE" "$app/Node-LICENSE"

if [ "$target" = windows ]; then
  cp "$runtime/node.exe" "$app/"
  artifact="$out/AthanBot-$version-windows-$arch.exe"
  icon="$PWD/packaging/icons/athanbot.ico"
  makensis "-Dstage=$app" "-Dicon=$icon" packaging/windows/launcher.nsi
  makensis "-Dstage=$app" "-Dicon=$icon" "-Doutput=$artifact" "-Dversion=$version" "-Darchitecture=$arch" packaging/windows/installer.nsi
else
  cp "$runtime/bin/node" "$app/"
  install -d "$work/deb/usr/bin" "$work/deb/usr/share/applications" "$work/deb/DEBIAN"
  install -m 755 packaging/linux/athanbot "$work/deb/usr/bin/athanbot"
  install -m 644 packaging/linux/athanbot.desktop "$work/deb/usr/share/applications/athanbot.desktop"
  install -d "$work/deb/usr/share/icons/hicolor/256x256/apps"
  install -m 644 packaging/icons/athanbot.png "$work/deb/usr/share/icons/hicolor/256x256/apps/athanbot.png"
  cat > "$work/deb/DEBIAN/control" <<CONTROL
Package: athanbot
Version: $version
Architecture: $deb_arch
Maintainer: AthanBot maintainers
Section: sound
Priority: optional
Depends: libc6 (>= 2.28), libstdc++6, mpv, xdg-utils
Suggests: bluez
Description: Scheduled Athan playback
 Calculates local prayer times and plays a recording through a selected speaker.
CONTROL
  artifact="$out/athanbot_${version}_${deb_arch}.deb"
  if command -v dpkg-deb > /dev/null; then
    dpkg-deb --root-owner-group --build "$work/deb" "$artifact"
  else
    printf '2.0\n' > "$work/debian-binary"
    tar --format=ustar --uid 0 --gid 0 --uname root --gname root -czf "$work/control.tar.gz" -C "$work/deb/DEBIAN" .
    tar --format=ustar --uid 0 --gid 0 --uname root --gname root --exclude ./DEBIAN -czf "$work/data.tar.gz" -C "$work/deb" .
    tar --format=ar --uid 0 --gid 0 -cf "$work/package.deb" -C "$work" debian-binary control.tar.gz data.tar.gz
    mv "$work/package.deb" "$artifact"
  fi
fi

printf 'Built %s\n' "$artifact"
