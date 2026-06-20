/**
 * Tests for the rendering layer's coordination: the `render()` route-dispatch
 * lifecycle (initial render, navigation dispatch, error display, clearing of
 * previous results), the render-race guard and hashchange-listener cleanup, and
 * the route-independence characterization of `renderBrowse`/`renderSearch`.
 *
 * Split out of the former `src/app.test.ts` monolith (task-29). Shared
 * fixtures, DOM scaffolding, and the per-test fetch stub come from
 * `./test-helpers`.
 *
 * Environment: the project-default `happy-dom` (these tests need a DOM).
 */
import { describe, it, expect, vi } from 'vitest';
import { startApp, renderBrowse, renderSearch } from '../app';
import type { SearchResult } from '../api';
import { toBrowseHash, toSearchHash, navigate } from '../router';
import { mockResponse } from '../test-utils/mock-response';
import {
  setup,
  setupCleared,
  flush,
  browseResult,
  fileEntry,
  joinPathHelper,
  dataRows,
  fetchMock,
  installAppTestLifecycle,
} from './test-helpers';

installAppTestLifecycle();

/* ===========================================================================
 * render output depends ONLY on `result` (route-parameter removal)
 *
 * Characterization for the removal of the unused `route` parameter from
 * `renderBrowse`/`renderSearch`. Before the refactor each function accepted a
 * `route: Route` that it discarded (`void route`); after the refactor the
 * parameter is gone. The observable contract is unchanged either way:
 * EVERYTHING the functions render — breadcrumb, status footer, and the results
 * table — is derived solely from the `result` argument. They must not read the
 * active route (getCurrentRoute / window.location.hash), so the rendered DOM is
 * identical no matter what hash is set when they run. The route-independence
 * tests below pin that by rendering the same `result` under different active
 * routes and asserting byte-for-byte identical output; the remaining tests add
 * result-only edge cases (empty results, search scope path, table swapping).
 * ========================================================================= */
