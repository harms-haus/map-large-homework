/**
 * Tests for `src/app.ts`'s module surface and `startApp` bootstrap: the
 * imperative DOM scaffold it builds, the dialog open/close + create-on-open
 * widget lifecycle, and the two characterization suites that pin app.ts's retained
 * imports and its (dead-)CSS-selector-relevant DOM output.
 *
 * Shared fixtures, DOM scaffolding, and the per-test fetch stub come from
 * `./test-helpers`.
 *
 * Environment: the project-default `happy-dom` (these tests need a DOM).
 *
 * Contract decisions encoded by these suites:
 *  - The action controls Delete / Move / Copy are `<button>` elements whose
 *    trimmed `textContent` is exactly `"Delete"` / `"Move"` / `"Copy"`.
 *  - Importing `./app` must not side-effect when there is no `#app` element.
 */
import { describe, it, expect, vi } from 'vitest';
import { startApp } from '../app';
import { renderBrowse } from './render-browse';
import { renderSearch } from './render-search';
import { toBrowseHash, toSearchHash } from '../router';
import {
  setup,
  setupCleared,
  browseResult,
  fileEntry,
  cellsOf,
  rowByName,
  clickNameLink,
  dataRows,
  flush,
  installAppTestLifecycle,
} from './test-helpers';

installAppTestLifecycle();

/* ===========================================================================
 * Module surface / bootstrap guard
 * ========================================================================= */
describe('app module surface', () => {
  it('exports startApp, renderBrowse, and renderSearch as functions', () => {
    expect(typeof startApp).toBe('function');
    expect(typeof renderBrowse).toBe('function');
    expect(typeof renderSearch).toBe('function');
  });

  it('can be imported without a DOM #app element present (bootstrap is guarded)', () => {
    // Importing this test file already imported '../app'. That import ran the
    // bootstrap line `const root = document.getElementById('app'); if (root)
    // startApp(root);` against an empty document and did not throw — reaching
    // this assertion proves the guard. We additionally assert there is no
    // stray dialog created at module load time.
    expect(document.querySelector('dialog.browser-dialog')).toBeNull();
  });
});

/* ===========================================================================
 * startApp — DOM structure & dialog wiring
 * ========================================================================= */
