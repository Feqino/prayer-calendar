// Build a VCALENDAR (ICS) string from a computed schedule.
// Times are emitted as absolute UTC (…Z) so each event fires at the true prayer
// instant and every calendar app renders it in the viewer's local timezone.

const CRLF = '\r\n';

function fmtUtc(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Fold lines longer than 75 octets per RFC 5545.
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const chunks = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Don't split a multi-byte UTF-8 character across the fold.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    chunks.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74; // continuation lines carry a leading space
  }
  return chunks.join(CRLF + ' ');
}

export function buildICS(days, config) {
  const now = fmtUtc(new Date());
  const domain = 'prayer-calendar';
  const calName = config.calendarName || 'Prayer Times';

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Prayer Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escapeText(calName),
    'X-WR-TIMEZONE:' + escapeText(config.location.timezone),
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
  ];

  for (const day of days) {
    for (const ev of day.events) {
      const summary = ev.emoji ? `${ev.emoji} ${ev.label}` : ev.label;
      const desc = [
        `Adhan at ${ev.adhanLocal}`,
        ev.leadMinutes ? `Event starts ${ev.leadMinutes} min before the adhan.` : null,
        ev.notes || null,
      ].filter(Boolean).join('\n');

      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + `${day.dateKey}-${ev.key}@${domain}`);
      lines.push('DTSTAMP:' + now);
      lines.push('DTSTART:' + fmtUtc(ev.start));
      lines.push('DTEND:' + fmtUtc(ev.end));
      lines.push('SUMMARY:' + escapeText(summary));
      lines.push('DESCRIPTION:' + escapeText(desc));
      if (ev.location) lines.push('LOCATION:' + escapeText(ev.location));
      lines.push('TRANSP:TRANSPARENT');

      if (ev.reminderMinutes > 0) {
        lines.push('BEGIN:VALARM');
        lines.push('ACTION:DISPLAY');
        lines.push('DESCRIPTION:' + escapeText(summary));
        lines.push(`TRIGGER:-PT${ev.reminderMinutes}M`);
        lines.push('END:VALARM');
      }
      lines.push('END:VEVENT');
    }
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join(CRLF) + CRLF;
}
