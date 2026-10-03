# AutoSchedule — MaxPreps → Google Calendar

Automatically scrapes varsity sports schedules from MaxPreps for multiple high school teams and generates a subscribable `.ics` calendar file, hosted via GitHub Pages.

## Teams Tracked

| Team | MaxPreps URL |
|------|-------------|
| Ripley Tigers | [Link](https://www.maxpreps.com/ms/ripley/ripley-tigers/) |
| Pine Grove Panthers | [Link](https://www.maxpreps.com/ms/ripley/pine-grove-panthers/) |
| Falkner Eagles | [Link](https://www.maxpreps.com/ms/falkner/falkner-eagles/) |
| Walnut Wildcats | [Link](https://www.maxpreps.com/ms/walnut/walnut-wildcats/) |
| Blue Mountain Cougars | [Link](https://www.maxpreps.com/ms/blue-mountain/blue-mountain-cougars/) |

## How It Works

1. **GitHub Actions** runs the scraper daily at 1:00 AM Central
2. The scraper visits each team's MaxPreps page and discovers all **varsity** sports
3. For each sport, it extracts upcoming game data from MaxPreps' embedded JSON (`__NEXT_DATA__`)
4. An `.ics` (iCalendar) file is generated with all future games
5. The file is committed to `docs/schedules.ics` and served via **GitHub Pages**

## Subscribe to the Calendar

### Google Calendar
1. Open [Google Calendar](https://calendar.google.com)
2. Click **+** next to "Other calendars" → **From URL**
3. Paste: `https://wallyrebel.github.io/autoschedule/schedules.ics`
4. Click **Add calendar**

> **Note:** Google Calendar refreshes URL subscriptions every 12–24 hours.

### Apple Calendar / Outlook
Use the same URL above to subscribe in any calendar app that supports `.ics` URL subscriptions.

## Manual Run

To trigger an immediate update, go to the **Actions** tab → **Update Sports Calendar** → **Run workflow**.

## Local Development

```bash
npm ci
npm test
node index.js
```

The generated calendar will be at `docs/schedules.ics`.

## Adding/Removing Teams

Edit `config.json` to add or remove teams. Pushing the change to `main` will automatically trigger a re-scrape.

## Failure safety

An update is published only after every configured school and every discovered current-year varsity sport succeeds. HTTP errors (including 406), missing or changed source schemas, invalid contests, and calendar generation errors fail the workflow before publication. The last successful feed remains available; no historical snapshot is silently substituted.

Explicit empty contest arrays and legacy pages with “No Schedule Available” are accepted only with matching school, sport, and season metadata. Legacy schedule tables are accepted as having no upcoming games only when every row is positively dated more than a day in the past; other legacy tables fail safely. A missing array or unidentified page is a failure. Generated event counts and unique IDs are validated in a staged file, then the ICS is replaced atomically. `docs/summary.json` records source coverage, dates, and a SHA-256 digest of the feed.

`npm test` runs offline regression tests. `npm run dry-run` performs a live scrape and validation without writing either published file. Scraper code changes trigger the same guarded GitHub Actions workflow as config changes, and overlapping updates are serialized.

## Direct schedule viewer

The responsive viewer at `https://wallyrebel.github.io/autoschedule/` reads the adjacent `schedules.ics` and `summary.json` directly. It displays an upcoming agenda with school and sport filters, Central time labels, source links, and a verified last-update timestamp. The existing ICS subscription URLs are unchanged.

For a WordPress Custom HTML block, use:

```html
<iframe src="https://wallyrebel.github.io/autoschedule/"
        title="Tippah Sports upcoming games"
        style="width:100%;height:1000px;border:0;"
        loading="lazy"></iframe>
```

The frame scrolls to the remaining games and the “Show more games” control. `1000px` is a recommended starting height for desktop and mobile. The viewer uses no third-party scripts or credentials. Parser tests include actual-feed coverage, UTC and IANA timezones, midnight, DST folds/gaps, all-day dates, folding/escaping, and filter/reset behavior.
