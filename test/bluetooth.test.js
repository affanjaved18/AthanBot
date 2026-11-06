import test from 'node:test';
import assert from 'node:assert/strict';
import { access, appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Mac Bluetooth playback releases the speaker after success or failure', { skip: process.platform !== 'darwin' }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'athanbot-bluetooth-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const helper = join(directory, 'audio');
  process.env.ATHANBOT_MAC_AUDIO = helper;
  process.env.ATHANBOT_DATA_DIR = directory;
  await writeFile(helper, `#!/bin/sh
case "$1" in
  outputs) if [ -f "$ATHANBOT_DATA_DIR/connected" ]; then
    echo '[{"id":"coreaudio/test","label":"Test Speaker"}]'
  else
    echo '[]'
  fi ;;
  connect) echo connect >> "$ATHANBOT_DATA_DIR/actions"
    if [ -f "$ATHANBOT_DATA_DIR/stalled-link" ]; then
      rm "$ATHANBOT_DATA_DIR/stalled-link"
    else
      touch "$ATHANBOT_DATA_DIR/connected"
    fi ;;
  disconnect) echo disconnect >> "$ATHANBOT_DATA_DIR/actions"; rm -f "$ATHANBOT_DATA_DIR/connected" ;;
esac
`, { mode: 0o700 });

  const { preparePlayback, withPlaybackOutput } = await import('../src/audio.js');
  const settings = { device: 'coreaudio/test', bluetoothAddress: 'AA:BB:CC:DD:EE:FF' };
  const actions = join(directory, 'actions');
  await preparePlayback(settings);
  await assert.rejects(access(actions), { code: 'ENOENT' });
  await withPlaybackOutput(settings, undefined, async device => {
    assert.equal(device, settings.device);
    await assert.rejects(withPlaybackOutput(settings, undefined, () => assert.fail()), /already using Bluetooth/);
    await appendFile(actions, 'play\n');
  });
  await assert.rejects(withPlaybackOutput(settings, undefined, async () => {
    throw new Error('test playback failure');
  }), /test playback failure/);
  assert.equal(await readFile(actions, 'utf8'), 'connect\nplay\ndisconnect\nconnect\ndisconnect\n');

  await writeFile(actions, '');
  await writeFile(join(directory, 'stalled-link'), '');
  await withPlaybackOutput(settings, undefined, async device => {
    assert.equal(device, settings.device);
    await appendFile(actions, 'play\n');
  });
  assert.equal(await readFile(actions, 'utf8'), 'connect\ndisconnect\nconnect\nplay\ndisconnect\n');
});
