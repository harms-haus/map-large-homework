/**
 * Tests for `renderBrowse` — the browse-result renderer (table headers, rows,
 * columns, in-app navigation, the Actions column with Download/Delete/Move/Copy
 * + their error surfacing, the breadcrumb, and the status footer).
 *
 * Split out of the former `src/app.test.ts` monolith (task-29). Shared
 * fixtures, DOM scaffolding, and the per-test fetch stub come from
 * `./test-helpers`.
 *
 * Environment: the project-default `happy-dom` (these tests need a DOM).
 *
 * Contract decisions encoded here (carried over from the monolith):
 *  - In-app navigation (directory name links, the ".." parent row, breadcrumb
 *    segments) is verified by asserting on `window.location.hash` after a
 *    click — robust to either a `navigate(...)` call OR an
 *    `<a href="#...">` (happy-dom follows hash-fragment href clicks).
 *  - The results table uses a `<thead>` (header `<th>` row) and a `<tbody>`
 *    (data `<td>` rows). Column order for browse is
 *    `Name | Size | Modified | Actions`.
 *  - `renderBrowse` operates against the DOM context `startApp` establishes
 *    (module-level element refs), so every test calls `setup()`/`setupCleared()`
 *    first.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderBrowse } from '../app';
import { toBrowseHash } from '../router';
import { formatBytes, normalizeRelativePath } from '../format';
import { mockResponse } from '../test-utils/mock-response';
import {
  setup,
  setupCleared,
  flush,
  browseResult,
  fileEntry,
  dataRows,
  rowByName,
  cellsOf,
  clickNameLink,
  buttonsByText,
  fetchMock,
  ISO_FMT,
  installAppTestLifecycle,
} from './test-helpers';

installAppTestLifecycle();

/* ===========================================================================
 * renderBrowse — table, rows, columns, navigation, actions
 * ========================================================================= */
