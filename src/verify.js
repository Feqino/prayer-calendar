// Correctness check: prints computed adhan times and event windows, and
// compares today's adhan times against the Aladhan API for the same location
// and method. Run with: npm run test-times

import { DateTime } from 'luxon';
import { computeSchedule } from './prayers.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const tz = config.location.timezone;
const days = computeSchedule(config, { days: 8 });

console.log(`\n== ${config.location.city} · ${config.calculation.method} · ${config.calculation.madhab} (Asr) ==`);
console.log(`   Format:  Prayer   adhan   ->  event window  (total length)\n`);

for (const day of days) {
  console.log(`${day.dateLabel}${day.isFriday ? '   [FRIDAY]' : ''}`);
  for (const ev of day.events) {
    const lead = `-${ev.leadMinutes}m`.padStart(5);
    console.log(
      `   ${ev.label.padEnd(10)} ${ev.adhanLocal}  ${lead} ->  ${ev.startLocal}–${ev.endLocal}  (${ev.durationMinutes}m)`
    );
  }
  console.log('');
}

// --- every event must match the lead/length its settings ask for --------------
let failures = 0;
const check = (cond, msg) => {
  if (!cond) { console.log(`   FAIL: ${msg}`); failures++; }
};

for (const day of days) {
  for (const ev of day.events) {
    const leadActual = Math.round((ev.adhan - ev.start) / 60000);
    check(leadActual === ev.leadMinutes, `${day.dateKey} ${ev.label}: lead ${leadActual} != ${ev.leadMinutes}`);
    check(
      Math.round((ev.end - ev.start) / 60000) === ev.durationMinutes,
      `${day.dateKey} ${ev.label}: total length wrong`
    );
  }
}

// Sleep: from Isha + after to the NEXT day's Fajr − before. Checked with sleep
// switched on even when the saved settings have it off, across a DST change.
const withSleep = { ...config, sleep: { afterIshaMinutes: 120, beforeFajrMinutes: 30, ...config.sleep, enabled: true } };
const sleepDays = computeSchedule(withSleep, { days: 60 });
for (let i = 0; i < sleepDays.length - 1; i++) {
  const day = sleepDays[i].dateKey;
  const s = sleepDays[i].events.find((e) => e.key === 'sleep');
  const isha = sleepDays[i].events.find((e) => e.key === 'isha');
  const fajrNext = sleepDays[i + 1].events.find((e) => e.key === 'fajr');
  check(Boolean(s), `${day}: no sleep event`);
  if (!s) continue;
  if (isha) check(s.adhan.getTime() === isha.adhan.getTime(), `${day} sleep: not anchored to that night's Isha`);
  if (fajrNext) check(s.nextFajr.getTime() === fajrNext.adhan.getTime(), `${day} sleep: not anchored to the next morning's Fajr`);
  check(s.start - s.adhan === s.afterIshaMinutes * 60000, `${day} sleep: start is not Isha + ${s.afterIshaMinutes}m`);
  check(s.nextFajr - s.end === s.beforeFajrMinutes * 60000, `${day} sleep: end is not Fajr − ${s.beforeFajrMinutes}m`);
}

console.log(failures === 0 ? '== Timing rules: all checks passed ==' : `== ${failures} check(s) FAILED ==`);
if (failures) process.exitCode = 1; // fail CI rather than publish wrong times

// --- compare adhan times against the Aladhan API ------------------------------
const ALADHAN_METHOD = { Egyptian: 5, MuslimWorldLeague: 3, Karachi: 1, UmmAlQura: 4, NorthAmerica: 2, Tehran: 7, Dubai: 16, Qatar: 10, Kuwait: 9, Singapore: 11, Turkey: 13 };

try {
  const today = DateTime.now().setZone(tz);
  const m = ALADHAN_METHOD[config.calculation.method] ?? 5;
  const school = config.calculation.madhab === 'Hanafi' ? 1 : 0;
  const url = `https://api.aladhan.com/v1/timings/${today.toFormat('dd-MM-yyyy')}?latitude=${config.location.latitude}&longitude=${config.location.longitude}&method=${m}&school=${school}`;
  const t = (await (await fetch(url)).json()).data.timings;

  const ours = days[0].events;
  const get = (k) => {
    const e = ours.find((x) => x.key === k || (k === 'dhuhr' && x.key === 'jumuah'));
    return e ? e.adhanLocal : '—';
  };
  console.log('\n== Today\'s adhan times vs Aladhan API ==');
  console.log('             ours   aladhan');
  for (const [k, a] of [['fajr', t.Fajr], ['dhuhr', t.Dhuhr], ['asr', t.Asr], ['maghrib', t.Maghrib], ['isha', t.Isha]]) {
    console.log(`   ${k.padEnd(9)} ${get(k).padEnd(6)} ${a}`);
  }
} catch (e) {
  console.log('\n(Skipped Aladhan comparison — offline?)', e.message);
}
