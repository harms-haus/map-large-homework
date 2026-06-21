/**
 * Route dispatcher and rendering-lifecycle owner.
 *
 * `render` reads the current route, fetches the matching result from the API,
 * and delegates to `renderBrowse` / `renderSearch`. A monotonic token checked
 * after each `await` guards against render races: a slower, superseded fetch
 * cannot clobber fresher results.
 *
 * `init` is called once per `startApp` mount: it binds the DOM refs into the
 * shared context, registers `render` as the re-render hook (so action buttons
 * and uploads can trigger it without a circular import), tears down the
 * previous mount's hashchange listener, subscribes a new one, and kicks off
 * the initial render.
 */
import { getCurrentRoute, subscribe } from '../router.js';
import { normalizeRelativePath } from '../format.js';
import {
  getApi,
  getResults,
  setMenuState,
  setRefs,
  setRenderHook,
  type DomRefs,
} from './context.js';
import { createMenuState } from './menus.js';
import { renderBrowse } from './render-browse.js';
import { renderSearch } from './render-search.js';

/** Threshold (ms) below which a search spinner is not shown. */
const SPINNER_DELAY_MS = 500;

// `unsubscribe` tears down the current mount's hashchange listener so a
// re-mount never leaves the old listener on `window`.
// `renderToken` is incremented at the start of every `render()`; each in-flight
// render captures its token and bails out after each `await` if a newer render
// has started.
let unsubscribe: (() => void) | null = null;
let renderToken = 0;

export function init(refs: DomRefs): void {
  setRefs(refs);
  setMenuState(createMenuState());
  setRenderHook(render);
  if (unsubscribe !== null) {
    unsubscribe();
    unsubscribe = null;
  }
  unsubscribe = subscribe(render);
  render();
}

/**
 * Route dispatcher. Clears the results container synchronously so a
 * pending/failed fetch leaves no stale table, but does NOT clear the
 * breadcrumb or status here: clearing those synchronously would remove
 * in-page navigation targets mid-click — `navigate()` dispatches `hashchange`
 * synchronously in happy-dom, which would re-enter `render` and wipe the
 * breadcrumb before the click's caller can read the next segment. They are
 * refreshed by `renderBrowse`/`renderSearch` once data arrives.
 */
export async function render(): Promise<void> {
  // Claim this render slot. After each `await` we bail out if superseded so a
  // slower fetch can never overwrite the freshest results.
  const myToken = ++renderToken;
  const route = getCurrentRoute();
  const resultsEl = getResults();
  resultsEl.innerHTML = '';

  // A search fetch shows a spinner only if still in flight after 500ms, so
  // fast searches never flash a loading indicator. The timer is cleared on
  // every exit path, and its callback also bails if superseded.
  let spinnerTimer: ReturnType<typeof setTimeout> | null = null;
  const clearSpinnerTimer = (): void => {
    if (spinnerTimer !== null) {
      clearTimeout(spinnerTimer);
      spinnerTimer = null;
    }
  };
  if (route.view === 'search') {
    spinnerTimer = setTimeout(() => {
      spinnerTimer = null;
      if (myToken !== renderToken) return;
      const spinnerWrap = document.createElement('div');
      spinnerWrap.className = 'search-spinner';
      const spinnerIcon = document.createElement('i');
      spinnerIcon.className = 'bi bi-arrow-repeat spinning';
      spinnerWrap.appendChild(spinnerIcon);
      resultsEl.appendChild(spinnerWrap);
    }, SPINNER_DELAY_MS);
  }
  try {
    if (route.view === 'browse') {
      const result = await getApi().browse(normalizeRelativePath(route.path));
      clearSpinnerTimer();
      if (myToken !== renderToken) return;
      renderBrowse(result);
    } else {
      const result = await getApi().search(route.query, normalizeRelativePath(route.path));
      clearSpinnerTimer();
      if (myToken !== renderToken) return;
      renderSearch(result);
    }
  } catch (err) {
    clearSpinnerTimer();
    if (myToken !== renderToken) return;
    const message = err instanceof Error ? err.message : String(err);
    // textContent replaces all children, so any stale table is removed too.
    resultsEl.textContent = 'Error: ' + message;
  }
}
