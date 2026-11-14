const token = location.hash.slice(1);
const form = document.querySelector('#settings');
const message = document.querySelector('#message');
const field = name => form.elements.namedItem(name);
const byId = id => document.getElementById(id);
const names = { fajr: 'Fajr', dhuhr: 'Dhuhr', asr: 'Asr', maghrib: 'Maghrib', isha: 'Isha' };
const methodNames = {
  MuslimWorldLeague: 'Muslim World League', NorthAmerica: 'ISNA (North America)',
  MoonsightingCommittee: 'Moonsighting Committee', Egyptian: 'Egyptian General Authority of Survey',
  UmmAlQura: 'Umm al-Qura, Makkah',
};
const ruleNames = {
  MethodDefault: 'Use the method’s default', MiddleOfTheNight: 'Middle of the night',
  SeventhOfTheNight: 'One seventh of the night', TwilightAngle: 'Twilight angle',
  Unresolved: 'Skip times that cannot be calculated', AqrabBalad: 'Nearest usable latitude',
  AqrabYaum: 'Nearest usable date',
};
let state;
let page = 0;
let nextAthan;
let prayerToSkip;
const desktop = (action, data = {}) => window.webkit?.messageHandlers?.athanbot?.postMessage({ action, ...data });

function showPage(next) {
  page = next;
  for (const section of form.querySelectorAll('[data-page]')) section.hidden = Number(section.dataset.page) !== page;
  for (const button of byId('steps').querySelectorAll('button')) {
    if (Number(button.dataset.step) === page) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  }
  byId('back').hidden = page === 0;
  byId('next').hidden = page === 2;
  window.scrollTo(0, 0);
}

function visit(next) {
  if (next > page) {
    for (const control of form.querySelectorAll('[data-page="0"] [required]')) {
      if (!control.validity.valid) {
        showPage(0);
        control.reportValidity();
        return;
      }
    }
  }
  showPage(next);
  if (next === 1) void loadPaired();
}

async function wakeStatus() {
  const { available } = await api('/wake-status');
  byId('install-wake').hidden = available;
  if (!available) field('wake').checked = false;
  for (const element of [field('wake'), byId('sleep'), byId('sleep-status')]) element.disabled = !available;
  byId('wake-instructions').textContent = available
    ? 'Test with the lid closed and the charger unplugged before relying on sleep playback.'
    : 'Enable sleep playback to test whether this Mac can play with the lid closed on battery.';
  return available;
}

async function loadPaired() {
  const paired = await api('/paired').catch(() => []);
  const address = field('bluetoothAddress').value;
  const entries = paired.map(speaker => ({ id: speaker.address, label: speaker.name }));
  if (address && !entries.some(entry => entry.id === address)) entries.push({ id: address, label: address });
  options(byId('paired'), [{ id: '', label: 'Leave connection to macOS' }, ...entries], address);
}

window.athanbotLocationResult = result => {
  byId('find-city').disabled = false;
  if (result.error) return status(result.error, true);
  field('latitude').value = result.latitude;
  field('longitude').value = result.longitude;
  if (result.timeZone) field('timeZone').value = result.timeZone;
  byId('found-city').textContent = 'Location found · ' + result.label;
  status('Check that this is your location before continuing.');
};

window.athanbotWakeResult = async result => {
  byId('install-wake').disabled = false;
  if (result.error) return status(result.error, true);
  try {
    if (!await wakeStatus()) return status('The Mac did not authorize the wake helper. Try enabling sleep playback again.', true);
    status('Wake scheduling is ready to test.');
  } catch (error) {
    status(error.message, true);
  }
};

