/**
 * Tests for the search-wrapper DOM restructuring and event rewiring that
 * `src/app.ts`'s `startApp` performs:
 *
 *   - The legacy "Search" `<button>` is removed entirely.
 *   - A `.search-wrapper` div wraps the search `<input>`, a leading search
 *     icon (`bi bi-search search-icon`), and a trailing clear button
 *     (`.clear-btn` containing a `bi bi-x-lg` icon).
 *   - The clear button is an icon-only `<button type="button">` carrying
 *     `aria-label="Clear search"`.
 *   - Child order inside the wrapper is exactly input → search-icon →
 *     clear-btn (the CSS visibility rule for the clear button uses the
 *     general sibling `~` combinator against the input's `:placeholder-shown`).
 *   - `input` events are debounced (200 ms) before triggering `doSearch`;
 *     each new keystroke resets the timer so only the final value searches.
 *   - `Enter` triggers search immediately (no debounce, no stopPropagation).
 *   - `Escape` clears the search AND calls `event.stopPropagation()` so an
 *     enclosing `<dialog>` is not dismissed by the native ESC-to-close
 *     behavior.
 *   - Clicking the clear button invokes `clearSearch`.
 *   - The `DomRefs` passed to `init()` are unchanged: exactly the 5 standard
 *     refs (`results`, `status`, `breadcrumb`, `searchInput`, `uploadInput`)
 *     — the wrapper and clear button are NOT added, because clear-button
 *     visibility is driven purely by CSS (`:placeholder-shown`).
 *
 * The shared `init` from `./render-orchestrator` is wrapped in a pass-through
 * spy (via `vi.mock`) so the DomRefs suite can assert on the exact argument
 * `startApp` passes. The spy delegates to the real `init`, so the app still
 * mounts and renders normally in every other suite here.
 *
 * Environment: the project-default `happy-dom` (these tests need a DOM).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { init } from './render-orchestrator';
import { toBrowseHash, toSearchHash } from '../router';
import { setup, flush, installAppTestLifecycle } from './test-helpers';

// Wrap `init` in a pass-through spy so the DomRefs suite can inspect the exact
// refs object startApp hands to init. The spy calls the real init, so the app
// still binds refs, subscribes hashchange, and kicks off the initial render.
vi.mock('./render-orchestrator', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./render-orchestrator')>();
  return { ...actual, init: vi.fn(actual.init) };
});

installAppTestLifecycle();

// Clear the init spy's call history before each test so call counts reflect
// only the current test's startApp mount. (mockClear, not mockReset: we must
// keep the delegation to the real init.)
beforeEach(() => {
  vi.mocked(init).mockClear();
});

/**
 * Build a fresh app and resolve the search-wrapper sub-elements directly from
 * the rendered DOM.
 *
 * `test-helpers.ts`'s `SetupCtx` now exposes `searchWrapper` /
 * `searchClearBtn` / `searchIcon` (the legacy standalone `searchBtn` field was
 * removed once the search button was dropped from the DOM). This local helper
 * keeps resolving those nodes plus the `.toolbar` handle per-test so the
 * assertions here stay coupled to the rendered DOM rather than to the shared
 * context's field set.
 */
function setupSearchWrapper(options: { hash?: string } = {}) {
  const ctx = setup(options);
  const toolbar = ctx.root.querySelector('.toolbar') as HTMLElement;
  const searchWrapper = ctx.root.querySelector('.search-wrapper') as HTMLElement;
  const searchIcon = searchWrapper.querySelector('.search-icon') as HTMLElement;
  const searchClearBtn = searchWrapper.querySelector('.clear-btn') as HTMLButtonElement;
  return { ...ctx, toolbar, searchWrapper, searchIcon, searchClearBtn };
}

/* ===========================================================================
 * Structure: the "Search" button is gone; a .search-wrapper holds the icons
 * ========================================================================= */
