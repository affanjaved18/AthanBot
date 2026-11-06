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
  if (state.desktop) {
    document.body.classList.add('desktop');
    for (const id of ['steps', 'wizard-actions', 'city-lookup', 'bluetooth-settings', 'paired-picker', 'play-now']) byId(id).hidden = false;
    byId('bluetooth-address').hidden = true;
    byId('mode').textContent = state.configured ? 'Settings' : 'First-time setup';
    byId('startup-note').textContent = 'Allow background playback to hear the Athan when the app window is closed. Reopen AthanBot any time to change settings.';
    field('enable').checked = !state.configured || state.enabled;
    form.querySelector('[type=submit]').textContent = state.configured ? 'Save changes' : 'Finish setup';
    showPage(0);
    void wakeStatus().catch(() => { byId('install-wake').hidden = false; });
  }
  byId('mac').hidden = !state.mac;
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
  }
  for (const track of ['default', ...state.prayers]) {
    const select = dynamicField(byId(track === 'default' ? 'default-track' : 'tracks'), names[track] || 'Default Athan', 'track-' + track, document.createElement('select'));
    select.required = track === 'default';
  }
  if (state.desktop && !settings.asr) field('asr').value = 'standard';
  library(state.library, settings.audio);
  const outputId = id => state.desktop ? id.replace(/^avfoundation\//, 'coreaudio/') : id;
  devices(Array.isArray(state.devices) ? state.devices : [{ id: 'auto', label: 'System default' }], outputId(settings.device), outputId(settings.fallback));
  byId('import').accept = state.audioExtensions.map(extension => '.' + extension).join(',');
  form.hidden = false;
  const outputError = state.desktop ? 'Could not list audio outputs. Try refreshing speakers.' : 'Speaker list unavailable. Install mpv and refresh speakers.';
  status(Array.isArray(state.devices) ? '' : outputError, !Array.isArray(state.devices));
}

action('devices', async () => {
  devices(await api('/devices'));
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
  const { stopped } = await api('/play', audioInput());
  status(stopped ? 'Athan stopped.' : 'Test playback finished.');
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
