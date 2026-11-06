import { execFile, spawn } from 'node:child_process';
import { access, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { audioExtensions, bundledTracks, dataDir, importedAudio } from './settings.js';

export const run = promisify(execFile);
const library = join(dataDir, 'audio');
const bundle = fileURLToPath(new URL('../audio/', import.meta.url));
const player = process.env.ATHANBOT_MPV || 'mpv';
const common = ['--no-config', '--no-video', '--msg-level=all=warn'];
export const maxAudioBytes = 32 * 1024 * 1024;

export function trackPath(id) {
  if (bundledTracks.has(id)) return join(bundle, id);
  if (typeof id === 'string' && importedAudio.test(id)) return join(library, id);
  throw new Error('Choose a recording.');
}

export async function listTracks() {
  const entries = [];
  for (const [id, label] of bundledTracks) {
    try {
      await access(trackPath(id));
      entries.push({ id, label });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const files = await readdir(library).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const id of files.filter(file => importedAudio.test(file))) {
    const label = await readFile(join(library, id + '.name'), 'utf8').catch(() => id);
    entries.push({ id, label });
  }
  return entries;
}

export async function importTrack(name, bytes) {
  const extension = name.split('.').at(-1).toLowerCase();
  if (!audioExtensions.includes(extension)) throw new Error('Choose a supported audio file, such as MP3 or WAV.');
  if (!bytes.length || bytes.length > maxAudioBytes) throw new Error('Audio files must be between 1 byte and 32 MiB.');
  const id = createHash('sha256').update(bytes).digest('hex') + '.' + extension;
  await mkdir(library, { recursive: true, mode: 0o700 });
  const temporary = join(library, '.' + randomUUID() + '.' + extension);
  try {
    await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
    try {
      const { stdout } = await run(player, [
        '--no-config', '--no-video', '--ao=null', '--length=0.2',
        '--term-playing-msg=ATHANBOT_AUDIO=${audio-codec-name}', '--', temporary,
      ], { timeout: 10000 });
      if (!/^ATHANBOT_AUDIO=\S+/m.test(stdout) || stdout.includes('ATHANBOT_AUDIO=(unavailable)')) {
        throw new Error('No audio stream');
      }
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('Install mpv before importing audio.');
      throw new Error('mpv could not decode an audio track in this file.');
    }
    await rename(temporary, trackPath(id));
    await writeFile(join(library, id + '.name'), name.replace(/[\x00-\x1f]/g, '').slice(0, 200), { mode: 0o600 });
    return id;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function outputs() {
  const { stdout } = await run(player, ['--no-config', '--audio-device=help'], { timeout: 5000 });
  const devices = stdout.split('\n').flatMap(line => {
    const match = line.match(/^\s*'([^']+)'\s*\((.*)\)\s*$/);
    return match && match[1] !== 'auto' && !match[1].startsWith('null')
      ? [{ id: match[1], label: match[2] }]
      : [];
  });
  return [{ id: 'auto', label: 'System default' }, ...devices];
}

export async function connectBluetooth(address) {
  if (!address) return;
  if (process.platform === 'darwin') {
    await run('blueutil', ['--connect', address.replaceAll(':', '-')], { timeout: 7000 });
  } else if (process.platform === 'linux') {
    await run('bluetoothctl', ['--timeout', '6', 'connect', address], { timeout: 7000 });
  }
}

export async function readyOutput(settings, deadline = Date.now()) {
  let lastError;
  let reconnectAt = 0;
  const retryUntil = deadline - (settings.fallback ? 8000 : 1000);
  do {
    try {
      if ((await outputs()).some(device => device.id === settings.device)) return settings.device;
    } catch (error) {
      lastError = error;
    }
    if (settings.bluetoothAddress && Date.now() >= reconnectAt) {
      reconnectAt = Date.now() + 8000;
      await connectBluetooth(settings.bluetoothAddress).catch(error => { lastError = error; });
      if ((await outputs()).some(device => device.id === settings.device)) return settings.device;
    }
    if (Date.now() + 1000 >= retryUntil) break;
    await delay(1000);
  } while (Date.now() < retryUntil);
  if (settings.fallback && (await outputs()).some(device => device.id === settings.fallback)) {
    return settings.fallback;
  }
  throw new Error(`Selected audio output is unavailable${lastError ? ': ' + lastError.message : ''}`);
}

export async function play(file, device) {
  await access(file);
  const stayAwake = process.platform === 'darwin';
  const command = stayAwake ? '/usr/bin/caffeinate' : player;
  const args = stayAwake ? ['-i', player] : [];
  await run(command, [...args, ...common, '--audio-fallback-to-null=no', `--audio-device=${device}`, '--', file], {
    timeout: 15 * 60 * 1000,
  });
}

export function prepareAudio(settings) {
  if (process.platform === 'darwin' && settings.wake) {
    const assertion = spawn('/usr/bin/caffeinate', ['-i', '-t', '110'], { stdio: 'ignore' });
    assertion.on('error', error => console.error(error.message));
    assertion.unref();
  }
  return connectBluetooth(settings.bluetoothAddress);
}
