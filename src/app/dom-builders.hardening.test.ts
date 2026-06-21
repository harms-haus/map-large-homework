/**
 * Hardening tests for `src/app/dom-builders.ts`.
 *
 * Two contracts are pinned:
 *
 *  1. Action-button handlers (Delete / Move / Copy / New directory) must await
 *     the `rerender()` call following each successful mutation. A rejecting
 *     re-render must propagate to `makeActionButton`'s catch wrapper and
 *     surface in the status footer — the same surface used for mutation
 *     errors.
 *
 *     - "re-renders after a successful mutation": each handler triggers a
 *       fresh browse fetch + table rebuild.
 *     - "a failing re-render surfaces in .status": the handler awaits
 *       `rerender()`, so a rejection propagates to the catch wrapper.
 *
 *  2. Menu open/close state (`openRowMenu` / `openCurrentDirMenu`) is
 *     encapsulated per mount (a `createMenuState()` factory threaded through
 *     the shared context) so a re-mount never inherits a previous mount's
 *     stale menu state. The within-mount menu contract (open/close, single-open
 *     invariant, keyboard nav, the row + directory context menus) must hold
 *     unchanged after a re-mount.
 *
 * Environment: happy-dom (these tests need a DOM). Shared fixtures and the
 * per-test fetch stub come from `./test-helpers`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderBrowse } from '../app';
import { setRenderHook } from './context';
import { mockResponse } from '../test-utils/mock-response';
import {
  setupCleared,
  flush,
  browseResult,
  fileEntry,
  rowByName,
  cellsOf,
  buttonsByText,
  fetchMock,
  installAppTestLifecycle,
} from './test-helpers';

installAppTestLifecycle();

const FILE = fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false, size: 10 });

/** The Actions cell (4th td) of the data row whose Name cell matches `name`. */
function actionsOf(results: HTMLElement, name: string): Element {
  return cellsOf(rowByName(results.querySelector('table')!, name)!)[3];
}

/** The current-directory menu: the `.row-menu` that is a direct child of `.results`. */
function dirMenuOf(results: HTMLElement): HTMLElement {
  const menu = Array.from(results.children).find(
    (c) => c instanceof HTMLElement && c.classList.contains('row-menu'),
  ) as HTMLElement | undefined;
  if (!menu) {
    throw new Error('directory menu (.results > .row-menu) not found');
  }
  return menu;
}

/**
 * Safety net: tests below override the shared render hook (`setRenderHook`) to
 * inject a failing re-render. Neutralize the hook after every test so a
 * throwing hook can never leak into a later test; each test's `setupCleared()`
 * re-binds the real render via the orchestrator's `init()` before it runs.
 */
afterEach(() => {
  setRenderHook(async () => {});
});

/* ===========================================================================
 * Issue 1 — characterization: mutation handlers re-render on success
 *
 * Each handler calls rerender() (a fresh browse fetch + table rebuild) after a
 * successful mutation.
 * ========================================================================= */
describe('action handlers re-render after a successful mutation', () => {
  it('Delete: re-renders so the deleted file is gone from the table', async () => {
    let deleted = false;
    fetchMock.mockImplementation(async (url, init) => {
      const u = String(url);
      const m = (init?.method ?? 'GET').toUpperCase();
      if (m === 'DELETE' && u.includes('/delete')) {
        deleted = true;
        return mockResponse({ status: 200, body: {} });
      }
      if (m === 'GET' && u.includes('/browse')) {
        const entries = deleted ? [] : [FILE];
        return mockResponse({
          body: browseResult({
            path: 'docs',
            entries,
            fileCount: deleted ? 0 : 1,
            totalSize: deleted ? 0 : 10,
          }),
        });
      }
      return mockResponse({ status: 200, body: {} });
    });

    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [FILE] }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    buttonsByText(actionsOf(results, 'a.txt'), 'Delete')[0].click();
    await flush();
    await flush();
    await flush();

    expect(deleted).toBe(true);
    // The re-render fetched an empty listing, so the row is gone.
    expect(rowByName(results.querySelector('table')!, 'a.txt')).toBeUndefined();
  });

  it('Move: calls api.move then re-renders (fetches browse again)', async () => {
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [FILE] }));
    vi.spyOn(window, 'prompt').mockReturnValue('docs/archive/a.txt');

    const browseBefore = fetchMock.mock.calls.filter(([u]) => String(u).includes('/browse')).length;

    buttonsByText(actionsOf(results, 'a.txt'), 'Move')[0].click();
    await flush();
    await flush();
    await flush();

    const moveCalls = fetchMock.mock.calls.filter(
      ([u, init]) => String(u).includes('/move') && (init?.method ?? 'GET') === 'POST',
    );
    expect(moveCalls).toHaveLength(1);
    // rerender() fired a fresh browse fetch.
    const browseAfter = fetchMock.mock.calls.filter(([u]) => String(u).includes('/browse')).length;
    expect(browseAfter).toBeGreaterThan(browseBefore);
  });

  it('Copy: calls api.copy then re-renders (fetches browse again)', async () => {
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [FILE] }));
    vi.spyOn(window, 'prompt').mockReturnValue('docs/copy/a.txt');

    const browseBefore = fetchMock.mock.calls.filter(([u]) => String(u).includes('/browse')).length;

    buttonsByText(actionsOf(results, 'a.txt'), 'Copy')[0].click();
    await flush();
    await flush();
    await flush();

    const copyCalls = fetchMock.mock.calls.filter(
      ([u, init]) => String(u).includes('/copy') && (init?.method ?? 'GET') === 'POST',
    );
    expect(copyCalls).toHaveLength(1);
    const browseAfter = fetchMock.mock.calls.filter(([u]) => String(u).includes('/browse')).length;
    expect(browseAfter).toBeGreaterThan(browseBefore);
  });

  it('New directory: re-renders so the new subdirectory appears in the table', async () => {
    let created = false;
    fetchMock.mockImplementation(async (url, init) => {
      const u = String(url);
      const m = (init?.method ?? 'GET').toUpperCase();
      if (m === 'POST' && u.includes('/mkdir')) {
        created = true;
        return mockResponse({ status: 200, body: {} });
      }
      if (m === 'GET' && u.includes('/browse')) {
        const entries = created
          ? [fileEntry({ name: 'new folder', path: 'docs/new folder', isDirectory: true })]
          : [];
        return mockResponse({
          body: browseResult({ path: 'docs', entries, folderCount: created ? 1 : 0 }),
        });
      }
      return mockResponse({ status: 200, body: {} });
    });

    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [] }));
    vi.spyOn(window, 'prompt').mockReturnValue('new folder');

    buttonsByText(dirMenuOf(results), 'New directory')[0].click();
    await flush();
    await flush();
    await flush();

    expect(created).toBe(true);
    expect(rowByName(results.querySelector('table')!, 'new folder')).toBeTruthy();
  });
});

