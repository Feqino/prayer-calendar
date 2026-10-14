// Runs PrayerSync.gs against an in-memory fake of Google Calendar and the other
// Apps Script services, fed by a feed built from this repo's config.json.
// Usage: npm run test-sync

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { computeSchedule } from '../src/prayers.js';
import { buildICS } from '../src/ics.js';
import { loadConfig } from '../src/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'PrayerSync.gs'), 'utf8');

const config = loadConfig();
const baseIcs = buildICS(computeSchedule(config), config, { baseUrl: 'https://example.test' });

// ---- fakes ---------------------------------------------------------------------
function makeWorld({ failInsertAfter = Infinity } = {}) {
  const store = new Map();
  let nextId = 1;
  let inserts = 0;
  const calls = { insert: 0, update: 0, remove: 0, list: 0 };
  const copy = (o) => JSON.parse(JSON.stringify(o));

  const Calendar = {
    Events: {
      list(calId, opts) {
        calls.list++;
        const [k, v] = opts.privateExtendedProperty.split('=');
        const items = [...store.values()].filter((e) => {
          if (e.extendedProperties?.private?.[k] !== v) return false;
          if (opts.timeMin && !(new Date(e.end.dateTime) > new Date(opts.timeMin))) return false;
          if (opts.timeMax && !(new Date(e.start.dateTime) < new Date(opts.timeMax))) return false;
          return true;
        });
        return { items: items.map(copy) };
      },
      insert(body) {
        if (++inserts > failInsertAfter) throw new Error('Rate Limit Exceeded');
        calls.insert++;
        const ev = { ...copy(body), id: 'e' + nextId++ };
        store.set(ev.id, ev);
        return copy(ev);
      },
      update(body, calId, id) {
        calls.update++;
        if (!store.has(id)) throw new Error('Not Found');
        store.set(id, { ...copy(body), id });
      },
      remove(calId, id) {
        calls.remove++;
        if (!store.delete(id)) throw new Error('Not Found');
      },
    },
  };

  const world = { store, calls, feed: baseIcs, feedStatus: 200, triggers: [], logs: [] };
  world.context = vm.createContext({
    Calendar,
    UrlFetchApp: {
      fetch: () => ({ getResponseCode: () => world.feedStatus, getContentText: () => world.feed }),
    },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    ScriptApp: {
      getProjectTriggers: () => world.triggers,
      deleteTrigger: (t) => { world.triggers = world.triggers.filter((x) => x !== t); },
      newTrigger: (fn) => ({
        timeBased: () => ({ everyHours: (h) => ({ create: () => world.triggers.push({ getHandlerFunction: () => fn, h }) }) }),
      }),
    },
    Utilities: { sleep() {} },
    console: { log: (m) => world.logs.push(m), warn: (m) => world.logs.push('WARN ' + m) },
  });
  vm.runInContext(source, world.context);
  world.run = (fn) => vm.runInContext(fn + '()', world.context);
  world.resetCalls = () => Object.keys(calls).forEach((k) => (calls[k] = 0));
  return world;
}

