import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dataDir } from './settings.js';
import { addDays, calculateDay, localDay } from './prayers.js';

export const eventDirectory = join(dataDir, 'events');
const historyDirectory = join(dataDir, 'history');
const heartbeatFile = join(dataDir, 'scheduler.json');
const testDirectory = join(dataDir, 'scheduled-tests');
export const testId = /^test-\d{13}-[a-f0-9-]{36}$/;
export const prayerId = /^\d{4}-\d{2}-\d{2}-(fajr|dhuhr|asr|maghrib|isha)$/;

async function entries(directory) {
  return readdir(directory).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
}

async function readJSON(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeJSON(directory, file, value) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(directory, randomUUID() + '.tmp');
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export function scheduledPrayers(settings, now, days = 3) {
  const today = localDay(now, settings.timeZone);
  return Array.from({ length: days + 1 }, (_, index) => calculateDay(addDays(today, index - 1), settings))
    .flat().filter(event => event.at !== null).sort((first, second) => first.at - second.at);
}

export async function nextPrayer(settings, now) {
  const claimed = new Set(await entries(eventDirectory));
  return scheduledPrayers(settings, now, 8).find(event => event.at > now && !claimed.has(event.id)) ?? null;
}

export async function skippedPrayers(days) {
  const claimed = new Set(await entries(eventDirectory));
  const ids = days.flat().map(event => event.id).filter(id => claimed.has(id));
  const skips = await Promise.all(ids.map(async id => {
    const status = await readFile(join(eventDirectory, id), 'utf8').catch(error => {
      if (error.code !== 'ENOENT') throw error;
      return '';
    });
    return status.trim() === 'skipped' ? id : null;
  }));
  return skips.filter(Boolean);
}

export async function schedulePlaybackTest(now = Date.now()) {
  const at = now + 180_000;
  const event = { id: 'test-' + at + '-' + randomUUID(), at };
  await writeJSON(testDirectory, join(testDirectory, event.id + '.json'), event);
  return event;
}

export async function scheduledTests() {
  const files = (await entries(testDirectory)).filter(file => testId.test(file.slice(0, -5)) && file.endsWith('.json'));
  return (await Promise.all(files.map(file => readJSON(join(testDirectory, file))))).filter(Boolean);
}

export async function forgetTest(id) {
  await unlink(join(testDirectory, id + '.json')).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
}

export function recordPlayback(event, result) {
  return writeJSON(historyDirectory, join(historyDirectory, event.id + '.json'), { ...event, ...result });
}

export async function forgetPlayback(id) {
  await unlink(join(historyDirectory, id + '.json')).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
}

export function markSchedulerRunning(at) {
  return writeJSON(dataDir, heartbeatFile, { at });
}

export async function schedulerRunning(now = Date.now()) {
  const heartbeat = await readJSON(heartbeatFile);
  return Boolean(heartbeat && heartbeat.at <= now && now - heartbeat.at < 20_000);
}

export async function playbackHistory(now = Date.now(), checkIn = schedulerRunning(now)) {
  const files = (await entries(historyDirectory)).filter(file => file.endsWith('.json')).sort().reverse();
  // Prayer IDs and test IDs have different prefixes. Keep a recent window from each.
  const candidates = [...files.filter(file => !file.startsWith('test-')).slice(0, 20),
    ...files.filter(file => file.startsWith('test-')).slice(0, 20)];
  const records = await Promise.all(candidates.map(file => readJSON(join(historyDirectory, file))));
  const running = await checkIn;
  return records.filter(Boolean).sort((first, second) => second.at - first.at).slice(0, 20)
    .map(record => record.outcome === 'playing' && (!running || now - record.updatedAt > 16 * 60_000)
      ? { ...record, outcome: 'unknown' } : record);
}
