#!/bin/sh
set -eu
[ "$(/usr/bin/id -u)" = 0 ]
account=${1:-}
case "$account" in
  ''|*[!a-zA-Z0-9_-]*) exit 1 ;;
esac
[ "$(/usr/bin/id -u "$account")" -ge 501 ]
helper=/Library/PrivilegedHelperTools/org.athanbot.wake
# sudo ignores drop-in filenames containing a dot.
policy=/private/etc/sudoers.d/org_athanbot_wake
old_policy=/private/etc/sudoers.d/org.athanbot.wake
resources=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
temp=$(/usr/bin/mktemp -d /private/tmp/athanbot-wake.XXXXXX)
trap '/bin/rm -f "$temp/sudoers"; /bin/rmdir "$temp"' EXIT
printf '%s ALL=(root) NOPASSWD: %s\n' "$account" "$helper" > "$temp/sudoers"
/usr/sbin/visudo -cf "$temp/sudoers"
/usr/bin/install -d -o root -g wheel -m 0755 /Library/PrivilegedHelperTools
/usr/bin/install -o root -g wheel -m 0755 "$resources/../MacOS/athanbot-wake" "$helper"
/usr/bin/install -o root -g wheel -m 0440 "$temp/sudoers" "$policy"
/bin/rm -f "$old_policy"