/* ===========================================================================
 * Issue 1 — fix verification: handlers AWAIT rerender()
 *
 * A rejecting re-render must propagate to makeActionButton's catch wrapper and
 * surface in the status footer. This only happens once `rerender()` is awaited;
 * the fire-and-forget call silently swallows the rejection. We inject a failing
 * re-render by overriding the shared render hook (setRenderHook) AFTER setup —
 * the orchestrator's hashchange listener calls the LOCAL render function (not
 * the hook), so the override affects ONLY rerender() callers.
 *
 * These tests verify that a failing re-render after a successful action
 * (Delete, New directory) surfaces the error in the .status footer. (Delete
 * and New directory cover the two distinct code locations — makeRowMenu and
 * makeDirMenu; Move and Copy share makeRowMenu's Delete-shaped handler, so
 * they are covered transitively.) A process-level handler in beforeEach
 * swallows any unhandled rejection from the expected failure so the assertion
 * is clean rather than noisy.
 * ========================================================================= */
describe('action handlers await rerender() — a failing re-render surfaces in .status', () => {
  // Swallow any unhandled rejection from a failing rerender() so each test
  // fails cleanly on its assertion. process is the Node global vitest runs
  // under (the happy-dom DOM shim does not change this).
  const swallow = (): void => {};
  beforeEach(() => {
    process.on('unhandledRejection', swallow);
  });
  afterEach(() => {
    process.off('unhandledRejection', swallow);
  });

  it('Delete: a failing re-render after a successful delete surfaces in .status', async () => {
    const { results, status } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [FILE] }));
    setRenderHook(async () => {
      throw new Error('re-render failed');
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    buttonsByText(actionsOf(results, 'a.txt'), 'Delete')[0].click();
    await flush();
    await flush();

    // With `await rerender()`, the handler rejects and makeActionButton surfaces
    // the error in the status footer (same surface as mutation errors).
    expect(status.textContent).toBe('Error: re-render failed');
  });

  it('New directory: a failing re-render after a successful mkdir surfaces in .status', async () => {
    const { results, status } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [] }));
    setRenderHook(async () => {
      throw new Error('re-render failed');
    });
    vi.spyOn(window, 'prompt').mockReturnValue('new folder');

    buttonsByText(dirMenuOf(results), 'New directory')[0].click();
    await flush();
    await flush();

    expect(status.textContent).toBe('Error: re-render failed');
  });
});

/* ===========================================================================
 * Issue 2 — per-mount menu state: behavior across a re-mount
 *
 * Encapsulating openRowMenu / openCurrentDirMenu in a per-mount object must not
 * change the within-mount menu contract. The first three tests verify the full
 * menu behavior (open/close, single-open invariant, keyboard nav, the row +
 * directory context menus) still works in the NEWEST mount after a previous
 * mount has populated module-level state.
 *
 * The last test verifies the contamination guard: a row menu left open in
 * a PREVIOUS mount must NOT be closed when the new mount opens its own menu
 * ========================================================================= */