describe('startApp', () => {
  describe('DOM structure', () => {
    it('creates a trigger button labelled "Browse Files"', () => {
      const { trigger } = setup();
      expect(trigger).toBeTruthy();
      expect(trigger.className).toBe('trigger');
      expect(trigger.textContent?.trim()).toBe('Browse Files');
    });

    it('creates a native <dialog class="browser-dialog"> that starts closed', () => {
      const { dialog } = setup();
      expect(dialog).toBeTruthy();
      expect(dialog.tagName).toBe('DIALOG');
      expect(dialog.className).toBe('browser-dialog');
      expect(dialog.open).toBe(false);
    });

    it('renders a header with a centered title span and an icon Close button', () => {
      const { dialog, closeBtn } = setup();
      expect(closeBtn).toBeTruthy();
      expect(closeBtn.className).toBe('close-btn');
      // No visible text — it's an icon button, so it carries an aria-label.
      expect(closeBtn.textContent?.trim()).toBe('');
      expect(closeBtn.getAttribute('aria-label')).toBe('Close');
      const icon = closeBtn.querySelector('.bi');
      expect(icon).toBeTruthy();
      expect(icon?.className).toContain('bi-x-lg');
      expect(dialog.contains(closeBtn)).toBe(true);
      const titleSpan = dialog.querySelector('.title');
      expect(titleSpan).toBeTruthy();
      expect(titleSpan?.textContent).toBe('File Browser');
    });

    it('renders a toolbar with a breadcrumb container', () => {
      const { breadcrumb } = setup();
      expect(breadcrumb).toBeTruthy();
      expect(breadcrumb.className).toBe('breadcrumb');
    });

    it('renders a search text input inside a .search-wrapper with a magnifying glass icon and a clear button', () => {
      const { searchInput, searchWrapper, searchIcon, searchClearBtn } = setup();
      expect(searchInput).toBeTruthy();
      expect(searchInput.type).toBe('text');
      expect(searchInput.getAttribute('placeholder')).toBe('Search...');
      // The wrapper contains the input, search icon, and clear button
      expect(searchWrapper).toBeTruthy();
      expect(searchWrapper.className).toBe('search-wrapper');
      expect(searchWrapper.contains(searchInput)).toBe(true);
      // Magnifying glass icon at idle
      expect(searchIcon).toBeTruthy();
      expect(searchIcon.className).toContain('bi-search');
      expect(searchIcon.className).toContain('search-icon');
      expect(searchWrapper.contains(searchIcon)).toBe(true);
      // Clear (X) button
      expect(searchClearBtn).toBeTruthy();
      expect(searchClearBtn.className).toBe('clear-btn');
      expect(searchClearBtn.getAttribute('aria-label')).toBe('Clear search');
      const clearIcon = searchClearBtn.querySelector('.bi');
      expect(clearIcon).toBeTruthy();
      expect(clearIcon?.className).toContain('bi-x-lg');
      expect(searchWrapper.contains(searchClearBtn)).toBe(true);
    });

    it('does NOT render a standalone Search button (search fires via debounced input)', () => {
      const { root } = setup();
      const buttons = Array.from(root.querySelectorAll('button'));
      const searchButtons = buttons.filter((b) => (b.textContent ?? '').trim() === 'Search');
      expect(searchButtons).toHaveLength(0);
    });

    it('renders an empty .results container and a .status footer', () => {
      const { results, status } = setup();
      expect(results).toBeTruthy();
      expect(results.className).toBe('results');
      expect(status).toBeTruthy();
      expect(status.tagName).toBe('FOOTER');
      expect(status.className).toBe('status');
    });
  });

  describe('dialog open/close wiring', () => {
    it('opens the dialog (showModal) when the trigger is clicked', () => {
      const { dialog, trigger } = setup();
      const showSpy = vi.spyOn(dialog, 'showModal');

      trigger.click();

      expect(showSpy).toHaveBeenCalledTimes(1);
      expect(dialog.open).toBe(true);
    });

    it('closes the dialog when the Close button is clicked', () => {
      const { dialog, closeBtn } = setup();
      dialog.showModal();
      expect(dialog.open).toBe(true);
      const closeSpy = vi.spyOn(dialog, 'close');

      closeBtn.click();

      expect(closeSpy).toHaveBeenCalledTimes(1);
      expect(dialog.open).toBe(false);
    });
  });

  /* The embedded host holds a permanent widget. While the dialog is open a
     second, separate widget lives in the dialog body. */
  describe('widget lifecycle (embedded host vs dialog)', () => {
    it('renders an embedded host and a single chromeless .file-browser widget while closed', () => {
      const { embeddedHost, widget } = setup();
      expect(embeddedHost).toBeTruthy();
      expect(embeddedHost.className).toBe('file-browser-host');
      expect(widget).toBeTruthy();
      expect(widget.className).toBe('file-browser');
      expect(document.querySelectorAll('.file-browser')).toHaveLength(1);
      expect(embeddedHost.contains(widget)).toBe(true);
    });

    it('the embedded widget stays in its host when the dialog opens', () => {
      const { embeddedHost, widget, dialog, trigger } = setup();
      expect(embeddedHost.contains(widget)).toBe(true);
      expect(dialog.contains(widget)).toBe(false);

      trigger.click();

      expect(embeddedHost.contains(widget)).toBe(true);
      expect(dialog.contains(widget)).toBe(false);
    });

    it('opening the dialog creates a separate .file-browser inside the dialog', () => {
      const { embeddedHost, widget, dialog, trigger } = setup();

      trigger.click();

      expect(dialog.open).toBe(true);
      const dialogWidget = dialog.querySelector('.file-browser');
      expect(dialogWidget).toBeTruthy();
      expect(dialogWidget).not.toBe(widget);
      expect(document.querySelectorAll('.file-browser')).toHaveLength(2);
      expect(embeddedHost.contains(widget)).toBe(true);
      expect(dialog.contains(dialogWidget)).toBe(true);
    });

    it('builds a fresh widget on every open', () => {
      const { dialog, trigger } = setup();

      trigger.click();
      const first = dialog.querySelector('.file-browser');
      expect(first).toBeTruthy();

      dialog.close();
      expect(dialog.querySelector('.file-browser')).toBeNull();
      expect(document.querySelectorAll('.file-browser')).toHaveLength(1);

      trigger.click();
      const second = dialog.querySelector('.file-browser');
      expect(second).toBeTruthy();
      expect(second).not.toBe(first);
      expect(document.querySelectorAll('.file-browser')).toHaveLength(2);
    });

    it('closing discards the dialog widget and leaves the embedded widget in place', () => {
      const { embeddedHost, widget, dialog, trigger } = setup();
      trigger.click();
      expect(document.querySelectorAll('.file-browser')).toHaveLength(2);

      dialog.close();

      expect(dialog.open).toBe(false);
      expect(dialog.querySelector('.file-browser')).toBeNull();
      expect(document.querySelectorAll('.file-browser')).toHaveLength(1);
      expect(embeddedHost.contains(widget)).toBe(true);
    });

    it('the dialog widget is functional — it renders the current route into its own results', async () => {
      const ctx = setup();
      await flush(); // let the initial (embedded) render settle
      const embeddedTable = ctx.results.querySelector('table.browse-table');
      expect(embeddedTable).toBeTruthy();

      ctx.trigger.click();
      await flush(); // let the dialog widget's render settle

      const dialogWidget = ctx.dialog.querySelector('.file-browser');
      expect(dialogWidget?.querySelector('table.browse-table')).toBeTruthy();
      expect(ctx.results.querySelector('table.browse-table')).toBe(embeddedTable);
    });

    it('the embedded widget carries no dialog chrome (no title/close-btn)', () => {
      const { widget } = setup();
      // The titlebar (title + close button) is dialog-only chrome; the embedded
      // widget must not contain a title or close button.
      expect(widget.querySelector('.title')).toBeNull();
      expect(widget.querySelector('.close-btn')).toBeNull();
      expect(widget.querySelector('.dialog-header')).toBeNull();
    });
  });
});

