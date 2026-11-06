import { run } from './audio.js';

// A closed Mac can return to sleep after only a short maintenance wake.
export const wakeLead = 10_000;
const helper = '/Library/PrivilegedHelperTools/org.athanbot.wake';

export async function syncWake(scope, timestamps) {
  await run('/usr/bin/sudo', ['-n', helper, scope, ...timestamps.map(time => String(Math.floor(time / 1000)))], {
    timeout: 15000,
  });
}
