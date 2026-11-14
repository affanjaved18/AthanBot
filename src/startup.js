import { access, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dataDir } from './settings.js';
import { run } from './audio.js';
import { syncWake } from './wake.js';
import { windowsStartup, windowsStartupEnabled } from './windows-startup.js';

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
    ${process.env.ATHANBOT_MAC_AUDIO ? '<key>ATHANBOT_MAC_AUDIO</key><string>' + xml(process.env.ATHANBOT_MAC_AUDIO) + '</string>' : ''}
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
  const player = process.env.ATHANBOT_MPV;
  const playerEnv = player ? 'Environment=' + systemd('ATHANBOT_MPV=' + player) + '\n' : '';
  const contents = `[Unit]
Description=AthanBot prayer-time playback
After=pipewire.socket wireplumber.service

[Service]
ExecStart=:${systemd(process.execPath)} ${systemd(entry)} run
Environment=${systemd('PATH=' + paths)}
Environment=${systemd('ATHANBOT_DATA_DIR=' + dataDir)}
${playerEnv}Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
  return { file, contents };
}

export async function startupEnabled() {
  if (process.platform === 'win32') return windowsStartupEnabled();
  const { file } = process.platform === 'darwin' ? macService() : linuxService();
  try {
    await access(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function macServiceLoaded(target) {
  try {
    await run('/bin/launchctl', ['print', target]);
    return true;
  } catch (error) {
    if (error.code === 113) return false; // launchctl could not find the service.
    throw error;
  }
}

async function waitForMacServiceRemoval(target) {
  // bootout can return while launchd is still stopping the process.
  const deadline = performance.now() + 10_000;
  while (await macServiceLoaded(target)) {
    if (performance.now() >= deadline) throw new Error('AthanBot’s background service is still stopping. Try saving again.');
    await delay(100);
  }
}

export async function startup(settings, enable) {
  if (process.platform === 'win32') return windowsStartup(entry, enable);
  const mac = process.platform === 'darwin';
  if (!mac && process.platform !== 'linux') throw new Error('Automatic startup supports Windows, macOS, and systemd Linux.');
  const { domain, file, contents } = mac ? macService() : linuxService();
  const target = mac ? domain + '/' + label : undefined;
  if (enable) {
    if (mac && settings.wake) {
      // Check that the optional, administrator-installed helper is available without touching the daily alarms.
      await syncWake('check', []).catch(() => {
        throw new Error('Enable sleep playback in AthanBot before turning on scheduled Mac wake-ups.');
      });
    }
    await mkdir(dataDir, { recursive: true, mode: 0o700 });
    await mkdir(dirname(file), { recursive: true });
    if (mac) {
      const previous = await readFile(file, 'utf8').catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
      const loaded = await macServiceLoaded(target);
      // The scheduler reads saved settings itself. Reload only when the job definition changes.
      if (previous !== contents || !loaded) {
        if (loaded) {
          await run('/bin/launchctl', ['bootout', target]);
          await waitForMacServiceRemoval(target);
        }
        if (previous !== contents) await writeFile(file, contents, { mode: 0o644 });
        await run('/bin/launchctl', ['enable', target]);
        await run('/bin/launchctl', ['bootstrap', domain, file]);
      }
      if (!settings.wake) await syncWake('schedule', []).catch(() => {});
    } else {
      await writeFile(file, contents, { mode: 0o644 });
      await run('systemctl', ['--user', 'daemon-reload']);
      await run('systemctl', ['--user', 'enable', 'athanbot.service']);
      await run('systemctl', ['--user', 'restart', 'athanbot.service']);
    }
  } else {
    if (mac) {
      if (await macServiceLoaded(target)) {
        await run('/bin/launchctl', ['bootout', target]);
        await waitForMacServiceRemoval(target);
      }
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
