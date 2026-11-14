import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

test('loopback setup previews, validates and saves an offline configuration', { skip: process.platform === 'win32' && 'Uses a POSIX shell as a mock audio player' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'athanbot-setup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fakePlayer = join(directory, 'mpv');
  await writeFile(fakePlayer, `#!/bin/sh
case "$*" in
  *audio-device=help*) printf "List of detected audio devices:\\n  'auto' (Autoselect device)\\n  'pipewire/test' (Test speaker)\\n";;
  *term-playing-msg*) printf "ATHANBOT_AUDIO=pcm_s16le\\n";;
  *) printf '%s\\n' "$@" > "$ATHANBOT_DATA_DIR/playback-args"
     if [ -f "$ATHANBOT_DATA_DIR/hold-playback" ]; then
       touch "$ATHANBOT_DATA_DIR/player-started"
       exec /bin/sleep 5
     fi;;
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
  assert.equal(state.desktop, false);
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

  const desktop = await setup(0, { desktop: true });
  t.after(() => new Promise(resolve => desktop.server.close(resolve)));
  const desktopAddress = new URL(desktop.url);
  const reopen = await fetch(new URL('/state', desktopAddress), {
    method: 'POST', headers: { 'X-AthanBot-Token': desktopAddress.hash.slice(1) },
  });
  const desktopSettings = await reopen.json();
  assert.equal(desktopSettings.desktop, true);
  assert.equal(desktopSettings.configured, true);
  assert.equal(desktopSettings.settings.audio.default, savedDefault.settings.audio.default);

  const play = full => fetch(new URL('/play', desktopAddress), {
    method: 'POST', headers: { 'X-AthanBot-Token': desktopAddress.hash.slice(1) },
    body: JSON.stringify({ device: input.device, track: id, full }),
  });
  const playbackArgs = join(directory, 'playback-args');
  assert.equal((await play(false)).status, 200);
  assert.match(await readFile(playbackArgs, 'utf8'), /--length=8/);
  assert.equal((await play(true)).status, 200);
  const fullArgs = (await readFile(playbackArgs, 'utf8')).split('\n');
  assert.ok(fullArgs.includes('--volume=50'));
  assert.ok(fullArgs.includes('--audio-device=pipewire/test'));
  assert.ok(fullArgs.includes(join(directory, 'audio', id)));
  assert.ok(!fullArgs.some(arg => arg.startsWith('--length=')));

  const waitForPlayer = async () => {
    const marker = join(directory, 'player-started');
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await access(marker).then(() => true, () => false)) {
        await unlink(marker);
        return;
      }
      await delay(20);
    }
    assert.fail('Player did not start');
  };
  await writeFile(join(directory, 'hold-playback'), '');
  const playing = play(true);
  await waitForPlayer();
  assert.equal((await call('/stop-playback', null, false)).status, 403);
  assert.deepEqual(await (await call('/stop-playback')).json(), { stopped: true });
  assert.deepEqual(await (await playing).json(), { ok: true, stopped: true });

  const audioModule = new URL('../src/audio.js', import.meta.url).href;
  const background = promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
    import { play } from ${JSON.stringify(audioModule)};
    console.log(await play(process.argv[1], 'pipewire/test'));
  `, join(directory, 'audio', id)]);
  await waitForPlayer();
  assert.deepEqual(await (await call('/stop-playback')).json(), { stopped: true });
  assert.equal((await background).stdout.trim(), 'false');
  assert.deepEqual(await (await call('/stop-playback')).json(), { stopped: false });

  const settingsFile = join(directory, 'settings.json');
  await writeFile(settingsFile, JSON.stringify({
    ...savedDefault.settings, playback: 'googleHome', googleHome: { token: 'old-token' },
  }));
  const migrated = (await (await call('/state')).json()).settings;
  assert.equal(migrated.playback, undefined);
  assert.equal(migrated.googleHome, undefined);
  assert.equal(migrated.audio.default, savedDefault.settings.audio.default);
  assert.equal((await call('/save', migrated)).status, 200);
  assert.doesNotMatch(await readFile(settingsFile, 'utf8'), /old-token|googleHome/);
});
