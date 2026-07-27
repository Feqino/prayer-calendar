'use strict';

const PRAYERS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];
const $ = (id) => document.getElementById(id);

let config = null;
let meta = null;
let previewTimer = null;

// ── boot ─────────────────────────────────────────────────────────────────────
init();

async function init() {
  try {
    [config, meta] = await Promise.all([
      fetch('/api/config').then((r) => r.json()),
      fetch('/api/meta').then((r) => r.json()),
    ]);
  } catch {
    setStatus('Could not reach the server.', 'err');
    return;
  }

  $('feedUrl').value = meta.feedUrl;
  fillMethods(meta.methods);
  fillTimezones();
  buildPrayerRows();
  formFromConfig(config);
  wireEvents();
  refreshPreview();
}

// ── populate selects ─────────────────────────────────────────────────────────
function fillMethods(methods) {
  $('method').innerHTML = Object.entries(methods)
    .map(([k, v]) => `<option value="${k}">${v}</option>`)
    .join('');
}

function fillTimezones() {
  let zones = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = ['Africa/Cairo', 'Europe/London', 'America/New_York', 'Asia/Dubai'];
  }
  $('tzList').innerHTML = zones.map((z) => `<option value="${z}">`).join('');
}

function buildPrayerRows() {
  $('prayerRows').innerHTML = PRAYERS.map((k) => `
    <div class="prow" id="row-${k}">
      <div class="pname"><span id="emoji-${k}"></span><span id="name-${k}"></span></div>
      <label class="mini"><span>Enabled</span><input type="checkbox" id="${k}-enabled"></label>
      <label class="mini"><span>Starts before</span><input type="number" id="${k}-lead" min="0" max="180" step="5"></label>
      <label class="mini"><span>Total length</span><input type="number" id="${k}-duration" min="5" max="480" step="5"></label>
      <label class="mini"><span>Alert</span><input type="number" id="${k}-reminder" min="0" max="240" step="5"></label>
      <label class="mini"><span>Fine-tune</span><input type="number" id="${k}-adjust" min="-60" max="60" step="1"></label>
    </div>`).join('');
}

// ── config <-> form ──────────────────────────────────────────────────────────
function formFromConfig(c) {
  $('calendarName').value = c.calendarName;
  $('city').value = c.location.city;
  $('latitude').value = c.location.latitude;
  $('longitude').value = c.location.longitude;
  $('timezone').value = c.location.timezone;
  $('method').value = c.calculation.method;
  $('madhab').value = c.calculation.madhab;
  $('daysAhead').value = c.feed.daysAhead;

  for (const k of PRAYERS) {
    const p = c.prayers[k];
    $(`emoji-${k}`).textContent = p.emoji || '';
    $(`name-${k}`).textContent = p.label;
    $(`${k}-enabled`).checked = p.enabled;
    $(`${k}-lead`).value = p.leadMinutes;
    $(`${k}-duration`).value = p.durationMinutes;
    $(`${k}-reminder`).value = p.reminderMinutes;
    $(`${k}-adjust`).value = c.calculation.adjustments[k] || 0;
    $(`row-${k}`).classList.toggle('off', !p.enabled);
  }

  const j = c.jumuah;
  $('jEnabled').checked = j.enabled;
  $('jReplace').checked = j.replaceDhuhr;
  $('jLabel').value = j.label;
  $('jEmoji').value = j.emoji;
  $('jLocation').value = j.location;
  $('jTimeMode').value = j.timeMode;
  $('jFixedTime').value = j.fixedTime;
  $('jOffset').value = j.offsetMinutesFromDhuhr;
  $('jLead').value = j.leadMinutes;
  $('jDuration').value = j.durationMinutes;
  $('jReminder').value = j.reminderMinutes;
  $('jNotes').value = j.notes;

  syncChrome();
}

function configFromForm() {
  const adjustments = {};
  const prayers = {};
  for (const k of PRAYERS) {
    adjustments[k] = num(`${k}-adjust`);
    prayers[k] = {
      enabled: $(`${k}-enabled`).checked,
      label: config.prayers[k].label,
      emoji: config.prayers[k].emoji,
      leadMinutes: num(`${k}-lead`),
      durationMinutes: num(`${k}-duration`),
      reminderMinutes: num(`${k}-reminder`),
    };
  }

  return {
    calendarName: $('calendarName').value,
    location: {
      city: $('city').value,
      latitude: parseFloat($('latitude').value),
      longitude: parseFloat($('longitude').value),
      timezone: $('timezone').value.trim(),
    },
    calculation: {
      method: $('method').value,
      madhab: $('madhab').value,
      highLatitudeRule: config.calculation.highLatitudeRule,
      adjustments,
    },
    feed: { ...config.feed, daysAhead: num('daysAhead') },
    prayers,
    jumuah: {
      enabled: $('jEnabled').checked,
      replaceDhuhr: $('jReplace').checked,
      label: $('jLabel').value,
      emoji: $('jEmoji').value,
      location: $('jLocation').value,
      leadMinutes: num('jLead'),
      durationMinutes: num('jDuration'),
      reminderMinutes: num('jReminder'),
      timeMode: $('jTimeMode').value,
      fixedTime: $('jFixedTime').value,
      offsetMinutesFromDhuhr: num('jOffset'),
      notes: $('jNotes').value,
    },
  };
}

