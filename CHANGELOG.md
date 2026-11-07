# Changelog

All notable changes to Animetro. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- Stamps are worth 75 ride points each (was 150), so the bigger set doesn't push everyone up a tier.
- My map's single-entry section is now called One-stop lines, so it isn't confused with the Local service.
- The repository is reorganised: the web app lives in `web/`, the Mac app in `macos/`, tests in `tests/`.
- Tests run on Node's built-in test runner, one file per module, plus structure checks for pages, imports and links.

### Added
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

[Unreleased]: https://github.com/lonlydwolf/animetro/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/lonlydwolf/animetro/compare/v0.5.0...v1.0.0
[0.5.0]: https://github.com/lonlydwolf/animetro/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/lonlydwolf/animetro/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/lonlydwolf/animetro/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/lonlydwolf/animetro/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/lonlydwolf/animetro/releases/tag/v0.1.0