/* ===========================================================================
 * Import characterization
 *
 * Each import used by app.ts is exercised through concrete observable outputs,
 * providing a safety net against accidental removal: if an import were removed,
 * the referenced call would throw (ReferenceError) or emit wrong output and
 * the test would fail.
 *
 * Imports exercised here:
 *   format.js: joinPath, normalizeRelativePath, formatBytes, formatDate
 *   router.js: toBrowseHash, toSearchHash
 * (getCurrentRoute / subscribe / navigate are already covered by the render
 * orchestration and toolbar-handler suites.)
 * ========================================================================= */
describe('import characterization (KEEP-list behaviors)', () => {
  // Local leaf finder; the breadcrumb describe has its own scoped copy.
  function leafByText(container: Element, text: string): HTMLElement | undefined {
    return Array.from(container.querySelectorAll('*')).find(
      (el) => el.children.length === 0 && (el.textContent ?? '').trim() === text,
    ) as HTMLElement | undefined;
  }

  /* --- format.js imports exercised here --- */

  describe('joinPath (breadcrumb cumulative paths)', () => {
    it('joins each cumulative segment across three path levels', async () => {
      const { breadcrumb } = await setupCleared();
      renderBrowse(browseResult({ path: 'a/b/c', entries: [] }));

      leafByText(breadcrumb, 'c')!.click();
      expect(window.location.hash).toBe(toBrowseHash('a/b/c'));

      leafByText(breadcrumb, 'b')!.click();
      expect(window.location.hash).toBe(toBrowseHash('a/b'));
    });
  });

  describe('normalizeRelativePath (breadcrumb path cleaning)', () => {
    it('collapses leading/doubled/trailing slashes before splitting segments', async () => {
      const { breadcrumb } = await setupCleared();
      renderBrowse(browseResult({ path: '//a//b//' }));

      leafByText(breadcrumb, 'b')!.click();
      expect(window.location.hash).toBe(toBrowseHash('a/b'));
    });
  });

  describe('formatBytes (size column)', () => {
    it('renders a 0-byte file as "0 B" (sub-KB integer branch)', async () => {
      const entry = fileEntry({ name: 'empty.txt', path: 'docs/empty.txt', size: 0 });
      const { results } = await setupCleared();
      renderBrowse(browseResult({ path: 'docs', entries: [entry] }));

      const sizeCell = cellsOf(rowByName(results.querySelector('table')!, 'empty.txt')!)[1];
      expect(sizeCell.textContent?.trim()).toBe('0 B');
    });
  });

  describe('formatDate (modified column)', () => {
    it('renders an empty Modified cell when lastModified is empty (fallback)', async () => {
      const entry = fileEntry({ name: 'nodate.txt', path: 'docs/nodate.txt', lastModified: '' });
      const { results } = await setupCleared();
      renderBrowse(browseResult({ path: 'docs', entries: [entry] }));

      const modifiedCell = cellsOf(rowByName(results.querySelector('table')!, 'nodate.txt')!)[2];
      expect(modifiedCell.textContent).toBe('');
    });
  });

  /* --- router.js imports exercised here --- */

  describe('toBrowseHash (per-segment percent-encoding)', () => {
    it('encodes spaces in directory names when navigating into a folder', async () => {
      const dir = fileEntry({ name: 'my folder', path: 'docs/my folder', isDirectory: true });
      const { results } = await setupCleared();
      renderBrowse(browseResult({ path: 'docs', entries: [dir] }));

      clickNameLink(rowByName(results.querySelector('table')!, 'my folder')!);

      expect(window.location.hash).toBe(toBrowseHash('docs/my folder'));
    });
  });

  describe('toSearchHash (query/path percent-encoding)', () => {
    it('encodes special characters in the search query and scope path', async () => {
      vi.useFakeTimers();
      try {
        const { searchInput } = setup({ hash: toBrowseHash('docs') });
        vi.advanceTimersByTime(1000); // settle initial render

        searchInput.value = 'a & b=c?';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(200); // fire the debounce

        expect(window.location.hash).toBe(toSearchHash('a & b=c?', 'docs'));
      } finally {
        vi.useRealTimers();
      }
    });
  });
});

