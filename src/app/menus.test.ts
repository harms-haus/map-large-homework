/**
 * Tests for `menus.ts` — the row-menu and directory-context-menu lifecycle
 * and viewport-edge positioning.
 *
 * Covers, in order:
 *
 *  1. `computeMenuPosition` — the pure off-screen flip math (no DOM). By
 *     default a menu opens below + left-aligned with its anchor; when that
 *     would run off a viewport edge it flips direction (down→up, left→right)
 *     and is finally clamped inside the viewport.
 *  2. `openMenu` wiring — when a row menu is opened, its real measured size
 *     and the live viewport size are fed into `computeMenuPosition`, so the
 *     flip actually takes effect (not just the pure function in isolation).
 *  3. `createMenuState` — the per-mount menu open/close state: fresh
 *     independent state, default no-op `openCurrentDirMenu`, the
 *     `closeAllRowMenus` idempotent contract, and per-call independence.
 *  4. `setupDirContextMenu` — appends a hidden `.row-menu`, rebinds
 *     `openCurrentDirMenu` per call, wires the `contextmenu` listener ONCE,
 *     and ignores right-clicks inside the table or an open `.row-menu`.
 *  5. Action-button handlers (Delete / Move / Copy / New directory) must await
 *     the `rerender()` call following each successful mutation. A rejecting
 *     re-render must propagate to `makeActionButton`'s catch wrapper and
 *     surface in the status footer — the same surface used for mutation errors.
 *  6. Menu open/close state (`openRowMenu` / `openCurrentDirMenu`) is
 *     encapsulated per mount (a `createMenuState()` factory threaded through
 *     the shared context) so a re-mount never inherits a previous mount's
 *     stale menu state.
 *
 * Environment: happy-dom, which performs NO layout (`getBoundingClientRect`
 * always reports width/height 0). The pure `computeMenuPosition` suite is
 * therefore independent of the DOM, and the wiring test injects a synthetic
 * menu rect + viewport via spies/assignment rather than relying on rendered
 * geometry. Shared fixtures and the per-test fetch stub come from
 * `./test-helpers`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeMenuPosition,
  createMenuState,
  setupDirContextMenu,
  MENU_EDGE_MARGIN,
} from './menus';
import { renderBrowse } from './render-browse';
import { setRenderHook } from './context';
import { mockResponse } from '../test-utils/mock-response';
import {
  setupCleared,
  browseResult,
  fileEntry,
  rowByName,
  cellsOf,
  buttonsByText,
  fetchMock,
  flush,
  installAppTestLifecycle,
} from './test-helpers';

installAppTestLifecycle();

/* A typical ⋮ button rect and a menu size, used across the pure suite. */
const BTN = { left: 900, top: 200, right: 920, bottom: 224 };
const SIZE = { width: 160, height: 140 };
const VIEW = { width: 1000, height: 600 };

/* ===========================================================================
 * computeMenuPosition — default (no overflow)
 * ========================================================================= */
describe('computeMenuPosition — default (no overflow)', () => {
  it('opens below + left-aligned with the anchor: left=anchor.left, top=anchor.bottom', () => {
    const anchor = { left: 100, top: 200, right: 120, bottom: 224 };
    const p = computeMenuPosition(anchor, SIZE, VIEW);
    expect(p).toEqual({ left: 100, top: 224 });
  });

  it('keeps the cursor coords for a zero-size (right-click) anchor that fits', () => {
    const cursor = { left: 137, top: 242, right: 137, bottom: 242 };
    const p = computeMenuPosition(cursor, SIZE, VIEW);
    expect(p).toEqual({ left: 137, top: 242 });
  });
});

/* ===========================================================================
 * computeMenuPosition — horizontal flip (would overflow the right edge)
 * ========================================================================= */
describe('computeMenuPosition — horizontal flip (would overflow the right edge)', () => {
  it('right-aligns the menu to the anchor right edge instead (open leftward)', () => {
    // anchor.left(900) + width(160) = 1060 > viewport(1000) - margin → flip.
    const p = computeMenuPosition(BTN, SIZE, VIEW);
    expect(p.left).toBe(BTN.right - SIZE.width); // 920 - 160 = 760
    expect(p.top).toBe(BTN.bottom); // vertical still fits → unchanged
  });

  it('right-click near the right edge flips so the menu extends left of the cursor', () => {
    const cursor = { left: 980, top: 100, right: 980, bottom: 100 };
    const p = computeMenuPosition(cursor, SIZE, VIEW);
    expect(p.left).toBe(980 - 160); // 820
  });

  it('does NOT flip when the menu fits within the margin of the right edge', () => {
    // 836 + 160 = 996 == viewport(1000) - margin(4): exactly at the limit, fits.
    const anchor = { left: 836, top: 200, right: 856, bottom: 224 };
    expect(computeMenuPosition(anchor, SIZE, VIEW).left).toBe(836);
  });
});

