import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { scrapeAllTeams } from './scraper.js';
import { generateICS } from './generate-ics.js';

const root = dirname(fileURLToPath(import.meta.url));
// MaxPreps supplies school-local wall times without an offset; these schools are Central.
process.env.TZ = 'America/Chicago';

export function validateCalendar(content, expectedCount) {
  const lines = content.split(/\r?\n/);
  if (lines[0] !== 'BEGIN:VCALENDAR' || !content.trimEnd().endsWith('END:VCALENDAR') ||
      lines.filter(l => l === 'BEGIN:VEVENT').length !== expectedCount ||
      lines.filter(l => l === 'END:VEVENT').length !== expectedCount ||
      lines.filter(l => l.startsWith('DTSTART')).length !== expectedCount ||
      lines.filter(l => l.startsWith('UID:')).length !== expectedCount) {
    throw new Error('Generated calendar failed structural/event-count validation');
  }
  const uids = content.replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter(l => l.startsWith('UID:'));
  if (new Set(uids).size !== expectedCount) throw new Error('Duplicate calendar event IDs');
}

export async function updateCalendar({ config = JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')),
  outputDir = join(root, 'docs'), scrape = scrapeAllTeams, generate = generateICS,
  dryRun = false, ...scrapeOptions } = {}) {
  const sources = [];
  const games = await scrape(config, { ...scrapeOptions, sources });
  // Any request or parsing error above rejects the entire update, before file writes.
  const content = generate(games, config);
  validateCalendar(content, games.length);
  const summary = {
    lastUpdated: new Date().toISOString(),
    status: 'complete',
    totalGames: games.length,
    sourceUpcomingGames: sources.reduce((total, source) => total + source.upcoming, 0),
    duplicateSourceRecords: sources.reduce((total, source) => total + source.upcoming, 0) - games.length,
    teams: config.teams.map(t => t.name),
    gamesByTeam: Object.fromEntries(config.teams.map(t => [t.name, 0])),
    gamesBySport: {},
    sources,
    calendarSha256: createHash('sha256').update(content).digest('hex'),
    firstGame: games[0]?.dateTime || null,
    lastGame: games.at(-1)?.dateTime || null,
  };
  for (const game of games) {
    summary.gamesByTeam[game.teamName]++;
    const key = `${game.gender} ${game.sport}`;
    summary.gamesBySport[key] = (summary.gamesBySport[key] || 0) + 1;
  }
  if (!dryRun) {
    mkdirSync(outputDir, { recursive: true });
    const staging = mkdtempSync(join(outputDir, '.calendar-'));
    try {
      writeFileSync(join(staging, 'schedules.ics'), content);
      writeFileSync(join(staging, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
      // Validate the staged bytes before atomically replacing the public feed.
      validateCalendar(readFileSync(join(staging, 'schedules.ics'), 'utf8'), games.length);
      renameSync(join(staging, 'summary.json'), join(outputDir, 'summary.json'));
      renameSync(join(staging, 'schedules.ics'), join(outputDir, 'schedules.ics'));
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
  console.log(JSON.stringify(summary, null, 2));
  console.log(`${dryRun ? 'Validated (dry run)' : 'Published'} ${games.length} events from ${sources.length} schedules.`);
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  updateCalendar({ dryRun: process.argv.includes('--dry-run') }).catch(err => {
    console.error('Calendar update failed; existing feed preserved:', err);
    process.exitCode = 1;
  });
}
