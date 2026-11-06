import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataDir } from './settings.js';
import { run } from './audio.js';
import { syncWake } from './wake.js';

const label = 'org.athanbot.service';
const entry = fileURLToPath(new URL('./main.js', import.meta.url));
const paths = [...new Set([
  dirname(process.execPath), ...(process.env.PATH || '').split(':').filter(path => path.startsWith('/')),
  '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin',
])].join(':');

function xml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function systemd(value) {
  return '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
    .replaceAll('\n', '\\n').replaceAll('%', '%%') + '"';
}

function macService() {
  const domain = 'gui/' + process.getuid();
  const file = join(homedir(), 'Library', 'LaunchAgents', label + '.plist');
  const contents = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(entry)}</string><string>run</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${xml(paths)}</string>
    <key>ATHANBOT_DATA_DIR</key><string>${xml(dataDir)}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>${xml(join(dataDir, 'athanbot.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(join(dataDir, 'athanbot.log'))}</string>
</dict></plist>
`;
  return { domain, file, contents };
}

function linuxService() {
  const file = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user', 'athanbot.service');
  const contents = `[Unit]
Description=AthanBot prayer-time playback
Wants=pipewire.socket wireplumber.service
After=pipewire.socket wireplumber.service

[Service]
ExecStart=:${systemd(process.execPath)} ${systemd(entry)} run
Environment=${systemd('PATH=' + paths)}
Environment=${systemd('ATHANBOT_DATA_DIR=' + dataDir)}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
  return { file, contents };
}

export async function startup(settings, enable) {
  const mac = process.platform === 'darwin';
  if (!mac && process.platform !== 'linux') throw new Error('Automatic startup supports macOS and systemd Linux.');
  const { domain, file, contents } = mac ? macService() : linuxService();
  if (enable) {
    if (mac && settings.wake) {
      // Check that the optional, administrator-installed helper is available without touching the daily alarms.
      await syncWake('check', []).catch(() => {
        throw new Error('Install the Mac wake helper before enabling sleep playback. See the README.');
      });
    }
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents, { mode: 0o644 });
    if (mac) {
      await run('/bin/launchctl', ['bootout', domain + '/' + label]).catch(() => {});
      await run('/bin/launchctl', ['enable', domain + '/' + label]);
      await run('/bin/launchctl', ['bootstrap', domain, file]);
      if (!settings.wake) await syncWake('schedule', []).catch(() => {});
    } else {
      await run('systemctl', ['--user', 'daemon-reload']);
      await run('systemctl', ['--user', 'enable', 'athanbot.service']);
      await run('systemctl', ['--user', 'restart', 'athanbot.service']);
    }
  } else {
    if (mac) {
      await run('/bin/launchctl', ['bootout', domain + '/' + label]).catch(() => {});
      for (const scope of ['schedule', 'test']) await syncWake(scope, []).catch(() => {});
    } else {
      await run('systemctl', ['--user', 'disable', '--now', 'athanbot.service']).catch(() => {});
    }
    await unlink(file).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (!mac) await run('systemctl', ['--user', 'daemon-reload']);
  }
}