const num = (id) => {
  const v = parseInt($(id).value, 10);
  return Number.isFinite(v) ? v : 0;
};

// ── reactive chrome (titles, conditional fields, Jumu'ah sentence) ───────────
function syncChrome() {
  $('calTitle').textContent = $('calendarName').value || 'Prayer Calendar';
  $('locPill').textContent = `${$('city').value} · ${$('method').value}`;

  const mode = $('jTimeMode').value;
  $('jFixedWrap').style.display = mode === 'fixed' ? '' : 'none';
  $('jOffsetWrap').style.display = mode === 'offset' ? '' : 'none';

  for (const k of PRAYERS) $(`row-${k}`).classList.toggle('off', !$(`${k}-enabled`).checked);

  // Plain-English summary of what the Jumu'ah settings produce.
  const lead = num('jLead');
  const dur = num('jDuration');
  const after = dur - lead;
  const when = mode === 'fixed' ? `${$('jFixedTime').value || '—'}`
    : mode === 'offset' ? `${num('jOffset')} min after Dhuhr`
    : 'the Dhuhr time';
  $('jSummary').textContent = $('jEnabled').checked
    ? `Every Friday: “${$('jEmoji').value} ${$('jLabel').value}” runs from ${lead} min before ${when} until ${after} min after it — ${dur} minutes total.`
      + ($('jReplace').checked ? ' Friday’s regular Dhuhr event is removed.' : ' Friday’s Dhuhr stays as well.')
    : 'Jumu’ah is turned off — Fridays use the normal Dhuhr event.';
}

// ── preview ──────────────────────────────────────────────────────────────────
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreview, 350);
}

async function refreshPreview() {
  try {
    const res = await fetch('/api/preview?days=7', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configFromForm()),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Preview failed');

    $('preview').innerHTML = data.days.map((d) => `
      <div class="pday ${d.isFriday ? 'fri' : ''}">
        <div class="pday-h">${d.dateLabel}${d.isFriday ? '<span class="tag">Friday</span>' : ''}</div>
        ${d.events.map((e) => `
          <div class="pev">
            <b>${e.emoji} ${esc(e.label)}</b>
            <span class="adh">adhan ${e.adhan}</span>
            <span class="rng">event ${e.start} – ${e.end} (${e.durationMinutes}m)</span>
          </div>`).join('')}
      </div>`).join('');
  } catch (err) {
    $('preview').innerHTML = `<span class="status err">${esc(err.message)}</span>`;
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── events ───────────────────────────────────────────────────────────────────
function wireEvents() {
  document.addEventListener('input', (e) => {
    if (e.target.closest('main')) { syncChrome(); schedulePreview(); setStatus(''); }
  });
  document.addEventListener('change', (e) => {
    if (e.target.closest('main')) { syncChrome(); schedulePreview(); }
  });

  $('saveBtn').addEventListener('click', save);

  $('copyBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(meta.feedUrl);
    } catch {
      $('feedUrl').select();
      document.execCommand('copy');
    }
    $('copyBtn').textContent = 'Copied ✓';
    setTimeout(() => ($('copyBtn').textContent = 'Copy'), 1600);
  });

  $('locateBtn').addEventListener('click', () => {
    if (!navigator.geolocation) return setStatus('Geolocation is unavailable here.', 'err');
    setStatus('Locating…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        $('latitude').value = pos.coords.latitude.toFixed(4);
        $('longitude').value = pos.coords.longitude.toFixed(4);
        try {
          $('timezone').value = Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch { /* keep existing */ }
        setStatus('Location filled in — remember to save.', 'ok');
        schedulePreview();
      },
      () => setStatus('Could not get your location.', 'err')
    );
  });
}

async function save() {
  const btn = $('saveBtn');
  btn.disabled = true;
  setStatus('Saving…');
  try {
    const headers = { 'Content-Type': 'application/json' };
    const pw = meta.passwordRequired ? getPassword() : null;
    if (pw) headers['x-admin-password'] = pw;

    const res = await fetch('/api/config', {
      method: 'PUT',
      headers,
      body: JSON.stringify(configFromForm()),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) sessionStorage.removeItem('pw');
      throw new Error(data.error || 'Save failed');
    }
    config = data.config;
    formFromConfig(config);
    setStatus('Saved. Your calendar will pick this up on its next refresh.', 'ok');
    refreshPreview();
  } catch (err) {
    setStatus(err.message, 'err');
  } finally {
    btn.disabled = false;
  }
}

function getPassword() {
  let pw = sessionStorage.getItem('pw');
  if (!pw) {
    pw = prompt('Settings password:');
    if (pw) sessionStorage.setItem('pw', pw);
  }
  return pw;
}

function setStatus(msg, kind = '') {
  const el = $('status');
  el.textContent = msg;
  el.className = 'status ' + kind;
}
