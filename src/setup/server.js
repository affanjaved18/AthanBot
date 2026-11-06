import { access, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { audioExtensions, defaults, highLatitudeRules, methods, outputSettings, polarRules, prayers, readSettings, saveSettings, validate } from '../settings.js';
import { importTrack, listTracks, maxAudioBytes, outputs, pairedBluetooth, play, stopPlayback, trackPath, withPlaybackOutput } from '../audio.js';
import { upcomingDays } from '../prayers.js';
import { startup, startupEnabled } from '../startup.js';
import { scheduleSleepTest } from '../sleep.js';
import { syncWake } from '../wake.js';

const alafasy = {
  id: 'download-alafasy',
  label: 'Mishari Rashid Alafasy (download on first use)',
  name: 'Mishari Rashid Alafasy — Yet Another Adhan.mp3',
  url: 'https://cdn.aladhan.com/audio/adhans/a9.mp3',
};
const assets = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
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

export async function setup(port = 0, { desktop = false } = {}) {
  const token = randomBytes(32).toString('hex');
  let sleepTest;
  let testingAudio = false;
  let saving = false;
  let downloading;
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
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
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
          outputs().catch(error => ({ error: error.message })), readSettings(), desktop ? startupEnabled() : false,
        ]);
        return send(response, {
          settings: saved || defaults, configured: Boolean(saved), enabled, desktop, library: await listTracks(), devices,
          recommended: { id: alafasy.id, label: alafasy.label },
          methods, highLatitudeRules, polarRules, prayers, audioExtensions: desktop ? audioExtensions.filter(extension => !['ogg', 'opus'].includes(extension)) : audioExtensions, mac: process.platform === 'darwin',
          timeZones: Intl.supportedValuesOf('timeZone'),
        });
      }
      if (desktop && url.pathname === '/paired') return send(response, await pairedBluetooth());
      if (desktop && url.pathname === '/wake-status') {
        return send(response, { available: await syncWake('check', []).then(() => true, () => false) });
      }
      if (url.pathname === '/devices') return send(response, await outputs());
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
        const settings = validate({ ...input, audio: {}, device: 'auto', fallback: '', bluetoothAddress: '' });
        return send(response, upcomingDays(settings, Date.now(), 1)[0]);
      }
      if (url.pathname === '/play') {
        if (testingAudio) throw new Error('Test playback is already running.');
        testingAudio = true;
        try {
          const settings = { ...outputSettings(input), fallback: '' };
          const file = trackPath(await resolveTrack(input.track));
          const finished = await withPlaybackOutput(settings, undefined, device => play(file, device, desktop && input.full !== true));
          return send(response, { ok: true, stopped: finished === false });
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
          const settings = { ...outputSettings(input), fallback: '', audio: { default: track } };
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
            else if (desktop && input.enable === false && await startupEnabled()) await startup(saved, false);
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
  if (desktop) console.log(url);
  else console.log('Open this address in your browser. Press Ctrl+C when setup is finished.\n' + url);
  return { server, url };
}
