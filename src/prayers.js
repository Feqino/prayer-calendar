// Prayer-time computation. Offline, via the `adhan` library.
//
// Event model: each prayer has an *adhan instant* (the calculated time), and the
// calendar event is placed around it:
//     start = adhan - leadMinutes
//     end   = start + durationMinutes
// So a 10-minute lead with a 40-minute duration means "10 min before the adhan
// through 30 min after it".

import * as adhan from 'adhan';
import { DateTime } from 'luxon';

export const PRAYER_KEYS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'];

export const METHODS = {
  Egyptian: 'Egyptian General Authority of Survey',
  MuslimWorldLeague: 'Muslim World League',
  UmmAlQura: 'Umm al-Qura, Makkah',
  Karachi: 'University of Islamic Sciences, Karachi',
  NorthAmerica: 'ISNA (North America)',
  Dubai: 'Dubai',
  Qatar: 'Qatar',
  Kuwait: 'Kuwait',
  Singapore: 'Singapore',
  Turkey: 'Diyanet (Turkey)',
  Tehran: 'Institute of Geophysics, Tehran',
  MoonsightingCommittee: 'Moonsighting Committee',
};

const METHOD_FACTORY = {
  MuslimWorldLeague: adhan.CalculationMethod.MuslimWorldLeague,
  Egyptian: adhan.CalculationMethod.Egyptian,
  Karachi: adhan.CalculationMethod.Karachi,
  UmmAlQura: adhan.CalculationMethod.UmmAlQura,
  Dubai: adhan.CalculationMethod.Dubai,
  Qatar: adhan.CalculationMethod.Qatar,
  Kuwait: adhan.CalculationMethod.Kuwait,
  MoonsightingCommittee: adhan.CalculationMethod.MoonsightingCommittee,
  Singapore: adhan.CalculationMethod.Singapore,
  Turkey: adhan.CalculationMethod.Turkey,
  Tehran: adhan.CalculationMethod.Tehran,
  NorthAmerica: adhan.CalculationMethod.NorthAmerica,
  Other: adhan.CalculationMethod.Other,
};

const HIGH_LAT_RULE = {
  MiddleOfTheNight: adhan.HighLatitudeRule.MiddleOfTheNight,
  SeventhOfTheNight: adhan.HighLatitudeRule.SeventhOfTheNight,
  TwilightAngle: adhan.HighLatitudeRule.TwilightAngle,
};

function buildParams(calc) {
  const factory = METHOD_FACTORY[calc.method] || adhan.CalculationMethod.Egyptian;
  const params = factory();
  params.madhab = calc.madhab === 'Hanafi' ? adhan.Madhab.Hanafi : adhan.Madhab.Shafi;
  params.highLatitudeRule = HIGH_LAT_RULE[calc.highLatitudeRule] || adhan.HighLatitudeRule.MiddleOfTheNight;

  const adj = calc.adjustments || {};
  params.adjustments = {
    fajr: adj.fajr || 0,
    sunrise: adj.sunrise || 0,
    dhuhr: adj.dhuhr || 0,
    asr: adj.asr || 0,
    maghrib: adj.maghrib || 0,
    isha: adj.isha || 0,
  };
  return params;
}

// The Jumu'ah adhan instant for a given Friday, per the configured time mode.
function jumuahAdhan(jumuah, localDate, dhuhrUtc, tz) {
  if (jumuah.timeMode === 'offset') {
    return new Date(dhuhrUtc.getTime() + (jumuah.offsetMinutesFromDhuhr || 0) * 60000);
  }
  if (jumuah.timeMode === 'fixed') {
    const [h, m] = String(jumuah.fixedTime || '13:00').split(':').map(Number);
    // Interpret the wall-clock time in the location's timezone, then convert to UTC.
    return DateTime.fromObject(
      { year: localDate.year, month: localDate.month, day: localDate.day, hour: h || 0, minute: m || 0 },
      { zone: tz }
    ).toJSDate();
  }
  return dhuhrUtc; // "dhuhr" mode
}

function makeEvent(key, cfg, adhanTime, feed, tz, extra = {}) {
  const lead = cfg.leadMinutes ?? feed.defaultLeadMinutes ?? 0;
  const duration = cfg.durationMinutes ?? feed.defaultDurationMinutes ?? 30;
  const start = new Date(adhanTime.getTime() - lead * 60000);
  const end = new Date(start.getTime() + duration * 60000);
  return {
    key,
    label: cfg.label,
    emoji: cfg.emoji || '',
    adhan: adhanTime,
    start,
    end,
    leadMinutes: lead,
    durationMinutes: duration,
    reminderMinutes: cfg.reminderMinutes ?? feed.defaultReminderMinutes ?? 0,
    adhanLocal: DateTime.fromJSDate(adhanTime).setZone(tz).toFormat('HH:mm'),
    startLocal: DateTime.fromJSDate(start).setZone(tz).toFormat('HH:mm'),
    endLocal: DateTime.fromJSDate(end).setZone(tz).toFormat('HH:mm'),
    location: extra.location || '',
    notes: extra.notes || '',
  };
}

// Returns an array of days: { dateKey, dateLabel, isFriday, events: [...] }
export function computeSchedule(config, opts = {}) {
  const { location, calculation, feed, prayers, jumuah } = config;
  const tz = location.timezone;
  const dayCount = opts.days ?? feed.daysAhead;
  const coordinates = new adhan.Coordinates(location.latitude, location.longitude);
  const params = buildParams(calculation);

  const days = [];
  const startLocal = DateTime.now().setZone(tz).startOf('day');

  for (let i = 0; i < dayCount; i++) {
    const local = startLocal.plus({ days: i });
    // adhan reads Y/M/D through local getters; building the Date from these
    // numbers keeps the calendar day independent of the server's own timezone.
    const jsDate = new Date(local.year, local.month - 1, local.day);
    const t = new adhan.PrayerTimes(coordinates, jsDate, params);
    const isFriday = local.weekday === 5; // luxon: Mon=1 … Sun=7

    const raw = {
      fajr: t.fajr, sunrise: t.sunrise, dhuhr: t.dhuhr,
      asr: t.asr, maghrib: t.maghrib, isha: t.isha,
    };

    const events = [];
    const jumuahActive = isFriday && jumuah.enabled;

    for (const key of PRAYER_KEYS) {
      const p = prayers[key];
      if (!p || !p.enabled) continue;

      // On Fridays, swap Dhuhr for Jumu'ah when configured to replace it.
      if (key === 'dhuhr' && jumuahActive && jumuah.replaceDhuhr) {
        events.push(makeEvent('jumuah', jumuah, jumuahAdhan(jumuah, local, raw.dhuhr, tz), feed, tz, jumuah));
        continue;
      }
      events.push(makeEvent(key, p, raw[key], feed, tz));
    }

    // Jumu'ah enabled but not replacing Dhuhr -> add it alongside.
    if (jumuahActive && !jumuah.replaceDhuhr) {
      events.push(makeEvent('jumuah', jumuah, jumuahAdhan(jumuah, local, raw.dhuhr, tz), feed, tz, jumuah));
    }

    events.sort((a, b) => a.start - b.start);

    days.push({
      dateKey: local.toFormat('yyyyMMdd'),
      dateLabel: local.toFormat('ccc, d LLL yyyy'),
      isFriday,
      events,
    });
  }

  return days;
}
