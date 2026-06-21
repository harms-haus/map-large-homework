/**
 * Characterization tests for the exported DOM builders in `dom-builders.ts`.
 *
 * These tests exist to make the planned split of `dom-builders.ts` into
 * focused domain modules (`menus.ts`, `rows.ts`, `breadcrumb.ts`, `icons.ts`,
 * `tables.ts`) provably safe: each exported builder is exercised DIRECTLY at
 * its own unit boundary (rather than only indirectly through `renderBrowse` /
 * `renderSearch`), with edge cases that the renderer integration suites do not
 * reach. If a function is moved to a new module and its observable behavior
 * changes, the corresponding test here fails.
 *
 * What is pinned per function:
 *   - `buildTable`        → `tables.ts`     : exact DOM shape (class, thead/tbody,
 *                                                th text via textContent, empty-body,
 *                                                HTML-injection-safe headers).
 *   - `makeNavLink`       → `breadcrumb.ts` : href set verbatim via setAttribute,
 *                                                click → preventDefault + navigate.
 *   - `renderBreadcrumb`  → `breadcrumb.ts` : Home link + cumulative segment links
 *                                                + class-less '/' separators, path
 *                                                normalization, content replacement.
 *   - `makeParentRow`     → `rows.ts`       : parent-row class, 4 cells, '..' link,
 *                                                whole-row navigation, no context menu.
 *   - `makeBrowseRow`     → `rows.ts`       : file vs folder row structure, classes,
 *                                                actions-cell exception, right-click
 *                                                opens the row menu, injection-safe.
 *   - `makeSearchRow`     → `rows.ts`       : file (download <a>) vs directory (nav
 *                                                <a>) name cell, path/size/modified
 *                                                columns, injection-safe.
 *   - `createMenuState`   → `menus.ts`      : fresh independent state, default
 *                                                no-op openCurrentDirMenu,
 *                                                closeAllRowMenus idempotent contract.
 *   - `setupDirContextMenu`→ `menus.ts`     : appends a hidden .row-menu, rebinds
 *                                                openCurrentDirMenu per call, wires
 *                                                the contextmenu listener ONCE, and
 *                                                ignores right-clicks inside the
 *                                                table or an open .row-menu.
 *
 * Environment: happy-dom (these tests need a DOM).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  buildTable,
  makeNavLink,
  renderBreadcrumb,
  makeParentRow,
  makeBrowseRow,
  makeSearchRow,
  createMenuState,
  setupDirContextMenu,
} from './dom-builders';
import { toBrowseHash } from '../router';
import { formatBytes } from '../format';
import { getApi } from './context';
import { setupCleared, fileEntry, ISO_FMT, installAppTestLifecycle } from './test-helpers';

installAppTestLifecycle();

// Reset the location hash before each test so navigation assertions start from
// a known state. Between tests no app is mounted (the shared lifecycle clears
// document.body in afterEach), so assigning the hash fires no hashchange
// listener. Tests that mount an app (renderBreadcrumb) call setupCleared()
// afterwards, which sets the hash itself.
beforeEach(() => {
  window.location.hash = '';
});

/* ===========================================================================
 * buildTable — the generic results-table skeleton (→ tables.ts)
 * ========================================================================= */
describe('buildTable', () => {
  it('returns an HTMLTableElement whose className is exactly "results-table"', () => {
    const table = buildTable(['Name']);
    expect(table).toBeInstanceOf(HTMLTableElement);
    expect(table.className).toBe('results-table');
  });

  it('creates one <thead> holding a single <tr> with one <th> per header label, in order', () => {
    const table = buildTable(['Name', 'Size', 'Modified', '']);
    const theads = table.querySelectorAll('thead');
    expect(theads).toHaveLength(1);
    const headRows = theads[0].querySelectorAll('tr');
    expect(headRows).toHaveLength(1);
    const ths = Array.from(headRows[0].querySelectorAll('th'));
    expect(ths.map((th) => th.textContent)).toEqual(['Name', 'Size', 'Modified', '']);
  });

  it('creates exactly one empty <tbody> (no rows) so the caller appends into it', () => {
    const table = buildTable(['A', 'B']);
    const tbodies = table.querySelectorAll('tbody');
    expect(tbodies).toHaveLength(1);
    expect(tbodies[0].querySelectorAll('tr')).toHaveLength(0);
  });

  it('inserts header labels via textContent (HTML-special characters are NOT parsed)', () => {
    // A label that looks like markup must remain literal text, proving headers
    // are HTML-injection-safe even when sourced from user input.
    const table = buildTable(['<b>bold</b>', 'a&b']);
    const ths = Array.from(table.querySelectorAll('thead th'));
    expect(ths[0].textContent).toBe('<b>bold</b>');
    expect(ths[0].querySelector('b')).toBeNull();
    expect(ths[1].textContent).toBe('a&b');
  });

  it('preserves header whitespace verbatim (no trimming)', () => {
    const table = buildTable(['  spaced  ']);
    expect(table.querySelector('thead th')!.textContent).toBe('  spaced  ');
  });

  it('handles an empty headers array: thead has an empty <tr>, tbody still present', () => {
    const table = buildTable([]);
    expect(table.querySelectorAll('thead tr')).toHaveLength(1);
    expect(table.querySelectorAll('thead th')).toHaveLength(0);
    expect(table.querySelectorAll('tbody')).toHaveLength(1);
  });
});