/* ===========================================================================
 * computeMenuPosition — vertical flip (would overflow the bottom edge)
 * ========================================================================= */
describe('computeMenuPosition — vertical flip (would overflow the bottom edge)', () => {
  it('opens upward, aligning the menu bottom to the anchor top', () => {
    // anchor.bottom(500) + height(140) = 640 > viewport(600) - margin → flip.
    const anchor = { left: 100, top: 476, right: 120, bottom: 500 };
    const p = computeMenuPosition(anchor, SIZE, VIEW);
    expect(p.top).toBe(anchor.top - SIZE.height); // 476 - 140 = 336
    expect(p.left).toBe(anchor.left); // horizontal still fits → unchanged
  });

  it('right-click near the bottom flips so the menu extends above the cursor', () => {
    const cursor = { left: 100, top: 580, right: 100, bottom: 580 };
    const p = computeMenuPosition(cursor, SIZE, VIEW);
    expect(p.top).toBe(580 - 140); // 440
  });
});

/* ===========================================================================
 * computeMenuPosition — both axes flip at once
 * ========================================================================= */
describe('computeMenuPosition — both axes flip at once', () => {
  it('right-aligns AND opens upward when the anchor is in the bottom-right corner', () => {
    const anchor = { left: 900, top: 476, right: 920, bottom: 500 };
    const p = computeMenuPosition(anchor, SIZE, VIEW);
    expect(p).toEqual({ left: 760, top: 336 });
  });
});

/* ===========================================================================
 * computeMenuPosition — clamping into the viewport
 * ========================================================================= */
describe('computeMenuPosition — clamping into the viewport', () => {
  it('clamps left to the edge margin when a flip would push it off the left edge', () => {
    // Cursor near the left edge + a menu wider than the tiny viewport: the
    // right-align flip computes left = 10 - 160 = -150, which clamps to the
    // margin.
    const tinyView = { width: 100, height: 600 };
    const cursor = { left: 10, top: 200, right: 10, bottom: 224 };
    const p = computeMenuPosition(cursor, SIZE, tinyView);
    expect(p.left).toBe(MENU_EDGE_MARGIN);
  });

  it('clamps top to the edge margin when opening upward would go above the top', () => {
    const tinyView = { width: 1000, height: 100 };
    const anchor = { left: 100, top: 40, right: 120, bottom: 60 };
    const p = computeMenuPosition(anchor, SIZE, tinyView);
    expect(p.top).toBe(MENU_EDGE_MARGIN);
  });
});

/* ===========================================================================
 * openMenu wiring — the measured menu size + live viewport drive the flip.
 *
 * happy-dom reports a 0×0 rect for every element, so we spy on the menu's
 * getBoundingClientRect to inject a known size and shrink window.innerWidth/
 * innerHeight to force an overflow, then assert the menu's inline left/top
 * match what computeMenuPosition would produce.
 * ========================================================================= */
