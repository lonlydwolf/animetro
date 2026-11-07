# Animetro

[![CI](https://github.com/lonlydwolf/animetro/actions/workflows/ci.yml/badge.svg)](https://github.com/lonlydwolf/animetro/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/lonlydwolf/animetro)](https://github.com/lonlydwolf/animetro/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Type an anime name in English and get its whole franchise (seasons, movies, OVAs, recaps) laid out as a train line in watch order, with live data from the [AniList API](https://docs.anilist.co). A macOS app and a plain web app, from the same files.

> [!IMPORTANT]
> **This project was created entirely by AI.** Every line of code, the design, the tests, the build scripts, the release workflow and this README were written by Claude (Anthropic's Claude Opus 5.5), in a conversation where the repository owner asked for features, tested the app and made the decisions. No human wrote the code. Treat it accordingly: it works and is tested, but it has not had a human code review.

## Run it

### macOS app

With [Homebrew](https://brew.sh):

```sh
brew install --cask lonlydwolf/tap/animetro
```

`brew upgrade --cask animetro` picks up new releases (the [tap](https://github.com/lonlydwolf/homebrew-tap) updates itself within a day of each one), and `brew uninstall --cask --zap animetro` removes the app and its data.

Or download `Animetro-<version>-macOS.zip` from the [latest release](https://github.com/lonlydwolf/animetro/releases/latest), unzip it and drag **Animetro** to Applications. It runs on Apple Silicon and Intel Macs with macOS 13 or later.

The app isn't notarized by Apple (that needs a paid developer account), so the first time macOS says it can't check it. Open it once with **right-click › Open › Open**, or go to System Settings › Privacy & Security and click **Open Anyway**. In Terminal, `xattr -dr com.apple.quarantine /Applications/Animetro.app` does the same.

Build it yourself (needs Xcode or the Command Line Tools, `xcode-select --install`):

```sh
cd animetro
./macos/build.sh             # -> build/Animetro.app
./macos/build.sh --install   # also copies it to /Applications
```

### In a browser

```sh
cd animetro
python3 -m http.server 5180 --directory web   # or: npm start
```

Open http://localhost:5180. It has no build step and no dependencies. Any static file server works, but it has to be a server, because ES modules won't load from `file://`.

### Developing

- Browser: run the server above and reload.
- Mac app: `./macos/dev.sh` runs the app against the files in `web/`, so an edit only needs **⌘R** in the app. Right-click › **Inspect Element** opens Safari's Web Inspector. Only changes to `macos/Animetro.swift` need a rebuild (the script does it for you).

Run the tests (Node 20 or later, no install needed):

```sh
npm test
```

## Project layout

```
web/            the app: one HTML page per screen, css/, js/ (ES modules), img/
  js/           pure logic (order, score, fit, odds, map, journal, streams, simkl) is kept
                apart from the page scripts so it can be tested without a browser
macos/          the Mac app: Animetro.swift, Info.plist, icon, build.sh, dev.sh, selftest.sh
tests/          node:test unit tests per module, plus structure checks
.github/        CI, release workflow, Dependabot, issue and pull request templates
```

| Command | What it does |
|---|---|
| `npm start` | Serve `web/` at http://localhost:5180 |
| `npm test` | Run all tests |
| `npm run lint` | ESLint (`npm install` first; dev tools only) |
| `npm run build:mac` | Build `build/Animetro.app` |
| `npm run dev:mac` | Run the Mac app against `web/` (edit, then ⌘R) |
| `./macos/selftest.sh` | Launch the built app and check it renders |

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, [SECURITY.md](SECURITY.md) for reporting problems and what's stored, and [CHANGELOG.md](CHANGELOG.md) for what changed.

## What's inside

| Page | What it does |
|---|---|
| **Home** (`index.html`) | Your platform: everything you're watching, split into **Ready to watch** (episodes left, "Last episode!", minutes to go) and **Waiting at the platform** (caught up, live countdown to the next episode), with +1 buttons. **Got some time?** fills 30 minutes to a 7-hour flight from your Watching and Planning lists, finishing shows first. |
| **Discover** (`search.html`) | Search by English or Japanese title, browse mood "lines" (Heartbreak, Cozy, Hype…), see trending shows and the next episodes airing. |
| **History** (`history.html`) | Your watch history from AniList's activity feed: episodes and time watched this week, your daily streak, a 6-month ride calendar (brighter squares = more logged), and a day-by-day timeline you can filter (episodes, completions, plans and drops). Older entries load as you scroll. |
| **My map** (`map.html`) | Your personal metro map: every franchise you've touched is a line, every season, movie and OVA a station, filled in as you ride them (with the next unwatched stop included). Lines are grouped into studio districts; single-entry franchises sit under One-stop lines. The same **Express / Rapid / Local** toggle as the line map hides the extras most people skip, and the ridden and end-to-end counts follow it. |
| **Line map** (`line.html`) | Watch order for a franchise. **Share card** saves the line as an image. Switch between release order and story order (prequels first). Three services: **Express** (main story only), **Rapid** (the default: main story plus the extras most fans watch) and **Local** (every stop, with skippable ones labelled). AniList has no "canon" flag, so skippable stops are read from the crowd: a side story, movie or special that only a few % of the main show's audience has on their list, recaps, chibi shorts, and extras of 15 minutes or less. Movies linked as sequels but almost nobody watched are flagged as probable compilations. Anything out for less than 6 months isn't judged yet. Spin-offs show up as transfers. Filler episodes inside a series aren't detected. A planner works out the total ride time and the date you'll finish at N episodes a day. When your AniList is connected, it marks what you've watched, shows "You are here", and can add every unwatched entry to Planning in one click. |
| **Anime** (`anime.html`) | Details, a "vibe check" from tag strength (spoiler tags hidden), score spread, rankings, cast with voice actors, trailer, recommendations, and list controls (status, +1 episode). **Will you finish it?** estimates your chance of finishing the show from your own history (shows you left untouched for 3+ months count as quietly dropped), with the reasons. **Where to watch** lists official streams from AniList, then the free sites [everythingmoe.com](https://everythingmoe.com/) ranks highest (hentai sites for 18+ titles). Most links search that site for the show; the rest open the site and copy the title for you to paste. The site list lives in `js/streams.js`. These sites change domains often, so update it from everythingmoe when links stop working. |
| **Explore** (`explore.html`) | Filter by genres, tags, format, season, year, minimum score, and **ticket class**: Everyone, Teen, Mature, or 18+ only. AniList has no official age rating, so Everyone and Teen are estimated from genres and tags. **New to me** hides anything you've watched, are watching or dropped. Filters live in the URL, so a search can be shared as a link. |
| **For you** (`foryou.html`) | Suggestions from your watched list: **Next stops** (sequels to shows you finished but never started), **Your taste line** and **Hidden gems** (shows matching the tags you score highest, with a match %), what fans of your favourites loved, and your Planning list sorted by how well each show fits you. |
| **Departures** (`departures.html`) | An LED-style board of this week's episodes with live countdowns, in your local time. |
| **Gacha** (`gacha.html`) | A capsule machine that pulls random anime. Rarity rewards hidden gems: **SSR** means a high score but low popularity. Can pull only shows that are new to you. |
| **My pass** (`pass.html`) | Your stats as a transit card (**Share my pass** saves it as an image), an "anime personality", a **rider rank** (ride points earn train tiers from Platform Ticket to Galaxy Express, with a progress bar to the next one), 16 **station stamps** to collect, a random pick from your Planning list, and +1 buttons for shows you're watching. |

### Departure chimes

Logging an episode plays a short two-note chime; finishing a show plays a little departure melody (an original tune, synthesised in the browser). Turn them off with **Chimes on/off** on the home page.

### Backup sync (off by default)

My pass › **Backup sync** turns it on. It copies your AniList list to other trackers as a backup next to MAL-Sync. It only runs when you press the button, and it shows what would change before sending anything. It never changes AniList and never removes anything from the other tracker.

- **Simkl** (free): create an app at https://simkl.com/settings/developer (type *TV, devices & command line*), paste its client ID on the Sync page, then approve the short code Simkl shows. Statuses, episode progress and scores (if you score) are matched by AniList ID. Simkl allows one write a second, so a first sync of ~600 titles takes about 15 seconds.
- **MyAnimeList**: not yet. MAL blocks web pages from its API, so it needs native code in the Mac app, planned for a later version.
- **Bingers**: its API is a paid feature, so the Sync page explains the free route: Simkl's JSON backup, uploaded at https://bingers.app/import.

Turning backup sync off forgets the Simkl connection and client ID.

### 18+ titles

Hentai and other titles AniList marks as adult are hidden everywhere by default. The **18+** button in the header turns them on (you confirm you're 18 or older). Once it's on, you get the **18+ only** ticket and the **Hentai** genre in Explore and Gacha, adult tags, a **Last train** line on the home page, and 18+ results in search and watch-order maps. Covers of 18+ titles stay blurred until you hover over them; you can switch that off in the same dialog.

### Ride points

| Points for | How many |
|---|---|
| Time watched | 1 per 20 minutes |
| Each completed title | 20 |
| Each genre with 3+ titles | 25 |
| Each station stamp | 150 |

Tiers: Platform Ticket 0, Local 300, Rapid 1,500, Express 4,000, Limited Express 8,000, Shinkansen 15,000, Maglev 30,000, Galaxy Express 60,000.

## Connecting AniList

There are two ways to connect, both on the **My pass** page:

- **Username (read only):** type any public AniList username. No setup needed.
- **Log in (can edit your lists):** AniList needs a client ID from you once.
  1. Go to https://anilist.co/settings/developer → *Create new client*.
  2. Set the redirect URL to `http://localhost:5180/pass.html` for the browser (match the port you serve on), or `animetro://auth` for the Mac app. A client has one redirect URL, so use two clients if you use both.
  3. Paste the client ID on the My pass page and log in.

## What's stored

Everything is fetched live from AniList. The browser keeps only your login token or username and client ID, your 18+ and blur settings, and, if you turn on backup sync, your Simkl client ID and login (`localStorage`), plus, for the current tab only (`sessionStorage`), a copy of your profile and AniList answers from the last 5 minutes, so going back and forth between pages doesn't re-ask AniList. Closing the tab clears that. **Disconnect** on My pass signs you out of AniList; turning backup sync off forgets the Simkl connection and client ID. Your AniList client ID and the 18+, blur and chime settings stay until you clear the site's data in your browser. The Mac app keeps its data in `~/Library/WebKit/local.animetro`, which deleting the app does not remove; to reset it, quit the app and delete that folder.

AniList currently allows 30 requests a minute. Animetro batches queries, reuses answers from the last 5 minutes, and reads AniList's "requests left" counter: when it gets low, it pauses until the minute resets instead of getting refused. If you ever see "Pausing…", that's why.

## How the Mac app works

`macos/Animetro.swift` is one Swift file: a window with a WebKit view that loads the same HTML, CSS and JavaScript from inside the app through an `animetro://` address, so there is no server and no port. AniList sends logins to `animetro://auth`, which the window catches. Links to other sites open in your browser. The app keeps its own login and settings, separate from your browser.

## Releases

Every push and pull request runs [CI](.github/workflows/ci.yml): lint, tests, a gitleaks secret scan over the whole history, and a macOS job that builds the app and launches it. Pushing a tag like `v1.2.0` runs the [release workflow](.github/workflows/release.yml): the full CI first, then it builds the universal app with that version, smoke-tests it, zips it and publishes a GitHub release with that version's CHANGELOG section as the notes.

## License

[MIT](LICENSE). Anime data comes from AniList and Simkl under their API terms; the streaming-site list and logos come from everythingmoe.com.
