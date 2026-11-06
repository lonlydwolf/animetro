# Animetro

Type an anime name in English and get its whole franchise (seasons, movies, OVAs, recaps) laid out as a train line in watch order, with live data from the [AniList API](https://docs.anilist.co).

## Run it

```sh
cd animetro
python3 -m http.server 5180
```

Open http://localhost:5180. It has no build step and no dependencies. Any static file server works, but it has to be a server, because ES modules won't load from `file://`.

Run the logic checks (watch-order sorting and search ranking) with Node 18+:

```sh
node test/check.mjs
```

## What's inside

| Page | What it does |
|---|---|
| **Search** (`index.html`) | Search by English or Japanese title, browse mood "lines" (Heartbreak, Cozy, Hype…), see trending shows and the next episodes airing. |
| **Line map** (`line.html`) | Watch order for a franchise. Switch between release order and story order (prequels first). **Express** shows only the main story. Recaps are marked as safe to skip, and spin-offs show up as transfers. A planner works out the total ride time and the date you'll finish at N episodes a day. When your AniList is connected, it marks what you've watched, shows "You are here", and can add every unwatched entry to Planning in one click. |
| **Anime** (`anime.html`) | Details, a "vibe check" from tag strength (spoiler tags hidden), score spread, rankings, cast with voice actors, trailer, where to stream, recommendations, and list controls (status, +1 episode). |
| **Explore** (`explore.html`) | Filter by genres, tags, format, season, year, minimum score, and **ticket class**: Everyone, Teen or Mature. AniList has no official age rating, so this is estimated from genres and tags. Filters live in the URL, so a search can be shared as a link. |
| **Departures** (`departures.html`) | An LED-style board of this week's episodes with live countdowns, in your local time. |
| **Gacha** (`gacha.html`) | A capsule machine that pulls random anime. Rarity rewards hidden gems: **SSR** means a high score but low popularity. |
| **My pass** (`pass.html`) | Your stats as a transit card, an "anime personality", picks based on your highest-rated shows, a random pick from your Planning list, and +1 buttons for shows you're watching. |

## Connecting AniList

There are two ways to connect, both on the **My pass** page:

- **Username (read only):** type any public AniList username. No setup needed.
- **Log in (can edit your lists):** AniList needs a client ID from you once.
  1. Go to https://anilist.co/settings/developer → *Create new client*.
  2. Set the redirect URL to `http://localhost:5180/pass.html` (match the port you serve on).
  3. Paste the client ID on the My pass page and log in.

## What's stored

Everything is fetched live from AniList. The browser keeps only your login token or username and client ID (`localStorage`), plus a copy of your profile for the current tab (`sessionStorage`) so each page doesn't need an extra request. **Disconnect** clears it.

AniList currently allows about 30 requests a minute. Animetro batches queries to stay under that, and if it gets throttled it waits and retries on its own.