describe('openMenu applies computeMenuPosition to the rendered menu', () => {
  const file = fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false, size: 10 });

  let savedW: number;
  let savedH: number;

  beforeEach(() => {
    savedW = window.innerWidth;
    savedH = window.innerHeight;
    // Ensure no menu is left open by a prior test.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  afterEach(() => {
    window.innerWidth = savedW;
    window.innerHeight = savedH;
  });

  function menuOf(results: HTMLElement): HTMLElement {
    const row = rowByName(results.querySelector('table')!, 'a.txt')!;
    return cellsOf(row)[3].querySelector('.row-menu') as HTMLElement;
  }

  it('flips up + right when the right-click point is in the bottom-right corner', async () => {
    window.innerWidth = 1000;
    window.innerHeight = 600;
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [file] }));
    const menu = menuOf(results);
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 160,
      bottom: 140,
      width: 160,
      height: 140,
      x: 0,
      y: 0,
      toJSON() {},
    });

    const row = rowByName(results.querySelector('table')!, 'a.txt')!;
    row.dispatchEvent(
      new MouseEvent('contextmenu', {
        cancelable: true,
        bubbles: true,
        clientX: 900,
        clientY: 500,
      }),
    );

    // Cursor anchor {900,500,900,500}, size 160×140, viewport 1000×600:
    // horizontal flip → left = 900 - 160 = 740; vertical flip → top = 500 - 140 = 360.
    expect(menu.hidden).toBe(false);
    expect(menu.style.left).toBe('740px');
    expect(menu.style.top).toBe('360px');
  });

  it('leaves the cursor position untouched when the menu fits (no measured overflow)', async () => {
    // Default happy-dom viewport (1024×768) with a measured size that fits.
    window.innerWidth = 1024;
    window.innerHeight = 768;
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [file] }));
    const menu = menuOf(results);
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 160,
      bottom: 60,
      width: 160,
      height: 60,
      x: 0,
      y: 0,
      toJSON() {},
    });

    const row = rowByName(results.querySelector('table')!, 'a.txt')!;
    row.dispatchEvent(
      new MouseEvent('contextmenu', {
        cancelable: true,
        bubbles: true,
        clientX: 137,
        clientY: 242,
      }),
    );

    expect(menu.hidden).toBe(false);
    expect(menu.style.left).toBe('137px');
    expect(menu.style.top).toBe('242px');
  });
});

/* ===========================================================================
 * createMenuState — the per-mount menu open/close state
 * ========================================================================= */
describe('createMenuState', () => {
  it('returns a state with openRowMenu null, a function openCurrentDirMenu, and a closeAllRowMenus function', () => {
    const state = createMenuState();
    expect(state.openRowMenu).toBeNull();
    expect(typeof state.openCurrentDirMenu).toBe('function');
    expect(typeof state.closeAllRowMenus).toBe('function');
  });

  it('closeAllRowMenus is an idempotent no-op when no menu is open (openRowMenu stays null)', () => {
    const state = createMenuState();
    expect(() => state.closeAllRowMenus()).not.toThrow();
    state.closeAllRowMenus();
    expect(state.openRowMenu).toBeNull();
  });

  it("closeAllRowMenus invokes the open menu's close exactly once then nulls the slot", () => {
    const state = createMenuState();
    const close = vi.fn();
    state.openRowMenu = { close };
    state.closeAllRowMenus();
    state.closeAllRowMenus(); // second call: slot already null → must NOT call close again
    expect(close).toHaveBeenCalledTimes(1);
    expect(state.openRowMenu).toBeNull();
  });

  it('openCurrentDirMenu defaults to a no-op but can be rebound; the bound function is the one invoked', () => {
    const state = createMenuState();
    expect(() => state.openCurrentDirMenu({ left: 0, top: 0, right: 0, bottom: 0 })).not.toThrow();
    const rebound = vi.fn();
    state.openCurrentDirMenu = rebound;
    const anchor = { left: 5, top: 6, right: 7, bottom: 8 };
    state.openCurrentDirMenu(anchor);
    expect(rebound).toHaveBeenCalledTimes(1);
    expect(rebound).toHaveBeenCalledWith(anchor);
  });

  it('yields an independent object per call — mutating one state never touches another', () => {
    // This is the per-mount isolation contract the re-mount suite below
    // relies on; pinned here at the factory's own boundary.
    const a = createMenuState();
    const b = createMenuState();
    expect(a).not.toBe(b);
    a.openRowMenu = { close: () => undefined };
    expect(b.openRowMenu).toBeNull();
    const fnA = vi.fn();
    a.openCurrentDirMenu = fnA;
    b.openCurrentDirMenu({ left: 0, top: 0, right: 0, bottom: 0 });
    expect(fnA).not.toHaveBeenCalled();
  });
});

/* ===========================================================================
 * setupDirContextMenu — the current-directory blank-space menu
 * ========================================================================= */
