import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { scrapeAllTeams } from './scraper.js';
import { generateICS } from './generate-ics.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║     MaxPreps Schedule → ICS Calendar Generator      ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log(`║  Started: ${new Date().toISOString()}         ║`);
  console.log('╚══════════════════════════════════════════════════════╝');

  // Load config
  const configPath = join(__dirname, 'config.json');
  if (!existsSync(configPath)) {
    console.error('ERROR: config.json not found!');
    process.exit(1);
  }

  const config = JSON.parse(readFileSync(configPath, 'utf-8'));

  console.log(`\nTeams to scrape: ${config.teams.length}`);
  config.teams.forEach(t => console.log(`  • ${t.name}`));

  // Scrape all teams
  const allGames = await scrapeAllTeams(config);

  if (allGames.length === 0) {
    console.warn('\n⚠️  No upcoming games found! The ICS file will be empty.');
  }

  // Generate ICS
  const icsContent = generateICS(allGames, config);

  // Write to docs/ folder for GitHub Pages
  const docsDir = join(__dirname, 'docs');
  if (!existsSync(docsDir)) {
    mkdirSync(docsDir, { recursive: true });
  }

  const outputPath = join(docsDir, 'schedules.ics');
  writeFileSync(outputPath, icsContent, 'utf-8');
  console.log(`\n✅ Calendar written to: ${outputPath}`);

  // Also write a summary JSON for debugging
  const summaryPath = join(docsDir, 'summary.json');
  const summary = {
    lastUpdated: new Date().toISOString(),
    totalGames: allGames.length,
    teams: config.teams.map(t => t.name),
    gamesByTeam: {},
    gamesBySport: {},
  };

  for (const game of allGames) {
    summary.gamesByTeam[game.teamName] = (summary.gamesByTeam[game.teamName] || 0) + 1;
    const sportKey = `${game.gender} ${game.sport}`;
    summary.gamesBySport[sportKey] = (summary.gamesBySport[sportKey] || 0) + 1;
  }

  writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`📊 Summary written to: ${summaryPath}`);

  // Print summary
  console.log('\n📋 Summary:');
  console.log('  Games by team:');
  for (const [team, count] of Object.entries(summary.gamesByTeam)) {
    console.log(`    ${team}: ${count} games`);
  }
  console.log('  Games by sport:');
  for (const [sport, count] of Object.entries(summary.gamesBySport)) {
    console.log(`    ${sport}: ${count} games`);
  }

  console.log('\n🏁 Done!');
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
