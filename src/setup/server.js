import { access, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { audioExtensions, defaults, highLatitudeRules, methods, outputSettings, playbackVolume, polarRules, prayers, readSettings, saveSettings, validate } from '../settings.js';
import { currentPlayback, importTrack, listTracks, maxAudioBytes, normalizeOutput, outputs, pairedBluetooth, play, playbackActive, stopPlayback, trackPath, withPlaybackOutput } from '../audio.js';
import { upcomingDays } from '../prayers.js';
import { startup, startupEnabled } from '../startup.js';
import { scheduleSleepTest } from '../sleep.js';
import { syncWake } from '../wake.js';
import { claimEvent } from '../scheduler.js';
import { eventDirectory, nextPrayer, playbackHistory, recordPlayback, scheduledTests, schedulePlaybackTest, schedulerRunning, skippedPrayers } from '../playback-status.js';

const alafasy = {
  id: 'download-alafasy',
  label: 'Mishari Rashid Alafasy (download on first use)',
  name: 'Mishari Rashid Alafasy — Yet Another Adhan.mp3',
  url: 'https://cdn.aladhan.com/audio/adhans/a9.mp3',
};
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/calendar.js': ['calendar.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
  '/vendor/web-awesome/components.js': ['vendor/web-awesome/components.js', 'text/javascript; charset=utf-8'],
  '/vendor/web-awesome/theme.css': ['vendor/web-awesome/theme.css', 'text/css; charset=utf-8'],
  '/athanbot.png': ['athanbot.png', 'image/png'],
  '/fonts/Inter.woff2': ['fonts/Inter.woff2', 'font/woff2'],
};