describe('menu state across a re-mount', () => {
  // Close any menu left open by a prior test (Escape is handled by an open
  // menu's document keydown listener; idempotent no-op when none is open) so
  // every test starts — and, via afterEach, ends — with a clean menu slate.
  // This also tears down any document click/keydown listeners an open menu
  // registered, so they cannot leak into the next test.
  beforeEach(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  afterEach(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });

  it('after a re-mount, the ⋮ row menu opens/closes and only one is open at a time', async () => {
    await setupCleared(); // first mount (populates module-level state)
    const { results } = await setupCleared(); // re-mount (under test)
    renderBrowse(
      browseResult({
        path: 'docs',
        entries: [
          fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false, size: 10 }),
          fileEntry({ name: 'b.txt', path: 'docs/b.txt', isDirectory: false, size: 20 }),
        ],
      }),
    );

    const actionsA = actionsOf(results, 'a.txt');
    const actionsB = actionsOf(results, 'b.txt');
    const menuA = actionsA.querySelector('.row-menu') as HTMLElement;
    const menuB = actionsB.querySelector('.row-menu') as HTMLElement;
    const btnA = actionsA.querySelector('.row-menu-btn') as HTMLButtonElement;
    const btnB = actionsB.querySelector('.row-menu-btn') as HTMLButtonElement;

    btnA.click();
    expect(menuA.hidden).toBe(false);
    expect(btnA.getAttribute('aria-expanded')).toBe('true');

    // Opening B closes A (single-open invariant).
    btnB.click();
    expect(menuB.hidden).toBe(false);
    expect(menuA.hidden).toBe(true);
    expect(btnA.getAttribute('aria-expanded')).toBe('false');

    // A click anywhere outside closes the open menu.
    const outside = document.createElement('div');
    document.body.append(outside);
    outside.click();
    outside.remove();
    expect(menuB.hidden).toBe(true);
    expect(btnB.getAttribute('aria-expanded')).toBe('false');
  });

  it('after a re-mount, the right-click row menu and the blank-space directory menu both open at the cursor', async () => {
    await setupCleared();
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [FILE] }));

    // Right-click the row opens the row menu at the cursor.
    const row = rowByName(results.querySelector('table')!, 'a.txt')!;
    const rowMenu = actionsOf(results, 'a.txt').querySelector('.row-menu') as HTMLElement;
    row.dispatchEvent(
      new MouseEvent('contextmenu', { cancelable: true, bubbles: true, clientX: 30, clientY: 40 }),
    );
    expect(rowMenu.hidden).toBe(false);
    expect(rowMenu.style.left).toBe('30px');

    // Close it, then right-click blank space opens the directory menu.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(rowMenu.hidden).toBe(true);

    const dirMenu = dirMenuOf(results);
    const evt = new MouseEvent('contextmenu', {
      cancelable: true,
      bubbles: true,
      clientX: 50,
      clientY: 80,
    });
    results.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
    expect(dirMenu.hidden).toBe(false);
    expect(dirMenu.style.left).toBe('50px');
  });

  it('after a re-mount, keyboard navigation (ArrowDown / End) still moves focus between items', async () => {
    await setupCleared();
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [FILE] }));

    const actions = actionsOf(results, 'a.txt');
    (actions.querySelector('.row-menu-btn') as HTMLButtonElement).click();
    const menu = actions.querySelector('.row-menu') as HTMLElement;
    const items = Array.from(menu.children) as HTMLElement[];
    expect(menu.hidden).toBe(false);

    items[0].focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }));
    expect(document.activeElement).toBe(items[1]);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', cancelable: true }));
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  it('a row menu left open in a PREVIOUS mount is not closed when the new mount opens its own menu (per-mount isolation)', async () => {
    // Each mount owns its own menu-state slot, so opening a menu in a new
    // mount never touches a previous mount's menu.
    const ctx1 = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [FILE] }));
    const menu1 = actionsOf(ctx1.results, 'a.txt').querySelector('.row-menu') as HTMLElement;
    const btn1 = actionsOf(ctx1.results, 'a.txt').querySelector(
      '.row-menu-btn',
    ) as HTMLButtonElement;
    btn1.click();
    expect(menu1.hidden).toBe(false); // mount #1's menu is open

    // Re-mount: document.body is cleared (menu1 is detached but still
    // referenced). The per-mount state ensures the new mount does not
    // reference menu1's close function.
    const ctx2 = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [FILE] }));
    const btn2 = actionsOf(ctx2.results, 'a.txt').querySelector(
      '.row-menu-btn',
    ) as HTMLButtonElement;
    const menu2 = actionsOf(ctx2.results, 'a.txt').querySelector('.row-menu') as HTMLElement;

    btn2.click(); // open mount #2's menu

    expect(menu2.hidden).toBe(false); // mount #2's menu opened
    // Per-mount isolation: the previous mount's menu is untouched (the new
    // mount must not close a menu it does not own).
    expect(menu1.hidden).toBe(false);
  });
});