/* ===========================================================================
 * makeNavLink — the in-app navigation anchor (→ breadcrumb.ts)
 * ========================================================================= */
describe('makeNavLink', () => {
  it('returns an <a> whose textContent is the label and href is the hash', () => {
    const link = makeNavLink('sub', '#/browse/docs/sub');
    expect(link.tagName).toBe('A');
    expect(link.textContent).toBe('sub');
    expect(link.getAttribute('href')).toBe('#/browse/docs/sub');
  });

  it('sets href via setAttribute so the raw value is preserved exactly (no normalization)', () => {
    // A hash containing a literal space and a '?' must be stored verbatim so
    // middle-click / copy-link yield the exact target (the doc calls this out
    // as important for download URLs especially).
    const link = makeNavLink('weird', '#/browse/a b?c=d');
    expect(link.getAttribute('href')).toBe('#/browse/a b?c=d');
  });

  it('inserts the label via textContent (markup in the label is not parsed)', () => {
    const link = makeNavLink('<img src=x>', '#/browse/x');
    expect(link.textContent).toBe('<img src=x>');
    expect(link.querySelector('img')).toBeNull();
  });

  it('on click calls preventDefault and navigates so window.location.hash becomes the hash', () => {
    const link = makeNavLink('sub', toBrowseHash('docs/sub'));
    const evt = new MouseEvent('click', { cancelable: true, bubbles: true });
    link.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
    expect(window.location.hash).toBe(toBrowseHash('docs/sub'));
  });

  it('carries an href attribute (enables middle-click / copy-link, not only a JS handler)', () => {
    const link = makeNavLink('x', toBrowseHash('x'));
    expect(link.hasAttribute('href')).toBe(true);
  });
});

/* ===========================================================================
 * createMenuState — the per-mount menu open/close state (→ menus.ts)
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
    // This is the per-mount isolation contract the hardening suite relies on;
    // pinned here at the factory's own boundary.
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
 * setupDirContextMenu — the current-directory blank-space menu (→ menus.ts)
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
 * renderBreadcrumb — the shared breadcrumb element populator (→ breadcrumb.ts)
 *
 * Needs the app context (getBreadcrumb) established by startApp, so each test
 * mounts the app via setupCleared() before calling renderBreadcrumb directly.
 * ========================================================================= */
describe('renderBreadcrumb', () => {
  it('for the root path renders only a Home link (no separators)', async () => {
    const { breadcrumb } = await setupCleared();
    renderBreadcrumb('');

    const links = Array.from(breadcrumb.querySelectorAll('a'));
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('Home');
    expect(links[0].getAttribute('href')).toBe(toBrowseHash(''));
    expect(breadcrumb.querySelectorAll('span')).toHaveLength(0);
  });

  it('for "a/b/c" renders Home + three segment links and three "/" separators with cumulative hrefs', async () => {
    const { breadcrumb } = await setupCleared();
    renderBreadcrumb('a/b/c');

    const links = Array.from(breadcrumb.querySelectorAll('a'));
    expect(links.map((a) => a.textContent)).toEqual(['Home', 'a', 'b', 'c']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      toBrowseHash(''),
      toBrowseHash('a'),
      toBrowseHash('a/b'),
      toBrowseHash('a/b/c'),
    ]);
    const separators = Array.from(breadcrumb.querySelectorAll('span'));
    expect(separators).toHaveLength(3);
    for (const sep of separators) {
      expect(sep.textContent).toBe('/');
      expect(sep.className).toBe('');
    }
  });

  it('replaces (not appends to) previous breadcrumb content on each call', async () => {
    const { breadcrumb } = await setupCleared();
    renderBreadcrumb('a/b/c');
    renderBreadcrumb('x');

    const links = Array.from(breadcrumb.querySelectorAll('a'));
    expect(links.map((a) => a.textContent)).toEqual(['Home', 'x']);
  });

  it('normalizes leading/trailing/doubled slashes before splitting into segments', async () => {
    const { breadcrumb } = await setupCleared();
    renderBreadcrumb('//a//b//');

    const links = Array.from(breadcrumb.querySelectorAll('a'));
    expect(links.map((a) => a.textContent)).toEqual(['Home', 'a', 'b']);
  });

  it("clicking a segment navigates to that segment's cumulative browse hash", async () => {
    const { breadcrumb } = await setupCleared();
    renderBreadcrumb('a/b');

    const segB = Array.from(breadcrumb.querySelectorAll('a')).find((a) => a.textContent === 'b')!;
    segB.dispatchEvent(new MouseEvent('click', { cancelable: true, bubbles: true }));

    expect(window.location.hash).toBe(toBrowseHash('a/b'));
  });
});

