import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { addDays, localDay } from './prayers.js';
import { readSettings } from './settings.js';
import { play, preparePlayback, trackPath, withPlaybackOutput } from './audio.js';
import { syncWake, wakeLead } from './wake.js';
import { eventDirectory, forgetPlayback, forgetTest, markSchedulerRunning, prayerId, recordPlayback, scheduledPrayers, scheduledTests, testId } from './playback-status.js';

export const grace = 60_000;
const interval = 2000;

export function dueEvents(events, now, previous, waiting = new Set()) {
  return events.filter(({ at, id }) => at !== null && at <= now && (
    now - at < grace || waiting.has(id) || (previous !== undefined && at > previous)
  ));
}

export async function claimEvent(directory, event, status) {
  if (!prayerId.test(event.id) && !testId.test(event.id)) {
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
  claim, playback, report, now = Date.now, withOutput = withPlaybackOutput, record = async () => {},
}) {
  if (!await claim(event, now() - event.at >= grace ? 'missed' : 'attempted')) return;
  const history = (outcome, extra) => record(event, { outcome, updatedAt: now(), ...extra })
    .catch(error => report(`Could not save playback history: ${error.message}`));
  if (now() - event.at >= grace) {
    await history('missed');
    report(`Missed ${event.id} while unavailable.`);
    return;
  }
  let output;
  let outcome;
  try {
    const track = settings.audio[event.prayer] || settings.audio.default;
    if (!track) throw new Error('Choose a default Athan recording.');
    await withOutput(settings, event.at + grace, async (device, selected) => {
      if (now() - event.at >= grace) throw new Error('Playback window expired');
      report(`Playing ${event.id} on ${device}.`);
      output = selected ?? { id: device, label: device, fallback: device === settings.fallback };
      await history('playing', { output });
      if (now() - event.at >= grace) throw new Error('Playback window expired');
      const finished = await playback(track, device, output);
      outcome = finished === false ? 'stopped' : 'played';
    });
    await history(outcome, { output });
    report(`${outcome === 'stopped' ? 'Stopped' : 'Finished'} ${event.id}.`);
  } catch (error) {
    await history(outcome || 'failed', { output, detail: error.stderr?.trim() || error.message });
    report(`Playback failed for ${event.id}: ${error.message}`);
  }
}

function report(message) {
  console.log(new Date().toISOString(), message);
}

export async function runScheduler() {
  const directory = eventDirectory;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const seen = new Set(await readdir(directory));
  const inFlight = new Set();
  const prepared = new Set();
  const waiting = new Set();
  let previous;
  let lastHeartbeat = 0;
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
        events = scheduledPrayers(settings, now);
        prepared.clear();
        waiting.clear();
        const cutoff = addDays(today, -35);
        for (const id of seen) {
          const oldPrayer = prayerId.test(id) && id.slice(0, 10) < cutoff;
          const oldTest = testId.test(id) && Number(id.slice(5, 18)) < now - 35 * 86400_000;
          if (!oldPrayer && !oldTest) continue;
          await unlink(join(directory, id)).catch(error => {
            if (error.code !== 'ENOENT') throw error;
          });
          await forgetPlayback(id);
          seen.delete(id);
        }
      }

      if (now - lastHeartbeat >= 5000 || now < lastHeartbeat) {
        await markSchedulerRunning(now).catch(error => report(`Could not record scheduler check-in: ${error.message}`));
        lastHeartbeat = now;
      }

      const tests = await scheduledTests();
      for (const id of await readdir(directory)) seen.add(id);
      for (const test of tests.filter(test => seen.has(test.id) && !inFlight.has(test.id))) await forgetTest(test.id);
      const due = [...dueEvents(events, now, previous, waiting), ...tests.filter(test => test.at <= now)]
        .filter(event => !seen.has(event.id));
      for (const event of due) {
        if (now - event.at < grace && active) {
          waiting.add(event.id);
          continue;
        }
        waiting.delete(event.id);
        seen.add(event.id);
        inFlight.add(event.id);
        const playing = now - event.at < grace;
        if (playing) active = true;
        void dispatch(event, settings, {
          claim: (target, status) => claimEvent(directory, target, status),
          playback: (track, device, output) => play(trackPath(track), device, false, settings.volumes[event.prayer] ?? settings.defaultVolume, {
            kind: event.prayer ? 'prayer' : 'scheduled-test', prayer: event.prayer, output,
          }),
          report, record: recordPlayback,
        }).catch(error => {
          seen.delete(event.id);
          report(error.message);
        }).finally(() => {
          inFlight.delete(event.id);
          if (playing) active = false;
        });
      }
      previous = now;

      const upcoming = [...events, ...tests].find(event => event.at > now && event.at - now <= wakeLead && !seen.has(event.id));
      if (upcoming && !active && !prepared.has(upcoming.id)) {
        prepared.add(upcoming.id);
        void preparePlayback(settings).catch(error => report(`Playback preparation: ${error.message}`));
      }
      if (process.platform === 'darwin' && now >= retryWakeAt) {
        const wakes = settings.wake
          ? [...events, ...tests].filter(event => !seen.has(event.id) && event.at - wakeLead > now + 5000)
            .map(event => event.at - wakeLead).sort((a, b) => a - b).slice(0, 10)
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
