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

function devices(entries, primary = field('device').value, fallback = field('fallback').value) {
  for (const id of [primary, fallback]) {
    if (id && !entries.some(entry => entry.id === id)) {
      entries = [...entries, { id, label: id + ' (currently unavailable)' }];
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
    ...audioInput(), wake: field('wake').checked, enable: field('enable').checked,
  };
}

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
  byId('mac').hidden = !state.mac;
  byId('time-zones').replaceChildren(...state.timeZones.map(zone => new Option(zone)));
  options(field('method'), [{ id: '', label: 'Choose a method' },
    ...state.methods.map(id => ({ id, label: methodNames[id] || id }))], settings.method);
  for (const [name, choices] of [['highLatitude', state.highLatitudeRules], ['polar', state.polarRules]]) {
    options(field(name), choices.map(id => ({ id, label: ruleNames[id] })), settings[name]);
  }
  for (const prayer of state.prayers) {
    const offset = dynamicField(byId('offsets'), names[prayer] + ' offset in minutes', 'offset-' + prayer, document.createElement('input'));
    Object.assign(offset, { type: 'number', min: -120, max: 120, step: 1, value: settings.offsets[prayer] ?? 0 });
  }
  for (const track of ['default', ...state.prayers]) {
    const select = dynamicField(byId('tracks'), names[track] || 'Default Athan', 'track-' + track, document.createElement('select'));
    select.required = track === 'default';
  }
  library(state.library, settings.audio);
  devices(Array.isArray(state.devices) ? state.devices : [{ id: 'auto', label: 'System default' }], settings.device, settings.fallback);
  byId('import').accept = state.audioExtensions.map(extension => '.' + extension).join(',');
  form.hidden = false;
  status(Array.isArray(state.devices) ? '' : 'Speaker list unavailable. Install mpv and refresh speakers.', !Array.isArray(state.devices));
}

action('devices', async () => {
  devices(await api('/devices'));
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
  status('Preview uses the configured location and prayer conventions.');
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
  await api('/play', audioInput());
  status('Test playback finished.');
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
    status(field('enable').checked ? 'Settings saved and automatic startup enabled.' : 'Settings saved.');
  } catch (error) {
    status(error.message, true);
  } finally {
    button.disabled = false;
  }
});

initialize().catch(error => status(error.message, true));
