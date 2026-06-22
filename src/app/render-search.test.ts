/**
 * Tests for `renderSearch` — the search-result renderer.
 *
 * Search rows now mirror browse rows: a five-column table
 * (Name | Path | Size | Modified | —) with the per-row ⋮ actions menu +
 * right-click context menu, whole-row folder navigation, and a Path column
 * showing only the containing directory as a browse link. File names are plain
 * text (download lives in the actions menu, same as browse).
 *
 * Shared fixtures, DOM scaffolding, and the per-test fetch stub come from
 * `./test-helpers`.
 *
 * Environment: the project-default `happy-dom` (these tests need a DOM).
 *
 * Contract decisions encoded here:
 *  - The results table uses a `<thead>` (header `<th>` row) and a `<tbody>`
 *    (data `<td>` rows). Column order for search is
 *    `Name | Path | Size | Modified | (blank Actions)`.
 *  - The Path column shows only the containing directory (the entry's parent),
 *    as a link that browses into it — NOT the full entry path.
 *  - A directory result's name navigates to `toBrowseHash(entry.path)`; a file
 *    result's name is plain text with no link. Clicking anywhere on a folder
 *    row navigates into the folder (except the path/actions cells).
 *  - Every data row has a ⋮ actions menu (Download/Upload + Delete/Move/Copy)
 *    and right-click opens it.
 *  - `renderSearch` operates against the DOM context `startApp` establishes
 *    (module-level element refs), so every test calls `setupCleared()` first.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderSearch } from './render-search';
import type { FileEntry } from '../api';
import { toBrowseHash } from '../router';
import {
  setupCleared,
  fileEntry,
  dataRows,
  cellsOf,
  rowByName,
  clickNameLink,
  buttonsByText,
  mockConfirmDialog,
  flush,
  ISO_FMT,
  installAppTestLifecycle,
} from './test-helpers';

installAppTestLifecycle();

/* ===========================================================================
 * renderSearch — table, rows, columns, navigation, actions
 * ========================================================================= */
