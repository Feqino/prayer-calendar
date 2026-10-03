// The Express app, shared by the local server (src/server.js) and the Vercel
// function (api/index.js).
//
//   GET  /prayers.ics   the subscribable feed (add this URL to Google/Apple Calendar)
//   GET  /              settings interface (static, from public/)
//   GET  /api/config    current settings
//   PUT  /api/config    save settings
//   GET  /api/preview   computed times for the next few days
//   GET  /api/meta      feed URL, methods list, whether saving is possible

import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { computeSchedule, METHODS } from './prayers.js';
import { buildICS } from './ics.js';
import { sanitizeConfig } from './config.js';
import { readConfig, writeConfig, storageMode } from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

const app = express();
app.set('trust proxy', true); // so req.protocol is https behind Vercel's proxy
app.use(express.json({ limit: '256kb' }));
app.use(express.static(join(__dirname, '..', 'public')));

// Public address of this site; event edit links are built from it.
function baseUrl(req) {
  const fixed = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '');
  return fixed || `${req.protocol}://${req.get('host')}`;
}

// On a local machine saving is open unless a password is set. Anywhere else a
// save becomes a commit to the repo, so a password is mandatory there.
function saveState() {
  const mode = storageMode();
  if (mode === 'readonly') return { canSave: false, reason: 'Saving is not set up on this deployment yet (GITHUB_REPO and GITHUB_TOKEN are missing).' };
  if (mode === 'github' && !ADMIN_PASSWORD) return { canSave: false, reason: 'Saving is locked until an ADMIN_PASSWORD is set on this deployment.' };
  return { canSave: true, reason: '' };
}

function passwordMatches(given) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function requireAuth(req, res, next) {
  const state = saveState();
  if (!state.canSave) return res.status(403).json({ error: state.reason });
  if (!ADMIN_PASSWORD) return next();
  if (passwordMatches(req.get('x-admin-password') || '')) return next();
  await new Promise((r) => setTimeout(r, 500)); // slow down guessing
  res.status(401).json({ error: 'Incorrect password.' });
}

app.get('/prayers.ics', async (req, res) => {
  try {
    const config = await readConfig();
    const ics = buildICS(computeSchedule(config), config, { baseUrl: baseUrl(req) });
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'inline; filename="prayers.ics"');
    res.set('Cache-Control', 'public, max-age=900');
    res.send(ics);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error generating calendar: ' + err.message);
  }
});

app.get('/api/meta', (req, res) => {
  const base = baseUrl(req);
  const state = saveState();
  res.json({
    feedUrl: `${base}/prayers.ics`,
    webcalUrl: `${base}/prayers.ics`.replace(/^https?:/, 'webcal:'),
    methods: METHODS,
    passwordRequired: Boolean(ADMIN_PASSWORD),
    canSave: state.canSave,
    saveBlockedReason: state.reason,
    storage: storageMode(),
  });
});

app.get('/api/config', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await readConfig({ fresh: true }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/config', requireAuth, async (req, res) => {
  let clean;
  try {
    const current = await readConfig({ fresh: true });
    clean = sanitizeConfig(req.body, current);
    // Compute once before persisting — a config that can't produce a schedule
    // is never saved.
    computeSchedule(clean, { days: 8 });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  try {
    await writeConfig(clean);
    res.json({ ok: true, config: clean });
  } catch (err) {
    console.error(err);
    res.status(502).json({ error: err.message });
  }
});

// Preview against unsaved settings when a config is posted, else the saved one.
async function previewHandler(req, res) {
  try {
    const saved = await readConfig();
    const config = req.method === 'POST' && req.body && Object.keys(req.body).length
      ? sanitizeConfig(req.body, saved)
      : saved;
    const days = Math.min(Number(req.query.days) || 7, 30);
    const schedule = computeSchedule(config, { days });
    res.set('Cache-Control', 'no-store');
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

export default app;
