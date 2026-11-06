import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { addDays, calculateDay, localDay } from './prayers.js';
import { dataDir, readSettings } from './settings.js';
import { play, preparePlayback, trackPath, withPlaybackOutput } from './audio.js';
import { syncWake, wakeLead } from './wake.js';

export const grace = 60_000;
const interval = 2000;

export function dueEvents(events, now, previous, waiting = new Set()) {
  return events.filter(({ at, id }) => at !== null && at <= now && (
    now - at < grace || waiting.has(id) || (previous !== undefined && at > previous)
  ));
}

export async function claimEvent(directory, event, status) {
  if (!/^\d{4}-\d{2}-\d{2}-(fajr|dhuhr|asr|maghrib|isha)$/.test(event.id)) {
    throw new Error('Invalid prayer event ID');
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(join(directory, event.id), status + '\n', { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

export async function dispatch(event, settings, {
  claim, playback, report, now = Date.now, withOutput = withPlaybackOutput,
}) {
  if (!await claim(event, now() - event.at >= grace ? 'missed' : 'attempted')) return;
  if (now() - event.at >= grace) {
    report(`Missed ${event.id} while unavailable.`);
    return;
  }
  try {
    const track = settings.audio[event.prayer] || settings.audio.default;
    if (!track) throw new Error('Choose a default Athan recording.');
    const finished = await withOutput(settings, event.at + grace, async device => {
      if (now() - event.at >= grace) throw new Error('Playback window expired');
      report(`Playing ${event.id} on ${device}.`);
      return playback(track, device);
    });
    report(`${finished === false ? 'Stopped' : 'Finished'} ${event.id}.`);
  } catch (error) {
    report(`Playback failed for ${event.id}: ${error.message}`);
  }
}

function report(message) {
  console.log(new Date().toISOString(), message);
}

export async function runScheduler() {
  const directory = join(dataDir, 'events');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const seen = new Set(await readdir(directory));
  const prepared = new Set();
  const waiting = new Set();
  let previous;
  let scheduleKey;
  let wakeKey;
  let retryWakeAt = 0;
  let events = [];
  let active = false;
  let stopped = false;
  const abort = new AbortController();
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      stopped = true;
      abort.abort();
    });
  }

  while (!stopped) {
    try {
      const settings = await readSettings();
      if (!settings) throw new Error('Complete AthanBot setup first.');
      const now = Date.now();
      const today = localDay(now, settings.timeZone);
      const nextKey = today + JSON.stringify(settings);
      if (nextKey !== scheduleKey) {
        scheduleKey = nextKey;
        events = [-1, 0, 1, 2].flatMap(offset => calculateDay(addDays(today, offset), settings));
        for (const event of events.filter(event => event.day === today && event.at === null)) {
          report(`Unavailable prayer time for ${event.id}.`);
        }
        events = events.filter(event => event.at !== null).sort((first, second) => first.at - second.at);
        prepared.clear();
        waiting.clear();
        const cutoff = addDays(today, -35);
        for (const id of seen) {
          if (id.slice(0, 10) >= cutoff) continue;
          await unlink(join(directory, id)).catch(error => {
            if (error.code !== 'ENOENT') throw error;
          });
          seen.delete(id);
        }
      }

      const due = dueEvents(events, now, previous, waiting).filter(event => !seen.has(event.id));
      for (const event of due) {
        if (now - event.at < grace && active) {
          waiting.add(event.id);
          continue;
        }
        waiting.delete(event.id);
        seen.add(event.id);
        const playing = now - event.at < grace;
        if (playing) active = true;
        void dispatch(event, settings, {
          claim: (target, status) => claimEvent(directory, target, status),
          playback: (track, device) => play(trackPath(track), device),
          report,
        }).catch(error => {
          seen.delete(event.id);
          report(error.message);
        }).finally(() => { if (playing) active = false; });
      }
      previous = now;

      const upcoming = events.find(event => event.at > now && event.at - now <= wakeLead && !seen.has(event.id));
      if (upcoming && !active && !prepared.has(upcoming.id)) {
        prepared.add(upcoming.id);
        void preparePlayback(settings).catch(error => report(`Playback preparation: ${error.message}`));
      }
      if (process.platform === 'darwin' && now >= retryWakeAt) {
        const wakes = settings.wake
          ? events.filter(event => !seen.has(event.id) && event.at - wakeLead > now + 5000)
            .slice(0, 10).map(event => event.at - wakeLead)
          : [];
        const key = JSON.stringify(wakes);
        if (key !== wakeKey && (settings.wake || wakeKey)) {
          try {
            await syncWake('schedule', wakes);
            wakeKey = key;
            report(`Registered ${wakes.length} macOS wake alarms.`);
          } catch (error) {
            retryWakeAt = now + 60_000;
            report(`macOS wake scheduling failed: ${error.message}`);
          }
        }
      }
    } catch (error) {
      report(error.message);
      if (!scheduleKey) process.exitCode = 1;
      if (process.exitCode) break;
    }
    await delay(interval, undefined, { signal: abort.signal }).catch(error => {
      if (!stopped) throw error;
    });
  }
}
