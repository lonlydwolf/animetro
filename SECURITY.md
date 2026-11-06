# Security

## Reporting a problem

Please report security issues privately through GitHub: **Security › Report a vulnerability** on this repository. Don't open a public issue for them. You'll get a reply as soon as the owner sees it.

## What Animetro stores

Animetro has no server and no analytics. Everything is fetched live from AniList (and Simkl, if you turn backup sync on), straight from your browser or the Mac app.

On your device only:
- your AniList login token or username, and the AniList client ID you entered
- your Simkl client ID and login, only if you turned on backup sync
- your 18+, blur and chime settings
- for the current tab only: your profile and AniList answers from the last 5 minutes

**Disconnect** on My pass clears your login; turning backup sync off forgets Simkl. Nothing in this repository contains anyone's keys or tokens, and CI scans every push for leaked secrets.