async function body(stream, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw new Error('The upload is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function send(response, payload, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

export async function setup(port = 0, { desktop = false, idleTimeout } = {}) {
  const token = randomBytes(32).toString('hex');
  let sleepTest;
  let testingAudio = false;
  let saving = false;
  let downloading;
  let schedulingTest = false;
  let idleTimer;
  let requests = 0;
  function resetIdleTimer() {
    clearTimeout(idleTimer);
    if (idleTimeout && !requests) idleTimer = setTimeout(() => server.close(), idleTimeout);
  }
  async function getAlafasy() {
    downloading ??= (async () => {
      const audio = await fetch(alafasy.url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
      if (!audio.ok || !audio.body) throw new Error('Could not download Alafasy from Aladhan.');
      return importTrack(alafasy.name, await body(audio.body, maxAudioBytes));
    })().catch(error => {
      downloading = undefined;
      throw error;
    });
    return downloading;
  }
  const resolveTrack = id => id === alafasy.id ? getAlafasy() : id;
  const startupState = () => startupEnabled().catch(error => ({ error: error.stderr?.trim() || error.message }));
  const server = createServer(async (request, response) => {
    requests++;
    resetIdleTimer();
    response.once('close', () => { requests--; resetIdleTimer(); });
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Web Awesome keeps its built-in icons in the local bundle as data URLs.
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self' data:; frame-ancestors 'none'; base-uri 'none'");
    try {
      const host = '127.0.0.1:' + server.address().port;
      if (request.headers.host !== host || (request.headers.origin && request.headers.origin !== 'http://' + host)) {
        return send(response, { error: 'Use the local setup address.' }, 403);
      }
      const url = new URL(request.url, 'http://' + host);
      if (request.method === 'GET' && Object.hasOwn(assets, url.pathname)) {
        const [filename, type] = assets[url.pathname];
        const content = await readFile(new URL(filename, import.meta.url));
        response.writeHead(200, { 'Content-Type': type });
        return response.end(content);
      }
      if (request.method !== 'POST' || request.headers['x-athanbot-token'] !== token) {
        return send(response, { error: 'Invalid setup session. Reopen the URL printed by AthanBot.' }, 403);
      }

      if (url.pathname === '/state') {
        const [devices, saved, enabled] = await Promise.all([
          outputs().catch(error => ({ error: error.message })), readSettings(),
          startupState(),
        ]);
        return send(response, {
          settings: saved || defaults, configured: Boolean(saved), enabled: enabled === true,
          startupError: enabled.error, desktop, library: await listTracks(), devices,
          recommended: { id: alafasy.id, label: alafasy.label },
          methods, highLatitudeRules, polarRules, prayers,
          audioExtensions: desktop ? audioExtensions.filter(extension => !['ogg', 'opus'].includes(extension)) : audioExtensions,
          mac: process.platform === 'darwin', windows: process.platform === 'win32',
          timeZones: Intl.supportedValuesOf('timeZone'),
        });
      }
      if (desktop && url.pathname === '/paired') return send(response, await pairedBluetooth());
      if (desktop && url.pathname === '/wake-status') {
        return send(response, { available: await syncWake('check', []).then(() => true, () => false) });
      }
      if (url.pathname === '/devices') return send(response, await outputs());
      if (url.pathname === '/playback-active') return send(response, { playing: await playbackActive() });
      if (url.pathname === '/now-playing') return send(response, await currentPlayback());
      if (url.pathname === '/status') {
        const saved = await readSettings();
        const now = Date.now();
        const checkIn = schedulerRunning(now);
        const days = saved ? upcomingDays(saved, now, 7) : [];
        const [running, next, history, devices, paired, tests, skipped] = await Promise.all([
          checkIn, saved ? nextPrayer(saved, now) : null, playbackHistory(now, checkIn),
          saved ? outputs().catch(() => null) : null, saved?.bluetoothAddress ? pairedBluetooth().catch(() => []) : [],
          scheduledTests(), skippedPrayers(days),
        ]);
        const preferred = saved && devices?.find(device => device.id === normalizeOutput(saved.device));
        const bluetooth = paired.find(speaker => speaker.address === saved?.bluetoothAddress);
        return send(response, {
          running, next, history, days, skipped,
          tests: tests.filter(test => !history.some(record => record.id === test.id)), timeZone: saved?.timeZone,
          speaker: saved && {
            label: preferred?.label || bluetooth?.name || saved.deviceLabel || (saved.device === 'auto' ? 'System default' : saved.device),
            available: devices ? Boolean(preferred) : null,
            bluetooth: Boolean(saved.bluetoothAddress) || /bluez|^coreaudio\/[0-9a-f]{2}(?:-[0-9a-f]{2}){5}:/i.test(saved.device),
            reconnect: Boolean(saved.bluetoothAddress) && (!desktop || Boolean(bluetooth)),
            fallback: saved.fallback && (devices?.find(device => device.id === normalizeOutput(saved.fallback))?.label || saved.fallbackLabel || saved.fallback),
          },
        });
      }
      if (url.pathname === '/scheduled-test') {
        if (schedulingTest) throw new Error('A test is already being scheduled.');
        schedulingTest = true;
        try {
          if (!(await readSettings())?.audio.default) throw new Error('Save your speaker and recording settings first.');
          if (!await schedulerRunning()) throw new Error('Start the background scheduler before scheduling a test.');
          if ((await scheduledTests()).length) throw new Error('A scheduled test is already pending or playing.');
          return send(response, await schedulePlaybackTest());
        } finally {
          schedulingTest = false;
        }
      }
      if (url.pathname === '/upload') {
        const id = await importTrack(url.searchParams.get('name') || '', await body(request, maxAudioBytes));
        return send(response, { id, library: await listTracks() });
      }
      if (url.pathname === '/alafasy') {
        const id = await getAlafasy();
        return send(response, { id, library: await listTracks() });
      }
      const input = JSON.parse((await body(request, 64 * 1024)).toString('utf8') || '{}');
      if (url.pathname === '/preview') {
        const settings = validate({ ...input, audio: {}, volumes: {}, defaultVolume: undefined, device: 'auto', fallback: '', bluetoothAddress: '' });
        const days = upcomingDays(settings, Date.now(), input.days === 7 ? 7 : 1);
        return send(response, input.days === 7 ? days : days[0]);
      }
      if (url.pathname === '/skip-next') {
        const saved = await readSettings();
        const now = Date.now();
        const next = saved && await nextPrayer(saved, now);
        if (!next || next.id !== input.id || next.at <= Date.now() || !await claimEvent(eventDirectory, next, 'skipped')) {
          throw new Error('The next prayer changed. Refresh status before skipping.');
        }
        await recordPlayback(next, { outcome: 'skipped', updatedAt: now });
        return send(response, next);
      }
      if (url.pathname === '/play' || url.pathname === '/test-speaker') {
        if (testingAudio) throw new Error('Test playback is already running.');
        testingAudio = true;
        try {
          const savedTest = url.pathname === '/test-speaker';
          const saved = savedTest ? await readSettings() : null;
          if (savedTest && !saved?.audio.default) throw new Error('Save a recording and speaker before testing.');
          const settings = saved || outputSettings(input);
          const file = trackPath(await resolveTrack(saved ? saved.audio.default : input.track));
          const full = !savedTest && input.full === true;
          let output;
          const finished = await withPlaybackOutput(settings, undefined, async (device, selected) => {
            output = selected;
            return play(file, device, savedTest || (desktop && !full), saved?.defaultVolume ?? playbackVolume(input.defaultVolume), {
              kind: full ? 'manual' : 'speaker-test', output: selected,
            });
          });
          return send(response, { ok: true, stopped: finished === false, output });
        } finally {
          testingAudio = false;
        }
      }
      if (url.pathname === '/stop-playback') return send(response, { stopped: await stopPlayback() });
      if (url.pathname === '/sleep') {
        if (sleepTest?.running) throw new Error('A sleep test is already scheduled.');
        sleepTest = { running: true };
        try {
          const track = await resolveTrack(input.track);
          const settings = { ...outputSettings(input), fallback: '', audio: { default: track }, defaultVolume: playbackVolume(input.defaultVolume) };
          await access(trackPath(track));
          const test = await scheduleSleepTest(settings, Number(input.seconds));
          sleepTest.at = test.at;
          void test.finish().then(finished => { sleepTest.result = finished === false ? 'Athan stopped.' : 'Playback finished. Confirm you heard it.'; })
            .catch(error => { sleepTest.result = error.stderr?.trim() || error.message; })
            .finally(() => { sleepTest.running = false; });
          return send(response, sleepTest);
        } catch (error) {
          sleepTest = null;
          throw error;
        }
      }
      if (url.pathname === '/sleep-status') return send(response, sleepTest || {});
      if (url.pathname === '/save') {
        if (saving) throw new Error('Settings are being saved.');
        saving = true;
        try {
          const useAlafasy = input.audio?.default === alafasy.id;
          const audio = useAlafasy ? { ...input.audio, default: '' } : input.audio;
          const settings = validate({ ...input, audio });
          if (useAlafasy) settings.audio.default = await getAlafasy();
          await Promise.all(Object.values(settings.audio).map(id => access(trackPath(id))));
          const saved = await saveSettings(settings);
          try {
            if (input.enable === true) await startup(saved, true);
            else if (input.enable === false && await startupEnabled()) await startup(saved, false);
          } catch (error) {
            throw new Error('Settings were saved, but the background playback setting could not be applied. ' + error.message);
          }
          return send(response, { settings: saved, library: await listTracks() });
        } finally {
          saving = false;
        }
      }
      return send(response, { error: 'Unknown setup action.' }, 404);
    } catch (error) {
      if (!response.headersSent) send(response, { error: error.stderr?.trim() || error.message }, 400);
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const url = `http://127.0.0.1:${server.address().port}/#${token}`;
  server.once('close', () => clearTimeout(idleTimer));
  resetIdleTimer();
  if (desktop) console.log(url);
  else console.log('Open this address in your browser. Press Ctrl+C when setup is finished.\n' + url);
  return { server, url };
}