async function api(path, data) {
  const headers = { 'X-AthanBot-Token': token };
  const file = data instanceof File;
  if (!file) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, {
    method: 'POST', headers, body: file ? data : JSON.stringify(data || {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

function status(text, error = false) {
  message.textContent = text;
  message.classList.toggle('error', error);
}

function options(select, entries, value) {
  select.replaceChildren(...entries.map(({ id, label }) => new Option(label, id)));
  if (entries.some(entry => entry.id === value)) select.value = value;
}

function dynamicField(parent, label, name, element) {
  const wrapper = document.createElement('label');
  wrapper.append(label, element);
  element.name = name;
  parent.append(wrapper);
  return element;
}

function library(entries, saved = {}) {
  for (const track of ['default', ...state.prayers]) {
    const select = field('track-' + track);
    options(select, [
      track === 'default' ? state.recommended : { id: '', label: 'Use default recording' },
      ...entries,
    ], saved[track] ?? select.value);
  }
}

function devices(entries, primary = field('device').value, fallback = field('fallback').value, labels = {}) {
  for (const [id, savedLabel] of [[primary, labels.deviceLabel], [fallback, labels.fallbackLabel]]) {
    if (id && !entries.some(entry => entry.id === id)) {
      const label = savedLabel || id;
      const reconnect = id === primary && field('bluetoothAddress').value;
      entries = [...entries, { id, label: label + (reconnect ? ' (connects at playback)' : ' (currently unavailable)') }];
    }
  }
  options(field('device'), entries, primary);
  options(field('fallback'), [{ id: '', label: 'Skip if preferred speaker is unavailable' }, ...entries], fallback);
}

function input() {
  const values = new FormData(form);
  return {
    latitude: values.get('latitude'), longitude: values.get('longitude'), timeZone: values.get('timeZone'),
    method: values.get('method'), asr: values.get('asr'), highLatitude: values.get('highLatitude'),
    polar: values.get('polar'), offsets: Object.fromEntries(state.prayers.map(name => [name, values.get('offset-' + name)])),
    audio: Object.fromEntries(['default', ...state.prayers].map(name => [name, values.get('track-' + name)])),
    volumes: Object.fromEntries(state.prayers.map(name => [name, values.get('volume-' + name)])),
    ...audioInput(), ...speakerLabels(), wake: field('wake').checked, enable: field('enable').checked,
  };
}

function speakerLabels() {
  return Object.fromEntries(['device', 'fallback'].map(name => [
    name + 'Label', field(name).selectedOptions[0]?.textContent.replace(/ \((currently unavailable|connects at playback)\)$/, '') || '',
  ]));
}

const outcomes = { playing: 'Playing', played: 'Played', stopped: 'Stopped', missed: 'Missed · playback window passed', failed: 'Failed', skipped: 'Skipped once', unknown: 'Playback result unknown' };

async function refreshDashboard() {
  const { running, next, speaker, history, tests, timeZone } = await api('/status');
  const format = new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: 'medium', timeStyle: 'short' });
  nextAthan = next;
  byId('skip-next').hidden = !next;
  byId('scheduler-status').textContent = running ? 'Running' : 'Waiting for scheduler check-in';
  byId('next-prayer').textContent = next ? names[next.prayer] + ' · ' + format.format(next.at) : 'No upcoming prayer time found';
  const availability = speaker?.available === false ? (speaker.reconnect ? ' · Connects at playback' : ' · Currently unavailable') : '';
  byId('scheduled-speaker').textContent = speaker ? speaker.label + availability
    + (speaker.fallback ? ' · Fallback: ' + speaker.fallback : '') : 'Choose a speaker in settings';
  byId('empty-history').hidden = history.length > 0;
  byId('pending-tests').hidden = tests.length === 0;
  byId('pending-tests').textContent = tests.map(test => test.at > Date.now()
    ? 'Test scheduled for ' + format.format(test.at)
    : 'Test due · waiting for scheduler').join(' · ');
  byId('playback-history').replaceChildren(...history.map(({ prayer, at, outcome, output, detail }) => {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = (names[prayer] || 'Scheduled test') + ' · ' + format.format(at);
    const result = document.createElement('div');
    result.textContent = outcomes[outcome] + (output ? ' · ' + output.label + (output.fallback ? ' (fallback)' : '') : '');
    item.append(title, result);
    if (detail) {
      const note = document.createElement('small');
      note.textContent = detail;
      item.append(note);
    }
    return item;
  }));
}

function showDashboard() {
  byId('dashboard').hidden = false;
  void refreshDashboard().catch(error => status(error.message, true));
}

setInterval(() => {
  if (!document.hidden && !byId('dashboard').hidden) void refreshDashboard().catch(() => {});
}, 15_000);

function audioInput() {
  return {
    device: field('device').value, fallback: field('fallback').value,
    bluetoothAddress: field('bluetoothAddress').value, track: field('track-default').value,
  };
}

function action(id, run) {
  const element = byId(id);
  element.addEventListener(id === 'import' ? 'change' : 'click', async () => {
    element.disabled = true;
    try {
      await run();
    } catch (error) {
      status(error.message, true);
    } finally {
      element.disabled = false;
    }
  });
}

async function initialize() {
  state = await api('/state');
  const settings = state.settings;
  for (const key of ['latitude', 'longitude', 'timeZone', 'asr', 'bluetoothAddress']) field(key).value = settings[key];
  field('wake').checked = settings.wake;
  field('enable').checked = (!state.configured || state.enabled) && !state.startupError;
  if (state.desktop) {
    document.body.classList.add('desktop');
    for (const id of ['steps', 'wizard-actions', 'city-lookup', 'bluetooth-settings', 'paired-picker', 'play-now']) byId(id).hidden = false;
    byId('bluetooth-address').hidden = true;
    byId('mode').textContent = state.configured ? 'Settings' : 'First-time setup';
    byId('startup-note').textContent = 'Allow background playback to hear the Athan when the app window is closed. Reopen AthanBot any time to change settings.';
    form.querySelector('[type=submit]').textContent = state.configured ? 'Save changes' : 'Finish setup';
    showPage(0);
    void wakeStatus().catch(() => { byId('install-wake').hidden = false; });
  }
  byId('mac').hidden = !state.mac;
  if (state.windows) {
    field('bluetoothAddress').value = '';
    byId('bluetooth-address').hidden = true;
    byId('startup-note').textContent = 'AthanBot starts when you sign in to Windows. Keep the computer awake for scheduled playback.';
  }
  byId('bluetooth-playback-note').hidden = !state.mac;
  byId('time-zones').replaceChildren(...state.timeZones.map(zone => new Option(zone)));
  options(field('method'), [{ id: '', label: 'Choose a method' },
    ...state.methods.map(id => ({ id, label: methodNames[id] || id }))], settings.method || (state.desktop ? 'MuslimWorldLeague' : ''));
  for (const [name, choices] of [['highLatitude', state.highLatitudeRules], ['polar', state.polarRules]]) {
    options(field(name), choices.map(id => ({ id, label: ruleNames[id] })), settings[name]);
  }
  for (const prayer of state.prayers) {
    const offset = dynamicField(byId('offsets'), names[prayer] + ' offset in minutes', 'offset-' + prayer, document.createElement('input'));
    Object.assign(offset, { type: 'number', min: -120, max: 120, step: 1, value: settings.offsets[prayer] ?? 0 });
    const volume = dynamicField(byId('volumes'), names[prayer] + ' volume (%)', 'volume-' + prayer, document.createElement('input'));
    Object.assign(volume, { type: 'number', min: 0, max: 100, step: 1, value: settings.volumes[prayer] ?? '', placeholder: '50' });
  }
  for (const track of ['default', ...state.prayers]) {
    const select = dynamicField(byId(track === 'default' ? 'default-track' : 'tracks'), names[track] || 'Default Athan', 'track-' + track, document.createElement('select'));
    select.required = track === 'default';
  }
  if (state.desktop && !settings.asr) field('asr').value = 'standard';
  library(state.library, settings.audio);
  const outputId = id => state.desktop ? id.replace(/^avfoundation\//, 'coreaudio/') : id;
  devices(Array.isArray(state.devices) ? state.devices : [{ id: 'auto', label: 'System default' }], outputId(settings.device), outputId(settings.fallback), settings);
  byId('import').accept = state.audioExtensions.map(extension => '.' + extension).join(',');
  form.hidden = false;
  const outputError = state.desktop ? 'Could not list audio outputs. Try refreshing speakers.' : 'Speaker list unavailable. Install mpv and refresh speakers.';
  const error = state.startupError || (Array.isArray(state.devices) ? '' : outputError);
  status(error, Boolean(error));
  if (state.configured) {
    form.hidden = true;
    byId('steps').hidden = true;
    showDashboard();
  }
}

action('refresh-status', refreshDashboard);
action('scheduled-test', async () => {
  await api('/scheduled-test');
  await refreshDashboard();
  status('Test scheduled with your saved recording and speaker. You can close this window.');
});
byId('skip-next').addEventListener('click', () => {
  prayerToSkip = nextAthan;
  if (!prayerToSkip) return;
  byId('confirm-skip-button').textContent = 'Skip ' + names[prayerToSkip.prayer] + ' once';
  byId('confirm-skip').hidden = false;
  byId('confirm-skip-button').focus();
});
byId('cancel-skip').addEventListener('click', () => {
  byId('confirm-skip').hidden = true;
  byId('skip-next').focus();
});
action('confirm-skip-button', async () => {
  const prayer = prayerToSkip;
  byId('confirm-skip').hidden = true;
  await api('/skip-next', { id: prayer.id });
  await refreshDashboard();
  status('Skipped the upcoming ' + names[prayer.prayer] + ' Athan.');
});
byId('toggle-settings').addEventListener('click', () => {
  form.hidden = !form.hidden;
  byId('steps').hidden = !state.desktop || form.hidden;
  byId('toggle-settings').textContent = form.hidden ? 'Edit settings' : 'Hide settings';
});
action('devices', async () => {
  devices(await api('/devices'), field('device').value, field('fallback').value, speakerLabels());
  if (state.desktop) await loadPaired();
  status('Speaker list refreshed.');
});
action('preview', async () => {
  const settings = input();
  const events = await api('/preview', settings);
  const format = new Intl.DateTimeFormat(undefined, { timeZone: settings.timeZone, dateStyle: 'medium', timeStyle: 'short' });
  const list = byId('times');
  list.replaceChildren(...events.flatMap(({ prayer, at }) => {
    const label = document.createElement('dt');
    const time = document.createElement('dd');
    label.textContent = names[prayer];
    time.textContent = at === null ? 'Unavailable' : format.format(at);
    return [label, time];
  }));
  list.hidden = false;
  byId('weekly-preview').hidden = true;
  status('Preview uses the configured location and prayer conventions.');
});
action('preview-week', async () => {
  const settings = input();
  const days = await api('/preview', { ...settings, days: 7 });
  const date = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
  const format = new Intl.DateTimeFormat(undefined, { timeZone: settings.timeZone, timeStyle: 'short' });
  const dateKey = new Intl.DateTimeFormat('sv-SE', { timeZone: settings.timeZone, dateStyle: 'short' });
  const table = byId('weekly-times');
  table.replaceChildren();
  const header = table.createTHead().insertRow();
  for (const label of ['Date', ...state.prayers.map(prayer => names[prayer])]) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = label;
    header.append(cell);
  }
  const body = table.createTBody();
  for (const events of days) {
    const row = body.insertRow();
    const day = events[0].day;
    const label = document.createElement('th');
    label.scope = 'row';
    label.textContent = date.format(new Date(day + 'T12:00:00Z'));
    row.append(label);
    for (const { at } of events) {
      row.insertCell().textContent = at === null ? 'Unavailable' : format.format(at)
        + (dateKey.format(at) > day ? ' (+1 day)' : dateKey.format(at) < day ? ' (−1 day)' : '');
    }
  }
  byId('times').hidden = true;
  byId('weekly-preview').hidden = false;
});
action('alafasy', async () => {
  status('Downloading the Alafasy recording…');
  const result = await api('/alafasy');
  library(result.library, { default: result.id });
  status('Alafasy is selected as the default. Save setup to apply it.');
});
action('import', async () => {
  const element = byId('import');
  const file = element.files[0];
  if (!file) return;
  try {
    if (file.size > 32 * 1024 * 1024) throw new Error('Choose an audio file under 32 MiB.');
    status('Checking the recording…');
    const result = await api('/upload?name=' + encodeURIComponent(file.name), file);
    const selected = field('track-default').value;
    library(result.library, selected === state.recommended.id ? { default: result.id } : {});
    status('Recording imported. Choose which prayers should use it.');
  } finally {
    element.value = '';
  }
});
action('play', async () => {
  status('Testing the selected speaker…');
  const { stopped, output } = await api('/play', audioInput());
  status(stopped ? 'Athan stopped.' : 'Test played on ' + output.label + (output.fallback ? ' (fallback).' : '.'));
});
action('play-now', async () => {
  status('Preparing the selected speaker and starting playback…');
  const { stopped } = await api('/play', { ...audioInput(), full: true });
  status(stopped ? 'Athan stopped.' : 'Athan playback finished.');
});
action('stop-playback', async () => {
  const { stopped } = await api('/stop-playback');
  status(stopped ? 'Stop requested.' : 'No Athan is playing.');
});
action('sleep', async () => {
  const result = await api('/sleep', { ...audioInput(), seconds: Number(field('sleepDelay').value) * 60 });
  status('Scheduled for ' + new Date(result.at).toLocaleString() + '. Close the lid and leave the setup process running.');
});
action('sleep-status', async () => {
  const result = await api('/sleep-status');
  status(result.result || (result.running ? 'Sleep test pending.' : 'No sleep test scheduled.'));
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  const button = form.querySelector('[type=submit]');
  button.disabled = true;
  try {
    status('Saving setup…');
    const result = await api('/save', input());
    library(result.library, result.settings.audio);
    if (state.desktop) {
      byId('mode').textContent = 'Settings';
      button.textContent = 'Save changes';
    }
    status(field('enable').checked ? 'Settings saved and automatic startup enabled.' : 'Settings saved.');
    byId('toggle-settings').textContent = 'Hide settings';
    showDashboard();
  } catch (error) {
    status(error.message, true);
  } finally {
    button.disabled = false;
  }
});

for (const button of byId('steps').querySelectorAll('button')) {
  button.addEventListener('click', () => visit(Number(button.dataset.step)));
}
byId('back').addEventListener('click', () => visit(page - 1));
byId('next').addEventListener('click', () => visit(page + 1));
byId('paired').addEventListener('change', () => { field('bluetoothAddress').value = byId('paired').value; });
byId('bluetooth-settings').addEventListener('click', () => desktop('bluetooth'));
byId('find-city').addEventListener('click', () => {
  byId('find-city').disabled = true;
  status('Finding your city…');
  desktop('location', { query: byId('city').value });
});
byId('install-wake').addEventListener('click', () => {
  byId('install-wake').disabled = true;
  desktop('installWake');
});

initialize().catch(error => status(error.message, true));
