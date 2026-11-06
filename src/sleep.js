import { setTimeout as delay } from 'node:timers/promises';
import { grace } from './scheduler.js';
import { play, prepareAudio, readyOutput, trackPath, run } from './audio.js';
import { syncWake, wakeLead } from './wake.js';

async function waitUntil(timestamp) {
  while (Date.now() < timestamp) {
    await delay(Math.max(0, Math.min(1000, timestamp - Date.now())));
  }
}

export async function scheduleSleepTest(settings, seconds, useChime = false) {
  if (process.platform !== 'darwin') throw new Error('Sleep playback tests are available on macOS.');
  if (!Number.isInteger(seconds) || seconds < 90 || seconds > 43_200) {
    throw new Error('Choose a delay of 90 to 43,200 seconds.');
  }
  const at = Date.now() + seconds * 1000;
  await syncWake('test', [at - wakeLead]);
  return {
    at,
    async finish() {
      try {
        await waitUntil(at - wakeLead);
        if (Date.now() < at + grace) {
          void prepareAudio({ ...settings, wake: true }).catch(error => console.error(error.message));
        }
        await waitUntil(at);
        if (Date.now() >= at + grace) throw new Error('The Mac did not resume within the playback window.');
        if (useChime) {
          await run('/usr/bin/caffeinate', ['-i', '/usr/bin/afplay', '/System/Library/Sounds/Glass.aiff']);
        } else {
          const device = await readyOutput(settings, at + grace);
          if (Date.now() >= at + grace) throw new Error('The playback window expired before audio was ready.');
          await play(trackPath(settings.audio.default), device);
        }
      } finally {
        await syncWake('test', []).catch(() => {});
      }
    },
  };
}