/* ===========================================================================
 * makeParentRow — the ".." parent navigation row (→ rows.ts)
 * ========================================================================= */
describe('makeParentRow', () => {
  it('returns a <tr class="parent-row"> with exactly four <td> cells', () => {
    const row = makeParentRow('docs');
    expect(row.tagName).toBe('TR');
    expect(row.className).toBe('parent-row');
    const cells = Array.from(row.querySelectorAll('td'));
    expect(cells).toHaveLength(4);
  });

  it('the first cell holds an <a> labelled ".." pointing at toBrowseHash(parent); the other three cells are empty', () => {
    const row = makeParentRow('docs/sub');
    const cells = Array.from(row.querySelectorAll('td'));
    const link = cells[0].querySelector('a')!;
    expect(link.textContent).toBe('..');
    expect(link.getAttribute('href')).toBe(toBrowseHash('docs/sub'));
    for (const cell of cells.slice(1)) {
      expect(cell.textContent).toBe('');
      expect(cell.children).toHaveLength(0);
    }
  });

  it('clicking anywhere in the row (not just the link) navigates to the parent browse hash', () => {
    const row = makeParentRow('docs');
    // Click the empty Size cell — whole-row navigation should still fire.
    const sizeCell = row.querySelectorAll('td')[1];
    sizeCell.dispatchEvent(new MouseEvent('click', { cancelable: true, bubbles: true }));
    expect(window.location.hash).toBe(toBrowseHash('docs'));
  });

  it('does not attach a row context menu — right-click does not preventDefault', () => {
    const row = makeParentRow('docs');
    const evt = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    row.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);
  });
});

/* ===========================================================================
 * makeBrowseRow — one browse data row (→ rows.ts)
 *
 * Handler-level behavior (Delete/Move/Copy/Download confirmations, error
 * surfacing, re-rendering) is exhaustively covered by render-browse.test.ts and
 * dom-builders.hardening.test.ts; these tests pin only the row-level structural
 * contract and the whole-row / right-click wiring that live in makeBrowseRow.
 * ========================================================================= */
