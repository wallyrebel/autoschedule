import { parseCalendar, filterEvents, dateKey, DISPLAY_ZONE } from './calendar-data.js';

const elements = Object.fromEntries(['school', 'sport', 'reset', 'count', 'updated', 'state', 'games', 'more', 'retry', 'retry-wrap'].map(id => [id, document.getElementById(id)]));
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: DISPLAY_ZONE, hour: 'numeric', minute: '2-digit' });
const zoneFormat = new Intl.DateTimeFormat('en-US', { timeZone: DISPLAY_ZONE, timeZoneName: 'short' });
const updatedFormat = new Intl.DateTimeFormat('en-US', { timeZone: DISPLAY_ZONE, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const weekdays = new Intl.DateTimeFormat('en-US', { timeZone: DISPLAY_ZONE, weekday: 'long' });
const dayFormat = new Intl.DateTimeFormat('en-US', { timeZone: DISPLAY_ZONE, month: 'short', day: 'numeric' });
const yearFormat = new Intl.DateTimeFormat('en-US', { timeZone: DISPLAY_ZONE, year: 'numeric' });
const colors = ['#9e662f', '#3d7052', '#a35955', '#5e6796', '#6b8475'];
let events = [], limit = 30, loading = false;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function setState(title, description, busy = false) {
  elements.state.replaceChildren();
  if (busy) { const spinner = node('span', 'spinner'); spinner.setAttribute('aria-hidden', 'true'); elements.state.append(spinner); }
  elements.state.append(node('h3', '', title), node('p', '', description));
  elements.state.hidden = false;
}

function safeSource(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && /(^|\.)maxpreps\.com$/.test(url.hostname) ? url.href : null; }
  catch { return null; }
}

function render() {
  const now = new Date();
  const filters = { school: elements.school.value, sport: elements.sport.value };
  const filtered = filterEvents(events, filters, now);
  const total = filterEvents(events, {}, now).length;
  const shown = filtered.slice(0, limit);
  elements.games.replaceChildren();
  elements.more.hidden = filtered.length <= limit;
  elements.more.textContent = `Show more games (${filtered.length - shown.length} remaining)`;
  const filteredLabel = filters.school || filters.sport ? ` · ${total} across all schools` : '';
  elements.count.textContent = filtered.length ? `${filtered.length} upcoming ${filtered.length === 1 ? 'game' : 'games'} · Showing ${shown.length}${filteredLabel}` : `${total} upcoming games across all schools`;
  if (!filtered.length) {
    setState(total ? 'No games match these filters' : 'No upcoming games listed', total ? 'Choose another school or sport, or reset the filters.' : 'Check back after the next schedule update.');
    return;
  }
  elements.state.hidden = true;
  const schools = [...new Set(events.map(event => event.school))].sort();
  const groups = new Map();
  for (const event of shown) {
    const key = dateKey(event.start);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  }
  for (const [key, group] of groups) {
    const section = node('section', 'day-group');
    const heading = node('h3', 'day-label');
    heading.id = `day-${key}`; section.setAttribute('aria-labelledby', heading.id);
    const date = group[0].start;
    heading.append(node('span', 'weekday', weekdays.format(date)), node('span', 'date', dayFormat.format(date)), node('span', 'year', yearFormat.format(date)));
    if (key === dateKey(now)) heading.append(node('span', 'today', 'TODAY'));
    const cards = node('div', 'day-cards');
    for (const event of group) {
      const card = node('article', 'game'); card.style.setProperty('--school-color', colors[schools.indexOf(event.school) % colors.length]);
      const time = node('div', 'game-time');
      const clock = node('time', '', event.allDay ? 'All day' : timeFormat.format(event.start)); clock.dateTime = event.start.toISOString();
      time.append(clock, node('span', 'zone', event.allDay ? 'Central' : zoneFormat.formatToParts(event.start).find(part => part.type === 'timeZoneName').value));
      const body = node('div', 'game-body');
      const tags = node('div', 'game-tags');
      if (event.school) tags.append(node('span', 'school-tag', event.school));
      if (event.gender || event.sport) tags.append(node('span', '', [event.gender, event.sport].filter(Boolean).join(' ')));
      // Remove only the known category prefix; opponent/team text stays from the feed.
      const summary = event.summary.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '');
      const prefix = `${event.gender} ${event.sport}: `;
      const title = summary.startsWith(prefix) ? summary.slice(prefix.length) : summary;
      body.append(tags, node('h4', '', title));
      const detail = node('div', 'game-detail');
      if (event.location) detail.append(node('span', '', event.location));
      const source = safeSource(event.url);
      if (source) {
        const link = node('a', '', 'Game details ↗'); link.href = source; link.target = '_blank'; link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', `Game details for ${title} on ${dayFormat.format(date)}`); detail.append(link);
      }
      body.append(detail); card.append(time, body); cards.append(card);
    }
    section.append(heading, cards); elements.games.append(section);
  }
}

