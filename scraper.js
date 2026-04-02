import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

// Sport emoji mapping
const SPORT_EMOJIS = {
  'Baseball': '⚾',
  'Basketball': '🏀',
  'Football': '🏈',
  'Soccer': '⚽',
  'Softball': '🥎',
  'Volleyball': '🏐',
  'Tennis': '🎾',
  'Golf': '⛳',
  'Cross Country': '🏃',
  'Track & Field': '🏃',
  'Swimming': '🏊',
  'Wrestling': '🤼',
};

/**
 * Delay for rate limiting
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch a MaxPreps page and extract the __NEXT_DATA__ JSON
 */
async function fetchNextData(url) {
  console.log(`  Fetching: ${url}`);
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);
  const nextDataScript = $('#__NEXT_DATA__').html();

  if (!nextDataScript) {
    throw new Error(`No __NEXT_DATA__ found on ${url}`);
  }

  return JSON.parse(nextDataScript);
}

/**
 * Discover all varsity sports for a team from their school home page
 * Returns { sports: [...], schoolId: string }
 */
async function discoverSports(teamUrl, teamName) {
  console.log(`\nDiscovering sports for ${teamName}...`);

  const data = await fetchNextData(teamUrl);
  const sportSeasons = data?.props?.pageProps?.schoolContext?.sportSeasons || [];

  // Get the current school year (e.g. "25-26")
  const currentYears = sportSeasons
    .filter(s => s.level === 'Varsity')
    .map(s => s.year);
  // Use the most common year as the current year
  const yearCounts = {};
  currentYears.forEach(y => { yearCounts[y] = (yearCounts[y] || 0) + 1; });
  const currentYear = Object.entries(yearCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

  // Filter to varsity, published, and current year only
  const varsitySports = sportSeasons.filter(s =>
    s.level === 'Varsity' && s.isPublished && s.year === currentYear
  );

  // Extract schoolId
  const schoolId = sportSeasons[0]?.schoolId || null;

  console.log(`  Found ${varsitySports.length} varsity sports for ${teamName} (${currentYear}):`);
  varsitySports.forEach(s => {
    console.log(`    - ${s.gender} ${s.sport} (${s.season} ${s.year})`);
  });

  return {
    sports: varsitySports.map(s => ({
      sport: s.sport,
      gender: s.gender,
      season: s.season,
      year: s.year,
      canonicalUrl: s.canonicalUrl,
      sportSeasonId: s.sportSeasonId,
    })),
    schoolId,
  };
}

/**
 * Parse a single contest/game from the __NEXT_DATA__ contests array
 * 
 * Contest array indices (confirmed via inspection):
 *   [0]  = Array of 2 team arrays
 *   [11] = Game datetime (ISO 8601 string, e.g. "2026-04-02T19:00:00")
 *   [18] = MaxPreps game URL
 *   [21] = Contest type ("Game")
 *   [28] = Contest state description
 *   [29] = Game description text
 * 
 * Team array indices:
 *   [4]  = Team role: 1 = home team entry, 2 = away team entry
 *   [11] = Home/Away indicator: 0 = Home, 1 = Away
 *   [13] = Team canonical URL
 *   [14] = School name (e.g. "Ripley")
 *   [15] = City name
 *   [16] = State abbreviation
 *   [17] = Street address
 *   [19] = Display name with state (e.g. "Ripley (MS)")
 *   [21] = Mascot (e.g. "Tigers")
 *   [24] = Abbreviation (e.g. "RHS")
 */
function parseContest(contest, teamSchoolId) {
  try {
    const teams = contest[0];
    if (!teams || !Array.isArray(teams) || teams.length < 2) return null;

    const gameTime = contest[11];
    if (!gameTime) return null;

    const gameUrl = contest[18] || '';
    const contestType = contest[21] || 'Game';
    const description = contest[29] || '';

    // Find our team and the opponent
    let ourTeam = null;
    let opponent = null;

    for (const team of teams) {
      if (!Array.isArray(team)) continue;
      // Match by school ID (index 1 in team array)
      if (team[1] === teamSchoolId) {
        ourTeam = team;
      } else {
        opponent = team;
      }
    }

    // If we couldn't identify our team by schoolId, fall back to first team
    if (!ourTeam) {
      ourTeam = teams[0];
      opponent = teams[1];
    }

    if (!opponent) return null;

    // Determine home/away: team[11] = 0 means Home, 1 means Away
    const isHome = ourTeam[11] === 0;
    const isNeutral = ourTeam[11] === 2 || opponent[11] === 2;

    return {
      dateTime: gameTime,
      opponentName: opponent[14] || 'Unknown',
      opponentMascot: opponent[21] || '',
      opponentCity: opponent[15] || '',
      opponentState: opponent[16] || '',
      opponentDisplayName: opponent[19] || opponent[14] || 'Unknown',
      isHome,
      isNeutral,
      gameUrl: gameUrl.startsWith('http') ? gameUrl : `https://www.maxpreps.com${gameUrl}`,
      contestType,
      description,
      ourTeamName: ourTeam[14] || 'Unknown',
      ourMascot: ourTeam[21] || '',
      location: isHome
        ? `${ourTeam[14]} - Home`
        : `@ ${opponent[14]}${opponent[15] ? ', ' + opponent[15] : ''}${opponent[16] ? ' ' + opponent[16] : ''}`,
    };
  } catch (err) {
    console.error('  Error parsing contest:', err.message);
    return null;
  }
}

/**
 * Scrape the schedule for a specific sport
 */
async function scrapeSchedule(sportInfo, teamName, teamSchoolId) {
  // Build schedule URL — handle season-specific paths correctly
  let scheduleUrl = sportInfo.canonicalUrl.replace(/\/$/, '') + '/schedule/';
  // Avoid double /schedule/schedule/
  if (sportInfo.canonicalUrl.includes('/schedule')) {
    scheduleUrl = sportInfo.canonicalUrl;
  }

  try {
    const data = await fetchNextData(scheduleUrl);
    const contests = data?.props?.pageProps?.contests || [];

    // Also try to get the schoolId from the page if we don't have it
    let schoolId = teamSchoolId;
    if (!schoolId) {
      const sportSeasons = data?.props?.pageProps?.schoolContext?.sportSeasons || [];
      const matching = sportSeasons.find(s => s.sport === sportInfo.sport && s.level === 'Varsity');
      if (matching) schoolId = matching.schoolId;
    }

    console.log(`  Found ${contests.length} total contests for ${sportInfo.gender} ${sportInfo.sport}`);

    const now = new Date();
    const games = [];

    for (const contest of contests) {
      const gameDate = new Date(contest[11]);

      // Skip past games (future only)
      if (gameDate <= now) continue;

      const parsed = parseContest(contest, schoolId);
      if (!parsed) continue;

      // Add sport info
      parsed.sport = sportInfo.sport;
      parsed.gender = sportInfo.gender;
      parsed.season = sportInfo.season;
      parsed.year = sportInfo.year;
      parsed.teamName = teamName;
      parsed.emoji = SPORT_EMOJIS[sportInfo.sport] || '🏅';

      games.push(parsed);
    }

    console.log(`  → ${games.length} upcoming games`);
    return games;
  } catch (err) {
    console.error(`  Error scraping ${sportInfo.sport}: ${err.message}`);
    return [];
  }
}

/**
 * Main scraper: discover sports and scrape all schedules for a team
 */
export async function scrapeTeam(teamConfig) {
  const { name, url, timezone } = teamConfig;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Scraping: ${name}`);
  console.log(`URL: ${url}`);
  console.log(`${'='.repeat(60)}`);

  // Step 1: Discover all varsity sports (also returns schoolId)
  const { sports, schoolId } = await discoverSports(url, name);
  await delay(1000);

  // Step 2: Scrape schedule for each sport
  const allGames = [];
  for (const sport of sports) {
    await delay(1500); // Rate limiting between requests
    const games = await scrapeSchedule(sport, name, schoolId);
    allGames.push(...games);
  }

  console.log(`\nTotal upcoming games for ${name}: ${allGames.length}`);

  return allGames.map(game => ({
    ...game,
    timezone: timezone || 'America/Chicago',
  }));
}

/**
 * Scrape all teams from config
 */
export async function scrapeAllTeams(config) {
  const allGames = [];

  for (const team of config.teams) {
    try {
      const games = await scrapeTeam(team);
      allGames.push(...games);
    } catch (err) {
      console.error(`\nFailed to scrape ${team.name}: ${err.message}`);
    }

    // Longer delay between teams
    await delay(2000);
  }

  // Sort all games by date
  allGames.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total upcoming games across all teams: ${allGames.length}`);
  console.log(`${'='.repeat(60)}`);

  return allGames;
}
