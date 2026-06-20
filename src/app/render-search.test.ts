/**
 * Tests for `renderSearch` — the search-result renderer (table headers, rows,
 * per-result columns, directory-name navigation, file-name download, and the
 * status footer).
 *
 * Split out of the former `src/app.test.ts` monolith (task-29). Shared
 * fixtures, DOM scaffolding, and the per-test fetch stub come from
 * `./test-helpers`.
 *
 * Environment: the project-default `happy-dom` (these tests need a DOM).
 *
 * Contract decisions encoded here (carried over from the monolith):
 *  - Clicking a directory result name navigates (asserted via
 *    `window.location.hash`); clicking a search-result FILE name opens its
 *    download URL. The spec does not pin the file-open mechanism, so that test
 *    accepts EITHER an `<a href={downloadUrl}>` OR a `window.open(downloadUrl)`
 *    call.
 *  - The results table uses a `<thead>` (header `<th>` row) and a `<tbody>`
 *    (data `<td>` rows). Column order for search is
 *    `Name | Path | Size | Modified`.
 *  - `renderSearch` operates against the DOM context `startApp` establishes
 *    (module-level element refs), so every test calls `setupCleared()` first.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderSearch } from '../app';
import type { FileEntry } from '../api';
import { toBrowseHash } from '../router';
import {
  setupCleared,
  fileEntry,
  dataRows,
  cellsOf,
  rowByName,
  clickNameLink,
  ISO_FMT,
  installAppTestLifecycle,
} from './test-helpers';

installAppTestLifecycle();

/* ===========================================================================
 * renderSearch — table, rows, navigation
 * ========================================================================= */
describe('renderSearch', () => {
  it('builds a table with header Name | Path | Size | Modified', async () => {
    const { results } = await setupCleared();
    renderSearch(
      { query: 'foo', path: '', results: [] },
    );

    const table = results.querySelector('table');
    expect(table).toBeTruthy();
    const headers = Array.from(table!.querySelectorAll('th')).map((h) => h.textContent!.trim());
    expect(headers).toEqual(['Name', 'Path', 'Size', 'Modified']);
  });

  it('renders one row per result with its path, size and modified date', async () => {
    const results_data: FileEntry[] = [
      fileEntry({ name: 'a.txt', path: 'docs/a.txt', size: 1536 }),
      fileEntry({ name: 'b.txt', path: 'other/b.txt', size: 0 }),
    ];
    const { results } = await setupCleared();
    renderSearch({ query: 'q', path: '', results: results_data });

    const table = results.querySelector('table')!;
    expect(dataRows(table)).toHaveLength(2);
    const cells = cellsOf(rowByName(table, 'a.txt')!);
    expect(cells[1].textContent?.trim()).toBe('docs/a.txt'); // Path
    expect(cells[2].textContent?.trim()).toBe('1.5 KB'); // Size
    expect(cells[3].textContent?.trim()).toBe(ISO_FMT); // Modified
  });

  it('clicking a directory result name navigates to toBrowseHash(entry.path)', async () => {
    const dir = fileEntry({ name: 'matchdir', path: 'docs/matchdir', isDirectory: true });
    const { results } = await setupCleared();
    renderSearch({ query: 'match', path: '', results: [dir] });

    clickNameLink(rowByName(results.querySelector('table')!, 'matchdir')!);
    expect(window.location.hash).toBe(toBrowseHash('docs/matchdir'));
  });

  it('clicking a file result name opens api.downloadUrl(entry.path)', async () => {
    const file = fileEntry({ name: 'match.txt', path: 'docs/match.txt', isDirectory: false });
    const { results } = await setupCleared();
    renderSearch({ query: 'match', path: '', results: [file] });
    const expectedUrl = '/api/files/download?path=' + encodeURIComponent('docs/match.txt');

    const nameCell = cellsOf(rowByName(results.querySelector('table')!, 'match.txt')!)[0];
    const link = nameCell.querySelector('a, button') as HTMLElement | null;
    expect(link).toBeTruthy();

    // The spec says clicking "opens" the download URL. Two reasonable mechanisms
    // are acceptable: an <a href={downloadUrl}> (mirroring the Download control)
    // or a click handler that calls window.open(downloadUrl). Accept either so
    // the test does not over-constrain the implementation choice.
    const hrefOpens = link!.getAttribute('href') === expectedUrl;
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    link!.click();
    const openedViaWindow = openSpy.mock.calls.some((c) => c[0] === expectedUrl);
    expect(hrefOpens || openedViaWindow).toBe(true);
  });

  it('shows the result count and query in the status footer', async () => {
    const { status } = await setupCleared();
    renderSearch(
      {
        query: 'foo',
        path: '',
        results: [
          fileEntry({ name: 'a.txt' }),
          fileEntry({ name: 'b.txt' }),
        ],
      },
    );

    expect(status.textContent).toContain('2 results for "foo"');
  });
});
