import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, open, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { audioExtensions, bundledTracks, dataDir, defaultVolume, importedAudio } from './settings.js';

export const run = promisify(execFile);
const library = join(dataDir, 'audio');
const activePlayback = join(dataDir, 'active-playback');
const bundle = fileURLToPath(new URL('../audio/', import.meta.url));
const nativeAudio = process.env.ATHANBOT_MAC_AUDIO;
const player = process.env.ATHANBOT_MPV || (process.platform === 'win32' ? 'mpv.exe' : 'mpv');
const common = ['--no-config', '--no-video', '--msg-level=all=warn'];
export const maxAudioBytes = 32 * 1024 * 1024;

export function trackPath(id) {
  if (bundledTracks.has(id)) return join(bundle, nativeAudio ? id + '.m4a' : id);
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
      if (nativeAudio) {
        await run(nativeAudio, ['validate', temporary], { timeout: 10000 });
      } else {
        const { stdout } = await run(player, [
          '--no-config', '--no-video', '--ao=null', '--length=0.2',
          '--term-playing-msg=ATHANBOT_AUDIO=${audio-codec-name}', '--', temporary,
        ], { timeout: 10000, windowsHide: true });
        if (!/^ATHANBOT_AUDIO=\S+/m.test(stdout) || stdout.includes('ATHANBOT_AUDIO=(unavailable)')) {
          throw new Error('No audio stream');
        }
      }
    } catch (error) {
      if (nativeAudio) throw new Error('The Mac could not read this recording. Try MP3, M4A, or WAV.');
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

export async function pairedBluetooth() {
  if (!nativeAudio) return [];
  const { stdout } = await run(nativeAudio, ['paired'], { timeout: 5000 });
  return JSON.parse(stdout);
}

export async function outputs() {
  if (nativeAudio) {
    const { stdout } = await run(nativeAudio, ['outputs'], { timeout: 5000 });
    return [{ id: 'auto', label: 'System default' }, ...JSON.parse(stdout)];
  }
  const { stdout } = await run(player, ['--no-config', '--audio-device=help'], { timeout: 5000, windowsHide: true });
  const devices = stdout.split('\n').flatMap(line => {
    const match = line.match(/^\s*'([^']+)'\s*\((.*)\)\s*$/);
    return match && match[1] !== 'auto' && !match[1].startsWith('null')
      ? [{ id: match[1], label: match[2] }]
      : [];
  });
  return [{ id: 'auto', label: 'System default' }, ...devices];
}

async function connectBluetooth(address) {
  if (!address) return;
  if (nativeAudio) {
    await run(nativeAudio, ['connect', address], { timeout: 7000 });
  } else if (process.platform === 'darwin') {
    await run('blueutil', ['--connect', address.replaceAll(':', '-')], { timeout: 7000 });
  } else if (process.platform === 'linux') {
    await run('bluetoothctl', ['--timeout', '6', 'connect', address], { timeout: 7000 });
  }
}

async function disconnectBluetooth({ bluetoothAddress, device }) {
  if (nativeAudio) await run(nativeAudio, ['disconnect', bluetoothAddress, device], { timeout: 7000 });
  else await run('blueutil', ['--disconnect', bluetoothAddress.replaceAll(':', '-')], { timeout: 7000 });
}