describe('startApp search area structure', () => {
  describe('the legacy "Search" button is removed', () => {
    it('renders no button whose trimmed text content is "Search"', () => {
      const { root } = setup();
      const searchButtons = Array.from(root.querySelectorAll('button')).filter(
        (b) => (b.textContent ?? '').trim() === 'Search',
      );
      expect(searchButtons).toHaveLength(0);
    });

    it('the toolbar has exactly one .btn element — the Upload label', () => {
      // The old search button carried the `btn` class; with it gone, the only
      // `.btn` left in the toolbar is the upload label.
      const { toolbar } = setupSearchWrapper();
      const btns = Array.from(toolbar.querySelectorAll('.btn'));
      expect(btns).toHaveLength(1);
      expect(btns[0].tagName).toBe('LABEL');
      expect((btns[0].textContent ?? '').trim()).toBe('Upload');
    });
  });

  describe('.search-wrapper', () => {
    it('creates a div.search-wrapper inside the toolbar', () => {
      const { toolbar, searchWrapper } = setupSearchWrapper();
      expect(searchWrapper).toBeTruthy();
      expect(searchWrapper.tagName).toBe('DIV');
      expect(searchWrapper.className).toBe('search-wrapper');
      expect(toolbar.contains(searchWrapper)).toBe(true);
    });

    it('places search-wrapper between the breadcrumb and the upload label', () => {
      const { toolbar } = setupSearchWrapper();
      const children = Array.from(toolbar.children);
      expect(children).toHaveLength(3);
      expect(children[0].className).toBe('breadcrumb');
      expect(children[1].className).toBe('search-wrapper');
      expect(children[2].className).toBe('btn'); // upload label
    });

    it('contains the search text input with the "Search..." placeholder', () => {
      const { searchWrapper, searchInput } = setupSearchWrapper();
      expect(searchInput).toBeTruthy();
      expect(searchInput.type).toBe('text');
      expect(searchInput.getAttribute('placeholder')).toBe('Search...');
      expect(searchWrapper.contains(searchInput)).toBe(true);
    });

    it('contains a search icon <i> with classes "bi bi-search search-icon"', () => {
      const { searchWrapper, searchIcon } = setupSearchWrapper();
      expect(searchIcon).toBeTruthy();
      expect(searchIcon.tagName).toBe('I');
      expect(searchIcon.className).toBe('bi bi-search search-icon');
      expect(searchWrapper.contains(searchIcon)).toBe(true);
    });

    it('contains a clear button.clear-btn of type button', () => {
      const { searchWrapper, searchClearBtn } = setupSearchWrapper();
      expect(searchClearBtn).toBeTruthy();
      expect(searchClearBtn.tagName).toBe('BUTTON');
      expect(searchClearBtn.className).toBe('clear-btn');
      expect(searchClearBtn.type).toBe('button');
      expect(searchWrapper.contains(searchClearBtn)).toBe(true);
    });

    it('the clear button carries aria-label="Clear search"', () => {
      // Icon-only button: it has no visible text, so the accessible name must
      // come from aria-label.
      const { searchClearBtn } = setupSearchWrapper();
      expect(searchClearBtn.getAttribute('aria-label')).toBe('Clear search');
    });

    it('the clear button is icon-only (empty trimmed text content)', () => {
      const { searchClearBtn } = setupSearchWrapper();
      expect((searchClearBtn.textContent ?? '').trim()).toBe('');
    });

    it('the clear button contains an <i> icon with classes "bi bi-x-lg"', () => {
      const { searchClearBtn } = setupSearchWrapper();
      const icon = searchClearBtn.querySelector('i');
      expect(icon).toBeTruthy();
      expect(icon?.className).toBe('bi bi-x-lg');
    });

    it('orders children exactly: input → search-icon → clear-btn', () => {
      // ORDER MATTERS: the CSS rule that shows/hides the clear button relies
      // on the general-sibling (~) combinator against the input's
      // :placeholder-shown state, so the input must precede the clear button.
      const { searchWrapper, searchInput, searchIcon, searchClearBtn } = setupSearchWrapper();
      const children = Array.from(searchWrapper.children);
      expect(children).toHaveLength(3);
      expect(children[0]).toBe(searchInput);
      expect(children[1]).toBe(searchIcon);
      expect(children[2]).toBe(searchClearBtn);
    });

    it('the clear button is the only button inside the wrapper', () => {
      const { searchWrapper } = setupSearchWrapper();
      const buttons = searchWrapper.querySelectorAll('button');
      expect(buttons).toHaveLength(1);
    });
  });
});

