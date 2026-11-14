<img src="packaging/icons/athanbot.png" width="64" height="64" alt="">

# AthanBot

Play the Athan automatically through your chosen speaker on macOS, Windows, or Linux. AthanBot calculates all five daily prayer times offline.

[Install](#install) · [Set up playback](#set-up-playback) · [Check the schedule](#check-the-schedule) · [Appendix](#appendix)

## Install

Download the installer for your platform from [GitHub Releases](https://github.com/affanjaved18/AthanBot/releases), or [build it locally](#build-and-test).

| Platform | Install | Open |
| --- | --- | --- |
| macOS 13.5+ | Open the `.dmg` for your Mac and drag **AthanBot** into **Applications**. | Open **AthanBot** from Applications. |
| Windows x64 or ARM64 | Run the matching `.exe`. Install [mpv](https://mpv.io/installation/) and add the folder containing `mpv.exe` to your user `Path`. | Open **AthanBot** from Start. Setup opens in your browser. |
| Debian or Ubuntu, amd64 or arm64 | Install the matching `.deb`, for example `sudo apt install ./athanbot_0.3.2_amd64.deb`. APT also installs mpv. | Open **AthanBot** from the app menu. Setup opens in your browser. |

For other Linux distributions, see [Run from source](#run-from-source). For a Pi without a display, see [Headless Raspberry Pi](#headless-raspberry-pi).

## Set up playback

1. **Confirm prayer times.** Set your location, time zone, calculation method, and Asr convention. Use **Preview today** or **Preview 7 days** to check times and offsets against your local timetable.
2. **Choose recordings.** Use the bundled library, import your own audio, or download the recommended Alafasy recording. Set a different recording or volume for each prayer. The default volume is 50%.
3. **Choose a speaker.** Pair Bluetooth speakers in your system settings, then refresh the speaker list. Select an output and, optionally, a fallback. Use **Test playback** to check it and **Stop Athan** to end playback early. The Mac app also has **Play Athan now** for the full recording.
4. **Save the schedule.** Select **Enable automatic startup** to run in the background now and at future sign-ins on macOS, Windows, or Linux with systemd. Keep the computer awake and signed in. The display can turn off.

| Platform | Bluetooth playback |
| --- | --- |
| macOS app | Select the paired speaker in the Bluetooth picker. AthanBot connects for playback and disconnects afterward. |
| Windows | Connect and manage the speaker in Windows Bluetooth settings. |
| Linux | Install BlueZ and enter the paired speaker’s Bluetooth address for automatic reconnection. |

## Check the schedule

Open **Today** to see the next prayer, saved speaker, scheduler status, and today’s times. **Schedule** has a seven-day timetable and **Skip next Athan**. **History** shows the results of recent prayers and tests. To test background playback with your saved settings, go to **Settings → Audio → Test in 3 minutes**.

For terminal diagnostics, use the commands below.

| Platform | Check the scheduler | Recent playback |
| --- | --- | --- |
| macOS | `launchctl print "gui/$(id -u)/org.athanbot.service"` | `~/Library/Application Support/AthanBot/athanbot.log` |
| Windows PowerShell | `Get-ScheduledTask -TaskName "AthanBot-*"` | `%LOCALAPPDATA%\AthanBot\athanbot.log` |
| Linux with systemd | `systemctl --user status athanbot.service` | `journalctl --user -u athanbot.service -n 30` |

If the scheduler is missing, open setup and save again with **Enable automatic startup** selected.

## Appendix

### MacBook sleep

- **Keep the Mac awake with the display off.** With the lid open and power connected, enable **System Settings → Battery → Options → Prevent automatic sleeping on power adapter when the display is off**.
- **Try scheduled wake.** In the Mac app, go to **Settings → Startup → Advanced Mac wake settings**. Choose **Enable sleep playback**, approve the helper, then run **Test sleep playback** with your usual speaker, power source, and lid position. Turn on **Schedule Mac wake alarms** only after hearing the full Athan in the test. Scheduled wake is experimental, and macOS can wake into DarkWake with Bluetooth audio unavailable.
- **List registered wake alarms.** Run `pmset -g sched` and look for `org.athanbot.schedule`.

### Run from source

- Install Node.js 22+ and mpv. From the project folder, run `npm run setup` (`npm.cmd run setup` in Windows PowerShell) and open the printed URL. Keep the folder in place while automatic startup is enabled. macOS source installations use `blueutil` for Bluetooth reconnection.
- On Linux without systemd, save with **Enable automatic startup** cleared and run `node src/main.js run` in your session. With the `.deb` installed, use `athanbot run`.
- Run `node src/main.js times 2` for two days of prayer times, `node src/main.js outputs` to list speakers, or `node src/main.js disable` to turn off automatic startup.

To uninstall the `.deb`, run `athanbot disable` if you enabled automatic startup, then `sudo apt remove athanbot`.

### Headless Raspberry Pi

1. Use Raspberry Pi OS with Node.js 22+. For headless Bluetooth use WirePlumber 0.5.
2. As your regular user, run `./scripts/prepare-pi.sh --headless` and reboot. Connect a wired speaker or pair and trust your Bluetooth speaker with `bluetoothctl` under the same account.
3. On the Pi, run `node src/main.js setup 8787`. From your computer, run the command below with your Pi’s username and hostname.
4. On your computer, open the full URL printed by AthanBot, including the part beginning with `#`. Save with **Enable automatic startup** selected.

```sh
ssh -N -L 8787:127.0.0.1:8787 user@raspberrypi.local
```

### Build and test

Run `npm test` from the project folder. Installers are written to `dist/`.

| Installer | Build command | Requirements and options |
| --- | --- | --- |
| macOS `.dmg` | `./scripts/build_macos_app.sh` | Apple Command Line Tools and FFmpeg. Set `ATHANBOT_MAC_ARCH=x86_64` for Intel. Use `ATHANBOT_SIGN_IDENTITY` and `ATHANBOT_NOTARY_PROFILE` to sign and notarize. |
| Windows `.exe` | `./scripts/build_desktop_package.sh windows x64` | NSIS 3. Use `arm64` for Windows on ARM. Bundles Node.js. |
| Linux `.deb` | `./scripts/build_desktop_package.sh linux x64` | `dpkg-deb` or BSD tar. Use `arm64` for ARM. Bundles Node.js. |

Version tags such as `v0.3.2` trigger the release workflow. GitHub publishes installers and checksums after the build and smoke checks pass.

Prayer calculations use [Adhan JS](vendor/adhan/README.md). See [recording credits and licenses](audio/README.md).