describe('setupDirContextMenu', () => {
  /** A fresh results container + menu state, with the dir menu mounted for dirPath. */
  function mount(dirPath = 'docs'): {
    results: HTMLElement;
    state: ReturnType<typeof createMenuState>;
  } {
    const results = document.createElement('div');
    const state = createMenuState();
    setupDirContextMenu(results, dirPath, state);
    return { results, state };
  }

  it('appends a hidden .row-menu as a direct child of the results element', () => {
    const { results } = mount();
    const menus = Array.from(results.children).filter((c) =>
      c instanceof HTMLElement ? c.classList.contains('row-menu') : false,
    );
    expect(menus).toHaveLength(1);
    expect((menus[0] as HTMLElement).hidden).toBe(true);
  });

  it('the directory menu contains exactly Upload then New directory buttons', () => {
    const { results } = mount();
    const menu = results.querySelector('.row-menu') as HTMLElement;
    const labels = Array.from(menu.querySelectorAll('button')).map((b) =>
      (b.textContent ?? '').trim(),
    );
    expect(labels).toEqual(['Upload', 'New directory']);
  });

  it('rebinds state.openCurrentDirMenu on every call (the menu is rebuilt per render)', () => {
    const results = document.createElement('div');
    const state = createMenuState();
    setupDirContextMenu(results, 'a', state);
    const first = state.openCurrentDirMenu;
    setupDirContextMenu(results, 'b', state);
    expect(state.openCurrentDirMenu).not.toBe(first);
  });

  it('wires the blank-space contextmenu listener exactly ONCE even when called repeatedly', () => {
    // If the data-attribute guard ever breaks, a second setupDirContextMenu
    // would add a second listener and openCurrentDirMenu would fire twice per
    // right-click. Rebinding openCurrentDirMenu to a spy lets us count calls.
    const results = document.createElement('div');
    const state = createMenuState();
    setupDirContextMenu(results, 'docs', state);
    setupDirContextMenu(results, 'docs', state);
    setupDirContextMenu(results, 'docs', state);
    const openSpy = vi.fn();
    state.openCurrentDirMenu = openSpy;

    results.dispatchEvent(
      new MouseEvent('contextmenu', { cancelable: true, bubbles: true, clientX: 10, clientY: 20 }),
    );

    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('right-clicking genuine blank space prevents default and opens the dir menu at the cursor', () => {
    // Do NOT spy on openCurrentDirMenu here: the real openMenu (bound by
    // setupDirContextMenu) must run so we can assert the menu actually opens
    // and is positioned at the cursor. (happy-dom reports a 0×0 menu rect, so
    // computeMenuPosition leaves the cursor coords untouched when they fit.)
    const { results } = mount();
    const dirMenu = results.querySelector('.row-menu') as HTMLElement;

    const evt = new MouseEvent('contextmenu', {
      cancelable: true,
      bubbles: true,
      clientX: 42,
      clientY: 77,
    });
    results.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true);
    expect(dirMenu.hidden).toBe(false);
    expect(dirMenu.style.left).toBe('42px');
    expect(dirMenu.style.top).toBe('77px');
  });

  it('ignores a right-click whose target is inside the <table> (rows handle their own menus)', () => {
    const { results, state } = mount();
    const table = document.createElement('table');
    results.append(table);
    const openSpy = vi.fn();
    state.openCurrentDirMenu = openSpy;

    const evt = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    table.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('ignores a right-click whose target is inside an (open) .row-menu', () => {
    const { results, state } = mount();
    const dirMenu = results.querySelector('.row-menu') as HTMLElement;
    const openSpy = vi.fn();
    state.openCurrentDirMenu = openSpy;

    const evt = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    dirMenu.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('Upload in the dir menu calls pickAndUploadInto with the current directory path', async () => {
    // pickAndUploadInto opens a transient file picker; we stub it to capture
    // the path argument without triggering the real picker.
    const mod = await import('./toolbar-handlers');
    const pickSpy = vi.spyOn(mod, 'pickAndUploadInto').mockResolvedValue(undefined);
    const { results } = mount('docs/sub');

    const uploadBtn = Array.from(results.querySelectorAll('.row-menu button')).find(
      (b) => (b.textContent ?? '').trim() === 'Upload',
    )!;
    uploadBtn.click();

    expect(pickSpy).toHaveBeenCalledWith('docs/sub');
    pickSpy.mockRestore();
  });
});

/* ===========================================================================
 * Action handlers — characterization: mutation handlers re-render on success
 *
 * Each handler calls rerender() (a fresh browse fetch + table rebuild) after a
 * successful mutation.
 * ========================================================================= */
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
 * Safety net: the failing-rerender tests below override the shared render hook
 * (`setRenderHook`) to inject a failing re-render. Neutralize the hook after
 * every test so a throwing hook can never leak into a later test; each test's
 * `setupCleared()` re-binds the real render via the orchestrator's `init()`
 * before it runs.
 */
afterEach(() => {
  setRenderHook(async () => {});
});

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
 * Action handlers — fix verification: handlers AWAIT rerender()
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
 * Per-mount menu state: behavior across a re-mount
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