export function normalizeOutput(id) {
  return nativeAudio ? id?.replace(/^avfoundation\//, 'coreaudio/') : id;
}

async function readyOutput(settings, deadline) {
  const preferred = normalizeOutput(settings.device);
  const fallback = normalizeOutput(settings.fallback);
  let lastError;
  let reconnectAt = 0;
  let linkOpened = false;
  const retryUntil = deadline - (settings.fallback ? 8000 : 1000);
  do {
    try {
      const output = (await outputs()).find(device => device.id === preferred);
      if (output) return { ...output, fallback: false };
    } catch (error) {
      lastError = error;
    }
    if (settings.bluetoothAddress && Date.now() >= reconnectAt) {
      reconnectAt = Date.now() + 8000;
      try {
        if (nativeAudio && linkOpened) {
          // Opening an existing Bluetooth link again does not restart its audio profile.
          reconnectAt = Infinity;
          await disconnectBluetooth(settings);
          linkOpened = false;
        }
        if (Date.now() < deadline || !nativeAudio) {
          await connectBluetooth(settings.bluetoothAddress);
          linkOpened = true;
          lastError = undefined;
          if (nativeAudio && Number.isFinite(reconnectAt)) reconnectAt = Date.now() + 8000;
          const output = (await outputs()).find(device => device.id === preferred);
          if (output) return { ...output, fallback: false };
        }
      } catch (error) {
        lastError = error;
      }
    }
    if (Date.now() + 1000 >= retryUntil) break;
    await delay(1000);
  } while (Date.now() < retryUntil);
  if (fallback) {
    const output = (await outputs()).find(device => device.id === fallback);
    if (output) return { ...output, fallback: true };
  }
  if (lastError) throw new Error(lastError.stderr?.trim() || lastError.message);
  if (nativeAudio && linkOpened) {
    throw new Error('Bluetooth connected, but macOS did not make the selected speaker available for audio.');
  }
  throw new Error('Selected audio output is unavailable');
}

function holdPlaybackWake(args) {
  const assertion = spawn('/usr/bin/caffeinate', args, { stdio: 'ignore' });
  assertion.on('error', error => console.error(error.message));
  return assertion;
}

export async function withPlaybackOutput(settings, deadline, playback) {
  const playOnOutput = async () => {
    const device = await readyOutput(settings, deadline ?? Date.now());
    if (deadline !== undefined && Date.now() >= deadline) throw new Error('Playback window expired');
    return playback(device.id, device);
  };
  const { bluetoothAddress } = settings;
  if (process.platform === 'linux' && bluetoothAddress) deadline ??= Date.now() + 30_000;
  if (process.platform !== 'darwin') return playOnOutput();
  if (!bluetoothAddress) {
    const assertion = settings.wake ? holdPlaybackWake(['-is', '-w', String(process.pid)]) : undefined;
    try {
      return await playOnOutput();
    } finally {
      assertion?.kill();
    }
  }

  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  // Darwin's O_EXLOCK is missing from Node's fs.constants. The kernel releases it on close or exit.
  const O_EXLOCK = 0x20;
  const flags = O_EXLOCK | constants.O_NONBLOCK | constants.O_CREAT | constants.O_WRONLY;
  const lock = await open(join(dataDir, 'bluetooth-playback.lock'), flags, 0o600).catch(error => {
    if (['EAGAIN', 'EWOULDBLOCK'].includes(error.code)) throw new Error('AthanBot is already using Bluetooth for playback.');
    throw error;
  });
  try {
    deadline ??= Date.now() + 30_000;
    if (Date.now() >= deadline) throw new Error('Playback window expired');
    const assertion = holdPlaybackWake([settings.wake ? '-is' : '-i', '-w', String(process.pid)]);
    let failed = false;
    try {
      return await playOnOutput();
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        await disconnectBluetooth(settings);
      } catch (error) {
        const message = error.stderr?.trim() || 'Could not disconnect the Bluetooth speaker.';
        if (!failed) throw new Error(message);
        console.error(message);
      } finally {
        assertion.kill();
      }
    }
  } finally {
    await lock.close();
  }
}

export async function stopPlayback() {
  const entries = await readdir(activePlayback).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  let stopped = false;
  for (const entry of entries) {
    if (!/^\d+-[a-f0-9-]{36}$/.test(entry)) continue;
    let alive = true;
    try {
      process.kill(Number(entry.split('-')[0]), 0);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
      alive = false;
    }
    try {
      await unlink(join(activePlayback, entry));
      stopped ||= alive;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return stopped;
}

async function runPlayback(executable, args, timeout) {
  await mkdir(activePlayback, { recursive: true, mode: 0o700 });
  const marker = join(activePlayback, `${process.pid}-${randomUUID()}`);
  await writeFile(marker, '', { flag: 'wx', mode: 0o600 });
  const abort = new AbortController();
  // Removing this playback's marker lets the app stop a player owned by the scheduler.
  const poll = setInterval(() => {
    void access(marker).catch(error => { if (error.code === 'ENOENT') abort.abort(); });
  }, 150);
  const playback = run(executable, args, { timeout, signal: abort.signal, killSignal: 'SIGKILL', windowsHide: true });
  const closed = new Promise(resolve => playback.child.once('close', resolve));
  const awake = process.platform === 'darwin'
    ? spawn('/usr/bin/caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' }) : undefined;
  awake?.on('error', error => console.error(error.message));
  try {
    await playback;
    return true;
  } catch (error) {
    if (error.code === 'ABORT_ERR' && abort.signal.aborted) return false;
    throw error;
  } finally {
    clearInterval(poll);
    await closed;
    awake?.kill();
    await unlink(marker).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function play(file, device, preview = false, volume = defaultVolume) {
  await access(file);
  const legacyAudio = nativeAudio && /\.(ogg|opus)$/i.test(file);
  const timeout = 15 * 60 * 1000;
  if (nativeAudio && !legacyAudio) {
    const args = ['play', file, device];
    if (preview) args.push('preview');
    if (volume !== defaultVolume) args.push(String(volume));
    return runPlayback(nativeAudio, args, preview ? 25000 : timeout);
  }
  // Existing CLI installations may have saved Ogg files and already have mpv.
  const executable = legacyAudio && !process.env.ATHANBOT_MPV
    ? (process.arch === 'arm64' ? '/opt/homebrew/bin/mpv' : '/usr/local/bin/mpv') : player;
  if (legacyAudio) await access(executable).catch(() => {
    throw new Error('Reimport this recording as MP3, M4A, or WAV to play it in the Mac app.');
  });
  const limit = preview ? ['--length=8'] : [];
  return runPlayback(executable, [...common, ...limit, `--volume=${volume}`, '--audio-fallback-to-null=no', `--audio-device=${device}`, '--', file], timeout);
}

export async function preparePlayback(settings) {
  if (process.platform === 'darwin' && settings.wake) {
    holdPlaybackWake(['-is', '-t', '30']).unref();
  }
  if (process.platform === 'linux') await connectBluetooth(settings.bluetoothAddress);
}