describe('makeBrowseRow', () => {
  it('a FILE row: 4 cells, plain-text name (no link), no folder-row class, and an actions cell holding one .row-menu-btn + one .row-menu', () => {
    const row = makeBrowseRow(
      fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false, size: 10 }),
      createMenuState(),
    );
    expect(row.className).toBe('');
    const cells = Array.from(row.querySelectorAll('td'));
    expect(cells).toHaveLength(4);
    expect(cells[0].children).toHaveLength(0); // plain text, no <a>
    expect(cells[0].textContent).toBe('a.txt');
    const actions = cells[3];
    expect(actions.querySelectorAll('.row-menu-btn')).toHaveLength(1);
    expect(actions.querySelectorAll('.row-menu')).toHaveLength(1);
  });

  it('a FOLDER row: name cell is a navigation <a>, the row carries folder-row, and the size cell shows the child count', () => {
    const row = makeBrowseRow(
      fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true, itemCount: 7 }),
      createMenuState(),
    );
    expect(row.classList.contains('folder-row')).toBe(true);
    const cells = Array.from(row.querySelectorAll('td'));
    const link = cells[0].querySelector('a')!;
    expect(link.textContent).toBe('sub');
    expect(link.getAttribute('href')).toBe(toBrowseHash('docs/sub'));
    expect(cells[1].textContent).toBe('7');
  });

  it('a folder row navigates on a click in the Size cell, but NOT on a click in the actions cell', () => {
    const row = makeBrowseRow(
      fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true, itemCount: 0 }),
      createMenuState(),
    );
    const cells = Array.from(row.querySelectorAll('td'));
    const sizeCell = cells[1];
    const actionsCell = cells[3];

    // Size cell click → whole-row navigation.
    sizeCell.dispatchEvent(new MouseEvent('click', { cancelable: true, bubbles: true }));
    expect(window.location.hash).toBe(toBrowseHash('docs/sub'));

    // Actions cell click → excluded from whole-row navigation (no nav change).
    window.location.hash = '';
    actionsCell.dispatchEvent(new MouseEvent('click', { cancelable: true, bubbles: true }));
    expect(window.location.hash).toBe('');
  });

  it('clicking the ⋮ button opens the row menu (hidden=false) and does not navigate', () => {
    const row = makeBrowseRow(
      fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false, size: 0 }),
      createMenuState(),
    );
    const btn = row.querySelector('.row-menu-btn') as HTMLButtonElement;
    const menu = row.querySelector('.row-menu') as HTMLElement;
    expect(menu.hidden).toBe(true);

    btn.click();

    expect(menu.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(window.location.hash).toBe('');
  });

  it('right-clicking a data row prevents default and opens the row menu at the cursor', () => {
    const row = makeBrowseRow(
      fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false, size: 0 }),
      createMenuState(),
    );
    const menu = row.querySelector('.row-menu') as HTMLElement;

    const evt = new MouseEvent('contextmenu', {
      cancelable: true,
      bubbles: true,
      clientX: 30,
      clientY: 40,
    });
    row.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true);
    expect(menu.hidden).toBe(false);
    expect(menu.style.left).toBe('30px');
    expect(menu.style.top).toBe('40px');
  });

  it('inserts the file name via textContent (markup in the name is not parsed as HTML)', () => {
    const row = makeBrowseRow(
      fileEntry({ name: '<img src=x onerror=alert(1)>', path: 'docs/x', isDirectory: false }),
      createMenuState(),
    );
    const nameCell = Array.from(row.querySelectorAll('td'))[0];
    expect(nameCell.querySelector('img')).toBeNull();
    expect(nameCell.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

/* ===========================================================================
 * makeSearchRow — one search-result data row (→ rows.ts)
 * ========================================================================= */
describe('makeSearchRow', () => {
  it('a FILE result: 4 cells (Name | Path | Size | Modified); name is an <a> whose href is the raw downloadUrl', () => {
    const entry = fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false, size: 1536 });
    const row = makeSearchRow(entry);
    expect(row.tagName).toBe('TR');
    const cells = Array.from(row.querySelectorAll('td'));
    expect(cells).toHaveLength(4);

    const link = cells[0].querySelector('a')!;
    expect(link.textContent).toBe('a.txt');
    // href set verbatim via setAttribute (must equal the raw download URL).
    expect(link.getAttribute('href')).toBe(getApi().downloadUrl('docs/a.txt'));
    expect(link.getAttribute('download')).toBeNull(); // search name link is not a download anchor

    expect(cells[1].textContent).toBe('docs/a.txt'); // Path
    expect(cells[2].textContent).toBe(formatBytes(1536)); // Size
    expect(cells[3].textContent).toBe(ISO_FMT); // Modified
  });

  it('a DIRECTORY result: name is a navigation <a> pointing at toBrowseHash(entry.path)', () => {
    const entry = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true, itemCount: 3 });
    const row = makeSearchRow(entry);
    const cells = Array.from(row.querySelectorAll('td'));
    const link = cells[0].querySelector('a')!;
    expect(link.textContent).toBe('sub');
    expect(link.getAttribute('href')).toBe(toBrowseHash('docs/sub'));
    expect(cells[2].textContent).toBe('3'); // child count
  });

  it('a directory with itemCount 0 renders a blank Size cell (not "0")', () => {
    const row = makeSearchRow(
      fileEntry({ name: 'empty', path: 'docs/empty', isDirectory: true, itemCount: 0 }),
    );
    const cells = Array.from(row.querySelectorAll('td'));
    expect(cells[2].textContent).toBe('');
  });

  it('inserts the name and path via textContent (no HTML injection)', () => {
    const evil = fileEntry({
      name: '<b>name</b>',
      path: '<script>x</script>',
      isDirectory: false,
    });
    const row = makeSearchRow(evil);
    const cells = Array.from(row.querySelectorAll('td'));
    expect(cells[0].querySelector('b')).toBeNull();
    expect(cells[0].textContent).toBe('<b>name</b>');
    expect(cells[1].querySelector('script')).toBeNull();
    expect(cells[1].textContent).toBe('<script>x</script>');
  });
});
