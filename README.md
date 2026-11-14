# AthanBot

Play the Athan automatically at local prayer times on macOS, Windows, or Linux.
AthanBot calculates all five daily prayer times offline and plays a recording
through your selected speaker.

[macOS](#macos) · [Windows](#windows) · [Linux](#linux) · [Raspberry Pi](#headless-raspberry-pi) · [Troubleshooting](#troubleshooting)

## Set up AthanBot

### macOS

1. Open the disk image for your Mac and drag **AthanBot** into **Applications**.
   The app supports macOS 13.5 or later and includes its own audio player.
2. Open AthanBot and follow **Location → Audio → Schedule**.
3. Save with **Enable automatic startup** selected. You can close the app
   window after saving.

### Windows

1. Install [Node.js 22+](https://nodejs.org/en/download) and
   [mpv](https://mpv.io/installation/). Add the folder containing `mpv.exe` to
   your user `Path`, then open a new PowerShell window.
2. From the AthanBot folder, run `npm.cmd run setup` and open the local URL it
   prints.
3. Save with **Enable automatic startup** selected. Task Scheduler starts
   AthanBot in your Windows session now and at future sign-ins.

### Linux

1. Install Node.js 22+ and mpv. Install BlueZ if you want Bluetooth
   reconnection.
2. From the AthanBot folder, run `npm run setup` and open the local URL it
   prints.
3. On systemd systems, save with **Enable automatic startup** selected to
   start the user service. On other systems, clear the checkbox, save, and
   run `node src/main.js run` in your session.

For browser setup on macOS, install Node.js 22+ and mpv and run
`npm run setup`. Install `blueutil` for Bluetooth reconnection by address.
Keep the project folder in place while automatic startup is enabled.

### Headless Raspberry Pi

Use Raspberry Pi OS with Node.js 22+ and WirePlumber 0.5 for headless Bluetooth.
Run `./scripts/prepare-pi.sh --headless` as your regular user, then reboot.
Connect a wired speaker or pair and trust your Bluetooth speaker using
`bluetoothctl` under the same account.

Run `node src/main.js setup 8787` on the Pi. From your computer, run the command
below with your Pi's username and hostname, then open the full URL printed
by AthanBot, including its fragment. Save with **Enable automatic startup**
selected.

```sh
ssh -N -L 8787:127.0.0.1:8787 user@raspberrypi.local
```

## Configure playback

- **Prayer times.** Set your location, time zone, calculation method, and Asr
  convention. Compare **Preview today** with your preferred prayer timetable
  and adjust offsets if needed.
- **Recordings.** Use the bundled library, import your own files, or download
  the recommended Alafasy recording. You can choose a separate recording for
  Fajr or any other prayer.
- **Speakers.** Pair Bluetooth speakers in system settings, refresh the list,
  and choose a preferred output. On the Mac app, also select the paired
  Bluetooth speaker so AthanBot connects for playback and disconnects
  afterward. On Linux, enter its address for automatic reconnection.
  Windows manages the Bluetooth connection. Scheduled playback can use an
  optional fallback output.
- **Controls.** Use **Test playback** to check your speaker. On the Mac app,
  **Play Athan now** plays the full default recording. **Stop Athan** ends
  current playback and leaves future prayers scheduled.

Keep the computer awake and signed in for desktop playback. On a plugged-in
MacBook, leave the lid open and enable **System Settings → Battery → Options →
Prevent automatic sleeping on power adapter when the display is off**. The
screen can turn off while AthanBot runs.

### Scheduled wake on macOS

Scheduled wake is experimental. In the Mac app, choose **Schedule → Enable
sleep playback**, approve the helper install, then run **Test sleep playback**.
Test with the same speaker, power source, and lid position you plan to use.
Enable **Schedule Mac wake alarms** only after you hear the full Athan during
a test. macOS can wake into DarkWake while Bluetooth audio is unavailable,
even when plugged in with the lid closed.

## Troubleshooting

| Platform | Check the background scheduler |
| --- | --- |
| macOS | `launchctl print "gui/$(id -u)/org.athanbot.service"` |
| Windows PowerShell | `Get-ScheduledTask -TaskName "AthanBot-*"` |
| Linux with systemd | `systemctl --user status athanbot.service` |

Look for a running task or service. If it is missing, save again with
**Enable automatic startup** selected. Check recent playback in
`~/Library/Application Support/AthanBot/athanbot.log` on macOS,
`%LOCALAPPDATA%\AthanBot\athanbot.log` on Windows, or with
`journalctl --user -u athanbot.service -n 30` on Linux. On macOS,
`pmset -g sched` lists registered wake alarms under `org.athanbot.schedule`.

From the project folder, `node src/main.js times 2` lists today’s and tomorrow’s
prayer times from saved settings. Use `node src/main.js outputs` to list speakers,
or `node src/main.js disable` to turn off automatic startup. With a bundled Mac
app, use **Preview today** in the app to check the current configuration.

## Build and test

Run `npm test` from the project folder. To build the Mac disk image, install
Apple Command Line Tools and FFmpeg, then run `./scripts/build_macos_app.sh`.
The output appears in `dist/`. Set `ATHANBOT_MAC_ARCH=x86_64` for an Intel
build. For distribution, set `ATHANBOT_SIGN_IDENTITY` and
`ATHANBOT_NOTARY_PROFILE` to sign and notarize the image.

Prayer calculations use [Adhan JS](vendor/adhan/README.md).
See [recording credits and licenses](audio/README.md).
