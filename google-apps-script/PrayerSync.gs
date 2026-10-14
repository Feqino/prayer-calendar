/**
 * Prayer Calendar -> a Google Calendar you own.
 *
 * A calendar added "From URL" shows the prayers, but Google ignores it when it
 * works out when you're free, so people inviting you or using your booking page
 * still see prayer times as open. This script copies the feed into a calendar
 * you own (your main one by default), which Google does count.
 *
 * It runs inside your own Google account at script.google.com: no server, no card.
 *
 *   setup()      run once: syncs now, then every hour
 *   sync()       what the hourly trigger runs
 *   removeAll()  deletes every event this script created and stops the hourly sync
 *
 * Needs the "Google Calendar API" service added (Services + in the editor).
 */

const CONFIG = {
  FEED_URL: 'https://prayer-calendar-fequino-websites-projects.vercel.app/prayers.ics',
  // 'primary' is your main calendar, the one Google uses for your availability.
  CALENDAR_ID: 'primary',
  // How far ahead to keep prayers in your calendar.
  DAYS_AHEAD: 60,
  // Event colour: '1'-'11' ('2' is Sage). Use '' to keep the calendar's colour.
  COLOR_ID: '2',
};

const MARK = 'prayerCalendar';       // private property on every event this script owns
const UID_KEY = 'prayerCalendarUid';
const HASH_KEY = 'prayerCalendarHash';
const TIME_BUDGET_MS = 4.5 * 60 * 1000; // Apps Script kills a run at 6 minutes

function setup() {
  stopTrigger_();
  ScriptApp.newTrigger('sync').timeBased().everyHours(1).create();
  sync();
}

function sync() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.log('Previous sync is still running; skipping this one.');
    return;
  }
  try {
    const startedAt = Date.now();
    const now = new Date(startedAt);
    const until = new Date(startedAt + CONFIG.DAYS_AHEAD * 864e5);

    const res = UrlFetchApp.fetch(CONFIG.FEED_URL, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      throw new Error('Feed returned HTTP ' + res.getResponseCode() + '; calendar left untouched.');
    }
    // Past events are never touched: only what hasn't ended yet is compared.
    const wanted = parseICS_(res.getContentText()).filter((e) => e.end > now && e.start < until);
    // A broken or empty feed must never be read as "delete every prayer".
    if (wanted.length === 0) throw new Error('Feed had no upcoming events; calendar left untouched.');

    const plan = planSync_(wanted, listOwned_(now, until));
    const n = apply_(plan, startedAt);
    console.log(
      'Created ' + n.created + ', updated ' + n.updated + ', removed ' + n.removed +
      (n.left ? '; ' + n.left + ' still to do, the next hourly run continues.' : '; up to date.')
    );
  } finally {
    lock.releaseLock();
  }
}

function removeAll() {
  stopTrigger_();
  const startedAt = Date.now();
  const owned = listOwned_(null, null);
  const n = apply_({ create: [], update: [], remove: owned.map((e) => e.id) }, startedAt);
  console.log(
    n.left
      ? 'Removed ' + n.removed + ' prayer events; ' + n.left + ' left, run removeAll again.'
      : 'Removed all ' + n.removed + ' prayer events. The hourly sync is off.'
  );
}

// ---- helpers (names ending in _ are hidden from the Run menu) -----------------

function stopTrigger_() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === 'sync') ScriptApp.deleteTrigger(t);
  }
}

// Every event this script created that ends after `from` and starts before `to`
// (either bound may be null for "no limit").
function listOwned_(from, to) {
  const out = [];
  let pageToken = null;
  do {
    const opts = { privateExtendedProperty: MARK + '=1', singleEvents: true, maxResults: 2500 };
    if (from) opts.timeMin = from.toISOString();
    if (to) opts.timeMax = to.toISOString();
    if (pageToken) opts.pageToken = pageToken;
    const page = Calendar.Events.list(CONFIG.CALENDAR_ID, opts);
    for (const item of page.items || []) out.push(item);
    pageToken = page.nextPageToken || null;
  } while (pageToken);
  return out;
}

