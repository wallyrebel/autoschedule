import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateCalendar, validateCalendar } from '../index.js';
import { generateICS } from '../generate-ics.js';

const team = (name, id) => ({ name, url: `https://www.maxpreps.com/${id}/`, timezone: 'America/Chicago' });
const config = { teams: [team('One', 'one'), team('Two', 'two')] };
const sport = (id, name = 'Football') => ({ schoolId: id, level: 'Varsity', isPublished: true, year: '26-27', sport: name, gender: 'Boys', season: 'Fall', sportSeasonId: id + name, canonicalUrl: `https://www.maxpreps.com/${id}/${name}/` });
function contest(id, date = '2026-10-04T19:00:00') {
  const own = [], other = [], c = [];
  own[1] = id; own[11] = 0; own[14] = id;
  other[1] = 'opponent'; other[11] = 1; other[14] = 'Opponent';
  c[0] = [own, other]; c[1] = id + '-contest'; c[11] = date; c[18] = 'https://www.maxpreps.com/game/';
  return c;
}
function mockFetch(overrides = {}) {
  return async url => {
    if (overrides[url] === 406) return { ok: false, status: 406 };
    const id = new URL(url).pathname.split('/')[1];
    const props = url.includes('/schedule/') ? { schoolId: id, contests: [contest(id)], teamContext: { data: sport(id) } } : { schoolContext: { sportSeasons: [sport(id)] } };
    const body = Object.hasOwn(overrides, url) ? overrides[url] : { props: { pageProps: props } };
    return { ok: true, text: async () => typeof body === 'string' ? body : `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(body)}</script>` };
  };
}
const options = { config, sleep: async () => {}, now: new Date('2026-10-03T12:00:00Z') };
async function preserved(overrides, extra = {}, pattern = /./) {
  const dir = mkdtempSync(join(tmpdir(), 'calendar-test-'));
  writeFileSync(join(dir, 'schedules.ics'), 'LAST GOOD FEED');
  writeFileSync(join(dir, 'summary.json'), 'LAST GOOD SUMMARY');
  try {
    await assert.rejects(updateCalendar({ ...options, fetch: mockFetch(overrides), outputDir: dir, ...extra }), pattern);
    assert.equal(readFileSync(join(dir, 'schedules.ics'), 'utf8'), 'LAST GOOD FEED');
    assert.equal(readFileSync(join(dir, 'summary.json'), 'utf8'), 'LAST GOOD SUMMARY');
    assert.deepEqual(readdirSync(dir).sort(), ['schedules.ics', 'summary.json']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('all-school HTTP 406 fails and leaves both published files unchanged', () => preserved({ [config.teams[0].url]: 406, [config.teams[1].url]: 406 }, {}, /HTTP 406/));
test('partial-school HTTP 406 cannot publish an incomplete feed', () => preserved({ [config.teams[1].url]: 406 }, {}, /HTTP 406/));
test('partial-sport HTTP 406 cannot publish an incomplete feed', () => preserved({ 'https://www.maxpreps.com/one/Football/schedule/': 406 }, {}, /HTTP 406/));
test('second sport failure after a successful sport preserves feed', () => preserved({
  [config.teams[0].url]: { props: { pageProps: { schoolContext: { sportSeasons: [sport('one'), sport('one', 'Basketball')] } } } },
  'https://www.maxpreps.com/one/Basketball/schedule/': 406,
}, {}, /HTTP 406/));
for (const [name, body] of Object.entries({ 'missing JSON': '<html>Access denied</html>', 'invalid JSON': '<script id="__NEXT_DATA__">{broken</script>', 'missing sportSeasons': {}, 'empty discovery': { props: { pageProps: { schoolContext: { sportSeasons: [] } } } } })) {
  test(name + ' preserves feed', () => preserved({ [config.teams[0].url]: body }));
}
for (const [name, value] of Object.entries({ 'missing contests': undefined, 'non-array contests': {}, 'invalid contest': [{}], 'invalid date': [contest('one', 'not-a-date')], 'wrong school': [contest('other')], 'malformed past contest': [contest('other', '2020-01-01T19:00:00')] })) {
  test(name + ' preserves feed', () => preserved({ 'https://www.maxpreps.com/one/Football/schedule/': { props: { pageProps: { schoolId: 'one', contests: value, teamContext: { data: sport('one') } } } } }));
}
test('calendar generation error preserves feed', () => preserved({}, { generate: () => { throw new Error('generation failed'); } }));
test('incomplete generated ICS preserves feed', () => preserved({}, { generate: () => 'BEGIN:VCALENDAR\r\nEND:VCALENDAR' }, /validation/));
test('duplicate generated event IDs preserve feed', () => preserved({}, { generate: games => generateICS([games[0], games[0]], config) }, /Duplicate/));

test('complete fresh scrape publishes validated matching feed and coverage', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'calendar-test-'));
  try {
    const summary = await updateCalendar({ ...options, fetch: mockFetch(), outputDir: dir });
    assert.equal(summary.totalGames, 2); assert.equal(summary.sources.length, 2);
    assert.equal(summary.status, 'complete');
    const ics = readFileSync(join(dir, 'schedules.ics'), 'utf8');
    validateCalendar(ics, 2);
    assert.match(ics, /DTSTART;TZID=America\/Chicago:20261004T190000/);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')), summary);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('explicit empty contests are legitimate no-games after all sources succeed', async () => {
  const overrides = Object.fromEntries(['one', 'two'].map(id => [`https://www.maxpreps.com/${id}/Football/schedule/`, { props: { pageProps: { schoolId: id, contests: [], teamContext: { data: sport(id) } } } }]));
  const summary = await updateCalendar({ ...options, fetch: mockFetch(overrides), dryRun: true });
  assert.equal(summary.totalGames, 0); assert.equal(summary.sources.length, 2);
});
test('valid past contests yield no upcoming games, with complete coverage', async () => {
  const overrides = Object.fromEntries(['one', 'two'].map(id => [`https://www.maxpreps.com/${id}/Football/schedule/`, { props: { pageProps: { schoolId: id, contests: [contest(id, '2026-10-01T19:00:00')], teamContext: { data: sport(id) } } } }]));
  const summary = await updateCalendar({ ...options, fetch: mockFetch(overrides), dryRun: true });
  assert.equal(summary.totalGames, 0); assert.equal(summary.sources.length, 2);
});
test('dry run leaves published files untouched on success', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'calendar-test-'));
  try {
    writeFileSync(join(dir, 'schedules.ics'), 'UNCHANGED');
    await updateCalendar({ ...options, fetch: mockFetch(), dryRun: true, outputDir: dir });
    assert.equal(readFileSync(join(dir, 'schedules.ics'), 'utf8'), 'UNCHANGED');
    assert.deepEqual(readdirSync(dir), ['schedules.ics']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function legacyPage(changes = {}, marker = true) {
  const metadata = { pageType: 'teamschedule', pageError: 0, schoolId: 'one', ssid: 'oneFootball', sportName: 'Football', gender: 'Boys', year: '26-27', season: 'Fall', teamLevel: 'Varsity', ...changes };
  return `<script>var utag_data = ${JSON.stringify(metadata)};</script>${marker ? '<h2>No Schedule Available</h2>' : ''}`;
}
test('verified legacy explicit no-schedule page succeeds', async () => {
  const summary = await updateCalendar({ ...options, fetch: mockFetch({ 'https://www.maxpreps.com/one/Football/schedule/': legacyPage() }), dryRun: true });
  assert.equal(summary.totalGames, 1); assert.equal(summary.sources.length, 2);
  assert.equal(summary.sources[0].format, 'legacy-explicit-no-schedule');
});
for (const changes of [{ schoolId: 'wrong' }, { year: '25-26' }, { ssid: 'wrong' }, { sportName: 'Tennis' }, { pageError: 1 }]) {
  test('legacy identity/error mismatch preserves feed ' + JSON.stringify(changes), () => preserved({ 'https://www.maxpreps.com/one/Football/schedule/': legacyPage(changes) }));
}
test('legacy missing explicit no-schedule marker preserves feed', () => preserved({ 'https://www.maxpreps.com/one/Football/schedule/': legacyPage({}, false) }));
test('next-data missing sport identity preserves feed', () => preserved({ 'https://www.maxpreps.com/one/Football/schedule/': { props: { pageProps: { schoolId: 'one', contests: [] } } } }));

test('explicit source-marked TBA opponent is valid, without invented identity', async () => {
  const c = contest('one'); c[0][1][1] = null; c[0][1][14] = null; c[0][1][7] = true;
  const summary = await updateCalendar({ ...options, fetch: mockFetch({ 'https://www.maxpreps.com/one/Football/schedule/': { props: { pageProps: { schoolId: 'one', contests: [c], teamContext: { data: sport('one') } } } } }), dryRun: true });
  assert.equal(summary.totalGames, 2);
});
test('unmarked missing opponent identity is a schema failure', () => {
  const c = contest('one'); c[0][1][1] = null; c[0][1][14] = null;
  return preserved({ 'https://www.maxpreps.com/one/Football/schedule/': { props: { pageProps: { schoolId: 'one', contests: [c], teamContext: { data: sport('one') } } } } });
});

function legacyTable(date) { return legacyPage({}, false) + `<table id="schedule"><tbody><tr><td><abbr class="event-time" title="${date}"></abbr></td></tr></tbody></table>`; }
test('matching legacy table with verified past dates is legitimate no-upcoming-games', async () => {
  const summary = await updateCalendar({ ...options, fetch: mockFetch({ 'https://www.maxpreps.com/one/Football/schedule/': legacyTable('2026-08-31T15:00:00') }), dryRun: true });
  assert.equal(summary.totalGames, 1); assert.equal(summary.sources[0].contests, 1);
  assert.equal(summary.sources[0].format, 'legacy-verified-past-only');
});
for (const date of ['2026-10-04T15:00:00', 'not-a-date', '2026-10-03T11:00:00']) {
  test('unparsed future/invalid/recent legacy row preserves feed: ' + date, () => preserved({ 'https://www.maxpreps.com/one/Football/schedule/': legacyTable(date) }));
}

test('repeated source contests for the same fixture consolidate under its stable UID', async () => {
  const c1 = contest('one'), c2 = contest('one'); c2[1] = 'second-contest';
  const overrides = { 'https://www.maxpreps.com/one/Football/schedule/': { props: { pageProps: { schoolId: 'one', contests: [c1, c2], teamContext: { data: sport('one') } } } } };
  const summary = await updateCalendar({ ...options, fetch: mockFetch(overrides), dryRun: true });
  assert.equal(summary.totalGames, 2);
  assert.equal(summary.duplicateSourceRecords, 1);
});

test('conflicting repeated fixture metadata fails before publication', () => {
  const c1 = contest('one'), c2 = contest('one'); c2[1] = 'second-contest'; c2[0][0][11] = 1;
  return preserved({ 'https://www.maxpreps.com/one/Football/schedule/': { props: { pageProps: { schoolId: 'one', contests: [c1, c2], teamContext: { data: sport('one') } } } } }, {}, /Conflicting duplicate/);
});
