/**
 * Route dispatcher and rendering-lifecycle owner.
 *
 * `render` reads the current route, fetches the matching result from the API,
 * and delegates to `renderBrowse` / `renderSearch`. It guards against render
 * races (a slower, superseded fetch cannot clobber fresher results) via a
 * monotonic token checked after each `await`.
 *
 * `init` is called once per `startApp` mount: it binds the freshly-built DOM
 * refs into the shared context, registers `render` as the re-render hook (so
 * action buttons and uploads can trigger it without a circular import), tears
 * down any previous mount's hashchange listener, subscribes a new one, and
 * kicks off the initial render.
 */
import { getCurrentRoute, subscribe } from '../router.js';
import { normalizeRelativePath } from '../format.js';
import { getApi, getResults, setRefs, setRenderHook, type DomRefs } from './context.js';
import { renderBrowse } from './render-browse.js';
import { renderSearch } from './render-search.js';

/* -------------------------------------------------------------------------
 * Rendering-lifecycle state
 *
 * `unsubscribe` holds the teardown for the CURRENT mount's hashchange listener.
 * `init` clears any previous listener before subscribing a new one, so a
 * re-mount never leaves the old listener on `window` (memory leak fix).
 *
 * `renderToken` is a monotonic counter incremented at the start of every
 * `render()`. Each in-flight render captures its token and, after each `await`,
 * bails out if a newer render has started — preventing a slower, superseded
 * fetch from clobbering the freshest results (render-race fix).
 * ---------------------------------------------------------------------- */
let unsubscribe: (() => void) | null = null;
let renderToken = 0;

/**
 * Bind the freshly-built DOM refs into the shared context, register `render`
 * as the re-render hook, tear down any previous mount's hashchange listener,
 * subscribe a new one, and kick off the initial render.
 */
export function init(refs: DomRefs): void {
  setRefs(refs);
  setRenderHook(render);
  // Tear down the previous mount's listener first (if any) so re-mounts never
  // accumulate hashchange listeners on `window`.
  if (unsubscribe !== null) {
    unsubscribe();
    unsubscribe = null;
  }
  unsubscribe = subscribe(render);
  render();
}

/**
 * Route dispatcher.
 *
 * Clears the results container synchronously (so a pending/failed fetch never
 * leaves a stale table behind) but does NOT clear the breadcrumb or status
 * here. Clearing those synchronously would remove in-page navigation targets
 * in the middle of a click handler: `navigate()` dispatches `hashchange`
 * synchronously in happy-dom, which would re-enter `render` and wipe the
 * breadcrumb before the click's caller can read the next segment. The
 * breadcrumb/status are instead refreshed by `renderBrowse`/`renderSearch`
 * once data arrives.
 */
export async function render(): Promise<void> {
  // Claim this render slot. A newer render increments `renderToken` past
  // `myToken`; after each `await` we bail out if superseded so a slower fetch
  // can never overwrite the freshest results, breadcrumb, or status.
  const myToken = ++renderToken;
  const route = getCurrentRoute();
  const resultsEl = getResults();
  resultsEl.innerHTML = '';
  // Show a spinner in the results container while a search fetch is in flight.
  // For browse routes, no spinner is shown. The spinner is removed naturally:
  // `renderSearch(result)` clears the container before building the table, and
  // the error handler's `textContent` assignment replaces all content.
  if (route.view === 'search') {
    const spinnerWrap = document.createElement('div');
    spinnerWrap.className = 'search-spinner';
    const spinnerIcon = document.createElement('i');
    spinnerIcon.className = 'bi bi-arrow-repeat spinning';
    spinnerWrap.appendChild(spinnerIcon);
    resultsEl.appendChild(spinnerWrap);
  }
  try {
    if (route.view === 'browse') {
      const result = await getApi().browse(normalizeRelativePath(route.path));
      if (myToken !== renderToken) return;
      renderBrowse(result);
    } else {
      const result = await getApi().search(route.query, normalizeRelativePath(route.path));
      if (myToken !== renderToken) return;
      renderSearch(result);
    }
  } catch (err) {
    // A superseded render must not even commit its error.
    if (myToken !== renderToken) return;
    // textContent replaces all children, so any stale table is removed too.
    resultsEl.textContent =
      err instanceof Error ? 'Error: ' + err.message : 'Error: ' + String(err);
  }
}
