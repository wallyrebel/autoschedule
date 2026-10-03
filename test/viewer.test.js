import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCalendar, parseDate, filterEvents, dateKey, unescapeText } from '../docs/calendar-data.js';

const now = new Date('2026-10-03T03:00:00Z');
const liveEvents = parseCalendar(readFileSync(new URL('../docs/schedules.ics', import.meta.url), 'utf8'));
const summary = JSON.parse(readFileSync(new URL('../docs/summary.json', import.meta.url), 'utf8'));
function fixture(properties) { return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:test\r\nSUMMARY:Test game\r\n${properties}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`; }

test('real feed parses every published event with categories and stable IDs', () => {
  assert.equal(liveEvents.length, summary.totalGames);
  assert.equal(new Set(liveEvents.map(event => event.uid)).size, summary.totalGames);
  for (const event of liveEvents) {
    assert.ok(event.school && event.sport && event.gender && event.start <= event.end);
    assert.ok(Number.isFinite(event.start.getTime()));
    assert.ok(!event.summary.includes('\r') && !event.summary.includes('\n'));
  }
  if (liveEvents.length) assert.equal(liveEvents[0].start.toISOString(), parseDate(summary.firstGame.replace(/[-:]/g, '')).date.toISOString());
});
test('filters match published per-school and per-sport counts; reset restores all', () => {
  for (const [school, count] of Object.entries(summary.gamesByTeam)) assert.equal(filterEvents(liveEvents, { school }, now).length, count);
  for (const [key, count] of Object.entries(summary.gamesBySport)) {
    const matching = liveEvents.filter(event => `${event.gender} ${event.sport}` === key);
    assert.equal(matching.length, count);
  }
  if (liveEvents.length) {
    const { school, sport } = liveEvents[0];
    const combined = filterEvents(liveEvents, { school, sport }, now);
    assert.ok(combined.length > 0 && combined.every(event => event.school === school && event.sport === sport));
  }
  assert.equal(filterEvents(liveEvents, { school: '__missing_school__' }, now).length, 0);
  assert.equal(filterEvents(liveEvents, { school: '', sport: '' }, now).length, summary.totalGames);
});
test('folding, text escapes, escaped category delimiters, URLs and quoted TZID parse correctly', () => {
  const content = fixture('DTSTART;TZID="America/Chicago":20261003T120000\r\nSUMMARY:Ripley vs Pine\r\n Grove\\, Panthers\\; varsity\\nSecond line\r\nLOCATION:Gym\\, Ripley\r\nCATEGORIES:Track\\, Field,Girls,School\\; Name\r\nURL:https://www.maxpreps.com/game/?a=one:b=two');
  const [event] = parseCalendar(content);
  // The first SUMMARY is retained, in accordance with this viewer's property convention.
  assert.equal(event.summary, 'Test game');
  assert.equal(event.location, 'Gym, Ripley');
  assert.deepEqual(event.categories, ['Track, Field', 'Girls', 'School; Name']);
  assert.equal(event.url, 'https://www.maxpreps.com/game/?a=one:b=two');
  assert.equal(unescapeText('First\\nSecond\\, x\\; y\\\\z'), 'First\nSecond, x; y\\z');
  const folded = content.replace('SUMMARY:Test game\r\n', '');
  assert.equal(parseCalendar(folded)[0].summary, 'Ripley vs PineGrove, Panthers; varsity\nSecond line');
});
test('UTC and floating times resolve correctly independent of host timezone', () => {
  assert.equal(parseDate('20261003T170000Z').date.toISOString(), '2026-10-03T17:00:00.000Z');
  assert.equal(parseDate('20261003T120000').date.toISOString(), '2026-10-03T17:00:00.000Z');
  assert.equal(parseDate('20261003T120000', { TZID: 'America/Los_Angeles' }).date.toISOString(), '2026-10-03T19:00:00.000Z');
});
test('midnight stays on the correct Central day and does not become all-day', () => {
  const parsed = parseDate('20261218T000000', { TZID: 'America/Chicago' });
  assert.equal(parsed.date.toISOString(), '2026-12-18T06:00:00.000Z');
  assert.equal(dateKey(parsed.date), '2026-12-18'); assert.equal(parsed.allDay, false);
});
test('DST winter/summer, fold and gap follow timezone and RFC 5545 rules', () => {
  assert.equal(parseDate('20270105T190000').date.toISOString(), '2027-01-06T01:00:00.000Z');
  assert.equal(parseDate('20270417T190000').date.toISOString(), '2027-04-18T00:00:00.000Z');
  assert.equal(parseDate('20261101T013000').date.toISOString(), '2026-11-01T06:30:00.000Z');
  assert.equal(parseDate('20270314T023000').date.toISOString(), '2027-03-14T08:30:00.000Z');
});
test('all-day event without DTEND lasts its local calendar day across DST', () => {
  const [event] = parseCalendar(fixture('DTSTART;VALUE=DATE:20270314'));
  assert.equal(event.allDay, true); assert.equal(event.start.toISOString(), '2027-03-14T06:00:00.000Z');
  assert.equal(event.end.toISOString(), '2027-03-15T05:00:00.000Z');
  assert.equal(filterEvents([event], {}, new Date('2027-03-15T04:59:00Z')).length, 1);
  assert.equal(filterEvents([event], {}, new Date('2027-03-15T05:00:00Z')).length, 0);
});
test('empty calendar is legitimate and malformed data fails instead of partial display', () => {
  assert.deepEqual(parseCalendar('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'), []);
  assert.throws(() => parseCalendar('<html>Error</html>'));
  assert.throws(() => parseCalendar(fixture('DTSTART:20260230T120000')));
  assert.throws(() => parseCalendar(fixture('DTSTART:20261003T250000')));
  assert.throws(() => parseCalendar(fixture('DTSTART:20261003T120000\r\nDTEND:20261003T110000')));
  const single = fixture('DTSTART:20261003T120000');
  assert.throws(() => parseCalendar(single.replace('END:VCALENDAR', single.match(/BEGIN:VEVENT[\s\S]*END:VEVENT/)[0] + '\r\nEND:VCALENDAR')), /Duplicate/);
});
test('completed and cancelled events are excluded, underway games remain visible', () => {
  const [event] = parseCalendar(fixture('DTSTART:20261003T120000\r\nDTEND:20261003T140000'));
  assert.equal(filterEvents([event], {}, new Date('2026-10-03T18:00:00Z')).length, 1);
  assert.equal(filterEvents([event], {}, new Date('2026-10-03T19:00:00Z')).length, 0);
  assert.equal(filterEvents([{ ...event, status: 'CANCELLED' }], {}, now).length, 0);
});