// Decide what to create, update and remove. Pure: no Google calls.
function planSync_(wanted, owned) {
  const byUid = new Map();
  const remove = [];
  for (const ev of owned) {
    const uid = ev.extendedProperties && ev.extendedProperties.private && ev.extendedProperties.private[UID_KEY];
    // A run cut off mid-way can leave a duplicate; keep one copy.
    if (!uid || byUid.has(uid)) remove.push(ev.id);
    else byUid.set(uid, ev);
  }

  const create = [];
  const update = [];
  for (const w of wanted) {
    const body = toResource_(w);
    const have = byUid.get(w.uid);
    if (!have) {
      create.push(body);
      continue;
    }
    byUid.delete(w.uid);
    // Compare a fingerprint of what we last wrote rather than Google's copy,
    // which Google may reformat; otherwise every event would "change" hourly.
    if (have.extendedProperties.private[HASH_KEY] !== body.extendedProperties.private[HASH_KEY]) {
      update.push({ id: have.id, body: body });
    }
  }
  // Still upcoming but gone from the feed: a prayer turned off, or Dhuhr
  // replaced by Jumu'ah.
  for (const ev of byUid.values()) remove.push(ev.id);

  return { create: create, update: update, remove: remove };
}

function toResource_(e) {
  const body = {
    summary: e.summary || '',
    description: e.description || '',
    location: e.location || '',
    start: { dateTime: e.start.toISOString() },
    end: { dateTime: e.end.toISOString() },
    transparency: e.busy === false ? 'transparent' : 'opaque',
    // Never inherit your calendar's default notifications: hundreds of prayer
    // events would each ping you. Only the alert set in the editor is used.
    reminders: {
      useDefault: false,
      overrides: e.alarmMinutes > 0 ? [{ method: 'popup', minutes: e.alarmMinutes }] : [],
    },
  };
  if (CONFIG.COLOR_ID) body.colorId = CONFIG.COLOR_ID;
  const fingerprint = hash_(JSON.stringify(body));
  body.extendedProperties = { private: {} };
  body.extendedProperties.private[MARK] = '1';
  body.extendedProperties.private[UID_KEY] = e.uid;
  body.extendedProperties.private[HASH_KEY] = fingerprint;
  return body;
}

// Removals first, then nearest events first. Stops cleanly near the time limit
// or on a Google error (e.g. rate limit); the next run picks up the rest.
function apply_(plan, startedAt) {
  const n = { created: 0, updated: 0, removed: 0, left: 0 };
  const tasks = [];
  for (const id of plan.remove) tasks.push(() => { Calendar.Events.remove(CONFIG.CALENDAR_ID, id); n.removed++; });
  for (const u of plan.update) tasks.push(() => { Calendar.Events.update(u.body, CONFIG.CALENDAR_ID, u.id); n.updated++; });
  for (const b of plan.create) tasks.push(() => { Calendar.Events.insert(b, CONFIG.CALENDAR_ID); n.created++; });

  for (let i = 0; i < tasks.length; i++) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      n.left = tasks.length - i;
      break;
    }
    try {
      tasks[i]();
    } catch (err) {
      n.left = tasks.length - i;
      console.warn('Stopped early: ' + err.message);
      break;
    }
    Utilities.sleep(80); // stay under Google's per-second write limit
  }
  return n;
}

function parseICS_(text) {
  const lines = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/); // unfold, then split
  const events = [];
  let cur = null;
  let inAlarm = false;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    if (line === 'BEGIN:VALARM') { inAlarm = true; continue; }
    if (line === 'END:VALARM') { inAlarm = false; continue; }

    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).split(';')[0].toUpperCase();
    const value = line.slice(colon + 1);

    if (inAlarm) {
      const m = name === 'TRIGGER' && /^-PT(\d+)M$/.exec(value);
      if (m) cur.alarmMinutes = Number(m[1]);
      continue;
    }
    if (name === 'UID') cur.uid = value;
    else if (name === 'DTSTART') cur.start = parseUtc_(value);
    else if (name === 'DTEND') cur.end = parseUtc_(value);
    else if (name === 'SUMMARY') cur.summary = unescapeText_(value);
    else if (name === 'DESCRIPTION') cur.description = unescapeText_(value);
    else if (name === 'LOCATION') cur.location = unescapeText_(value);
    else if (name === 'TRANSP') cur.busy = value !== 'TRANSPARENT';
  }

  return events.filter((e) => e.uid && e.start && e.end).sort((a, b) => a.start - b.start);
}

// The feed writes every time as UTC: 20261014T021800Z
function parseUtc_(v) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}

function unescapeText_(s) {
  return s.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

// FNV-1a: a short, stable fingerprint of an event's contents.
function hash_(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
