#!/bin/bash
set -euo pipefail
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:$PATH"
cd "$(dirname "$0")/.."
[ "$(uname -s)" = Darwin ] || { echo "Build this app on macOS." >&2; exit 1; }

arch=${ATHANBOT_MAC_ARCH:-$(uname -m)}
case "$arch" in
  arm64) node_arch=arm64 ;;
  x86_64) node_arch=x64 ;;
  *) echo "Unsupported Mac architecture: $arch" >&2; exit 1 ;;
esac
ffmpeg=${ATHANBOT_FFMPEG:-ffmpeg}
out="$PWD/dist"
mkdir -p "$out"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
node_dir=${ATHANBOT_NODE_DIR:-}
if [ -z "$node_dir" ]; then
  node_url=https://nodejs.org/dist/latest-v24.x
  curl -fsSL "$node_url/SHASUMS256.txt" -o "$work/SHASUMS256.txt"
  read -r checksum archive < <(awk -v arch="$node_arch" '$2 ~ ("^node-v24\\.[0-9]+\\.[0-9]+-darwin-" arch "\\.tar\\.gz$") { print $1, $2; exit }' "$work/SHASUMS256.txt")
  curl -fsSL "$node_url/$archive" -o "$work/$archive"
  (cd "$work"; printf '%s  %s\n' "$checksum" "$archive" | shasum -a 256 -c -)
  tar -xzf "$work/$archive" -C "$work"
  node_dir="$work/${archive%.tar.gz}"
fi

app="$work/AthanBot.app"
mac="$app/Contents/MacOS"
resources="$app/Contents/Resources"
mkdir -p "$mac" "$resources/audio" "$work/AthanBot.iconset"
cp macos/Info.plist "$app/Contents/Info.plist"
cp package.json "$resources"
cp -R src vendor "$resources"
cp macos/install-wake.sh "$resources"
cp "$node_dir/bin/node" "$mac/athanbot-node"
cp "$node_dir/LICENSE" "$resources/Node-LICENSE"
cp audio/README.md "$resources/audio"
printf '\nThe macOS package contains AAC conversions of both bundled recordings.\n' >> "$resources/audio/README.md"
for recording in malmo-fajr.opus prophets-mosque.ogg; do
  "$ffmpeg" -hide_banner -loglevel error -i "audio/$recording" -map 0:a:0 -c:a aac -b:a 128k "$resources/audio/$recording.m4a"
done

target="$arch-apple-macosx13.5"
cache="$out/.swift-cache"
swiftc -target "$target" -module-cache-path "$cache" -O macos/App.swift -o "$mac/AthanBot"
swiftc -target "$target" -module-cache-path "$cache" -O macos/Audio.swift -o "$mac/athanbot-audio"
swiftc -target "$target" -module-cache-path "$cache" -O scripts/mac-wake.swift -o "$mac/athanbot-wake"
swiftc -module-cache-path "$cache" macos/Icon.swift -o "$work/icon"
"$work/icon" "$work/AthanBot.iconset"
iconutil --convert icns --output "$resources/AthanBot.icns" "$work/AthanBot.iconset"

identity=${ATHANBOT_SIGN_IDENTITY:--}
sign_flags=(--force --sign "$identity")
if [ "$identity" != "-" ]; then
  sign_flags+=(--options runtime --timestamp)
fi
codesign "${sign_flags[@]}" --entitlements macos/node-entitlements.plist "$mac/athanbot-node"
codesign "${sign_flags[@]}" "$mac/athanbot-audio"
codesign "${sign_flags[@]}" "$mac/athanbot-wake"
codesign "${sign_flags[@]}" "$app"
codesign --verify --deep --strict "$app"

stage="$work/installer"
mkdir "$stage"
ditto "$app" "$stage/AthanBot.app"
ln -s /Applications "$stage/Applications"
hdiutil create -quiet -ov -format UDZO -volname AthanBot -srcfolder "$stage" "$out/AthanBot-$arch.dmg"
if [ "$identity" != "-" ]; then
  codesign --force --sign "$identity" --timestamp "$out/AthanBot-$arch.dmg"
fi
if [ -n "${ATHANBOT_NOTARY_PROFILE:-}" ]; then
  [ "$identity" != "-" ] || { echo "Notarization requires a Developer ID Application identity." >&2; exit 1; }
  xcrun notarytool submit "$out/AthanBot-$arch.dmg" --keychain-profile "$ATHANBOT_NOTARY_PROFILE" --wait
  xcrun stapler staple "$out/AthanBot-$arch.dmg"
  xcrun stapler validate "$out/AthanBot-$arch.dmg"
fi
# Keep an unpacked development copy beside the disk image.
if [ -e "$out/AthanBot.app" ]; then
  /bin/rm -rf "$out/AthanBot.app"
fi
ditto "$app" "$out/AthanBot.app"
printf 'Built %s\n' "$out/AthanBot-$arch.dmg"
