# Changelog

All notable changes to Animetro. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.2.0] - 2026-11-14

### Added
- Mac app: one-click login. **Log in with AniList** on My pass uses Animetro's own AniList client, so there's no client ID to create or paste. The web version still uses a client ID of your own. The Mac self-test checks that the button heads for AniList with that client.
- Mac app: a View menu with Zoom In (⌘+), Zoom Out (⌘−) and Actual Size (⌘0). The zoom level is remembered.
- Mac app: if WebKit's page process crashes, the page reloads itself instead of staying blank (Home after a second crash, then a Try Again / Quit sheet).
- Home refreshes itself when you come back after a minute or more, or when a countdown reaches zero, so a new episode shows up without a reload.
- `./macos/test.sh`: unit tests for the Mac app's picture route, run in CI. The Mac self-test now fails unless every check it reports passes, including reaching AniList and drawing a share-card picture.

### Changed
- Show pages load faster: the show, your list entry, Kitsu's episodes and AniList's streaming episodes are fetched side by side, and the Kitsu lookup happens once per show.
- Saving a list change keeps cached public answers (watch-order lines, show pages), so the next page doesn't fetch them again.
- AniList rate limits cause one pause, as long as AniList asks for, instead of two stacked ones. The pause notice no longer names a fixed limit.
- Between 900 and 1380 pixels wide, the header moves its links to a second row instead of squeezing the search box and pushing My pass off screen. Long usernames are shortened with an ellipsis.
- `npm start` only serves to this computer (127.0.0.1).

### Security
- Every page has a Content-Security-Policy: scripts only from Animetro itself (no inline scripts, no eval), connections only to AniList, Kitsu and Simkl, pictures only from AniList's, Kitsu's, Crunchyroll's and YouTube's image servers.
- Ranking descriptions on show pages are escaped, and YouTube trailer IDs are checked before they go into a link.
- Your profile in each tab is tied to the login it was fetched for. If another tab logs out or switches account, the tab reloads, and nothing is saved under an account the page wasn't showing.
- Mac app: only Animetro's own page can send messages to the app (not AniList's login page or any frame), and every message is checked.
- Mac app: links open outside the app only if they're https, http or mailto. AniList loads inside the app only over https.
- Mac app: the share-card picture route serves only raster images (no SVG), up to 25 MiB, and stops the download as soon as it's over.
- Mac app: the Web Inspector is only on when running from `./macos/dev.sh`.

### Fixed
- Offline or with AniList down, pages say AniList couldn't be reached instead of looking logged out. An unknown username says so and links to My pass to change it.
- List changes are checked against AniList at the moment you click. + Planning (watch-order lines, gacha), +1 (Home, My pass) and status changes on a show's page no longer undo what you did elsewhere since the page loaded, such as lowering your progress or moving a Completed show back to Planning. Each change is sent once, one at a time.
- Gacha shows a pulled show's list status instead of always offering + Planning.
- If your list can't be read, show and watch-order pages go read-only and say so, instead of offering to add shows that may already be on it.
- Home: an airing show with no schedule or episode count on AniList no longer counts as fully watched, the last +1 can't be sent twice, and keyboard focus stays on +1 after saving.
- My pass: each show's +1 waits for the previous one, and the card shows the progress AniList saved.
- History: if an older page fails to load, Load older can try again and your timeline stays.
- Explore: a failed Load more keeps your results and asks for the same page again; answers for old filters are dropped.
- Search: Enter searches what you typed, never a suggestion left over from your previous text.
- Departures: switching days quickly can't show an earlier day's trains under the new day.
- Backup sync: Check works again after a preview with nothing to send, a Simkl rate limit or brief error no longer disconnects you, cancelling a Simkl login stops it, and two tabs take turns writing to Simkl.
- Watch-order lines stop at exactly 120 stops, and the empty-state note names the Local toggle.
- Map Rewind counts shows with no start or finish date, using when you last updated them.
- No sideways scrolling on narrow phones on My pass, Gacha, Backup sync and Rapid rating (mostly in Safari and the Mac app), and the "New to me" toggles stay hidden when they should be.

## [1.1.0] - 2026-11-07

### Added
- Rapid rating (Rate in the menu): score every show you've finished but never rated, one keypress each. Shows leave the queue as soon as they're rated; skip, undo, and buttons that follow your AniList score format.

### Fixed
- Share cards in the Mac app have their pictures again (the banner, cover and avatar). AniList's image server refuses the app's `animetro://` origin, so the app now fetches card pictures itself.

## [1.0.1] - 2026-11-07

### Changed
- Stamps are worth 75 ride points each (was 150), so the bigger set doesn't push everyone up a tier.
- My map's single-entry section is now called One-stop lines, so it isn't confused with the Local service.
- The repository is reorganised: the web app lives in `web/`, the Mac app in `macos/`, tests in `tests/`.
- Tests run on Node's built-in test runner, one file per module, plus structure checks for pages, imports and links.

