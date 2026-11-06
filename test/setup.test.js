import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('loopback setup previews, validates and saves an offline configuration', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'athanbot-setup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fakePlayer = join(directory, 'mpv');
  await writeFile(fakePlayer, `#!/bin/sh
case "$*" in
  *audio-device=help*) printf "List of detected audio devices:\\n  'auto' (Autoselect device)\\n  'pipewire/test' (Test speaker)\\n";;
  *term-playing-msg*) printf "ATHANBOT_AUDIO=pcm_s16le\\n";;
esac
`, { mode: 0o700 });
  process.env.ATHANBOT_DATA_DIR = directory;
  process.env.ATHANBOT_MPV = fakePlayer;
  const { setup } = await import('../src/setup/server.js');
  const { server, url } = await setup();
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = new URL(url);
  const token = address.hash.slice(1);
  const call = (path, input, authorized = true) => fetch(new URL(path, address), {
    method: 'POST',
    headers: authorized ? { 'X-AthanBot-Token': token } : {},
    body: input instanceof Uint8Array ? input : JSON.stringify(input ?? {}),
  });
  const page = await fetch(address);
  assert.match(await page.text(), /AthanBot setup/);
  assert.equal((await call('/state', null, false)).status, 403);
  const state = await (await call('/state')).json();
  assert.equal(state.settings.latitude, '');
  assert.deepEqual(state.devices.map(device => device.id), ['auto', 'pipewire/test']);
  assert.ok(state.library.some(track => track.id === 'malmo-fajr.opus'));

  const upload = await call('/upload?name=test.wav', new Uint8Array([1, 2, 3]));
  assert.equal(upload.status, 200);
  const { id } = await upload.json();
  assert.match(id, /^[0-9a-f]{64}\.wav$/);
  assert.deepEqual([...await readFile(join(directory, 'audio', id))], [1, 2, 3]);

  const input = {
    latitude: 40.71, longitude: -74.01, timeZone: 'America/New_York',
    method: 'NorthAmerica', asr: 'standard', device: 'pipewire/test',
    audio: { default: id, fajr: 'malmo-fajr.opus' },
  };
  const preview = await call('/preview', input);
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).length, 5);
  assert.equal((await call('/save', { ...input, audio: {} })).status, 400);
  assert.equal((await call('/save', input)).status, 200);
  const saved = await (await call('/state')).json();
  assert.equal(saved.settings.audio.default, id);
  assert.equal(saved.settings.audio.fajr, 'malmo-fajr.opus');
  assert.equal(saved.settings.device, 'pipewire/test');

  let downloads = 0;
  const fetchLocal = globalThis.fetch;
  globalThis.fetch = (url, options) => {
    if (url !== 'https://cdn.aladhan.com/audio/adhans/a9.mp3') return fetchLocal(url, options);
    downloads += 1;
    return Promise.resolve(new Response(new Uint8Array([4, 5, 6])));
  };
  t.after(() => { globalThis.fetch = fetchLocal; });
  const recommended = { ...input, audio: { default: state.recommended.id } };
  assert.equal((await call('/preview', recommended)).status, 200);
  assert.equal(downloads, 0);
  const savedDefault = await (await call('/save', recommended)).json();
  assert.match(savedDefault.settings.audio.default, /^[0-9a-f]{64}\.mp3$/);
  assert.equal(downloads, 1);
  assert.deepEqual([...await readFile(join(directory, 'audio', savedDefault.settings.audio.default))], [4, 5, 6]);
});
