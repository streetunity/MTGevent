# MTG Events

An Android app for running and tracking the Magic: The Gathering tournaments at our bar. Built to replace MTGevent.com with something that works offline, keeps a real timer, and lets the organizer fix things mid-event.

Built with Expo (React Native + TypeScript). Data lives on the phone in SQLite, with no account or internet needed.

## Running it on your PC (emulator) or phone

**One-time setup (Windows)**
1. Install Node.js 22 or newer.
2. Install Android Studio and run the **Standard** setup so it downloads the Android SDK.
3. Add environment variables:
   - `ANDROID_HOME` = `C:\Users\<you>\AppData\Local\Android\Sdk`
   - add `%ANDROID_HOME%\platform-tools` to your Path
4. Either start an emulator (Android Studio → Virtual Device Manager → ▶), or plug in your phone with USB debugging turned on.

**Build and install**
```powershell
git clone https://github.com/streetunity/MTGevent.git
cd MTGevent
npm install
npm run android
```
The first build takes several minutes. It installs the app and starts the dev server. After that, JavaScript changes reload instantly, and you only need `npm run android` again when native packages change.

> The quick-preview **Expo Go** app is *not* enough, because the timer alarm needs a real build. That's why `npm run android` makes a development build.

**Other commands**
- `npm test`: runs the tournament-logic tests (pairing, scoring, standings, timer)
- `npm run typecheck`: TypeScript check

## What's in v0.1

**Setup (one screen)**
- The title fills itself in (e.g. "Friday Night Magic – Oct 16"). Tap it to rename.
- Settings collapse into one line: *Constructed · Swiss · Bo3 · 3 rounds · 50 min*. Tap to edit. Your last settings are remembered.
- The round count follows the player count automatically (2→1, 4→2, 8→3, 16→4, 32→5) unless you override it.
- Adding a player autocompletes from the saved roster, so the same person links to their history.
- Tap ✎ to rename a player. If the new name matches an existing player, the app offers to merge them. Tap ✕ to remove.

**During the event**
- **Swiss pairing**
  - avoids rematches within the event
  - pairs players with similar points together
  - gives the bye to the lowest-ranked player who hasn't had one
  - avoids pairing the same people as in recent weeks (it looks at the last 6 events)
- **Fixing pairings** before a round starts: tap any two players to swap them, or hit Re-pair. Rematches are flagged.
- **Results**: one tap from the full list of scores (2-0, 2-1, 1-2, 0-2, 1-0, 0-1, 1-1, 0-0). Any result in any round can be edited, and standings recalculate.
- **Next round stays locked** until every table has a result.
- **Drop a player at any time.**
  - If they're mid-match, you choose: they concede that match, or they drop after the round.
  - They stay in the standings, and you can undo the drop.
- **Late players** join the next round with 0 points.
- **Round timer**
  - start, pause, +5, −1, reset
  - big countdown on screen, which stays awake while running
  - **alarm notifications at the warning time and at time**, ringing on the alarm channel even with the phone locked or the app closed
  - when time is called, it shows the "5 extra turns" reminder
- You can end an event early or add an extra round after it finishes.

**Scoring presets**
| Result | House (default) | Official |
|---|---|---|
| 2-0 | 3 / 0 | 3 / 0 |
| 2-1 | 2 / 1 | 3 / 0 |
| 1-1 at time | 1 / 1 | 1 / 1 (draw) |
| 1-0 at time | 1 / 0 | 3 / 0 |
| 0-0 at time | 0 / 0 | 1 / 1 |
| Bye | 3 | 3 |

**Ties and prizes**
- Prize spots default to 4. Players inside them are highlighted gold.
- Tie modes:
  - **Share place** (default): tied players show as T-1st, T-2nd, and so on
  - **Tiebreakers**: opponents' match-win %, then game-win %, then opponents' game-win % (MTR style, floored at 33%)
  - **Head-to-head first**, then tiebreakers
- If a tie straddles the prize cutoff, the app flags it. You can apply tiebreakers, award the extra prizes, or settle it yourself.

**History**
- Player pages show events, record, match and game win %, 1st places, prize finishes, total points, head-to-head records against every opponent, and every past event.
- The leaderboard covers this month, this year, or all time, sorted by points, match wins, or attendance.

## Project layout
```
App.tsx                 navigation
src/core/               pure tournament logic (no React), fully unit-tested
  types.ts              data model
  scoring.ts            house + official scoring
  pairing.ts            Swiss pairing, swaps, rematch detection
  standings.ts          records, tiebreakers, shared places, prize cutoff
  eventOps.ts           every state change (start, report, drop, timer…)
src/data/
  db.ts                 SQLite: players table + one JSON document per event
  store.tsx             app state
  history.ts            stats, head-to-head, leaderboard, repeat-pairing penalty
src/timer/alerts.ts     alarm-channel notifications
src/screens/            Home, Setup, Event (Round/Standings/Players), Roster, Player, Leaderboard
```

## Roadmap
- **Next:**
  - share standings as an image to the group chat
  - backup/restore (export/import JSON)
  - app icon
- **Later:**
  - Swiss + top cut
  - Commander pods (3–5 players)
  - draft pod seating
- **Future:** player phones. Events are already stored as standalone documents with IDs and timestamps, so a sync server can be added without changing the data model.