/* ===========================================================================
 * Dead CSS selector characterization
 *
 * `src/app.css` ships rule blocks whose selectors are never emitted by app.ts,
 * so they have zero observable effect on the rendered UI. The tests below pin
 * the JS-side invariants:
 *
 *   - the rendered DOM must never produce an element the unused selectors
 *     could match; and
 *   - any behavior the unused rules *appear* to supply is provided by an
 *     independent mechanism.
 *
 * Unused selectors under test:
 *   (1) `.breadcrumb .separator`         — breadcrumb separators are class-less
 *       `<span>`s holding the literal "/"; nothing carries `separator`.
 *   (2) `.toolbar label.upload-btn` (+ its `:hover` + the descendant
 *       `input[type=file]` rule) — toolbar upload is reached via the
 *       folder/directory context menus, so this label selector never matches.
 *       The suite below pins only the still-relevant breadcrumb invariant.
 *
 * (`.folder-row` is intentionally NOT in this list: folder rows and the ".."
 * parent row carry `folder-row` / `parent-row` so the whole row is
 * click-to-browse — see the dedicated suite below.)
 *
 * These assertions depend only on the DOM app.ts emits, not on any CSS rule.
 * The environment does not load app.css, so a missing rule cannot change
 * `getComputedStyle` here; these tests instead prove the rule could never
 * have matched anything.)
 * ========================================================================= */
describe('dead CSS selector characterization', () => {
  describe('breadcrumb separators are class-less spans (no `.separator`)', () => {
    /** Leaf <span>s whose visible text is exactly the breadcrumb slash. */
    function slashSeparators(container: Element): HTMLSpanElement[] {
      return Array.from(container.querySelectorAll('span')).filter(
        (s) => (s.textContent ?? '').trim() === '/',
      ) as HTMLSpanElement[];
    }

    it('renders one "/" separator per path segment, each a class-less <span>', async () => {
      const { breadcrumb } = await setupCleared();
      renderBrowse(browseResult({ path: 'a/b/c', entries: [] }));

      const separators = slashSeparators(breadcrumb);
      // a/b/c → 3 segments → 3 separators (Home / a / b / c). Verifying the
      // count also pins that the separators are still visibly rendered.
      expect(separators).toHaveLength(3);
      for (const sep of separators) {
        expect(sep.tagName).toBe('SPAN');
        expect(sep.className).toBe('');
        expect(sep.classList.contains('separator')).toBe(false);
      }
      // The dead selector `.breadcrumb .separator` matches nothing.
      expect(document.querySelectorAll('.separator')).toHaveLength(0);
    });

    it('renders no separators for the root path, and still no `.separator` anywhere', async () => {
      const { breadcrumb } = await setupCleared();
      renderBrowse(browseResult({ path: '', entries: [] }));

      expect(slashSeparators(breadcrumb)).toHaveLength(0);
      expect(document.querySelectorAll('.separator')).toHaveLength(0);
    });

    it('search-scope breadcrumbs also use class-less "/" separators', async () => {
      const { breadcrumb } = await setupCleared();
      renderSearch({ query: 'q', path: 'x/y', results: [] });

      const separators = slashSeparators(breadcrumb);
      expect(separators).toHaveLength(2);
      for (const sep of separators) {
        expect(sep.className).toBe('');
        expect(sep.classList.contains('separator')).toBe(false);
      }
      expect(document.querySelectorAll('.separator')).toHaveLength(0);
    });
  });
});

