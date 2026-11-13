// When Home should ask AniList again: after you come back from being away a while, and when a countdown on the page
// reaches zero (the episode is out, so the show moves from waiting to ready). Pure: callers pass the clock in ms and
// countdown times in AniList's seconds, so tests/refresh.test.mjs runs it.
export const AWAY = 60e3, GAP = 60e3, RETRIES = 5;

export function refresher({ away = AWAY, gap = GAP, retries = RETRIES } = {}) {
  let hiddenAt = null, last = -Infinity;
  const tried = new Map(); // airingAt -> refreshes started since it passed (AniList can take a while to move on)
  const past = (ats, now) => ats.filter(at => at * 1000 <= now);
  return {
    // the window was hidden or lost focus; the earliest moment counts
    hide(now) { hiddenAt ??= now; },
    // the window is back: true when it was away longer than `away`
    show(now) { const t = hiddenAt; hiddenAt = null; return t != null && now - t > away; },
    // a countdown has reached zero, and that one hasn't already triggered `retries` refreshes
    due(ats, now) { return past(ats, now).some(at => (tried.get(at) || 0) < retries); },
    // may a refresh start now? At most one per `gap`. Starting one counts against the countdowns that are due.
    start(now, ats = []) {
      if (now - last < gap) return false;
      last = now;
      for (const at of past(ats, now)) tried.set(at, (tried.get(at) || 0) + 1);
      return true;
    },
  };
}

// The refresh itself, with the page's parts passed in so tests/refresh.test.mjs can drive it:
//   load(): fresh data; show(d): put it on the page; saves(): +1 saves started so far; busy(): not now (a save in
//   flight, a card leaving, nobody signed in); editing(): you're typing in a field on the page; ats(): countdown
//   times on the page; now(): the clock.
// Nothing starts while you're busy or typing (it waits, and tick() starts it once allowed). Data that arrives after
// a +1 started is dropped and asked for again. Data that arrives while you're typing waits until you're done
// (settle(), on blur or change); the latest arrival wins.
export function refreshes({ load, show, saves, busy, editing, ats = () => [], now = () => Date.now(), policy = refresher() }) {
  let want = false, running = false, held = null;
  const stale = started => saves() !== started || busy();
  async function request() {
    if (running) return; // the one on its way covers this
    want = true;
    if (busy() || editing() || !policy.start(now(), ats())) return;
    want = false;
    running = true;
    const started = saves();
    try {
      const d = await load();
      if (stale(started)) want = true;
      else if (editing()) held = { d, started };
      else { held = null; show(d); }
    } catch { /* keep what's shown; the next return or countdown tries again */ } finally { running = false; }
  }
  return {
    request,
    settle() {
      if (!held || editing()) return;
      const { d, started } = held;
      held = null;
      if (stale(started)) want = true;
      else { want = false; show(d); }
    },
    tick() { if (want || policy.due(ats(), now())) request(); }, // every second while the page is visible
    hide() { policy.hide(now()); }, // the window was hidden or lost focus
    back() { if (policy.show(now())) request(); }, // and it's back
  };
}