describe('render output depends only on result (route is irrelevant)', () => {
  it('renderBrowse produces identical output regardless of the active route', async () => {
    const result = browseResult({
      path: 'docs/sub',
      parent: 'docs',
      entries: [
        fileEntry({ name: 'a.txt', path: 'docs/sub/a.txt', size: 2048 }),
        fileEntry({ name: 'folder', path: 'docs/sub/folder', isDirectory: true }),
      ],
      folderCount: 1,
      fileCount: 1,
      totalSize: 2048,
    });

    // Start under a SEARCH route, render the browse result, and snapshot it.
    const { results, status, breadcrumb } = await setupCleared({
      hash: toSearchHash('whatever', 'else/where'),
    });
    renderBrowse(result);
    const snapResults = results.innerHTML;
    const snapStatus = status.textContent;
    const snapBreadcrumb = breadcrumb.innerHTML;

    // Switch to a completely different active route (a browse route) and let the
    // background render settle, then re-render the SAME result. renderBrowse
    // derives everything from `result`, so the output must be byte-for-byte
    // identical despite the route change.
    window.location.hash = toBrowseHash('completely/different/path');
    await flush();
    results.innerHTML = '';
    renderBrowse(result);

    expect(results.innerHTML).toBe(snapResults);
    expect(status.textContent).toBe(snapStatus);
    expect(breadcrumb.innerHTML).toBe(snapBreadcrumb);
    // Non-trivial sanity: the output is actually populated (not two empties).
    expect(results.querySelector('table')).toBeTruthy();
    expect(breadcrumb.querySelectorAll('a').length).toBeGreaterThan(0);
  });

  it('renderSearch produces identical output regardless of the active route', async () => {
    const result: SearchResult = {
      query: 'kittens',
      path: 'pets',
      results: [fileEntry({ name: 'cat.txt', path: 'pets/cat.txt', size: 4096 })],
    };

    // Start under a BROWSE route, render the search result, and snapshot it.
    const { results, status, breadcrumb } = await setupCleared({
      hash: toBrowseHash('unrelated/browse/route'),
    });
    renderSearch(result);
    const snapResults = results.innerHTML;
    const snapStatus = status.textContent;
    const snapBreadcrumb = breadcrumb.innerHTML;

    // Switch to a different active route (a search route) and let the background
    // render settle, then re-render the SAME result. renderSearch derives
    // everything from `result`, so the output must be identical.
    window.location.hash = toSearchHash('different', 'query/scope');
    await flush();
    results.innerHTML = '';
    renderSearch(result);

    expect(results.innerHTML).toBe(snapResults);
    expect(status.textContent).toBe(snapStatus);
    expect(breadcrumb.innerHTML).toBe(snapBreadcrumb);
    expect(results.querySelector('table')).toBeTruthy();
  });

  it('renderSearch breadcrumb reflects result.path (search scope), not the route', async () => {
    // The search scope path comes from result.path. With an empty hash and a
    // result scoped to 'archive/2024', the breadcrumb must show those segments
    // — proving the scope is sourced from result, not the active route.
    const { breadcrumb } = await setupCleared({ hash: '' });
    renderSearch({ query: 'q', path: 'archive/2024', results: [] });

    const texts = Array.from(breadcrumb.querySelectorAll('a')).map(
      (el) => el.textContent?.trim() ?? '',
    );
    expect(texts).toContain('Home');
    expect(texts).toContain('archive');
    expect(texts).toContain('2024');
  });

  describe('result-only status / footer edge cases', () => {
    it('renderBrowse with an empty result reports zero totals and no data rows', async () => {
      const { status, results } = await setupCleared();
      renderBrowse(
        browseResult({
          path: '',
          parent: null,
          entries: [],
          folderCount: 0,
          fileCount: 0,
          totalSize: 0,
        }),
      );

      expect(status.textContent).toBe('0 folders, 0 files, total 0 B');
      // Header row only — no data rows and no ".." parent row.
      expect(dataRows(results.querySelector('table')!)).toHaveLength(0);
    });

    it('renderSearch with zero results reports "0 results for ..." and no data rows', async () => {
      const { status, results } = await setupCleared();
      renderSearch({ query: 'nothing-here', path: '', results: [] });

      expect(status.textContent).toBe('0 results for "nothing-here"');
      expect(dataRows(results.querySelector('table')!)).toHaveLength(0);
    });
  });

  describe('re-render replaces prior output (direct call)', () => {
    /* render() dispatches to renderBrowse or renderSearch depending on the
       route; whichever runs must REPLACE the other's table rather than stack a
       second one. These pin the swap at the direct-call level (the render()
       orchestration suite covers the navigation-driven path). */
    it('renderSearch after renderBrowse swaps columns and status, leaving one table', async () => {
      const { results, status } = await setupCleared();
      renderBrowse(
        browseResult({
          path: 'docs',
          entries: [fileEntry({ name: 'a.txt', size: 10 })],
          fileCount: 1,
          totalSize: 10,
        }),
      );
      expect(status.textContent).toContain('1 files');
      let headers = Array.from(results.querySelectorAll('th')).map((h) => h.textContent!.trim());
      expect(headers).toEqual(['Name', 'Size', 'Modified', 'Actions']);

      renderSearch({ query: 'q', path: '', results: [fileEntry({ name: 'a.txt', path: 'docs/a.txt' })] });
      headers = Array.from(results.querySelectorAll('th')).map((h) => h.textContent!.trim());
      expect(headers).toEqual(['Name', 'Path', 'Size', 'Modified']);
      expect(status.textContent).toContain('1 results for "q"');
      // Exactly one table — the previous browse table was replaced, not stacked.
      expect(results.querySelectorAll('table')).toHaveLength(1);
    });

    it('renderBrowse after renderSearch swaps columns and status, leaving one table', async () => {
      const { results, status } = await setupCleared();
      renderSearch({ query: 'q', path: '', results: [fileEntry({ name: 'a.txt', path: 'docs/a.txt' })] });
      expect(status.textContent).toContain('1 results for "q"');

      renderBrowse(
        browseResult({
          path: 'docs',
          entries: [fileEntry({ name: 'a.txt', size: 10 })],
          fileCount: 1,
          totalSize: 10,
        }),
      );
      const headers = Array.from(results.querySelectorAll('th')).map((h) => h.textContent!.trim());
      expect(headers).toEqual(['Name', 'Size', 'Modified', 'Actions']);
      expect(status.textContent).toContain('1 files');
      expect(results.querySelectorAll('table')).toHaveLength(1);
    });
  });
});