/* ===========================================================================
 * Event wiring: debounce, Enter, Escape, clear-button click
 * ========================================================================= */
describe('startApp search area events', () => {
  describe('debounced input listener (200 ms)', () => {
    // Fake timers are engaged AFTER the real-timer `await flush()` so the
    // initial render (started by setup → startApp → init → render) can settle
    // using real microtask/timer scheduling. The debounce timer is created
    // only when an `input` event is dispatched below, i.e. after the switch.
    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not search synchronously when the input changes', async () => {
      const { searchInput } = setupSearchWrapper({ hash: toBrowseHash('docs') });
      await flush();
      vi.useFakeTimers();

      searchInput.value = 'hello';
      searchInput.dispatchEvent(new Event('input'));

      // Synchronously after the input event: still browsing.
      expect(window.location.hash).toBe(toBrowseHash('docs'));
    });

    it('fires doSearch once 200 ms have elapsed since the last keystroke', async () => {
      const { searchInput } = setupSearchWrapper({ hash: toBrowseHash('docs') });
      await flush();
      vi.useFakeTimers();

      searchInput.value = 'hello';
      searchInput.dispatchEvent(new Event('input'));

      vi.advanceTimersByTime(199);
      expect(window.location.hash).toBe(toBrowseHash('docs')); // not yet

      vi.advanceTimersByTime(1); // 200 ms total
      expect(window.location.hash).toBe(toSearchHash('hello', 'docs'));
    });

    it('resets the debounce window on each keystroke (only the last value searches)', async () => {
      const { searchInput } = setupSearchWrapper({ hash: toBrowseHash('docs') });
      await flush();
      vi.useFakeTimers();

      searchInput.value = 'a';
      searchInput.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(150); // first timer has 50 ms left

      searchInput.value = 'ab';
      searchInput.dispatchEvent(new Event('input')); // cancels first, starts fresh
      vi.advanceTimersByTime(150); // 150 ms since last keystroke — still inside
      expect(window.location.hash).toBe(toBrowseHash('docs'));

      vi.advanceTimersByTime(50); // 200 ms since last keystroke
      expect(window.location.hash).toBe(toSearchHash('ab', 'docs'));
    });

    it('trims the query before navigating to the search hash', async () => {
      const { searchInput } = setupSearchWrapper({ hash: toBrowseHash('docs') });
      await flush();
      vi.useFakeTimers();

      searchInput.value = '   spaced   ';
      searchInput.dispatchEvent(new Event('input'));

      vi.advanceTimersByTime(200);
      expect(window.location.hash).toBe(toSearchHash('spaced', 'docs'));
    });

    it('a second debounce can fire after the first one completes', async () => {
      // Guards against a regression where the timer variable is not reset to
      // null after firing, which would block subsequent searches.
      const { searchInput } = setupSearchWrapper({ hash: toBrowseHash('docs') });
      await flush();
      vi.useFakeTimers();

      searchInput.value = 'a';
      searchInput.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(200); // first search fires
      expect(window.location.hash).toBe(toSearchHash('a', 'docs'));

      searchInput.value = 'ab';
      searchInput.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(199);
      expect(window.location.hash).toBe(toSearchHash('a', 'docs')); // not yet
      vi.advanceTimersByTime(1);
      expect(window.location.hash).toBe(toSearchHash('ab', 'docs'));
    });
  });

  describe('Enter key (immediate search, no debounce)', () => {
    it('triggers search immediately on Enter (no 200 ms wait)', async () => {
      const { searchInput } = setupSearchWrapper({ hash: toBrowseHash('docs') });
      await flush();

      searchInput.value = 'foo';
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(window.location.hash).toBe(toSearchHash('foo', 'docs'));
    });

    it('does not stop propagation on Enter', () => {
      // Only Escape stops propagation; Enter must not, so it cannot interfere
      // with any upstream keydown handling.
      const { searchInput } = setupSearchWrapper();
      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      const stopSpy = vi.spyOn(event, 'stopPropagation');

      searchInput.dispatchEvent(event);

      expect(stopSpy).not.toHaveBeenCalled();
    });
  });

  describe('Escape key (clear + stopPropagation)', () => {
    it('clears the search input value on Escape', () => {
      const { searchInput } = setupSearchWrapper({ hash: toSearchHash('foo', 'docs') });
      searchInput.value = 'foo';

      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(searchInput.value).toBe('');
    });

    it('navigates back to the browse view for the current path on Escape', () => {
      setupSearchWrapper({ hash: toSearchHash('foo', 'docs') });

      const searchInput = document.querySelector('.search-wrapper input[type="text"]')!;
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(window.location.hash).toBe(toBrowseHash('docs'));
    });

    it('stops propagation on Escape (so an enclosing dialog is not dismissed)', () => {
      // The search input may live inside a <dialog> (when the browser modal is
      // open). Without stopPropagation, the native dialog ESC-to-close behavior
      // would fire and dismiss the dialog. The handler must swallow the Escape
      // so it only clears the search.
      const { searchInput } = setupSearchWrapper();
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      const stopSpy = vi.spyOn(event, 'stopPropagation');

      searchInput.dispatchEvent(event);

      expect(stopSpy).toHaveBeenCalled();
    });

    it('clears before stopPropagation order does not matter (both effects occur)', () => {
      const { searchInput } = setupSearchWrapper({ hash: toSearchHash('bar', 'docs') });
      searchInput.value = 'bar';
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      vi.spyOn(event, 'stopPropagation');

      searchInput.dispatchEvent(event);

      expect(searchInput.value).toBe('');
      expect(window.location.hash).toBe(toBrowseHash('docs'));
    });
  });

  describe('clear button click', () => {
    it('clears the search input value when the clear button is clicked', () => {
      const { searchClearBtn, searchInput } = setupSearchWrapper({
        hash: toSearchHash('foo', 'docs'),
      });
      searchInput.value = 'foo';

      searchClearBtn.click();

      expect(searchInput.value).toBe('');
    });

    it('navigates back to the browse view for the current path on clear click', () => {
      const { searchClearBtn } = setupSearchWrapper({ hash: toSearchHash('foo', 'docs') });

      searchClearBtn.click();

      expect(window.location.hash).toBe(toBrowseHash('docs'));
    });
  });
});

