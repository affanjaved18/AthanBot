import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDays, calculateDay, localDay, upcomingDays } from '../src/prayers.js';
import { validate } from '../src/settings.js';
import { claimEvent, dispatch, dueEvents, grace } from '../src/scheduler.js';

const observer = {
  latitude: 40.71, longitude: -74.01, timeZone: 'America/New_York',
  method: 'NorthAmerica', asr: 'standard',
};
const settings = validate(observer);

test('computes five prayer instants across the US fall time change', () => {
  const days = upcomingDays(settings, Date.parse('2026-11-01T01:00:00Z'), 2);
  assert.equal(days[0][0].day, '2026-10-31');
  assert.equal(days[1][0].day, '2026-11-01');
  for (const day of days) {
    assert.deepEqual(day.map(event => event.prayer), ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha']);
    assert.ok(day.every((event, index) => Number.isFinite(event.at) && (!index || event.at > day[index - 1].at)));
  }
  const format = new Intl.DateTimeFormat('en-US', { timeZone: settings.timeZone, hour: 'numeric', timeZoneName: 'short' });
  assert.match(format.format(days[0][0].at), /EDT/);
  assert.match(format.format(days[1][0].at), /EST/);
  assert.equal(new Date(calculateDay('2026-11-05', settings)[0].at).toISOString(), '2026-11-05T10:14:00.000Z');
});

test('supports Asr conventions, offsets, and an adjusted event crossing midnight', () => {
  const day = '2026-06-21';
  const location = { ...observer, latitude: 59.33, longitude: 18.07, timeZone: 'Europe/Stockholm' };
  const standard = calculateDay(day, validate(location));
  const hanafi = calculateDay(day, validate({ ...location, asr: 'hanafi', offsets: { isha: 120 } }));
  assert.ok(hanafi[2].at > standard[2].at);
  assert.equal(hanafi[4].at - standard[4].at, 120 * 60_000);
  assert.equal(hanafi[4].day, day);
  assert.equal(localDay(hanafi[4].at, location.timeZone), addDays(day, 1));
});

test('keeps unresolved polar prayer times out of the scheduler', () => {
  const polar = validate({ ...observer, latitude: 78.22, longitude: 15.64, timeZone: 'Arctic/Longyearbyen' });
  const day = calculateDay('2026-06-21', polar);
  assert.equal(day.find(event => event.prayer === 'maghrib').at, null);
  assert.ok(dueEvents(day, Date.parse('2026-06-21T23:00:00Z'), 0).every(event => event.at !== null));
});

test('validates deployment configuration and rejects track path traversal', () => {
  assert.throws(() => validate({ ...observer, latitude: '' }), /latitude/);
  assert.throws(() => validate({ ...observer, longitude: 181 }), /longitude/);
  assert.throws(() => validate({ ...observer, timeZone: 'Unknown/Place' }), /time zone/);
  assert.throws(() => validate({ ...observer, offsets: { fajr: 2.5 } }), /whole minutes/);
  assert.throws(() => validate({ ...observer, audio: { default: '../track.mp3' } }), /audio library/);
  assert.throws(() => validate({ ...observer, bluetoothAddress: 'AA:BB:CC:DD:EE:FF' }), /preferred output/);
  assert.throws(() => validate({ ...observer, volumes: { fajr: 101 } }), /volume/);
  assert.throws(() => validate({ ...observer, volumes: { fajr: 25.5 } }), /whole percentage/);
});

test('deduplicates concurrent playback and restart using a persistent claim', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'athanbot-events-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const event = { id: '2026-11-05-fajr', prayer: 'fajr', at: 5000 };
  const plays = [];
  const audio = { default: 'regular', fajr: 'morning' };
  const io = {
    claim: (target, status) => claimEvent(directory, target, status),
    withOutput: async (_, __, play) => play('preferred-device'),
    playback: async (...args) => plays.push(args),
    report: () => {},
    now: () => 5500,
  };
  await Promise.all([dispatch(event, { audio }, io), dispatch(event, { audio }, io)]);
  await dispatch(event, { audio }, io);
  assert.deepEqual(plays, [['morning', 'preferred-device']]);
  assert.equal(await readFile(join(directory, event.id), 'utf8'), 'attempted\n');
});

test('handles stale, recent and future events after sleep or a clock change', async () => {
  const now = 500_000;
  const stale = { id: 'stale', at: now - grace - 1 };
  const recent = { id: 'recent', at: now - 100 };
  const future = { id: 'future', at: now + 100 };
  const events = [stale, recent, future];
  assert.deepEqual(dueEvents(events, now), [recent]);
  assert.deepEqual(dueEvents(events, now, now - 120_000), [stale, recent]);
  assert.deepEqual(dueEvents(events, now, now + 120_000), [recent]);
  assert.deepEqual(dueEvents(events, now, now, new Set(['stale'])), [stale, recent]);

  const reports = [];
  await dispatch(stale, {}, {
    claim: async (_, status) => status === 'missed',
    withOutput: async () => assert.fail('Stale prayers must not start audio'),
    report: message => reports.push(message),
    now: () => now,
  });
  assert.deepEqual(reports, ['Missed stale while unavailable.']);
});

test('drops a playback if its speaker only becomes ready after the deadline', async () => {
  let now = 5000;
  const reports = [];
  await dispatch({ id: 'event', at: now, prayer: 'isha' }, { audio: { default: 'regular' } }, {
    claim: async () => true,
    withOutput: async (_, deadline, play) => { now = deadline; await play('preferred'); },
    playback: async () => assert.fail('Expired playback'),
    report: message => reports.push(message),
    now: () => now,
  });
  assert.match(reports[0], /Playback window expired/);
});
