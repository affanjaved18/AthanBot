import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const prayers = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
export const methods = [
  'MuslimWorldLeague', 'NorthAmerica', 'MoonsightingCommittee', 'Egyptian', 'Karachi',
  'UmmAlQura', 'Dubai', 'Qatar', 'Kuwait', 'Singapore', 'Turkey', 'Tehran',
];
export const highLatitudeRules = ['MethodDefault', 'MiddleOfTheNight', 'SeventhOfTheNight', 'TwilightAngle'];
export const polarRules = ['Unresolved', 'AqrabBalad', 'AqrabYaum'];
export const tracks = ['default', ...prayers];
export const audioExtensions = ['mp3', 'm4a', 'aac', 'wav', 'aiff', 'ogg', 'opus', 'flac'];
export const importedAudio = /^[a-f0-9]{64}\.(mp3|m4a|aac|wav|aiff|ogg|opus|flac)$/;
export const bundledTracks = new Map([
  ['malmo-fajr.opus', 'Fajr · Besim Azemi, Islamic Center Malmö'],
  ['prophets-mosque.ogg', 'Regular · Prophet’s Mosque (recording by ejaz215)'],
]);

export const dataDir = resolve(process.env.ATHANBOT_DATA_DIR || (process.platform === 'darwin'
  ? join(homedir(), 'Library', 'Application Support', 'AthanBot')
  : join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'athanbot')));

export const defaults = {
  latitude: '', longitude: '', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  method: '', asr: '', highLatitude: 'MethodDefault', polar: 'Unresolved',
  offsets: {}, audio: {}, device: 'auto', fallback: '', bluetoothAddress: '', wake: false,
};

function number(value, label, min, max) {
  if (!['number', 'string'].includes(typeof value) || String(value).trim() === '') {
    throw new Error(`Enter ${label}.`);
  }
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max) {
    throw new Error(`${label} must be between ${min} and ${max}.`);
  }
  return result;
}

export function outputSettings(input) {
  const device = input.device || 'auto';
  const fallback = input.fallback || '';
  const bluetoothAddress = (input.bluetoothAddress || '').toUpperCase();
  for (const output of [device, fallback]) {
    if (typeof output !== 'string' || output.length > 256 || /[\x00-\x1f]/.test(output)) {
      throw new Error('Choose a valid audio output.');
    }
  }
  if (bluetoothAddress && !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(bluetoothAddress)) {
    throw new Error('Use a Bluetooth address such as AA:BB:CC:DD:EE:FF.');
  }
  if (bluetoothAddress && device === 'auto') throw new Error('Choose the Bluetooth speaker as the preferred output.');
  return { device, fallback: fallback === device ? '' : fallback, bluetoothAddress };
}

export function validate(input) {
  const latitude = number(input.latitude, 'latitude', -90, 90);
  const longitude = number(input.longitude, 'longitude', -180, 180);
  const timeZone = String(input.timeZone || '').trim();
  try {
    if (!timeZone || /^[+-]/.test(timeZone)) throw new Error();
    new Intl.DateTimeFormat('en', { timeZone });
  } catch {
    throw new Error('Enter the location’s time zone, for example America/New_York.');
  }
  const { method, asr, highLatitude = defaults.highLatitude, polar = defaults.polar } = input;
  if (!methods.includes(method)) throw new Error('Choose a calculation method.');
  if (!['standard', 'hanafi'].includes(asr)) throw new Error('Choose an Asr convention.');
  if (!highLatitudeRules.includes(highLatitude) || !polarRules.includes(polar)) {
    throw new Error('Choose valid high-latitude and polar rules.');
  }
  const offsets = {};
  const audio = {};
  for (const prayer of prayers) {
    const offset = number(input.offsets?.[prayer] ?? 0, `${prayer} offset`, -120, 120);
    if (!Number.isInteger(offset)) throw new Error('Offsets must be whole minutes.');
    offsets[prayer] = offset;
  }
  for (const track of tracks) {
    const file = input.audio?.[track];
    if (!file) continue;
    if (typeof file !== 'string' || (!importedAudio.test(file) && !bundledTracks.has(file))) {
      throw new Error('Choose a track from the audio library.');
    }
    audio[track] = file;
  }
  return {
    latitude, longitude, timeZone, method, asr, highLatitude, polar, offsets, audio,
    ...outputSettings(input), wake: input.wake === true,
  };
}

export async function readSettings() {
  try {
    return validate(JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function saveSettings(input) {
  const settings = validate(input);
  if (!settings.audio.default) throw new Error('Choose a default Athan recording.');
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const temporary = join(dataDir, `settings-${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await rename(temporary, join(dataDir, 'settings.json'));
  return settings;
}
