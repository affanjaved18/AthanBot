import { run } from './audio.js';

export const wakeLead = 45_000;
const helper = '/Library/PrivilegedHelperTools/org.athanbot.wake';

export async function syncWake(scope, timestamps) {
  await run('/usr/bin/sudo', ['-n', helper, scope, ...timestamps.map(time => String(Math.floor(time / 1000)))], {
    timeout: 15000,
  });
}
