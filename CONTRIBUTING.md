# Contributing

Thanks for wanting to help. A few things worth knowing first.

**This project was written entirely by AI** (Claude Opus 5.5) at the repository owner's direction. Contributions from people are welcome; just know the code hasn't had a human review, so a careful eye is valuable.

## Setup

You need Node 20 or later. For the Mac app, Xcode or the Command Line Tools (`xcode-select --install`).

```sh
git clone https://github.com/lonlydwolf/animetro.git
cd animetro
npm install        # dev tools only (ESLint); the app itself has no dependencies
npm start          # serves web/ at http://localhost:5180
```

Mac app: `./macos/dev.sh` runs it against the files in `web/`, so edits only need ⌘R in the app. Right-click › Inspect Element opens Safari's Web Inspector.

## Before you open a pull request

```sh
npm run lint
npm test
./macos/build.sh && ./macos/selftest.sh   # only if you touched the Mac app
```

CI runs the same checks, plus a secret scan.

- Keep the stack plain: HTML, CSS and ES modules in `web/`, no framework and no build step. A runtime dependency needs a strong reason.
- Logic without DOM or network access lives in its own module (`order.js`, `score.js`, `fit.js`, …) and gets a test in `tests/`.
- Never commit API keys, client IDs or tokens. Users paste their own; they stay in their browser.

## Commits

One change per commit, with a [Conventional Commits](https://www.conventionalcommits.org/) subject (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `refactor:`, `build:`, `chore:`) and a body that says what changed and why.

## Releases

Add the version's notes to `CHANGELOG.md`, update `version` in `package.json`, then tag: `git tag v1.2.0 && git push origin v1.2.0`. The release workflow runs CI, builds the Mac app and publishes it with that CHANGELOG section as the notes.
