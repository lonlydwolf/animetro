# Security

## Reporting a problem

Please report security issues privately through GitHub: **Security › Report a vulnerability** on this repository. Don't open a public issue for them. You'll get a reply as soon as the owner sees it.

## What Animetro stores

Animetro has no server and no analytics. Everything is fetched live from AniList (and Simkl, if you turn backup sync on), straight from your browser or the Mac app.

On your device only:
- your AniList login token or username, and in a browser the AniList client ID you entered (the Mac app uses Animetro's own)
- your Simkl client ID and login, only if you turned on backup sync
- your settings: 18+, blur, chimes, recaps, livery, light or dark, episode view
- for the current tab only: your profile and AniList answers from the last 5 minutes

In a browser this is the site's local storage; the Mac app keeps it in `~/Library/WebKit/local.animetro` (quit the app and delete that folder to reset it). The Mac app also remembers its window colors and page zoom in its preferences.

**Disconnect** on My pass clears your login, but only on this device: Animetro doesn't cancel the token with AniList, so it stays valid until it expires (AniList tokens last a year). To cancel it, revoke Animetro in AniList under **Settings › Apps**. Turning backup sync off likewise only forgets Simkl here.

Nothing in this repository contains anyone's keys or tokens. The one ID it does contain is the Mac app's AniList client ID (56211), which is public by design: AniList's implicit-grant login, which Animetro uses, has no client secret, and none exists in this repository or the app. CI scans the whole git history for leaked secrets on every push to `main` and every pull request.

## How your login is protected

- Your AniList token is only sent to AniList, and only with requests about you (your lists, stats and saves). Public lookups go without it.
- A login is only accepted if Animetro started it (OAuth `state`), so a crafted link can't sign you in as someone else.
- Logins use AniList's implicit grant (`response_type=token`), so no client secret is involved. In the Mac app AniList sends the token to `animetro://auth`, the address Animetro's client is registered with, which the app's window catches and hands straight to My pass; the token is then removed from the page's address.
- Each tab's copy of your profile is tied to the login it was fetched for. If another tab logs out or switches account, the tab reloads, and a change isn't saved under an account the page wasn't showing.
- Status and episode changes, + Planning and +1 are checked against AniList at the moment you click and saved only if the entry is still what the page showed, so a page left open can't undo changes made elsewhere. Each is sent once, never retried on its own.
- Values from AniList are escaped and validated before they go into the page.

## Content-Security-Policy

Every page carries the same policy (in a `<meta>` tag, checked by the tests):
- scripts only from Animetro itself: no inline scripts, no `eval`
- connections only to AniList, Kitsu and Simkl
- pictures only from Animetro itself and AniList's, Kitsu's, Crunchyroll's and YouTube's image servers
- frames only for YouTube trailers; no plugins; forms only submit to Animetro

Inline `style` attributes are allowed, because the pages use them for per-show colors and sizes. A `<meta>` policy can't stop other sites from framing the page; a server hosting Animetro can add that as a header.

## Mac app

- Only Animetro's own page (the main frame at `animetro://app`) can send messages to the app. AniList's login page and frames can't, and every message's contents are checked.
- Links leave the app only if they're `https`, `http` or `mailto`; anything else is dropped. AniList loads inside the app only over https.
- Share cards get AniList pictures through the app's own picture route. It fetches only from AniList over https, passes on only raster images (PNG, JPEG, GIF, WebP, AVIF; never SVG), and stops any download over 25 MiB while it's still arriving.
- The Web Inspector is only available when the app runs from `./macos/dev.sh`, not in releases.
- Releases are signed ad hoc, not notarized. Each release has a SHA-256 checksum file for its zip.

## Development

`npm start` serves `web/` only to your own computer (127.0.0.1), not to the network. Open it as http://localhost:5180, which also matches the AniList redirect URL in the README.
