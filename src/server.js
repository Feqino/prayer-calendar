// Prayer Calendar server.
//
//   GET  /prayers.ics   the subscribable feed (add this URL to Google/Apple Calendar)
//   GET  /              settings interface
//   GET  /api/config    current settings
//   PUT  /api/config    save settings
//   GET  /api/preview   computed times for the next few days
//   GET  /api/meta      feed URL, methods list, whether a password is required

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeSchedule, METHODS } from './prayers.js';
import { buildICS } from './ics.js';
import { loadConfig, saveConfig, sanitizeConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

app.use(express.json({ limit: '256kb' }));
app.use(express.static(join(__dirname, '..', 'public')));

// Editing settings is gated only when ADMIN_PASSWORD is set (recommended once
// the app is deployed on a public URL). Reading the feed is always open.
function requireAuth(req, res, next) {
  if (!ADMIN_PASSWORD) return next();
  const given = req.get('x-admin-password') || '';
  if (given === ADMIN_PASSWORD) return next();
  res.status(401).json({ error: 'Incorrect password.' });
}

app.get('/prayers.ics', (req, res) => {
  try {
    const config = loadConfig();
    const ics = buildICS(computeSchedule(config), config);
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'inline; filename="prayers.ics"');
    res.set('Cache-Control', 'public, max-age=1800');
    res.send(ics);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error generating calendar: ' + err.message);
  }
});

app.get('/api/meta', (req, res) => {
  const base = `${req.protocol}://${req.get('host')}`;
  res.json({
    feedUrl: `${base}/prayers.ics`,
    webcalUrl: `${base}/prayers.ics`.replace(/^https?:/, 'webcal:'),
    methods: METHODS,
    passwordRequired: Boolean(ADMIN_PASSWORD),
  });
});

app.get('/api/config', (req, res) => {
  res.json(loadConfig());
});

app.put('/api/config', requireAuth, (req, res) => {
  try {
    const current = loadConfig();
    const clean = sanitizeConfig(req.body, current);
    // Compute once before persisting — a config that can't produce a schedule
    // never reaches disk.
    computeSchedule(clean, { days: 8 });
    saveConfig(clean);
    res.json({ ok: true, config: clean });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Preview against unsaved settings when a config is posted, else the saved one.
function previewHandler(req, res) {
  try {
    const saved = loadConfig();
    const config = req.method === 'POST' && req.body && Object.keys(req.body).length
      ? sanitizeConfig(req.body, saved)
      : saved;
    const days = Math.min(Number(req.query.days) || 7, 30);
    const schedule = computeSchedule(config, { days });
    res.json({
      timezone: config.location.timezone,
      city: config.location.city,
      days: schedule.map((d) => ({
        dateLabel: d.dateLabel,
        isFriday: d.isFriday,
        events: d.events.map((e) => ({
          key: e.key,
          label: e.label,
          emoji: e.emoji,
          adhan: e.adhanLocal,
          start: e.startLocal,
          end: e.endLocal,
          durationMinutes: e.durationMinutes,
        })),
      })),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
app.get('/api/preview', previewHandler);
app.post('/api/preview', previewHandler);

app.listen(PORT, () => {
  console.log(`\n  Prayer Calendar`);
  console.log(`  Settings : http://localhost:${PORT}`);
  console.log(`  Feed     : http://localhost:${PORT}/prayers.ics`);
  if (!ADMIN_PASSWORD) console.log(`  (Set ADMIN_PASSWORD to lock settings once deployed publicly.)`);
  console.log('');
});