/* ===========================================================================
 * render() orchestration (subscribe + initial render + dispatch + errors)
 * ========================================================================= */
describe('render orchestration', () => {
  it('renders browse results for the initial route on startApp', async () => {
    const { results } = setup({ hash: toBrowseHash('home') });
    await flush();

    const table = results.querySelector('table');
    expect(table).toBeTruthy();
    // The default mock derives an entry name from the requested path.
    expect(results.textContent).toContain('child-of-home');
    expect(
      fetchMock.mock.calls.some(
        ([u]) => String(u).includes('/browse') && String(u).includes('path=' + encodeURIComponent('home')),
      ),
    ).toBe(true);
  });

  it('re-renders into search results after navigating to a search hash', async () => {
    const { results, status } = setup();
    await flush();

    navigate(toSearchHash('kittens', ''));
    await flush();

    expect(results.querySelector('table')).toBeTruthy();
    expect(results.textContent).toContain('result-for-kittens');
    expect(status.textContent).toContain('kittens');
  });

  it('shows an error message in .results (and no table) when the API call fails', async () => {
    fetchMock.mockImplementation(async () => mockResponse({ status: 500, text: 'boom' }));
    const { results } = setup();
    await flush();

    expect(results.querySelector('table')).toBeNull();
    expect((results.textContent ?? '').trim().length).toBeGreaterThan(0);
  });

  it('clears previous results before rendering the new route', async () => {
    const { results } = setup();
    await flush();

    navigate(toBrowseHash('first'));
    await flush();
    expect(results.querySelectorAll('table')).toHaveLength(1);

    navigate(toBrowseHash('second'));
    await flush();
    expect(results.querySelectorAll('table')).toHaveLength(1); // not accumulated
    expect(results.textContent).toContain('child-of-second');
  });
});

/* ===========================================================================
 * Rendering lifecycle
 *
 * Two interrelated startApp/render bugs are pinned here:
 *
 *  (a) LISTENER LEAK — startApp calls subscribe(render) and used to throw away
 *      the returned unsubscribe function, so every re-mount left the previous
 *      mount's hashchange listener on `window`. (happy-dom dedups identical
 *      function references, so this leak is latent rather than multiplicative
 *      in this environment, but the cleanup contract is still asserted via the
 *      addEventListener/removeEventListener spies below.)
 *  (b) RENDER RACE — render() is async; two rapid navigations let a slower
 *      fetch overwrite a fresher one's results. The fix aborts a superseded
 *      render after each await.
 * ========================================================================= */
