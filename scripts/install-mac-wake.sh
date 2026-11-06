#!/bin/sh
set -eu
helper=/Library/PrivilegedHelperTools/org.athanbot.wake
# sudo ignores drop-in filenames containing a dot.
policy=/private/etc/sudoers.d/org_athanbot_wake
old_policy=/private/etc/sudoers.d/org.athanbot.wake
if [ "$(uname -s)" != Darwin ] || [ "$(id -u)" = 0 ]; then
  echo 'Run this as your normal macOS user. The script will ask for administrator access.' >&2
  exit 1
fi
if [ "${1:-}" = "--remove" ]; then
  if [ -x "$helper" ]; then
    sudo "$helper" schedule
    sudo "$helper" test
  fi
  sudo /bin/rm -f "$policy" "$old_policy" "$helper"
  exit
fi
account=$(id -un)
case "$account" in
  ''|*[!a-zA-Z0-9_-]*) echo 'Unsupported macOS account name.' >&2; exit 1 ;;
esac
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
build=$(mktemp -d)
trap 'rm -rf "$build"' EXIT
swiftc -module-cache-path "$build/cache" "$script_dir/mac-wake.swift" -o "$build/wake"
printf '%s ALL=(root) NOPASSWD: %s\n' "$account" "$helper" > "$build/sudoers"
sudo /usr/sbin/visudo -cf "$build/sudoers"
sudo /usr/bin/install -d -o root -g wheel -m 0755 "$(dirname "$helper")"
sudo /usr/bin/install -o root -g wheel -m 0755 "$build/wake" "$helper"
sudo /usr/bin/install -o root -g wheel -m 0440 "$build/sudoers" "$policy"
sudo -n "$helper" check
sudo /bin/rm -f "$old_policy"
echo 'AthanBot wake helper installed.'
