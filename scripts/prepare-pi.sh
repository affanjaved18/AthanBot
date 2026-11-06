#!/bin/sh
set -eu
if [ "$(uname -s)" != Linux ] || [ "$(id -u)" = 0 ]; then
  echo 'Run as the non-root account that will own AthanBot on Raspberry Pi OS.' >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install nodejs mpv bluez pipewire pipewire-pulse wireplumber libspa-0.2-bluetooth
node -e 'if (+process.versions.node.split(".")[0] < 22) throw Error("Install Node.js 22 or later first")'

if [ "${1:-}" = "--headless" ]; then
  config="${XDG_CONFIG_HOME:-$HOME/.config}/wireplumber/wireplumber.conf.d"
  mkdir -p "$config"
  cat > "$config/51-athanbot-headless.conf" <<'CONF'
wireplumber.profiles = {
  main = {
    monitor.bluez.seat-monitoring = disabled
  }
}
CONF
  sudo usermod -aG audio "$(id -un)"
  sudo loginctl enable-linger "$(id -un)"
  systemctl --user enable pipewire.socket pipewire-pulse.socket wireplumber.service
  echo 'Headless audio is configured. Reboot to apply audio group membership and start the audio services.'
fi