function fillOptions(select, values, defaultText) {
  const previous = select.value;
  select.replaceChildren(new Option(defaultText, ''));
  for (const value of values.filter(Boolean)) select.add(new Option(value, value));
  select.value = values.includes(previous) ? previous : '';
}

async function load() {
  if (loading) return; loading = true;
  elements['retry-wrap'].hidden = true; elements.more.hidden = true; elements.games.replaceChildren();
  for (const id of ['school', 'sport', 'reset']) elements[id].disabled = true;
  elements.count.textContent = 'Checking the latest schedule…'; elements.updated.textContent = 'Loading update details…';
  setState('Loading games', 'Getting the latest schedule for your schools.', true);
  try {
    const [feedResult, summaryResult] = await Promise.allSettled([
      fetch(new URL('schedules.ics', import.meta.url), { cache: 'no-cache', signal: AbortSignal.timeout(15000) }).then(response => {
        if (!response.ok) throw new Error('Schedule unavailable'); return response.text();
      }),
      fetch(new URL('summary.json', import.meta.url), { cache: 'no-cache', signal: AbortSignal.timeout(15000) }).then(response => {
        if (!response.ok) throw new Error('Update details unavailable'); return response.json();
      }),
    ]);
    if (feedResult.status !== 'fulfilled') throw feedResult.reason;
    events = parseCalendar(feedResult.value);
    let verifiedSummary = false;
    if (summaryResult.status === 'fulfilled') {
      const summary = summaryResult.value;
      if (summary.status === 'complete' && summary.totalGames === events.length && Number.isFinite(Date.parse(summary.lastUpdated))) {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(feedResult.value));
        const digest = [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
        if (digest === summary.calendarSha256) {
          elements.updated.textContent = `Schedule updated ${updatedFormat.format(new Date(summary.lastUpdated))}`;
          verifiedSummary = true;
        }
      }
    }
    if (!verifiedSummary) elements.updated.textContent = 'Games loaded · Update details unavailable';
    fillOptions(elements.school, [...new Set(events.map(event => event.school))].sort(), 'All schools');
    fillOptions(elements.sport, [...new Set(events.map(event => event.sport))].sort(), 'All sports');
    for (const id of ['school', 'sport', 'reset']) elements[id].disabled = false;
    limit = 30; render();
  } catch (error) {
    console.error('Schedule viewer:', error);
    events = []; elements.games.replaceChildren(); elements.count.textContent = 'Schedule unavailable';
    elements.updated.textContent = '';
    setState('We couldn’t load the schedule', 'Please try again in a moment. The calendar subscription link is also available above.');
    elements['retry-wrap'].hidden = false;
  } finally { loading = false; }
}

for (const id of ['school', 'sport']) elements[id].addEventListener('change', () => { limit = 30; render(); });
elements.reset.addEventListener('click', () => { elements.school.value = ''; elements.sport.value = ''; limit = 30; render(); });
elements.more.addEventListener('click', () => { limit += 30; render(); });
elements.retry.addEventListener('click', load);
load();
