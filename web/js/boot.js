// Runs in <head> before the page paints, so the saved livery and light/dark mode show from the first frame.
// Not a module on purpose: modules wait for the page to load. Mode follows the system until you pick one.
(function (d) {
  var get = function (k) { try { return localStorage.getItem(k); } catch { return null; } };
  d.dataset.theme = get('animetro.theme') || 'last-train';
  d.dataset.mode = get('animetro.mode') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  if (location.protocol === 'animetro:') d.dataset.app = ''; // the Mac app: its window buttons sit over the header
})(document.documentElement);
