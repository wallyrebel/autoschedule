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
export async function fetchNextData(url, options = {}) {
  console.log(`  Fetching: ${url}`);
  const response = await (options.fetch || fetch)(url, {
    signal: AbortSignal.timeout(30000),
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
    // Older MaxPreps sport pages expose explicit no-schedule HTML and JSON metadata.
    // Accept only that known empty state, with the full requested team/season identity.
    const metadataText = $('script').toArray().map(el => $(el).html() || '')
      .map(script => script.match(/var utag_data\s*=\s*(\{[\s\S]*?\})\s*;/)?.[1]).find(Boolean);
    const expected = options.expectedSport;
    if (expected && metadataText) {
      const metadata = JSON.parse(metadataText);
      const identityMatches = metadata.pageType === 'teamschedule' && metadata.pageError === 0 &&
        metadata.schoolId === options.expectedSchoolId && metadata.ssid === expected.sportSeasonId &&
        metadata.sportName === expected.sport && metadata.gender === expected.gender &&
        metadata.year === expected.year && metadata.season === expected.season && metadata.teamLevel === 'Varsity';
      const empty = $('h2').toArray().some(el => $(el).text().trim() === 'No Schedule Available');
      if (identityMatches && empty) {
        return { props: { pageProps: { schoolId: metadata.schoolId, contests: [], sourceFormat: 'legacy-explicit-no-schedule' } } };
      }
      // Legacy tables are also valid empty *upcoming* schedules when every row is
      // positively dated in the past. Do not guess at future legacy fixture fields.
      const rows = $('#schedule tbody tr').toArray();
      const cutoff = (options.now || new Date()).getTime() - 24 * 60 * 60 * 1000;
      const allPast = rows.length > 0 && rows.every(row => {
        const date = $(row).find('.event-time').attr('title');
        return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(date) &&
          Number.isFinite(new Date(date).getTime()) && new Date(date).getDate() === Number(date.slice(8, 10)) &&
          new Date(date).getTime() < cutoff;
      });
      if (identityMatches && allPast) {
        return { props: { pageProps: { schoolId: metadata.schoolId, contests: [], sourceFormat: 'legacy-verified-past-only', sourceTotalContests: rows.length } } };
      }
    }
    throw new Error(`No validated schedule data found on ${url}`);
  }

  return JSON.parse(nextDataScript);
}

/**
 * Discover all varsity sports for a team from their school home page
 * Returns { sports: [...], schoolId: string }
 */
export async function discoverSports(teamUrl, teamName, options = {}) {
  console.log(`\nDiscovering sports for ${teamName}...`);

  const data = await fetchNextData(teamUrl, options);
  const sportSeasons = data?.props?.pageProps?.schoolContext?.sportSeasons;
  if (!Array.isArray(sportSeasons) || sportSeasons.length === 0) {
    throw new Error(`Missing/empty sportSeasons for ${teamName}`);
  }
  for (const sport of sportSeasons) {
    if (!sport || typeof sport.isPublished !== 'boolean' ||
        !['schoolId', 'level', 'year', 'sport', 'gender', 'season', 'canonicalUrl', 'sportSeasonId'].every(k => typeof sport[k] === 'string' && sport[k])) {
      throw new Error(`Invalid sportSeasons schema for ${teamName}`);
    }
    if (new URL(sport.canonicalUrl).origin !== 'https://www.maxpreps.com') {
      throw new Error(`Invalid sport URL for ${teamName}`);
    }
  }

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

  if (!currentYear || varsitySports.length === 0) {
    throw new Error(`No published current varsity sports for ${teamName}`);
  }

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
export function parseContest(contest, teamSchoolId) {
  const teams = contest?.[0];
  if (!Array.isArray(contest) || !Array.isArray(teams) || teams.length !== 2 || !teams.every(t => Array.isArray(t) && [0, 1, 2].includes(t[11]) && ((typeof t[1] === 'string' && typeof t[14] === 'string' && t[14]) || (t[1] === null && t[14] === null && t[7] === true)))) {
    throw new Error('Invalid contest teams schema');
  }

  const gameTime = contest[11];
  if (typeof gameTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(gameTime) || !Number.isFinite(new Date(gameTime).getTime()) || new Date(gameTime).getDate() !== Number(gameTime.slice(8, 10))) {
    throw new Error(`Invalid contest date: ${gameTime}`);
  }

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

  if (!ourTeam || !opponent || teams.filter(t => t[1] === teamSchoolId).length !== 1) {
    throw new Error('Contest does not identify the configured school');
  }

  // Determine home/away: team[11] = 0 means Home, 1 means Away
  const isHome = ourTeam[11] === 0;
  const isNeutral = ourTeam[11] === 2 || opponent[11] === 2;

  return {
    dateTime: gameTime,
    opponentName: opponent[14] || 'TBA',
    opponentMascot: opponent[21] || '',
    opponentCity: opponent[15] || '',
    opponentState: opponent[16] || '',
    opponentDisplayName: opponent[19] || opponent[14] || 'TBA',
    isHome,
    isNeutral,
    gameUrl: gameUrl ? (gameUrl.startsWith('http') ? gameUrl : `https://www.maxpreps.com${gameUrl}`) : '',
    contestType,
    description,
    ourTeamName: ourTeam[14] || 'Unknown',
    ourMascot: ourTeam[21] || '',
    location: isHome
      ? `${ourTeam[14]} - Home`
      : `@ ${opponent[14]}${opponent[15] ? ', ' + opponent[15] : ''}${opponent[16] ? ' ' + opponent[16] : ''}`,
  };
}

/**
 * Scrape the schedule for a specific sport
 */
export async function scrapeSchedule(sportInfo, teamName, teamSchoolId, options = {}) {
  // Build schedule URL — handle season-specific paths correctly
  let scheduleUrl = sportInfo.canonicalUrl.replace(/\/$/, '') + '/schedule/';
  // Avoid double /schedule/schedule/
  if (sportInfo.canonicalUrl.includes('/schedule')) {
    scheduleUrl = sportInfo.canonicalUrl;
  }

  const data = await fetchNextData(scheduleUrl, { ...options, expectedSport: sportInfo, expectedSchoolId: teamSchoolId });
  const contests = data?.props?.pageProps?.contests;
  if (!Array.isArray(contests)) throw new Error(`Missing/invalid contests for ${scheduleUrl}`);
  const pageSchoolId = data?.props?.pageProps?.schoolId;
  if (pageSchoolId !== teamSchoolId) throw new Error(`Wrong school on ${scheduleUrl}`);
  if (!data.props.pageProps.sourceFormat) {
    const context = data.props.pageProps.teamContext?.data;
    if (!context || !['sport', 'gender', 'season', 'year', 'sportSeasonId'].every(k => context[k] === sportInfo[k]) || context.level !== 'Varsity') {
      throw new Error(`Wrong/missing sport season on ${scheduleUrl}`);
    }
  }

  const schoolId = teamSchoolId;

  console.log(`  Found ${contests.length} total contests for ${sportInfo.gender} ${sportInfo.sport}`);

  const now = options.now || new Date();
  const games = [];

  for (const contest of contests) {
    const parsed = parseContest(contest, schoolId);
    const gameDate = new Date(parsed.dateTime);

    // Skip past games (future only)
    if (gameDate <= now) continue;

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
  options.sources?.push({ team: teamName, sport: sportInfo.sport, gender: sportInfo.gender, year: sportInfo.year, url: scheduleUrl, format: data.props.pageProps.sourceFormat || 'next-data', contests: data.props.pageProps.sourceTotalContests ?? contests.length, upcoming: games.length });
  return games;
}

/**
 * Main scraper: discover sports and scrape all schedules for a team
 */
export async function scrapeTeam(teamConfig, options = {}) {
  const { name, url, timezone } = teamConfig;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Scraping: ${name}`);
  console.log(`URL: ${url}`);
  console.log(`${'='.repeat(60)}`);

  // Step 1: Discover all varsity sports (also returns schoolId)
  const { sports, schoolId } = await discoverSports(url, name, options);
  await (options.sleep || delay)(1000);

  // Step 2: Scrape schedule for each sport
  const allGames = [];
  for (const sport of sports) {
    await (options.sleep || delay)(1500); // Rate limiting between requests
    const games = await scrapeSchedule(sport, name, schoolId, options);
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
export async function scrapeAllTeams(config, options = {}) {
  if (!Array.isArray(config.teams) || config.teams.length === 0) throw new Error('No configured teams');
  const allGames = [];

  for (const team of config.teams) {
    try {
      const games = await scrapeTeam(team, options);
      allGames.push(...games);
    } catch (err) {
      throw new Error(`Failed to scrape ${team.name}; existing feed preserved: ${err.message}`, { cause: err });
    }

    // Longer delay between teams
    await (options.sleep || delay)(2000);
  }

  // Sort all games by date
  allGames.sort((a, b) => new Date(a.dateTime) - new Date(b.dateTime));

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Total upcoming games across all teams: ${allGames.length}`);
  console.log(`${'='.repeat(60)}`);

  return allGames;
}