### Added
- Map Rewind: slide My map back to any year, or play it forward, to watch your network grow.
- Junction Box: spin-offs and other versions branch off the watch-order line at the stop they connect to, instead of sitting in a sidebar list.
- Welcome Back Carriage: a recap when you return to a show (where you stopped, the last two episodes' summaries, who's who, the next stop). Automatic for paused shows; opt in from the home page for shows you're watching. Home lists paused shows.
- Hovering or tapping a rider tier shows a short description and how many points it is away.
- 21 more station stamps (37 in all), from ten thousand episodes to donghua, music videos and a favourite voice actor. Uncollected stamps show your progress; hovering or tapping a collected one shows how you earned it.
- Your pass card (and its share image) shows your AniList profile banner, faded toward your profile color.
- Liveries (themes): 20 of them, anime, Catppuccin and editor classics, each with a dark and a light mode. Pick one on My pass; switch light and dark from the button at the top of any page (it follows your system until you do). The Mac app's window matches.
- An Episodes tab on each anime page: every episode's title, Japanese title, air date, length, summary and picture (from Kitsu), as a List or as Icons, with watched, next up and upcoming marks, Crunchyroll links, and Watched up to here to set your progress.
- My map has the Express / Rapid / Local toggle from the line map; its counts follow the chosen service, and it's kept in the address.
- Install and update with Homebrew: `brew install --cask lonlydwolf/tap/animetro`.
- ESLint, a gitleaks secret scan, Dependabot, and a smoke test that launches the built Mac app in CI.
- Releases are only built after the full CI passes.
- CONTRIBUTING, SECURITY, issue and pull request templates, `.editorconfig`.

### Security
- Values from AniList are escaped and validated before they go into the page (only plain https addresses and hex colors; genre names, profile colors and share-card file names included), closing script-injection paths that could read stored logins.
- AniList logins are only accepted if the app started them (OAuth `state`), so a crafted link can't swap in another account.
- CI scans the whole git history for secrets, not just the commits in each push.

### Fixed
- Home: a +1 clicked while the page redraws can't log the same episode twice, and the Recaps and Chimes toggles stay visible when every show is waiting for new episodes.
- Episodes tab: on an airing show with no schedule on AniList, only episodes with a past air date can be marked watched.
- Need a recap? from the Episodes tab switches to Overview and shows the recap.
- Map Rewind starts at your earliest start date, and announced sequels without a year stay under construction in every year.
- Junctions follow the order on screen when the stop they leave from is hidden.
- Episodes tab: episodes that haven't aired (including every episode of an unreleased show) can't be marked watched, so they can't complete a show early; the same limit applies to +1.
- Episodes tab: quick clicks save one at a time, so older progress can't overwrite newer progress, and a slow range load can't replace the range you picked.
- Episodes tab: after watching exactly 100 of 100 episodes the tab opens on 1-100 instead of an empty page.
- Mac app: the logo no longer runs into the window's close, minimize and full-screen buttons, and the window title no longer draws over the header.
- The next tier's name on My pass is readable in light mode.
- Share cards no longer leave out avatars and banners that the page had already shown.
- Status tags, summaries, map stations and page banners no longer use colors that only worked on the dark background.
- Saving several list entries at once no longer reports success when only some were saved.
- Catching up with an airing show no longer marks it Completed; only reaching the known final episode does.
- A title without a cover no longer breaks its page, and shows a proper blank image.
- Tonight's ride no longer calls your Planning list empty when a random page held only hidden 18+ titles.
- 18+ titles on your own lists stay hidden on Home, My pass and My map while 18+ is off.
- Gacha counts its pool exactly, so every matching show can be pulled.
- Clearing the search box no longer brings back stale suggestions.
- The Mac app smoke test fails when the page didn't actually load.
- The README and SECURITY.md now say exactly what Disconnect clears and how to reset the Mac app's data.

## [1.0.0] - 2026-11-06

### Added
- macOS app: a native window around the web app with no server, universal (Apple Silicon and Intel), with a dev mode (`macos/dev.sh`), Web Inspector, and a native Save dialog for share cards.
- Release workflow that builds and publishes the app when a version tag is pushed.
- The web app knows when it runs inside the Mac app: AniList login through `animetro://auth`, shareable AniList links, trailers that open YouTube.
- MIT license and a notice that the project was created entirely by AI.

## [0.5.0] - 2026-11-06

### Added
- Home page with what you're watching, episodes left, countdowns and "Got some time?".
- My map: every franchise you've touched as a metro line, grouped by studio.
- Watch history with a streak, a 6-month calendar and a daily timeline.
- "Will you finish it?" estimates on details pages.
- Express, Rapid and Local services that label the extras most fans skip.
- Share cards for line maps and My pass, and departure chimes.

## [0.4.0] - 2026-11-06

### Added
- Opt-in, one-way backup sync from AniList to Simkl, with a preview before sending.

## [0.3.0] - 2026-11-06

### Added
- Where to watch: official streams plus the free sites everythingmoe.com ranks highest, with logos and search links.

## [0.2.0] - 2026-11-06

### Added
- 18+ mode, the New to me filter, the For you page, rider ranks and station stamps.
- Rate-limit pacing and a 5-minute per-tab cache for AniList requests.

## [0.1.0] - 2026-11-06

### Added
- First version: franchise watch orders as train lines, search, details, Explore, Departures, Gacha and My pass.

[Unreleased]: https://github.com/lonlydwolf/animetro/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/lonlydwolf/animetro/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/lonlydwolf/animetro/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/lonlydwolf/animetro/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/lonlydwolf/animetro/compare/v0.5.0...v1.0.0
[0.5.0]: https://github.com/lonlydwolf/animetro/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/lonlydwolf/animetro/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/lonlydwolf/animetro/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/lonlydwolf/animetro/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/lonlydwolf/animetro/releases/tag/v0.1.0
