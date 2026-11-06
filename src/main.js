import { setup } from './setup/server.js';
import { readSettings } from './settings.js';
import { upcomingDays } from './prayers.js';
import { outputs, play, trackPath, withPlaybackOutput } from './audio.js';
import { runScheduler } from './scheduler.js';
import { scheduleSleepTest } from './sleep.js';
import { startup } from './startup.js';

async function configured() {
  const settings = await readSettings();
  if (!settings) throw new Error('Run setup first.');
  return settings;
}

async function main([command, arg, extra]) {
  switch (command) {
    case 'app-setup':
      await setup(0, { desktop: true });
      break;
    case 'setup': {
      const port = arg === undefined ? 0 : Number(arg);
      if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid setup port.');
      await setup(port);
      break;
    }
    case 'run':
      await runScheduler();
      break;
    case 'times': {
      const days = Number(arg ?? 7);
      if (!Number.isInteger(days) || days < 1 || days > 30) throw new Error('Choose between 1 and 30 days.');
      const settings = await configured();
      const format = new Intl.DateTimeFormat('en', {
        timeZone: settings.timeZone, dateStyle: 'short', timeStyle: 'short',
      });
      for (const day of upcomingDays(settings, Date.now(), days)) {
        console.log(day[0].day, settings.timeZone);
        for (const { prayer, at } of day) console.log(' ', prayer, at === null ? 'unavailable' : format.format(at));
      }
      break;
    }
    case 'outputs':
      console.table(await outputs());
      break;
    case 'test-audio': {
      const settings = await configured();
      const track = arg ? settings.audio[arg] || settings.audio.default : settings.audio.default;
      const file = trackPath(track);
      await withPlaybackOutput({ ...settings, fallback: '' }, undefined, device => play(file, device));
      break;
    }
    case 'sleep-test': {
      const chime = extra === '--chime';
      const settings = chime ? {} : await configured();
      const test = await scheduleSleepTest(settings, Number(arg ?? 180), chime, extra);
      console.log(`Playback is scheduled for ${new Date(test.at).toLocaleString()}. Close the lid and leave this process running.`);
      const finished = await test.finish();
      console.log(finished === false ? 'Athan stopped.' : 'Playback finished. Confirm that you heard it without opening the lid.');
      break;
    }
    case 'enable':
      await startup(await configured(), true);
      console.log('Automatic startup enabled.');
      break;
    case 'disable':
      await startup(null, false);
      console.log('Automatic startup disabled.');
      break;
    default:
      console.log('AthanBot commands: setup [port], run, times [days], outputs, test-audio [prayer], sleep-test [seconds] [--chime|fajr], enable, disable');
      if (command && command !== '--help') process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch(error => {
  console.error(error.stderr?.trim() || error.message);
  process.exitCode = 1;
});
