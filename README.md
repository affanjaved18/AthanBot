# AthanBot

A background Athan clock for macOS and Raspberry Pi OS. AthanBot calculates
Fajr, Dhuhr, Asr, Maghrib, and Isha locally using a fixed location, then plays
a recording through the selected audio output. Open the Mac app for setup or
to change settings later. The scheduler and audio files run on the device.

## Install the Mac app

1. Open the AthanBot disk image for your Mac.
2. Drag **AthanBot** into **Applications**.
3. Open **AthanBot** from Applications and follow the Location, Audio, and
   Schedule steps. Use **Find city** or enter coordinates, choose a recording
   and speaker, and save with **Enable automatic startup** selected.

You can close the app after setup. Open AthanBot again to change any setting.
Pair and connect your Bluetooth speaker once in System Settings, then refresh
speakers in AthanBot. On the Audio page, choose it as both the preferred output
and the Bluetooth speaker to connect for playback. AthanBot connects when it
starts playing, disconnects afterward, and returns sound to the built-in
speakers if the Bluetooth speaker became the Mac's default output. The speaker
stays paired. A disconnected preferred speaker may appear as **currently
unavailable** until AthanBot reconnects it. The optional fallback is used for
scheduled prayers if the preferred output remains unavailable.

Use **Test playback** for a short preview or **Play Athan now** for the full
default recording. Both target the preferred speaker. Athan playback uses
50% player volume. **Stop Athan** ends the current preview, manual playback,
or scheduled prayer without canceling later prayers.

The disk image bundles its own Node.js runtime and uses macOS audio. Homebrew,
mpv, and Terminal are unnecessary for normal use. The Mac app supports
macOS 13.5 or later, with separate Apple Silicon and Intel builds. A locally
built disk image uses ad-hoc signing unless a Developer ID is configured.
For distribution to other users, build a Developer ID-signed, notarized image.

### Keep the Mac ready for playback

For dependable playback on a MacBook, leave the lid open and plug it in. In
**System Settings → Battery → Options**, enable **Prevent automatic sleeping
on power adapter when the display is off**. The screen can turn off and the
Mac can be locked while the scheduler runs. If you want the Mac itself to
sleep, test scheduled wake with your speaker before relying on it.

### Check background playback on macOS

Open **Location → Preview today** to check the calculated times before saving.
To see whether the scheduler is running, use Terminal:

```sh
launchctl print "gui/$(id -u)/org.athanbot.service"
```

Look for `state = running` and a `pid`. If the service is missing, save again
with **Enable automatic startup** selected. To list today and tomorrow using
the saved settings, run the bundled runtime. Adjust the path if the app is
somewhere other than Applications.

```sh
app="/Applications/AthanBot.app/Contents"
"$app/MacOS/athanbot-node" "$app/Resources/src/main.js" times 2
```

If **Schedule Mac wake alarms** is enabled, check macOS's wake queue. AthanBot
registers alarms about 10 seconds before upcoming prayers. The queue confirms
that a wake was registered. The playback log records the scheduler's result.

```sh
pmset -g sched | grep -F 'org.athanbot.schedule'
tail -n 30 "$HOME/Library/Application Support/AthanBot/athanbot.log"
```

## macOS command-line setup

For development or the CLI-only installation, install native Node.js 22 or later and mpv. Install blueutil if you want AthanBot
to request reconnection to a paired Bluetooth speaker by address.

```sh
# On Apple Silicon, load native Homebrew if necessary.
eval "$(/opt/homebrew/bin/brew shellenv)"
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
enter it in setup as `AA:BB:CC:DD:EE:FF`. AthanBot disconnects that speaker after
playback. Allow Bluetooth access if macOS prompts.
Test the preferred output and choose whether to allow a fallback.

Save with **Enable automatic startup** selected. AthanBot installs a LaunchAgent
for the signed-in account. You can close the browser tab and setup command
afterward. The service starts again when that account signs in after a reboot.
The scheduler log is at `~/Library/Application Support/AthanBot/athanbot.log`.

### Experimental scheduled wake on macOS

Scheduled wake uses a small administrator-installed helper to manage AthanBot's
wake alarms. In the Mac app, use **Schedule → Enable sleep playback** to
install it. macOS may wake into DarkWake, where the scheduler can run while
Bluetooth audio is still unavailable. In closed-lid tests, a Mac woke on time
but could not start its Bluetooth speaker, even on power. Treat playback as
experimental until the entire recording plays with your Mac and speaker in
the conditions you plan to use.

1. For CLI setup, install the helper from the checkout as the regular Mac
   user. This requires Apple Command Line Tools and administrator access.

   ```sh
   ./scripts/install-mac-wake.sh
   node src/main.js sleep-test 180 --chime
   ```

2. For the CLI chime test, select the MacBook speakers in Sound settings first.
   Keep the test command running and let the Mac sleep. To test with the lid
   open, choose **Apple menu → Sleep**. To test with the lid closed, close it
   after scheduling the test. Listen without touching the Mac.
3. For a Bluetooth test, confirm **Test playback** works while awake, then
   choose **Test sleep playback** with the same speaker. Leave setup open and
   let the Mac sleep using the lid and power conditions you want to verify.
   AthanBot skips the test if the Mac resumes more than 15 seconds late.
4. Repeat with a longer delay covering several hours of sleep, such as an
   overnight test for Fajr. A log entry from `pmset -g log` can help diagnose
   wake behavior. Audible playback through the selected device is the pass
   condition. Each Mac and output combination needs its own test.
5. After successful testing, check **Schedule Mac wake alarms** and save.
   The service registers up to ten upcoming alarms 10 seconds before prayer,
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

## Build a macOS disk image

For maintainers, install Apple Command Line Tools and FFmpeg, then run
`./scripts/build_macos_app.sh`. The script downloads an official Node.js 24
runtime, checks its published SHA-256, and includes its license in the bundle.
It creates `dist/AthanBot-<architecture>.dmg` and a local `dist/AthanBot.app`.
Set `ATHANBOT_MAC_ARCH=x86_64` for an Intel build. Apple Silicon is the default
when building on Apple Silicon.

To make a shareable build, set `ATHANBOT_SIGN_IDENTITY` to a Developer ID
Application certificate and `ATHANBOT_NOTARY_PROFILE` to a saved
`notarytool` keychain profile. The build signs the executables and disk image,
then submits and staples the notarization ticket.

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
Node.js and mpv are prerequisites for the command-line installation. The Mac
app bundles Node.js and uses native audio for its bundled recordings.