// ---- checks --------------------------------------------------------------------
let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? '  ok  ' : '  FAIL'} ${msg}`);
  if (!cond) failures++;
};
const lastLog = (w) => w.logs[w.logs.length - 1];

const daysAhead = vm.runInContext('CONFIG.DAYS_AHEAD', makeWorld().context);
const now = Date.now();
const upcoming = vm.runInContext('parseICS_', makeWorld().context)(baseIcs)
  .filter((e) => e.end > now && e.start < now + daysAhead * 864e5);

console.log('\n1. First run (setup)');
const w = makeWorld();
w.run('setup');
check(w.store.size === upcoming.length, `created ${w.store.size} events (expected ${upcoming.length}, ${daysAhead} days)`);
check(w.triggers.length === 1 && w.triggers[0].h === 1, 'hourly trigger installed');
const evs = [...w.store.values()];
check(evs.every((e) => e.reminders.useDefault === false), 'no default notifications on any event');
check(evs.every((e) => e.colorId === '2'), 'colour applied');
const fajr = evs.find((e) => e.extendedProperties.private.prayerCalendarUid.includes('-fajr@'));
const fajrFeed = upcoming.find((e) => e.uid === fajr.extendedProperties.private.prayerCalendarUid);
check(fajr.start.dateTime === fajrFeed.start.toISOString() && fajr.end.dateTime === fajrFeed.end.toISOString(), `times copied exactly (${fajr.summary} ${fajr.start.dateTime})`);
check(fajr.description.includes('https://example.test/#fajr') && fajr.description.includes('\n'), 'description keeps line breaks and the edit link');
const busyInFeed = upcoming.filter((e) => e.busy !== false).length;
check(evs.filter((e) => e.transparency === 'opaque').length === busyInFeed, `Busy/Free follows the feed (${busyInFeed} busy)`);

console.log('\n2. Second run with nothing changed');
w.resetCalls();
w.run('setup'); // re-running setup must not double the trigger or the events
check(w.calls.insert + w.calls.update + w.calls.remove === 0, 'no writes at all');
check(w.triggers.length === 1, 'still exactly one trigger');

console.log('\n3. Settings changed in the editor');
const lines = baseIcs.split('\r\n');
const firstAsrUid = upcoming.find((e) => e.uid.includes('-asr@')).uid;
const firstIshaUid = upcoming.find((e) => e.uid.includes('-isha@')).uid;
// Asr made Free, first Isha removed (prayer disabled for that day)
let mutated = [];
for (let i = 0, uid = null, skip = false; i < lines.length; i++) {
  const l = lines[i];
  if (l === 'BEGIN:VEVENT') { uid = lines[i + 1].slice(4); skip = uid === firstIshaUid; }
  if (!skip) mutated.push(uid === firstAsrUid && l === 'TRANSP:OPAQUE' ? 'TRANSP:TRANSPARENT' : l);
  if (l === 'END:VEVENT') skip = false;
}
w.feed = mutated.join('\r\n');
w.resetCalls();
w.run('sync');
check(w.calls.update === 1 && w.calls.remove === 1 && w.calls.insert === 0, `1 updated, 1 removed (got ${JSON.stringify(w.calls)})`);
const asr = [...w.store.values()].find((e) => e.extendedProperties.private.prayerCalendarUid === firstAsrUid);
check(asr.transparency === 'transparent', 'Asr now Free');

console.log('\n4. Broken feed');
for (const [status, body, label] of [[500, baseIcs, 'HTTP 500'], [200, '<html>error</html>', 'HTML instead of a calendar']]) {
  const before = w.store.size;
  w.feedStatus = status; w.feed = body; w.resetCalls();
  let threw = false;
  try { w.run('sync'); } catch { threw = true; }
  check(threw && w.store.size === before && w.calls.remove === 0, `${label}: nothing deleted`);
}
w.feedStatus = 200; w.feed = baseIcs;

console.log('\n5. Interrupted first run (rate limit) resumes next hour');
const w2 = makeWorld({ failInsertAfter: 100 });
w2.run('sync');
check(w2.store.size === 100 && /still to do/.test(lastLog(w2)), `stopped after 100: "${lastLog(w2)}"`);
// rate limit lifted: inserts succeed again against the same store
w2.context.Calendar.Events.insert = (body) => { const id = 'r' + Math.random(); w2.store.set(id, { ...JSON.parse(JSON.stringify(body)), id }); };
w2.run('sync');
check(w2.store.size === upcoming.length, `next run finished the rest (${w2.store.size})`);

console.log('\n6. Duplicate left behind by an interrupted run');
const dup = [...w2.store.values()][0];
w2.store.set('dup', { ...JSON.parse(JSON.stringify(dup)), id: 'dup' });
w2.resetCalls?.();
w2.run('sync');
check(w2.store.size === upcoming.length, 'duplicate removed');

console.log('\n7. removeAll');
w.run('removeAll');
check(w.store.size === 0 && w.triggers.length === 0, `everything removed, trigger off: "${lastLog(w)}"`);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll sync checks passed');
if (failures) process.exitCode = 1;
