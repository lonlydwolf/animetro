// Keeping keyboard focus through a save that ends in a full redraw (Home's +1 and Mark completed).
// The document and the redrawn region come in as arguments, so tests/focus.test.mjs drives it with a stand-in DOM.

// Call before disabling `button` for the save. Disabling a focused button drops focus to <body> (Chrome), so that
// alone doesn't count as leaving; focusing or clicking anything during the save does.
export function holdFocus(doc, region, button) {
  const had = doc.activeElement === button;
  let moved = false;
  const watch = new AbortController();
  for (const type of ['focusin', 'pointerdown']) doc.addEventListener(type, () => (moved = true), { capture: true, signal: watch.signal });
  return {
    drop: () => watch.abort(), // the redraw won't happen (the card is leaving)
    // Just before the redraw: where focus should go after it, as selectors to try in order ([] = leave focus alone).
    //   keyOf(el): a selector that finds el's equivalent after the redraw; mine: selectors for the clicked control,
    //   best first. Focus still on the button (or dropped by disabling it) goes back to it; focus you moved to another
    //   control in the region comes back to that control; focus you moved outside the region stays where you put it.
    settle(keyOf, mine) {
      watch.abort();
      const f = doc.activeElement;
      if (f === button || (f === doc.body && had && !moved)) return mine;
      const key = region.contains(f) && f !== region ? keyOf(f) : null;
      return key ? [key] : [];
    },
  };
}

// After the redraw: focus the first of the selectors that matches in the region.
export const refocus = (region, selectors) => selectors.map(s => region.querySelector(s)).find(Boolean)?.focus();
