// One-time export: writes prayers.ics to disk (no server needed).
// Usage: npm run ics   (respects config.feed.daysAhead)

import { writeFileSync } from 'node:fs';
import { computeSchedule } from './prayers.js';
import { buildICS } from './ics.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const days = computeSchedule(config);
const ics = buildICS(days, config);
const out = process.env.OUT || 'prayers.ics';
writeFileSync(out, ics, 'utf8');

const eventCount = days.reduce((n, d) => n + d.events.length, 0);
console.log(`Wrote ${out}: ${days.length} days, ${eventCount} events.`);
