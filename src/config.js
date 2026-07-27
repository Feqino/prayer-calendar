import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { IANAZone } from 'luxon';
import { PRAYER_KEYS, METHODS } from './prayers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONFIG_PATH = process.env.CONFIG_PATH || join(__dirname, '..', 'config.json');
const DEFAULTS_PATH = join(__dirname, '..', 'config.json');

export function configPath() {
  return CONFIG_PATH;
}

export function loadConfig() {
  const path = existsSync(CONFIG_PATH) ? CONFIG_PATH : DEFAULTS_PATH;
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function saveConfig(config) {
  const tmp = CONFIG_PATH + '.tmp';
  writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
  renameSync(tmp, CONFIG_PATH); // atomic-ish: never leaves a half-written config
}

// ---- validation -------------------------------------------------------------

const clamp = (n, lo, hi, fallback) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
};

const str = (s, max, fallback = '') => {
  if (typeof s !== 'string') return fallback;
  return s.trim().slice(0, max);
};

const bool = (b, fallback) => (typeof b === 'boolean' ? b : fallback);

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Validate and normalize an incoming config. Throws on anything unusable
 * (bad coordinates/timezone); silently falls back to `current` values for
 * softer fields so a malformed field can't wipe the user's setup.
 */
export function sanitizeConfig(input, current) {
  if (!input || typeof input !== 'object') throw new Error('Config must be an object');

  const loc = input.location || {};
  // Number('') is 0, which would silently relocate the user to the Atlantic —
  // treat blank/missing coordinates as invalid rather than as zero.
  const coord = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
  const lat = coord(loc.latitude);
  const lon = coord(loc.longitude);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error('Latitude must be a number between -90 and 90');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error('Longitude must be a number between -180 and 180');
  const tz = str(loc.timezone, 64, current.location.timezone);
  if (!IANAZone.isValidZone(tz)) throw new Error(`Unknown timezone: ${tz}`);

  const calc = input.calculation || {};
  const method = Object.hasOwn(METHODS, calc.method) ? calc.method : current.calculation.method;
  const madhab = calc.madhab === 'Hanafi' ? 'Hanafi' : 'Shafi';
  const highLat = ['MiddleOfTheNight', 'SeventhOfTheNight', 'TwilightAngle'].includes(calc.highLatitudeRule)
    ? calc.highLatitudeRule
    : 'MiddleOfTheNight';

  const inAdj = calc.adjustments || {};
  const adjustments = {};
  for (const k of PRAYER_KEYS) adjustments[k] = clamp(inAdj[k], -60, 60, 0);

  const inFeed = input.feed || {};
  const feed = {
    daysAhead: clamp(inFeed.daysAhead, 30, 730, current.feed.daysAhead),
    defaultLeadMinutes: clamp(inFeed.defaultLeadMinutes, 0, 180, 10),
    defaultDurationMinutes: clamp(inFeed.defaultDurationMinutes, 5, 480, 40),
    defaultReminderMinutes: clamp(inFeed.defaultReminderMinutes, 0, 240, 0),
  };

  const prayers = {};
  for (const k of PRAYER_KEYS) {
    const p = (input.prayers || {})[k] || {};
    const cur = current.prayers[k] || {};
    prayers[k] = {
      enabled: bool(p.enabled, cur.enabled ?? true),
      label: str(p.label, 60) || cur.label || k,
      emoji: str(p.emoji, 8, cur.emoji || ''),
      leadMinutes: clamp(p.leadMinutes, 0, 180, cur.leadMinutes ?? 10),
      durationMinutes: clamp(p.durationMinutes, 5, 480, cur.durationMinutes ?? 40),
      reminderMinutes: clamp(p.reminderMinutes, 0, 240, cur.reminderMinutes ?? 0),
    };
  }

  const j = input.jumuah || {};
  const curJ = current.jumuah;
  const timeMode = ['fixed', 'offset', 'dhuhr'].includes(j.timeMode) ? j.timeMode : curJ.timeMode;
  const fixedTime = TIME_RE.test(String(j.fixedTime)) ? j.fixedTime : curJ.fixedTime;

  const jumuah = {
    enabled: bool(j.enabled, curJ.enabled),
    replaceDhuhr: bool(j.replaceDhuhr, curJ.replaceDhuhr),
    label: str(j.label, 60) || curJ.label,
    emoji: str(j.emoji, 8, curJ.emoji),
    location: str(j.location, 200, ''),
    leadMinutes: clamp(j.leadMinutes, 0, 180, curJ.leadMinutes),
    durationMinutes: clamp(j.durationMinutes, 5, 480, curJ.durationMinutes),
    reminderMinutes: clamp(j.reminderMinutes, 0, 240, curJ.reminderMinutes),
    timeMode,
    fixedTime,
    offsetMinutesFromDhuhr: clamp(j.offsetMinutesFromDhuhr, -120, 240, curJ.offsetMinutesFromDhuhr),
    notes: str(j.notes, 500, ''),
  };

  return {
    calendarName: str(input.calendarName, 80) || current.calendarName,
    location: {
      city: str(loc.city, 80) || current.location.city,
      latitude: Math.round(lat * 1e6) / 1e6,
      longitude: Math.round(lon * 1e6) / 1e6,
      timezone: tz,
    },
    calculation: { method, madhab, highLatitudeRule: highLat, adjustments },
    feed,
    prayers,
    jumuah,
  };
}
