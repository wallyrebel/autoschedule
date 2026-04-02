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
npm install
node index.js
```

The generated calendar will be at `docs/schedules.ics`.

## Adding/Removing Teams

Edit `config.json` to add or remove teams. Pushing the change to `main` will automatically trigger a re-scrape.