describe('rendering lifecycle', () => {
  describe('hashchange listener cleanup on re-mount', () => {
    /**
     * Mount the app `n` times into fresh containers, the way `setup()` does.
     * Returns nothing; used to drive repeated startApp() calls with the spies
     * already installed so every subscribe/unsubscribe is captured.
     */
    function mountNTimes(n: number): void {
      for (let i = 0; i < n; i++) {
        document.body.innerHTML = '';
        window.location.hash = '';
        const root = document.createElement('div');
        document.body.append(root);
        startApp(root);
      }
    }

    function hashchangeCalls(
      spy: ReturnType<typeof vi.spyOn>,
    ): Array<{ type: string; callback: EventListenerOrEventListenerObject }> {
      return spy.mock.calls
        .map(([type, callback]) => ({ type: String(type), callback }))
        .filter((c) => c.type === 'hashchange');
    }

    it('subscribes exactly one hashchange listener per mount', async () => {
      const addSpy = vi.spyOn(window, 'addEventListener');

      mountNTimes(3);
      await flush();

      // Each startApp() subscribes render exactly once.
      expect(hashchangeCalls(addSpy)).toHaveLength(3);
    });

    it('unsubscribes the previous mount\'s hashchange listener on every re-mount', async () => {
      const addSpy = vi.spyOn(window, 'addEventListener');
      const removeSpy = vi.spyOn(window, 'removeEventListener');

      const N = 4;
      mountNTimes(N);
      await flush();

      const adds = hashchangeCalls(addSpy);
      const removes = hashchangeCalls(removeSpy);

      // Robust to test ordering: the 1st mount in *this* test may additionally
      // tear down a listener left over by an earlier test, so we only assert a
      // lower bound. The invariant that matters is that every re-mount removes
      // its predecessor — i.e. at least (N − 1) hashchange removals happened.
      // The leaky implementation performs ZERO removals.
      expect(adds).toHaveLength(N);
      expect(removes.length).toBeGreaterThanOrEqual(N - 1);
      // Every removal targets the same render callback that was subscribed.
      expect(removes.length).toBeGreaterThan(0);
      for (const r of removes) {
        expect(typeof r.callback).toBe('function');
        expect(adds.some((a) => a.callback === r.callback)).toBe(true);
      }
    });
  });

  describe('render race (superseded fetch is discarded)', () => {
    /**
     * Drive a browse render for `path` whose fetch is held open until the
     * caller invokes `release()`. All other browse paths resolve immediately.
     */
    function stubHeldBrowse(
      heldPath: string,
    ): { release: () => void } {
      let release!: () => void;
      const held = new Promise<Response>((resolve) => {
        release = () =>
          resolve(
            mockResponse({
              body: browseResult({
                path: heldPath,
                entries: [
                  fileEntry({
                    name: 'child-of-' + heldPath,
                    path: joinPathHelper(heldPath, 'child-of-' + heldPath),
                  }),
                ],
                fileCount: 1,
                totalSize: 1,
              }),
            }),
          );
      });

      fetchMock.mockImplementation(async (url, init) => {
        const u = String(url);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'GET' && u.includes('/browse')) {
          const path = decodeURIComponent(u.split('path=')[1] ?? '');
          if (path === heldPath) {
            return held;
          }
          return mockResponse({
            body: browseResult({
              path,
              entries: [
                fileEntry({
                  name: 'child-of-' + path,
                  path: joinPathHelper(path, 'child-of-' + path),
                }),
              ],
              fileCount: 1,
              totalSize: 1,
            }),
          });
        }
        return mockResponse({ status: 200, body: {} });
      });

      return { release };
    }

    it('does not let a slower, superseded browse overwrite the latest results', async () => {
      const { release } = stubHeldBrowse('slow');

      const { results } = setup();
      await flush(); // settle the initial render for the default route

      // Navigate to 'slow' (its fetch is held), then — before it resolves — to
      // 'fast'. In happy-dom each hash assignment fires `hashchange` and thus
      // render() synchronously, so both fetches are issued in order and the
      // 'slow' render is suspended at its await when 'fast' starts.
      navigate(toBrowseHash('slow'));
      navigate(toBrowseHash('fast'));
      await flush(); // 'fast' resolves first and commits

      expect(results.textContent).toContain('child-of-fast');
      expect(results.textContent).not.toContain('child-of-slow');

      // The slow fetch finally resolves LAST. Its stale data must be discarded
      // (a newer render owns the slot) and must NOT clobber the fresh results.
      release();
      await flush();

      expect(results.textContent).toContain('child-of-fast');
      expect(results.textContent).not.toContain('child-of-slow');
    });

    it('does not let a superseded browse update the breadcrumb or status', async () => {
      const { release } = stubHeldBrowse('slow');

      const { breadcrumb, status } = setup();
      await flush();

      navigate(toBrowseHash('slow'));
      navigate(toBrowseHash('fast'));
      await flush();

      // The fresh render owns the breadcrumb / status for 'fast'.
      expect(breadcrumb.textContent).toContain('fast');
      expect(status.textContent).toContain('1 files');

      release();
      await flush();

      // The superseded 'slow' render must not have touched them.
      expect(breadcrumb.textContent).toContain('fast');
      expect(breadcrumb.textContent).not.toContain('slow');
      expect(status.textContent).toContain('1 files');
    });

    it('still renders the latest navigation when fetches resolve in order', async () => {
      // Control case: a single navigation (no race) still commits normally,
      // so the race guard does not swallow a non-superseded render.
      const { results } = setup({ hash: toBrowseHash('solo') });
      await flush();

      expect(results.textContent).toContain('child-of-solo');

      navigate(toBrowseHash('next'));
      await flush();

      expect(results.textContent).toContain('child-of-next');
      expect(results.textContent).not.toContain('child-of-solo');
    });
  });
});
