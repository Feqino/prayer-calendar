// Builds the static site published to GitHub Pages:
//   dist/prayers.ics  — the subscribable feed
//   dist/index.html   — a landing page with the subscribe link and today's times
//
// Run by .github/workflows/publish.yml on a nightly schedule, so the rolling
// window of prayer times refills itself without a server.

import { mkdirSync, writeFileSync } from 'node:fs';
import { DateTime } from 'luxon';
import { computeSchedule } from './prayers.js';
import { buildICS } from './ics.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const days = computeSchedule(config);
const ics = buildICS(days, config);

const outDir = process.env.OUT_DIR || 'dist';
mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/prayers.ics`, ics, 'utf8');
writeFileSync(`${outDir}/.nojekyll`, '', 'utf8'); // stop Pages mangling the output
writeFileSync(`${outDir}/index.html`, landingPage(), 'utf8');

const eventCount = days.reduce((n, d) => n + d.events.length, 0);
console.log(`Built ${outDir}/prayers.ics — ${days.length} days, ${eventCount} events.`);
console.log(`Window: ${days[0].dateLabel} → ${days[days.length - 1].dateLabel}`);

function rows(day) {
  return day.events
    .map(
      (e) => `<tr><td>${e.emoji} ${esc(e.label)}</td><td class="t">${e.adhanLocal}</td>
      <td class="t muted">${e.startLocal} – ${e.endLocal}</td></tr>`
    )
    .join('');
}

function landingPage() {
  const today = days[0];
  const friday = days.find((d) => d.isFriday);
  const built = DateTime.now().setZone(config.location.timezone).toFormat("d LLL yyyy, HH:mm 'local time'");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(config.calendarName)}</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🕌</text></svg>">
<style>
:root{--bg:#f6f4ef;--card:#fff;--ink:#1d211f;--muted:#6d7570;--line:#e4e0d6;--green:#0d6e46;--gold:#b98b2e}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--ink);line-height:1.55}
.wrap{max-width:640px;margin:0 auto;padding:32px 18px 60px}
h1{font-size:1.45rem;margin:0 0 4px}
h2{font-size:1rem;margin:0 0 10px}
.sub{color:var(--muted);margin:0 0 24px;font-size:.94rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin:16px 0}
.card.hero{border-color:#cfe3d7;background:linear-gradient(180deg,#eaf3ee,#fff 60%)}
.row{display:flex;gap:8px;margin:12px 0 4px}
input{flex:1;min-width:0;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.82rem;padding:9px 11px;border:1px solid var(--line);border-radius:9px;background:#f4f2ec;color:var(--muted)}
button{font:inherit;font-weight:550;font-size:.9rem;padding:9px 16px;border-radius:9px;border:1px solid var(--green);background:var(--green);color:#fff;cursor:pointer}
table{width:100%;border-collapse:collapse;font-size:.92rem}
td{padding:6px 0;border-bottom:1px solid #f0ede5}
tr:last-child td{border-bottom:0}
.t{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.muted{color:var(--muted);font-size:.86rem}
.small{font-size:.85rem}
details summary{cursor:pointer;color:var(--green);font-weight:550;font-size:.9rem}
details p{font-size:.9rem;margin:10px 0}
.fri{border-color:#e6d3a6;background:linear-gradient(180deg,#fffdf7,#fff 60%)}
.tag{background:var(--gold);color:#fff;font-size:.68rem;padding:2px 8px;border-radius:999px;text-transform:uppercase;letter-spacing:.05em;vertical-align:middle}
footer{margin-top:26px;text-align:center}
@media(prefers-color-scheme:dark){
:root{--bg:#141715;--card:#1c211e;--ink:#e8eae8;--muted:#98a19c;--line:#2e352f;--green:#2f9268;--gold:#c9a24a}
input{background:#1a1f1c}
.card.hero{background:linear-gradient(180deg,#1a241f,var(--card) 60%);border-color:#2a3a31}
.fri{background:linear-gradient(180deg,#201d15,var(--card) 60%);border-color:#3d3421}
td{border-bottom-color:#262c27}}
</style></head><body><div class="wrap">

<h1>🕌 ${esc(config.calendarName)}</h1>
<p class="sub">${esc(config.location.city)} · ${esc(config.calculation.method)} method · ${config.calculation.madhab === 'Hanafi' ? 'Hanafi' : 'Standard'} Asr</p>

<div class="card hero">
  <h2>Subscribe</h2>
  <p class="muted small">Add this link once. It refreshes on its own — the times never run out.</p>
  <div class="row"><input id="u" readonly><button id="c">Copy</button></div>
  <details style="margin-top:10px"><summary>How do I add it?</summary>
    <p><b>Google Calendar</b> (on a computer): Settings → <i>Add calendar</i> → <i>From URL</i> → paste → <i>Add calendar</i>.</p>
    <p><b>iPhone</b>: Settings → Calendar → Accounts → Add Account → Other → <i>Add Subscribed Calendar</i> → paste.</p>
    <p><b>Outlook</b>: Add calendar → <i>Subscribe from web</i> → paste.</p>
  </details>
</div>

<div class="card">
  <h2>Today — ${esc(today.dateLabel)}</h2>
  <table>${rows(today)}</table>
</div>

${friday ? `<div class="card fri">
  <h2>Next Friday <span class="tag">Jumu'ah</span></h2>
  <p class="muted small">${esc(friday.dateLabel)}</p>
  <table>${rows(friday)}</table>
</div>` : ''}

<footer class="muted small">
  Times shown as <b>adhan</b> then <b>event window</b>.<br>
  Rebuilt nightly · last updated ${esc(built)}
</footer>

</div><script>
var u=location.href.replace(/index\\.html$/,'').replace(/\\/?$/,'/')+'prayers.ics';
document.getElementById('u').value=u;
document.getElementById('c').onclick=function(){
  navigator.clipboard.writeText(u).then(function(){
    var b=document.getElementById('c');b.textContent='Copied ✓';
    setTimeout(function(){b.textContent='Copy'},1600);
  });
};
</script></body></html>`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