/* ===========================================================================
 * DomRefs: init receives exactly the 5 standard refs
 *
 * The clear-button visibility is driven purely by CSS (:placeholder-shown on
 * the input), so startApp must NOT add searchWrapper or searchClearBtn to the
 * refs object it hands to init. Pinning the exact key set guards against a
 * regression that threads the new nodes through the shared context.
 * ========================================================================= */
describe('startApp search area: DomRefs unchanged', () => {
  it('passes exactly the 5 standard refs to init (no searchWrapper / clearBtn)', () => {
    const { searchInput, uploadInput, results, status, breadcrumb } = setupSearchWrapper();

    expect(init).toHaveBeenCalledTimes(1);
    const refs = vi.mocked(init).mock.calls[0][0];
    expect(Object.keys(refs).sort()).toEqual([
      'breadcrumb',
      'results',
      'searchInput',
      'status',
      'uploadInput',
    ]);
    // The refs point at the actual rendered nodes (not clones/duplicates).
    expect(refs.results).toBe(results);
    expect(refs.status).toBe(status);
    expect(refs.breadcrumb).toBe(breadcrumb);
    expect(refs.searchInput).toBe(searchInput);
    expect(refs.uploadInput).toBe(uploadInput);
  });

  it('does not attach a separate clear-button listener via the context (no getSearchClearBtn)', async () => {
    // The context module exposes getters only for the 5 standard refs. The
    // clear-button click handler is wired directly in startApp (imperative
    // addEventListener), not through a context ref — so importing the context
    // must not surface a clear-button getter. This is a structural guard: if a
    // future change adds the clear button to DomRefs, a matching getter would
    // appear here.
    const ctx = await import('./context');
    expect(typeof (ctx as Record<string, unknown>).getSearchClearBtn).toBe('undefined');
    expect(typeof (ctx as Record<string, unknown>).getSearchWrapper).toBe('undefined');
  });
});