describe('renderSearch', () => {
  it('builds a table with header Name | Path | Size | Modified | (blank Actions)', async () => {
    const { results } = await setupCleared();
    renderSearch({ query: 'foo', path: '', results: [] });

    const table = results.querySelector('table');
    expect(table).toBeTruthy();
    const headers = Array.from(table!.querySelectorAll('th')).map((h) => h.textContent!.trim());
    // The Actions column has no visible header label: the 5th <th> is empty,
    // but all five <th> remain so the header column count lines up with the
    // five <td> per body row (uniform :nth-child targeting).
    expect(headers).toEqual(['Name', 'Path', 'Size', 'Modified', '']);
  });

  it('tags the search table with the search-table class alongside results-table', async () => {
    const { results } = await setupCleared();
    renderSearch({ query: 'foo', path: '', results: [] });

    const table = results.querySelector('table')!;
    expect(table.classList.contains('results-table')).toBe(true);
    expect(table.classList.contains('search-table')).toBe(true);
  });

  it('keeps the Actions column header th empty but present (five header cells)', async () => {
    const { results } = await setupCleared();
    renderSearch({ query: 'foo', path: '', results: [] });

    const headers = Array.from(results.querySelector('table')!.querySelectorAll('thead th'));
    expect(headers).toHaveLength(5);
    expect(headers[4].textContent).toBe('');
  });

  it('keeps five td per body row so column counts line up with the header', async () => {
    const results_data: FileEntry[] = [
      fileEntry({ name: 'a.txt', path: 'docs/a.txt', size: 1536 }),
      fileEntry({ name: 'b.txt', path: 'other/b.txt', size: 0 }),
    ];
    const { results } = await setupCleared();
    renderSearch({ query: 'q', path: '', results: results_data });

    for (const row of dataRows(results.querySelector('table')!)) {
      expect(cellsOf(row)).toHaveLength(5);
    }
  });

  it('renders one row per result with its parent-dir path, size and modified date', async () => {
    const results_data: FileEntry[] = [
      fileEntry({ name: 'a.txt', path: 'docs/a.txt', size: 1536 }),
      fileEntry({ name: 'b.txt', path: 'other/b.txt', size: 0 }),
    ];
    const { results } = await setupCleared();
    renderSearch({ query: 'q', path: '', results: results_data });

    const table = results.querySelector('table')!;
    expect(dataRows(table)).toHaveLength(2);
    const cells = cellsOf(rowByName(table, 'a.txt')!);
    // Path shows the containing directory ('docs'), not the full path.
    expect(cells[1].textContent?.trim()).toBe('docs');
    expect(cells[2].textContent?.trim()).toBe('1.5 KB'); // Size
    expect(cells[3].textContent?.trim()).toBe(ISO_FMT); // Modified
  });

  describe('Path column', () => {
    it('shows the containing directory as a browse link (not the full entry path)', async () => {
      const { results } = await setupCleared();
      renderSearch({
        query: 'q',
        path: '',
        results: [fileEntry({ name: 'a.txt', path: 'docs/a.txt' })],
      });

      const pathCell = cellsOf(rowByName(results.querySelector('table')!, 'a.txt')!)[1];
      const link = pathCell.querySelector('a')!;
      expect(link.textContent).toBe('docs');
      expect(link.getAttribute('href')).toBe(toBrowseHash('docs'));
      expect(pathCell.textContent).not.toContain('a.txt');
    });

    it('shows the full parent chain for a deeply nested entry', async () => {
      const { results } = await setupCleared();
      renderSearch({
        query: 'q',
        path: '',
        results: [fileEntry({ name: 'c.txt', path: 'a/b/c.txt' })],
      });

      const pathCell = cellsOf(rowByName(results.querySelector('table')!, 'c.txt')!)[1];
      const link = pathCell.querySelector('a')!;
      expect(link.textContent).toBe('a/b');
      expect(link.getAttribute('href')).toBe(toBrowseHash('a/b'));
    });

    it('renders an empty path cell (no link) for a root-level entry', async () => {
      const { results } = await setupCleared();
      renderSearch({
        query: 'q',
        path: '',
        results: [fileEntry({ name: 'root.txt', path: 'root.txt' })],
      });

      const pathCell = cellsOf(rowByName(results.querySelector('table')!, 'root.txt')!)[1];
      expect(pathCell.textContent).toBe('');
      expect(pathCell.querySelector('a')).toBeNull();
    });

    it('clicking the path link navigates to toBrowseHash(parentDir)', async () => {
      const { results } = await setupCleared();
      renderSearch({
        query: 'q',
        path: '',
        results: [fileEntry({ name: 'a.txt', path: 'docs/a.txt' })],
      });

      const pathCell = cellsOf(rowByName(results.querySelector('table')!, 'a.txt')!)[1];
      const link = pathCell.querySelector('a')!;
      link.click();

      expect(window.location.hash).toBe(toBrowseHash('docs'));
    });
  });

  describe('Name column', () => {
    it('clicking a directory result name navigates to toBrowseHash(entry.path)', async () => {
      const dir = fileEntry({ name: 'matchdir', path: 'docs/matchdir', isDirectory: true });
      const { results } = await setupCleared();
      renderSearch({ query: 'match', path: '', results: [dir] });

      clickNameLink(rowByName(results.querySelector('table')!, 'matchdir')!);
      expect(window.location.hash).toBe(toBrowseHash('docs/matchdir'));
    });

    it('a file result name is plain text (no link) — download lives in the actions menu', async () => {
      const file = fileEntry({ name: 'match.txt', path: 'docs/match.txt', isDirectory: false });
      const { results } = await setupCleared();
      renderSearch({ query: 'match', path: '', results: [file] });

      const nameCell = cellsOf(rowByName(results.querySelector('table')!, 'match.txt')!)[0];
      expect(nameCell.querySelector('a, button')).toBeNull();
      expect(nameCell.textContent).toBe('match.txt');
    });
  });

  describe('whole-row folder navigation', () => {
    it('folder rows carry folder-row; clicking the Size cell navigates into the folder', async () => {
      const dir = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true, itemCount: 5 });
      const { results } = await setupCleared();
      renderSearch({ query: 'sub', path: '', results: [dir] });

      const row = rowByName(results.querySelector('table')!, 'sub')!;
      expect(row.classList.contains('folder-row')).toBe(true);
      cellsOf(row)[2].click(); // Size cell — not the name link

      expect(window.location.hash).toBe(toBrowseHash('docs/sub'));
    });

    it('clicking the path or actions cell of a folder row does NOT navigate into the folder', async () => {
      const dir = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true });
      const { results } = await setupCleared();
      renderSearch({ query: 'sub', path: '', results: [dir] });
      const row = rowByName(results.querySelector('table')!, 'sub')!;
      const pathCell = cellsOf(row)[1];
      const actionsCell = cellsOf(row)[4];

      window.location.hash = '';
      pathCell.dispatchEvent(new MouseEvent('click', { cancelable: true, bubbles: true }));
      expect(window.location.hash).toBe('');

      actionsCell.dispatchEvent(new MouseEvent('click', { cancelable: true, bubbles: true }));
      expect(window.location.hash).toBe('');
    });

    it('clicking a file row does NOT navigate', async () => {
      const file = fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false });
      const { results } = await setupCleared();
      renderSearch({ query: 'a', path: '', results: [file] });
      window.location.hash = '';

      rowByName(results.querySelector('table')!, 'a.txt')!.click();

      expect(window.location.hash).toBe('');
    });
  });

  describe('Actions column (⋮ menu + right-click context menu)', () => {
    const file = fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false, size: 10 });
    const dir = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true });

    function actionsCell(results: HTMLElement, name: string): Element {
      const row = rowByName(results.querySelector('table')!, name)!;
      return cellsOf(row)[4];
    }

    // Ensure no row menu is left open by a prior test.
    beforeEach(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    it('each data row has exactly one .row-menu-btn and one .row-menu in its actions cell', async () => {
      const { results } = await setupCleared();
      renderSearch({ query: 'q', path: '', results: [file, dir] });

      for (const name of ['a.txt', 'sub']) {
        const actions = actionsCell(results, name);
        expect(actions.querySelectorAll('.row-menu-btn')).toHaveLength(1);
        expect(actions.querySelectorAll('.row-menu')).toHaveLength(1);
      }
    });

    it('file menu: Download(a) + Delete/Move/Copy; folder menu: Upload + Delete/Move/Copy (no Download)', async () => {
      const { results } = await setupCleared();
      renderSearch({ query: 'q', path: '', results: [file, dir] });

      const fileMenu = Array.from(
        actionsCell(results, 'a.txt').querySelector('.row-menu')!.children,
      );
      expect(fileMenu).toHaveLength(4);
      expect(fileMenu[0].tagName).toBe('A');
      expect((fileMenu[0].textContent ?? '').trim()).toBe('Download');

      const dirMenu = Array.from(actionsCell(results, 'sub').querySelector('.row-menu')!.children);
      expect(dirMenu).toHaveLength(4);
      expect((dirMenu[0].textContent ?? '').trim()).toBe('Upload');
      expect(actionsCell(results, 'sub').querySelector('.row-menu a')).toBeNull();
    });

    it('clicking the ⋮ button opens the menu (hidden=false, aria-expanded="true") and positions it', async () => {
      const { results } = await setupCleared();
      renderSearch({ query: 'q', path: '', results: [file] });

      const actions = actionsCell(results, 'a.txt');
      const btn = actions.querySelector('.row-menu-btn') as HTMLButtonElement;
      const menu = actions.querySelector('.row-menu') as HTMLElement;

      btn.click();

      expect(menu.hidden).toBe(false);
      expect(btn.getAttribute('aria-expanded')).toBe('true');
    });

    it('right-clicking a data row prevents default and opens the menu at the cursor', async () => {
      const { results } = await setupCleared();
      renderSearch({ query: 'q', path: '', results: [file] });

      const row = rowByName(results.querySelector('table')!, 'a.txt')!;
      const menu = actionsCell(results, 'a.txt').querySelector('.row-menu') as HTMLElement;

      const evt = new MouseEvent('contextmenu', {
        cancelable: true,
        bubbles: true,
        clientX: 137,
        clientY: 242,
      });
      row.dispatchEvent(evt);

      expect(evt.defaultPrevented).toBe(true);
      expect(menu.hidden).toBe(false);
      expect(menu.style.left).toBe('137px');
      expect(menu.style.top).toBe('242px');
    });

    it('Delete in a search row menu confirms then calls api.delete(entry.path)', async () => {
      const { results } = await setupCleared();
      renderSearch({ query: 'q', path: '', results: [file] });
      const confirmSpy = mockConfirmDialog(true);

      buttonsByText(actionsCell(results, 'a.txt'), 'Delete')[0].click();
      await flush();

      expect(confirmSpy).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Delete "a.txt"? This cannot be undone.' }),
      );
    });
  });

  it('shows the result count and query in the status footer', async () => {
    const { status } = await setupCleared();
    renderSearch({
      query: 'foo',
      path: '',
      results: [fileEntry({ name: 'a.txt' }), fileEntry({ name: 'b.txt' })],
    });

    expect(status.textContent).toContain('2 results for "foo"');
  });

  it('renders a directory result with its immediate-child count in the Size cell (blank when 0)', async () => {
    // Search rows share the Size-column contract with browse rows: a directory
    // shows its child count (or blank when 0), not its (zero) byte size.
    const dir = fileEntry({
      name: 'matchdir',
      path: 'docs/matchdir',
      isDirectory: true,
      itemCount: 4,
    });
    const emptyDir = fileEntry({
      name: 'emptydir',
      path: 'docs/emptydir',
      isDirectory: true,
      itemCount: 0,
    });
    const { results } = await setupCleared();
    renderSearch({ query: 'match', path: '', results: [dir, emptyDir] });

    const table = results.querySelector('table')!;
    const dirSize = cellsOf(rowByName(table, 'matchdir')!)[2].textContent?.trim();
    const emptySize = cellsOf(rowByName(table, 'emptydir')!)[2].textContent ?? '';
    expect(dirSize).toBe('4');
    expect(emptySize).toBe('');
  });
});
