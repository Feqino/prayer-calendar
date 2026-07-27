# 🕌 Prayer Calendar — Alexandria

A self-hosted, subscribable **ICS feed** of the five daily prayers, with a **web settings
interface** to change everything later. Same model as Fajr Calendar: you add one link to
Google/Apple Calendar and it refreshes itself forever.

- Times computed **offline** with [`adhan`](https://github.com/batoulapps/adhan-js) — no API
  keys, no rate limits. Verified against the Aladhan API.
- Emitted as absolute UTC, so events land on the true prayer instant in any timezone.
- Rolling 180-day window that refills on every fetch — it never runs out.

## Current setup

| | |
|---|---|
| Location | Alexandria (31.2001, 29.9187) · `Africa/Cairo` |
| Method | Egyptian General Authority of Survey |
| Asr | Standard (Shafi'i / Maliki / Hanbali) |
| Fajr | starts 10 min before adhan · **50 min** total (ends +40) |
| Dhuhr, Asr, Maghrib, Isha | start 10 min before adhan · **40 min** total (ends +30) |
| Jumu'ah | starts 30 min before · **90 min** total (ends +60) · replaces Friday's Dhuhr |

---

## Run it

```bash
npm install
npm start
```

Open <http://localhost:3000> for the settings interface. The feed is at `/prayers.ics`.

```bash
npm run test-times   # print times, assert the timing rules, compare vs Aladhan API
npm run ics          # write a one-off prayers.ics file to disk
```

---

## The settings interface

Everything is editable at the root URL — no config file editing needed:

- **Location & calculation** — city, coordinates (or one-tap "use my current location"),
  timezone, calculation method, madhab.
- **The five prayers** — per prayer: on/off, minutes *before* the adhan the event starts,
  total event length, alert, and a *fine-tune* offset that nudges the calculated adhan time
  itself if your local mosque differs by a minute or two.
- **Jumu'ah** — its own full block (see below).
- **Live preview** — the next 7 days recompute as you type, *before* you save, so you can
  see exactly what lands in your calendar.

Bad input is rejected with a clear message (bad coordinates, unknown timezone); out-of-range
numbers are clamped rather than accepted.

### The two timing numbers

Each prayer has **starts before** and **total length**:

```
adhan 13:08 · starts before 10 · total length 40
   -> event runs 12:58 – 13:38   (10 min before, 30 min after)
```

### Jumu'ah settings

| Setting | What it does |
|---|---|
| Enabled | Adds a Jumu'ah event on Fridays |
| Replace Friday's Dhuhr | On = Dhuhr is removed that day. Off = you get both. |
| When is Jumu'ah? | `At the Dhuhr time` · `At a fixed time I set` · `A set number of minutes after Dhuhr` |
| Starts before / Total length | Same two numbers as the other prayers |
| Mosque / location | Optional — appears in the event's Location field |
| Title, emoji, notes, alert | Cosmetic / reminder options |

The card shows a plain-English sentence of what your settings produce, e.g.
*"Every Friday: 🕌 Jumu'ah runs from 30 min before the Dhuhr time until 60 min after it —
90 minutes total. Friday's regular Dhuhr event is removed."*

---

## How it's hosted

The feed is published as a **static file on GitHub Pages**, rebuilt nightly by a GitHub
Action ([.github/workflows/publish.yml](.github/workflows/publish.yml)). No server, no
hosting bill, no cold starts, nothing to keep awake.

```
nightly (02:17 UTC) ─┐
push to main ────────┼─> npm ci -> verify -> build-site.js -> dist/ -> GitHub Pages
manual dispatch ─────┘
```

`src/build-site.js` writes `dist/prayers.ics` (a fresh 180-day window) and `dist/index.html`
(a landing page with the subscribe link and today's times). The workflow runs `verify.js`
first, so a config change that breaks the timing rules fails the build instead of quietly
publishing wrong times.

### Changing settings

The settings UI needs a server to save changes, so it runs on your own machine:

```bash
npm start
```

Edit at <http://localhost:3000>, press **Save changes** (writes `config.json`), then:

```bash
git add config.json && git commit -m "Update prayer settings" && git push
```

The push triggers a rebuild and your calendar picks it up on its next refresh. Your laptop
does **not** need to stay on — the published feed keeps working regardless.

### Self-hosting the server instead (optional)

`npm start` also serves the feed at `/prayers.ics`, so the app can run as a normal web
service on Render/Railway/Fly/a VPS if you ever want the settings UI online. It reads `PORT`
from the environment. If you do that, set `ADMIN_PASSWORD` so strangers can't edit your
settings, and note that hosts with ephemeral disks reset `config.json` on redeploy unless you
point `CONFIG_PATH` at a persistent disk.

---

## Add the feed to your calendar

**Google Calendar** (must be done on a computer, not the phone app):
Settings → **Add calendar** → **From URL** → paste your `/prayers.ics` link → *Add calendar*.

**iPhone / Apple:** Settings → Calendar → Accounts → Add Account → Other →
*Add Subscribed Calendar* → paste.

**Outlook:** Add calendar → *Subscribe from web* → paste.

Calendars re-check the link every several hours. Because each event carries a stable ID
(date + prayer), edits **update events in place** rather than creating duplicates.

## Environment variables

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on (default 3000) |
| `ADMIN_PASSWORD` | If set, saving settings requires this password |
| `CONFIG_PATH` | Where to read/write settings (use for a persistent disk) |