describe('renderBrowse', () => {
  it('builds a table with header Name | Size | Modified | Actions', async () => {
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [] }));

    const table = results.querySelector('table');
    expect(table).toBeTruthy();
    const headers = Array.from(table!.querySelectorAll('th')).map((h) => h.textContent!.trim());
    expect(headers).toEqual(['Name', 'Size', 'Modified', 'Actions']);
  });

  it('renders one data row per entry when there is no parent', async () => {
    const entries = [
      fileEntry({ name: 'a.txt', isDirectory: false, size: 10 }),
      fileEntry({ name: 'sub', isDirectory: true }),
    ];
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries }));

    expect(dataRows(results.querySelector('table')!)).toHaveLength(2);
  });

  it('prepends a ".." parent row only when result.parent is not null', async () => {
    const entry = fileEntry({ name: 'a.txt' });
    const { results } = await setupCleared();

    renderBrowse(browseResult({ path: 'docs/sub', parent: 'docs', entries: [entry] }));
    const tableWithParent = results.querySelector('table')!;
    const rowsWithParent = dataRows(tableWithParent);
    expect(rowsWithParent).toHaveLength(2);
    expect(cellsOf(rowsWithParent[0])[0].textContent?.trim()).toBe('..');

    results.innerHTML = '';
    renderBrowse(browseResult({ path: 'docs', parent: null, entries: [entry] }));
    const tableNoParent = results.querySelector('table')!;
    expect(dataRows(tableNoParent)).toHaveLength(1);
    expect(cellsOf(dataRows(tableNoParent)[0])[0].textContent?.trim()).toBe('a.txt');
  });

  it('clicking the ".." row navigates to toBrowseHash(result.parent)', async () => {
    const { results } = await setupCleared();
    renderBrowse(
      browseResult({ path: 'docs/sub', parent: 'docs', entries: [] }),
    );
    const parentRow = rowByName(results.querySelector('table')!, '..')!;

    clickNameLink(parentRow);

    expect(window.location.hash).toBe(toBrowseHash('docs'));
  });

  describe('directory rows', () => {
    it('renders the name and an em-dash size, and clicking the name navigates into the folder', async () => {
      const dir = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true });
      const { results } = await setupCleared();
      renderBrowse(browseResult({ path: 'docs', entries: [dir] }));

      const row = rowByName(results.querySelector('table')!, 'sub')!;
      const [nameCell, sizeCell] = cellsOf(row);
      expect(nameCell.textContent?.trim()).toBe('sub');
      expect(sizeCell.textContent?.trim()).toBe('—');

      clickNameLink(row);
      expect(window.location.hash).toBe(toBrowseHash('docs/sub'));
    });
  });

  describe('file rows', () => {
    const file = fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false, size: 1536 });

    it('renders the name as plain text (no navigation link)', async () => {
      const { results } = await setupCleared();
      renderBrowse(browseResult({ path: 'docs', entries: [file] }));
      const row = rowByName(results.querySelector('table')!, 'a.txt')!;
      const [nameCell] = cellsOf(row);
      expect(nameCell.textContent?.trim()).toBe('a.txt');
      expect(nameCell.querySelector('a, button')).toBeNull();
    });

    it('shows formatBytes(size) for the Size column', async () => {
      const { results } = await setupCleared();
      renderBrowse(browseResult({ path: 'docs', entries: [file] }));
      const row = rowByName(results.querySelector('table')!, 'a.txt')!;
      const sizeCell = cellsOf(row)[1];
      expect(sizeCell.textContent?.trim()).toBe(formatBytes(1536));
      expect(sizeCell.textContent?.trim()).toBe('1.5 KB');
    });

    it('shows formatDate(lastModified) for the Modified column', async () => {
      const { results } = await setupCleared();
      renderBrowse(browseResult({ path: 'docs', entries: [file] }));
      const row = rowByName(results.querySelector('table')!, 'a.txt')!;
      const modifiedCell = cellsOf(row)[2];
      expect(modifiedCell.textContent?.trim()).toBe(ISO_FMT);
    });

    it('escapes names via textContent (no HTML injection)', async () => {
      const evil = fileEntry({ name: '<img src=x onerror=alert(1)>', path: 'docs/x', isDirectory: false });
      const { results } = await setupCleared();
      renderBrowse(browseResult({ path: 'docs', entries: [evil] }));

      const nameCell = cellsOf(rowByName(results.querySelector('table')!, evil.name)!)[0];
      // The literal markup must NOT have been parsed as HTML.
      expect(results.querySelector('img')).toBeNull();
      expect(nameCell.textContent).toContain('<img');
    });
  });

  describe('Actions column', () => {
    const file = fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false, size: 10 });
    const dir = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true });

    function actionsCell(results: HTMLElement, name: string): Element {
      const row = rowByName(results.querySelector('table')!, name)!;
      return cellsOf(row)[3];
    }

    it('gives files a Download anchor pointing at api.downloadUrl(path) with download=name', async () => {
      const { results } = await setupCleared();
      renderBrowse(browseResult({ path: 'docs', entries: [file] }));

      const actions = actionsCell(results, 'a.txt');
      const link = actions.querySelector('a.btn') as HTMLAnchorElement;
      expect(link).toBeTruthy();
      expect(link.textContent?.trim()).toBe('Download');
      expect(link.getAttribute('href')).toBe(
        '/api/files/download?path=' + encodeURIComponent('docs/a.txt'),
      );
      expect(link.getAttribute('download')).toBe('a.txt');
    });

    it('gives both files and folders Delete, Move, and Copy buttons', async () => {
      const { results } = await setupCleared();
      renderBrowse(
        browseResult({ path: 'docs', entries: [file, dir] }),
      );

      for (const name of ['a.txt', 'sub']) {
        const actions = actionsCell(results, name);
        expect(buttonsByText(actions, 'Delete')).toHaveLength(1);
        expect(buttonsByText(actions, 'Move')).toHaveLength(1);
        expect(buttonsByText(actions, 'Copy')).toHaveLength(1);
      }
    });

    it('folders have no Download anchor', async () => {
      const { results } = await setupCleared();
      renderBrowse(browseResult({ path: 'docs', entries: [dir] }));
      const actions = actionsCell(results, 'sub');
      expect(actions.querySelector('a')).toBeNull();
    });

    it('Delete confirms then calls api.delete(entry.path)', async () => {
      const { results } = setup();
      await flush();
      results.innerHTML = '';
      renderBrowse(browseResult({ path: 'docs', entries: [file] }));
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

      buttonsByText(actionsCell(results, 'a.txt'), 'Delete')[0].click();
      await flush();

      expect(confirmSpy).toHaveBeenCalledWith('Delete "a.txt"?');
      const deleteCalls = fetchMock.mock.calls.filter(
        ([u, init]) => String(u).includes('/delete') && (init?.method ?? 'GET') === 'DELETE',
      );
      expect(deleteCalls).toHaveLength(1);
      expect(String(deleteCalls[0][0])).toBe(
        '/api/files/delete?path=' + encodeURIComponent('docs/a.txt'),
      );
    });

    it('Delete does nothing when the user cancels the confirm', async () => {
      const { results } = await setupCleared();
      renderBrowse(browseResult({ path: 'docs', entries: [file] }));
      vi.spyOn(window, 'confirm').mockReturnValue(false);

      buttonsByText(actionsCell(results, 'a.txt'), 'Delete')[0].click();
      await flush();

      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/delete'))).toBe(false);
    });

    it('Move prompts for a destination then calls api.move with the normalized path', async () => {
      const { results } = setup();
      await flush();
      results.innerHTML = '';
      renderBrowse(browseResult({ path: 'docs', entries: [file] }));
      vi.spyOn(window, 'prompt').mockReturnValue('/docs/archive/a.txt');

      buttonsByText(actionsCell(results, 'a.txt'), 'Move')[0].click();
      await flush();

      const moveCalls = fetchMock.mock.calls.filter(
        ([u, init]) => String(u).includes('/move') && (init?.method ?? 'GET') === 'POST',
      );
      expect(moveCalls).toHaveLength(1);
      const [, init] = moveCalls[0];
      const headers = init?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init!.body as string)).toEqual({
        sourcePath: 'docs/a.txt',
        destinationPath: normalizeRelativePath('/docs/archive/a.txt'),
      });
    });

    it('Move does nothing when the user cancels the prompt', async () => {
      const { results } = await setupCleared();
      renderBrowse(browseResult({ path: 'docs', entries: [file] }));
      vi.spyOn(window, 'prompt').mockReturnValue(null);

      buttonsByText(actionsCell(results, 'a.txt'), 'Move')[0].click();
      await flush();

      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/move'))).toBe(false);
    });

    it('Copy prompts for a destination then calls api.copy with the normalized path', async () => {
      const { results } = setup();
      await flush();
      results.innerHTML = '';
      renderBrowse(browseResult({ path: 'docs', entries: [file] }));
      vi.spyOn(window, 'prompt').mockReturnValue('/docs/copy/a.txt');

      buttonsByText(actionsCell(results, 'a.txt'), 'Copy')[0].click();
      await flush();

      const copyCalls = fetchMock.mock.calls.filter(
        ([u, init]) => String(u).includes('/copy') && (init?.method ?? 'GET') === 'POST',
      );
      expect(copyCalls).toHaveLength(1);
      const [, init] = copyCalls[0];
      const headers = init?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init!.body as string)).toEqual({
        sourcePath: 'docs/a.txt',
        destinationPath: normalizeRelativePath('/docs/copy/a.txt'),
      });
    });

    describe('error surfacing (rejecting handlers)', () => {
      /* The Delete/Move/Copy handlers are async and `await api.X(...)`. If the
         API rejects (e.g. 400 for an invalid destination, 500 for a server
         error), `makeActionButton` must surface the error to the user rather
         than leaking an unhandled promise rejection. Contract: the message
         appears in the `.status` footer — the same surface `render()` uses for
         fetch errors — formatted as `Error: <message>`. The ApiClient throws
         `new Error(status + ': ' + body)`, and the wrapper prepends `Error: `,
         so the full text is `Error: <status>: <body>`. The success path is
         unchanged: a handler that resolves normally shows no error. */
      function failMutation(method: string, fragment: string, status: number, text: string): void {
        fetchMock.mockImplementation(async (url, init) => {
          const u = String(url);
          const m = (init?.method ?? 'GET').toUpperCase();
          if (m === method && u.includes(fragment)) {
            return mockResponse({ status, text });
          }
          // Everything else (including any incidental re-render browse) stays
          // permissive so background GETs never throw.
          return mockResponse({ status: 200, body: {} });
        });
      }

      async function actionsForFile(): Promise<{
        actions: Element;
        status: HTMLElement;
        results: HTMLElement;
      }> {
        const ctx = setup();
        await flush();
        ctx.results.innerHTML = '';
        renderBrowse(browseResult({ path: 'docs', entries: [file] }));
        return {
          actions: actionsCell(ctx.results, 'a.txt'),
          status: ctx.status,
          results: ctx.results,
        };
      }

      const browseCallCount = (): number =>
        fetchMock.mock.calls.filter(([u]) => String(u).includes('/browse')).length;

      it('Delete: surfaces a rejecting api.delete in the .status footer', async () => {
        const { actions, status } = await actionsForFile();
        failMutation('DELETE', '/delete', 500, 'boom');
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        buttonsByText(actions, 'Delete')[0].click();
        await flush();

        expect(status.textContent).toBe('Error: 500: boom');
      });

      it('Move: surfaces a rejecting api.move in .status (e.g. 400 invalid destination)', async () => {
        const { actions, status } = await actionsForFile();
        failMutation('POST', '/move', 400, 'invalid destination');
        vi.spyOn(window, 'prompt').mockReturnValue('/docs/missing/a.txt');

        buttonsByText(actions, 'Move')[0].click();
        await flush();

        expect(status.textContent).toBe('Error: 400: invalid destination');
      });

      it('Copy: surfaces a rejecting api.copy in .status', async () => {
        const { actions, status } = await actionsForFile();
        failMutation('POST', '/copy', 409, 'already exists');
        vi.spyOn(window, 'prompt').mockReturnValue('/docs/a.txt');

        buttonsByText(actions, 'Copy')[0].click();
        await flush();

        expect(status.textContent).toBe('Error: 409: already exists');
      });

      it('surfaces a non-Error rejection (e.g. a thrown string) via String(err)', async () => {
        const { actions, status } = await actionsForFile();
        fetchMock.mockImplementation(async (_url, init) => {
          const m = (init?.method ?? 'GET').toUpperCase();
          if (m === 'DELETE') {
            // Reject with a bare string — NOT an Error instance — so the
            // wrapper must fall back to String(err).
            throw 'disk on fire';
          }
          return mockResponse({ status: 200, body: {} });
        });
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        buttonsByText(actions, 'Delete')[0].click();
        await flush();

        expect(status.textContent).toBe('Error: disk on fire');
      });

      it('surfaces the error in .status only — the results table is left intact', async () => {
        const { actions, status, results } = await actionsForFile();
        failMutation('DELETE', '/delete', 500, 'boom');
        vi.spyOn(window, 'confirm').mockReturnValue(true);

        buttonsByText(actions, 'Delete')[0].click();
        await flush();

        // The error is in the status footer, NOT in .results (which is where
        // `render()` surfaces fetch errors — a distinct code path). The table
        // built by renderBrowse is untouched because the handler rejects before
        // calling render().
        expect(status.textContent).toBe('Error: 500: boom');
        expect(results.querySelector('table')).toBeTruthy();
        expect(results.textContent).not.toContain('Error');
        expect(results.textContent).toContain('a.txt');
      });

      it('Delete success: shows no error and still re-renders (success path unchanged)', async () => {
        const { actions, status } = await actionsForFile();
        // Default mock: DELETE returns 200 → handler resolves normally.
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const before = browseCallCount();

        buttonsByText(actions, 'Delete')[0].click();
        await flush();
        await flush();
        await flush();

        expect(status.textContent).not.toContain('Error');
        // The handler still calls render() on success, so browse is fetched again.
        expect(browseCallCount()).toBeGreaterThan(before);
      });

      it('Move success: shows no error (success path unchanged)', async () => {
        const { actions, status } = await actionsForFile();
        vi.spyOn(window, 'prompt').mockReturnValue('/docs/archive/a.txt');

        buttonsByText(actions, 'Move')[0].click();
        await flush();
        await flush();
        await flush();

        expect(status.textContent).not.toContain('Error');
      });

      it('Copy success: shows no error (success path unchanged)', async () => {
        const { actions, status } = await actionsForFile();
        vi.spyOn(window, 'prompt').mockReturnValue('/docs/archive/a.txt');

        buttonsByText(actions, 'Copy')[0].click();
        await flush();
        await flush();
        await flush();

        expect(status.textContent).not.toContain('Error');
      });

      it('shows no error when the user cancels (confirm false / prompt null)', async () => {
        const { actions, status } = await actionsForFile();

        // Delete cancelled — handler returns early before any await, no throw.
        vi.spyOn(window, 'confirm').mockReturnValue(false);
        buttonsByText(actions, 'Delete')[0].click();
        await flush();
        expect(status.textContent).not.toContain('Error');

        // Move cancelled — prompt returns null, handler returns early.
        vi.spyOn(window, 'prompt').mockReturnValue(null);
        buttonsByText(actions, 'Move')[0].click();
        await flush();
        expect(status.textContent).not.toContain('Error');

        // Copy cancelled — same.
        buttonsByText(actions, 'Copy')[0].click();
        await flush();
        expect(status.textContent).not.toContain('Error');
      });
    });
  });

  describe('breadcrumb', () => {
    function leafByText(container: Element, text: string): Element | undefined {
      return Array.from(container.querySelectorAll('*')).find(
        (el) => el.children.length === 0 && (el.textContent ?? '').trim() === text,
      );
    }

    it('renders clickable segments that navigate to each cumulative path', async () => {
      const { breadcrumb } = await setupCleared();
      renderBrowse(browseResult({ path: 'a/b', entries: [] }));

      const segB = leafByText(breadcrumb, 'b')! as HTMLElement;
      segB.click();
      expect(window.location.hash).toBe(toBrowseHash('a/b'));

      const segA = leafByText(breadcrumb, 'a')! as HTMLElement;
      segA.click();
      expect(window.location.hash).toBe(toBrowseHash('a'));
    });
  });

  describe('status footer', () => {
    it('shows folder count, file count, and total size for browse results', async () => {
      const { status } = await setupCleared();
      renderBrowse(
        browseResult({
          path: 'docs',
          entries: [],
          folderCount: 2,
          fileCount: 3,
          totalSize: 1536,
        }),
      );

      const text = status.textContent ?? '';
      expect(text).toContain('2 folders');
      expect(text).toContain('3 files');
      expect(text).toContain(formatBytes(1536)); // "1.5 KB"
    });
  });
});
