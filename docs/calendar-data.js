export const DISPLAY_ZONE = 'America/Chicago';

export function unescapeText(value) {
  return value.replace(/\\([nN,;\\])/g, (_, char) => /n/i.test(char) ? '\n' : char);
}

function splitOutside(value, delimiter, quoted = false) {
  const parts = []; let part = '', escaped = false, inQuotes = false;
  for (const char of value) {
    if (escaped) { part += char; escaped = false; continue; }
    if (char === '\\') { part += char; escaped = true; continue; }
    if (quoted && char === '"') inQuotes = !inQuotes;
    if (char === delimiter && !inQuotes) { parts.push(part); part = ''; }
    else part += char;
  }
  parts.push(part); return parts;
}

const zoneFormatters = new Map();
function wallParts(time, zone) {
  if (!zoneFormatters.has(zone)) zoneFormatters.set(zone, new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }));
  const parts = Object.fromEntries(zoneFormatters.get(zone).formatToParts(time).map(p => [p.type, p.value]));
  return ['year', 'month', 'day', 'hour', 'minute', 'second'].map(key => Number(parts[key]));
}
const wallEpoch = parts => Date.UTC(parts[0], parts[1] - 1, ...parts.slice(2));

function zonedDate(parts, zone) {
  const target = wallEpoch(parts);
  const offsets = new Set([-36, 0, 36].map(hours => {
    const sample = target + hours * 3600000;
    return wallEpoch(wallParts(sample, zone)) - sample;
  }));
  const candidates = [...offsets].map(offset => target - offset).sort((a, b) => a - b);
  const exact = candidates.find(candidate => wallEpoch(wallParts(candidate, zone)) === target);
  if (exact !== undefined) return new Date(exact); // First occurrence in a DST fold (RFC 5545).
  // A nonexistent local time uses the offset before the DST gap (RFC 5545).
  const afterGap = candidates.find(candidate => {
    const delta = wallEpoch(wallParts(candidate, zone)) - target;
    return delta > 0 && delta <= 3 * 3600000;
  });
  if (afterGap !== undefined) return new Date(afterGap);
  throw new Error('Unresolvable calendar time');
}

export function parseDate(value, parameters = {}, defaultZone = DISPLAY_ZONE) {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
  if (!match) throw new Error('Invalid calendar date');
  const parts = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0)];
  const utc = new Date(wallEpoch(parts));
  if (parts.some((part, i) => part !== [utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate(), utc.getUTCHours(), utc.getUTCMinutes(), utc.getUTCSeconds()][i])) throw new Error('Invalid calendar date fields');
  const allDay = !match[4];
  if (parameters.VALUE === 'DATE' && !allDay) throw new Error('Invalid all-day calendar date');
  return { date: match[7] ? utc : zonedDate(parts, parameters.TZID || defaultZone), allDay, dateKey: value.slice(0, 8) };
}

export function parseCalendar(content) {
  const lines = content.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  if (lines[0] !== 'BEGIN:VCALENDAR' || !content.trimEnd().endsWith('END:VCALENDAR')) throw new Error('Invalid calendar response');
  const events = []; const seen = new Set(); let properties = null, nested = 0;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      if (properties) throw new Error('Nested calendar event');
      properties = {}; nested = 0; continue;
    }
    if (!properties) continue;
    if (line === 'END:VEVENT') {
      const get = name => properties[name]?.[0];
      if (!get('UID') || !get('SUMMARY') || !get('DTSTART')) throw new Error('Incomplete calendar event');
      const uid = unescapeText(get('UID').value);
      if (seen.has(uid)) throw new Error('Duplicate calendar event');
      seen.add(uid);
      const start = parseDate(get('DTSTART').value, get('DTSTART').parameters);
      let end = get('DTEND') ? parseDate(get('DTEND').value, get('DTEND').parameters).date : start.date;
      if (start.allDay && !get('DTEND')) {
        const next = new Date(Date.UTC(Number(start.dateKey.slice(0, 4)), Number(start.dateKey.slice(4, 6)) - 1, Number(start.dateKey.slice(6, 8)) + 1));
        end = parseDate(next.toISOString().slice(0, 10).replaceAll('-', ''), { VALUE: 'DATE', TZID: get('DTSTART').parameters.TZID }).date;
      }
      if (end < start.date) throw new Error('Calendar end precedes start');
      const categories = (properties.CATEGORIES || []).flatMap(p => splitOutside(p.value, ',').map(unescapeText));
      events.push({ uid, start: start.date, end, allDay: start.allDay,
        summary: unescapeText(get('SUMMARY').value), location: unescapeText(get('LOCATION')?.value || ''),
        description: unescapeText(get('DESCRIPTION')?.value || ''), url: get('URL')?.value || '',
        sport: categories[0] || '', gender: categories[1] || '', school: categories[2] || '',
        status: get('STATUS')?.value || '', categories,
      });
      properties = null; continue;
    }
    if (line.startsWith('BEGIN:')) { nested++; continue; }
    if (line.startsWith('END:')) { nested--; continue; }
    if (nested) continue;
    const segments = splitOutside(line, ':', true);
    if (segments.length < 2) throw new Error('Invalid calendar property');
    const [key, ...params] = splitOutside(segments.shift(), ';', true);
    const parameters = Object.fromEntries(params.map(param => {
      const index = param.indexOf('=');
      if (index < 1) throw new Error('Invalid calendar parameter');
      return [param.slice(0, index).toUpperCase(), param.slice(index + 1).replace(/^"|"$/g, '')];
    }));
    const name = key.toUpperCase();
    (properties[name] ||= []).push({ parameters, value: segments.join(':') });
  }
  if (properties) throw new Error('Unclosed calendar event');
  return events.sort((a, b) => a.start - b.start || a.summary.localeCompare(b.summary));
}

export function filterEvents(events, { school = '', sport = '' } = {}, now = new Date()) {
  return events.filter(event => event.status !== 'CANCELLED' && (event.start >= now || event.end > now) &&
    (!school || event.school === school) && (!sport || event.sport === sport));
}

export function dateKey(date) {
  return wallParts(date, DISPLAY_ZONE).slice(0, 3).map((value, index) => index ? String(value).padStart(2, '0') : value).join('-');
}
