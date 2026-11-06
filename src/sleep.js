import { setTimeout as delay } from 'node:timers/promises';
import { grace } from './scheduler.js';
import { play, preparePlayback, trackPath, run, withPlaybackOutput } from './audio.js';
import { syncWake, wakeLead } from './wake.js';

async function waitUntil(timestamp) {
  while (Date.now() < timestamp) {
    await delay(Math.max(0, Math.min(1000, timestamp - Date.now())));
  }
}

export async function scheduleSleepTest(settings, seconds, useChime = false, prayer) {
  if (process.platform !== 'darwin') throw new Error('Sleep playback tests are available on macOS.');
  if (!Number.isInteger(seconds) || seconds < 90 || seconds > 43_200) {
    throw new Error('Choose a delay of 90 to 43,200 seconds.');
  }
  const at = Date.now() + seconds * 1000;
  const latestStart = at + 15_000;
  await syncWake('test', [at - wakeLead]);
  return {
    at,
    async finish() {
      try {
        await waitUntil(at - wakeLead);
        if (Date.now() < latestStart) {
          void preparePlayback({ ...settings, wake: true }).catch(error => console.error(error.message));
        }
        await waitUntil(at);
        if (Date.now() >= latestStart) {
          throw new Error('The Mac resumed too late for the sleep test. Playback was skipped.');
        }
        if (useChime) {
          await run('/usr/bin/caffeinate', ['-is', '/usr/bin/afplay', '/System/Library/Sounds/Glass.aiff']);
        } else {
          const file = trackPath(settings.audio[prayer] || settings.audio.default);
          return await withPlaybackOutput({ ...settings, wake: true }, at + grace, device => play(file, device));
        }
      } finally {
        await syncWake('test', []).catch(() => {});
      }
    },
  };
}
