import ical from 'ical-generator';

// Default game durations in hours by sport
const GAME_DURATIONS = {
  'Football': 3,
  'Baseball': 2.5,
  'Softball': 2,
  'Basketball': 1.5,
  'Soccer': 2,
  'Volleyball': 1.5,
  'Tennis': 2,
  'Golf': 4,
  'Cross Country': 1,
  'Track & Field': 3,
  'Swimming': 2,
  'Wrestling': 2,
};

/**
 * Generate an ICS calendar file from scraped game data
 * @param {Array} games - Array of game objects from scraper
 * @param {Object} config - Calendar configuration
 * @returns {string} ICS file content
 */
export function generateICS(games, config) {
  const calendar = ical({
    name: config.calendarName || 'High School Sports Schedules',
    timezone: 'America/Chicago',
    prodId: { company: 'AutoSchedule', product: 'MaxPreps Calendar' },
    description: 'Auto-generated calendar from MaxPreps high school sports schedules',
    ttl: 3600, // Suggest refresh every hour
  });

  console.log(`\nGenerating ICS with ${games.length} events...`);

  for (const game of games) {
    const startDate = new Date(game.dateTime);

    // Skip invalid dates
    if (isNaN(startDate.getTime())) {
      console.warn(`  Skipping game with invalid date: ${game.dateTime}`);
      continue;
    }

    // Calculate end time based on sport
    const durationHours = GAME_DURATIONS[game.sport] || 2;
    const endDate = new Date(startDate.getTime() + durationHours * 60 * 60 * 1000);

    // Build event title
    const prefix = game.isHome ? 'vs' : '@';
    const title = `${game.emoji} ${game.gender} ${game.sport}: ${game.teamName} ${prefix} ${game.opponentName} ${game.opponentMascot}`.trim();

    // Build description
    const descriptionParts = [
      `${game.teamName} ${game.ourMascot}`,
      `${game.isHome ? 'Home' : 'Away'} game ${game.isHome ? 'vs' : '@'} ${game.opponentDisplayName}`,
      `Sport: ${game.gender} ${game.sport}`,
      `Season: ${game.season} ${game.year}`,
    ];

    if (game.description) {
      descriptionParts.push('', game.description);
    }

    if (game.gameUrl) {
      descriptionParts.push('', `MaxPreps: ${game.gameUrl}`);
    }

    // Build location string
    let location = game.isHome
      ? `Home - ${game.teamName}`
      : `${game.opponentName}${game.opponentCity ? ', ' + game.opponentCity : ''}${game.opponentState ? ' ' + game.opponentState : ''}`;

    // Create a unique UID for this event — must be unique per event
    // Use team + datetime + sport + opponent to guarantee uniqueness
    const uidSource = `${game.teamName}-${game.dateTime}-${game.gender}-${game.sport}-${game.opponentName}`;
    const uid = Buffer.from(uidSource).toString('base64').replace(/[^a-zA-Z0-9]/g, '');

    try {
      calendar.createEvent({
        id: uid + '@autoschedule',
        start: startDate,
        end: endDate,
        timezone: game.timezone || 'America/Chicago',
        summary: title,
        description: descriptionParts.join('\n'),
        location: location,
        url: game.gameUrl || undefined,
        categories: [{ name: game.sport }, { name: game.gender }, { name: game.teamName }],
        status: 'CONFIRMED',
      });
    } catch (err) {
      console.error(`  Error creating event for ${title}: ${err.message}`);
    }
  }

  const icsContent = calendar.toString();
  console.log(`  Generated ${icsContent.split('BEGIN:VEVENT').length - 1} calendar events`);

  return icsContent;
}