/* ===========================================================================
 * Click-to-browse rows — whole-row navigation
 *
 * Folder rows and the ".." parent row browse into their target on a click
 * ANYWHERE in the row (not only on the name link), so a user is not forced to
 * hit the narrow link. Clicks in a folder row's actions cell (the ⋮ button +
 * its menu) are excluded so those controls keep working. File rows do nothing
 * on left-click. The row classes `folder-row` / `parent-row` drive the pointer
 * cursor (see app.css).
 * ========================================================================= */
describe('click-to-browse rows', () => {
  it('folder rows carry `folder-row`, the ".." parent row carries `parent-row`, and file rows carry neither', async () => {
    const dir = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true });
    const file = fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false });
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs/sub', parent: 'docs', entries: [dir, file] }));

    const rows = dataRows(results.querySelector('table')!);
    expect(rows).toHaveLength(3); // parent + folder + file
    const [parentRow, folderRow, fileRow] = rows;
    expect(parentRow.classList.contains('parent-row')).toBe(true);
    expect(folderRow.classList.contains('folder-row')).toBe(true);
    expect(fileRow.classList.contains('folder-row')).toBe(false);
    expect(fileRow.classList.contains('parent-row')).toBe(false);
    // Exactly the two navigable rows carry a click-to-browse class.
    expect(document.querySelectorAll('.folder-row, .parent-row')).toHaveLength(2);
  });

  it('clicking the Size cell of a folder row navigates into the folder', async () => {
    const dir = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true });
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [dir] }));

    const folderRow = rowByName(results.querySelector('table')!, 'sub')!;
    cellsOf(folderRow)[1].click(); // Size cell (item count) — not the name link

    expect(window.location.hash).toBe(toBrowseHash('docs/sub'));
  });

  it('clicking the Modified cell of a folder row navigates into the folder', async () => {
    const dir = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true });
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [dir] }));

    const folderRow = rowByName(results.querySelector('table')!, 'sub')!;
    cellsOf(folderRow)[2].click(); // Modified cell

    expect(window.location.hash).toBe(toBrowseHash('docs/sub'));
  });

  it('clicking the ".." parent row (not its link) navigates to the parent path', async () => {
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs/sub', parent: 'docs', entries: [] }));

    const parentRow = rowByName(results.querySelector('table')!, '..')!;
    cellsOf(parentRow)[2].click(); // Modified cell — not the ".." link

    expect(window.location.hash).toBe(toBrowseHash('docs'));
  });

  it('clicking a file row does NOT navigate', async () => {
    const file = fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false });
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [file] }));
    window.location.hash = '';

    rowByName(results.querySelector('table')!, 'a.txt')!.click();

    expect(window.location.hash).toBe('');
  });

  it('clicking the ⋮ button (in the actions cell) opens the menu and does NOT navigate', async () => {
    const dir = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true });
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [dir] }));
    window.location.hash = '';

    const folderRow = rowByName(results.querySelector('table')!, 'sub')!;
    const btn = cellsOf(folderRow)[3].querySelector('.row-menu-btn') as HTMLButtonElement;
    const menu = cellsOf(folderRow)[3].querySelector('.row-menu') as HTMLElement;
    btn.click();

    expect(menu.hidden).toBe(false); // menu opened
    expect(window.location.hash).toBe(''); // no navigation from the actions cell
  });
});
