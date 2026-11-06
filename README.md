# AthanBot

A background Athan clock for macOS and Raspberry Pi OS. AthanBot calculates
Fajr, Dhuhr, Asr, Maghrib, and Isha locally using a fixed location, then plays
a recording through the selected audio output. The browser is only used for
one-time setup and edits. The scheduler and audio files run on the device.

## macOS setup

Install native Node.js 22 or later and mpv. Install blueutil if you want AthanBot
to request reconnection to a paired Bluetooth speaker by address.

```sh
brew install node mpv
brew install blueutil  # Optional Bluetooth reconnection
node src/main.js setup
```

Keep the checkout and Node installation at a stable path. Open the loopback URL
printed by setup. Enter the observer's latitude and longitude and confirm the
**observer's** time zone. Select the prayer calculation and Asr conventions,
preview the results, and compare them with the prayer-start timetable you trust.
High-latitude rules, polar handling, and minute offsets are under advanced settings.

Mishari Rashid Alafasy is selected by default. The recording is downloaded
from Aladhan on first use. This step requires internet access. The bundled library and
**Import audio** work locally. Choose an optional separate Fajr recording or a
different recording for any prayer.

Pair Bluetooth speakers in **System Settings → Bluetooth**, then refresh the
speaker list in setup. Pick the actual output by name, or choose **System
default** to follow macOS sound settings. Compatible devices include Google Home
Mini, supported Echo speakers, and other standard Bluetooth audio receivers.
For explicit reconnect, find the paired address with `blueutil --paired` and
enter it in setup as `AA:BB:CC:DD:EE:FF`. Allow Bluetooth access if macOS prompts.
Test the preferred output and choose whether to allow a fallback.

Save with **Enable automatic startup** selected. AthanBot installs a LaunchAgent
for the signed-in account. You can close the browser tab and setup command
afterward. The service starts again when that account signs in after a reboot.
The scheduler log is at `~/Library/Application Support/AthanBot/athanbot.log`.

### Closed-lid Mac playback on battery

This feature is experimental until it passes on your Mac and speaker. It uses
Apple's scheduled wake API with a small administrator-installed helper. The
helper can only manage AthanBot's own wake alarms and validates their timing.
It leaves macOS sleep settings alone.

1. Install the helper from the checkout as the regular Mac user. This requires
   Apple Command Line Tools and an administrator account.

   ```sh
   ./scripts/install-mac-wake.sh
   node src/main.js sleep-test 180 --chime
   ```

2. Select the MacBook speakers in Sound settings for the chime test. Unplug
   the charger, close the lid, and listen for the chime at the printed time
   without touching the Mac. Keep the test command running.
3. For the Bluetooth test, pair the desired speaker and use **Test playback**
   while awake. Then use **Test sleep playback** in the wizard with the same
   speaker selected. Keep the setup command running, unplug the charger, and
   close the lid. Confirm that you heard the entire clip.
4. Repeat with a longer delay covering several hours of sleep, such as an
   overnight test for Fajr. A log entry from `pmset -g log` can help diagnose
   wake behavior. Audible playback through the selected device is the pass
   condition. Each Mac and output combination needs its own test.
5. After successful testing, check **Schedule Mac wake alarms** and save.
   The service registers up to ten upcoming alarms 45 seconds before prayer,
   including the next day's Fajr. If the Mac wakes but can't restore the audio
   path in time, use a Raspberry Pi for unattended playback.

To stop the service and clear its alarms, run `node src/main.js disable`.
To remove the optional privileged helper as well, run
`./scripts/install-mac-wake.sh --remove`. Settings and recordings are kept.

## Raspberry Pi OS setup

Use Raspberry Pi OS with Node.js 22+ and WirePlumber 0.5 for headless Bluetooth.
Run as the normal account that will own AthanBot. On a dedicated Pi that should
play after boot without a desktop login, prepare the system and then reboot.

```sh
./scripts/prepare-pi.sh --headless
sudo reboot
```

The script installs audio dependencies, enables the user's services at boot,
and makes Bluetooth audio available in that user's headless session. Use the
same account when pairing the speaker and running setup.

- **Wired:** Connect a powered speaker to USB, HDMI, or the Pi's analog output
  where available. A USB audio adapter can drive a powered analog speaker.
- **Bluetooth:** Pair through the Raspberry Pi desktop or `bluetoothctl`.
  On a headless Pi, put the speaker in pairing mode and use `scan on`, then
  `pair <address>`, `trust <address>`, and `connect <address>` in
  `bluetoothctl`. Enter the same address in AthanBot to enable reconnects.
  Select the speaker by name after it appears as an audio output.

Run `node src/main.js setup`. On a Pi without a local browser, bind the setup
server to a known port and forward it from your Mac. Use the setup URL the Pi
prints, including its fragment.

```sh
# On the Pi
node src/main.js setup 8787

# In a Mac terminal, replace the login and hostname with your Pi's
ssh -N -L 8787:127.0.0.1:8787 user@raspberrypi.local
```

Complete setup and enable automatic startup. Reboot the Pi and confirm it can
play a scheduled Athan with no desktop login. For Bluetooth, also power-cycle
the speaker and verify that it reconnects on the next event. The Pi schedules
and plays independently of the Mac. View logs with
`journalctl --user -u athanbot.service`. Use `node src/main.js disable` to
remove the AthanBot user service. The headless audio settings can be removed by
deleting the installed `51-athanbot-headless.conf` and disabling lingering
with `sudo loginctl disable-linger "$(id -un)"` if this account no longer
needs headless user services.

## Deployment checks

Compare a week of calculated times with the prayer-start timetable you use.
For the first deployment of each output, reboot, verify the service starts
automatically, and listen for all five scheduled Athans over a full day.
For a Bluetooth output, test a speaker disconnect and confirm the next prayer
uses the selected output once it returns. Keep the Pi's system clock accurate,
including after a power interruption, since the schedule uses that clock.

## Commands and scheduling behavior

```sh
node src/main.js times 7
node src/main.js outputs
node src/main.js test-audio fajr
node src/main.js sleep-test 180
node --test
```

At each prayer the scheduler checks the configured device, waits briefly for
a reconnect when needed, and uses the optional fallback if the preferred
output remains unavailable. A prayer can start up to 60 seconds late after
resume or restart. A persistent claim prevents duplicate playback after a
restart or a backward clock change. A failed or interrupted playback is
logged and the next prayer remains scheduled.

## Third-party credits

Prayer calculations use the locally vendored
[Batoul Apps Adhan JS 4.4.3](https://github.com/batoulapps/adhan-js).
See [the upstream MIT license and provenance](vendor/adhan/README.md)
and [recording credits and licenses](audio/README.md).
The repository contains the bundled library and two attributed recordings.
The Alafasy recording is the recommended setup download, stored outside this
repo because permission to redistribute the exact file has not been verified.
Node.js and mpv are system prerequisites.
