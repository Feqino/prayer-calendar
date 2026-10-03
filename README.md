# 🕌 Prayer Calendar — Alexandria

A subscribable **ICS feed** of the five daily prayers, with a **web settings
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
- **The five prayers** — per prayer: on/off, minutes before and after the adhan, alert, and a *fine-tune* offset that nudges the calculated adhan time
  itself if your local mosque differs by a minute or two.
- **Jumu'ah** — its own full block (see below).
- **Live preview** — the next 7 days recompute as you type, *before* you save, so you can
  see exactly what lands in your calendar.

Bad input is rejected with a clear message (bad coordinates, unknown timezone); out-of-range
numbers are clamped rather than accepted.

### The two timing numbers

Each prayer has **before adhan** and **after adhan** minutes:

```
adhan 13:08 · before 10 · after 30
   -> event runs 12:58 – 13:38   (40 minutes)
```

(`config.json` stores these as `leadMinutes` and the total `durationMinutes`.)

### Jumu'ah settings

| Setting | What it does |
|---|---|
| Enabled | Adds a Jumu'ah event on Fridays |
| Replace Friday's Dhuhr | On = Dhuhr is removed that day. Off = you get both. |
| When is Jumu'ah? | `At the Dhuhr time` · `At a fixed time I set` · `A set number of minutes after Dhuhr` |
| Before / after the prayer | Same two numbers as the other prayers |
| Mosque / location | Optional — appears in the event's Location field |
| Title, emoji, notes, alert | Cosmetic / reminder options |

---

## How it's hosted

The app runs on **Vercel** ([api/index.js](api/index.js) + [vercel.json](vercel.json)):

- `/` — the settings editor
- `/prayers.ics` — the feed, computed on every request, so it never runs out

**Every calendar event links back to the editor.** Open Fajr in your calendar and its
description carries `…/#fajr`, which opens the editor on Fajr's row.

### How saving works

Vercel's filesystem is read-only, so the editor can't write `config.json` to disk there.
Instead a save **commits `config.json` to this repo** through the GitHub API
([src/store.js](src/store.js)). The repo stays the single source of truth, every change is
a commit you can inspect or revert, and the feed reads the new settings straight away.

| Variable (set in Vercel) | Purpose |
|---|---|
| `GITHUB_REPO` | `owner/name` of this repo |
| `GITHUB_TOKEN` | Fine-grained token: this repo only, **Contents: read and write** |
| `ADMIN_PASSWORD` | Required to save. Without it the editor is view-only. |
| `PUBLIC_URL` | Optional. Fixes the address used in event links. |

Without the token the site still serves the feed; the editor just opens view-only and says so.

### GitHub Pages mirror

[.github/workflows/publish.yml](.github/workflows/publish.yml) still runs on every push and
nightly: it checks the timing rules (`verify.js`, which fails the build on a mismatch) and
publishes a static copy of the feed to GitHub Pages. Subscribe to **one** feed, not both —
they contain the same events.

### Running locally

`npm start` serves the same app at <http://localhost:3000>, reading and writing
`config.json` on disk. No password or token needed.

---

## Add the feed to your calendar

**Google Calendar** (must be done on a computer, not the phone app):
Settings → **Add calendar** → **From URL** → paste your `/prayers.ics` link → *Add calendar*.

**iPhone / Apple:** Settings → Calendar → Accounts → Add Account → Other →
*Add Subscribed Calendar* → paste.

**Outlook:** Add calendar → *Subscribe from web* → paste.

Calendars re-check the link every several hours. Because each event carries a stable ID
(date + prayer), edits **update events in place** rather than creating duplicates.
