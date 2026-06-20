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
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
  it('builds a table with header Name | Size | Modified | (blank Actions header)', async () => {
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [] }));

    const table = results.querySelector('table');
    expect(table).toBeTruthy();
    const headers = Array.from(table!.querySelectorAll('th')).map((h) => h.textContent!.trim());
    // The Actions column has no visible header label now: the 4th <th> is
    // empty, but all four <th> remain so the header column count lines up
    // with the four <td> per body row (uniform :nth-child targeting).
    expect(headers).toEqual(['Name', 'Size', 'Modified', '']);
  });

  it('tags the browse table with the browse-table class alongside results-table', async () => {
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [] }));

    const table = results.querySelector('table')!;
    expect(table.classList.contains('results-table')).toBe(true);
    expect(table.classList.contains('browse-table')).toBe(true);
  });

  it('keeps the Actions column header th empty but present (four header cells)', async () => {
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [] }));

    const headers = Array.from(results.querySelector('table')!.querySelectorAll('thead th'));
    expect(headers).toHaveLength(4);
    expect(headers[3].textContent).toBe('');
  });

  it('keeps four td per body row so column counts line up with the header', async () => {
    const entries = [
      fileEntry({ name: 'a.txt', isDirectory: false, size: 10 }),
      fileEntry({ name: 'sub', isDirectory: true }),
    ];
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries }));

    for (const row of dataRows(results.querySelector('table')!)) {
      expect(cellsOf(row)).toHaveLength(4);
    }
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
    renderBrowse(browseResult({ path: 'docs/sub', parent: 'docs', entries: [] }));
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
      const evil = fileEntry({
        name: '<img src=x onerror=alert(1)>',
        path: 'docs/x',
        isDirectory: false,
      });
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
      renderBrowse(browseResult({ path: 'docs', entries: [file, dir] }));

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

  /* =====================================================================
   * Row action menu — "⋮" dropdown button + right-click context menu
   *
   * The inline Download/Delete/Move/Copy controls are replaced by a single
   * `.row-menu-btn` (the "⋮" three-dots button) that opens a `.row-menu`
   * dropdown, and the SAME menu also opens on a right-click (`contextmenu`)
   * anywhere on the data row, positioned at the cursor. The ".." parent row
   * is navigation-only: no button, no menu, no contextmenu handler.
   *
   * These tests pin the new structure + open/close/positioning contract. The
   * EXISTING Actions-column behavior tests (Download/Delete/Move/Copy + error
   * surfacing) are left untouched and keep passing because clicking a button
   * inside a `hidden` menu still dispatches in happy-dom.
   * ===================================================================== */
  describe('row action menu (⋮ dropdown + right-click context menu)', () => {
    const file = fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false, size: 10 });
    const dir = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true });

    function actionsOf(results: HTMLElement, name: string): Element {
      const row = rowByName(results.querySelector('table')!, name)!;
      return cellsOf(row)[3];
    }
    function menuBtnOf(actions: Element): HTMLButtonElement {
      return actions.querySelector('.row-menu-btn') as HTMLButtonElement;
    }
    function menuOf(actions: Element): HTMLElement {
      return actions.querySelector('.row-menu') as HTMLElement;
    }

    // Ensure no row menu is left open by a prior test. An Escape keydown closes
    // any open menu and removes its document listeners — idempotent no-op when
    // none is open — giving every test below a clean slate.
    beforeEach(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    describe('structure', () => {
      it('a data row actions cell contains exactly one .row-menu-btn and one .row-menu', async () => {
        const { results } = await setupCleared();
        renderBrowse(browseResult({ path: 'docs', entries: [file, dir] }));

        for (const name of ['a.txt', 'sub']) {
          const actions = actionsOf(results, name);
          expect(actions.querySelectorAll('.row-menu-btn')).toHaveLength(1);
          expect(actions.querySelectorAll('.row-menu')).toHaveLength(1);
        }
      });

      it('the .row-menu-btn is a button[type=button] with aria-label="Actions", aria-haspopup="true", and textContent ⋮', async () => {
        const { results } = await setupCleared();
        renderBrowse(browseResult({ path: 'docs', entries: [file] }));

        const btn = menuBtnOf(actionsOf(results, 'a.txt'));
        expect(btn.tagName).toBe('BUTTON');
        expect(btn.className).toBe('row-menu-btn');
        expect(btn.getAttribute('type')).toBe('button');
        expect(btn.getAttribute('aria-label')).toBe('Actions');
        expect(btn.getAttribute('aria-haspopup')).toBe('true');
        // U+22EE VERTICAL ELLIPSIS — three vertical dots.
        expect(btn.textContent?.trim()).toBe('⋮');
        expect(btn.textContent?.trim()).toBe('\u22EE');
      });

      it('the .row-menu is hidden initially and its button has aria-expanded="false"', async () => {
        const { results } = await setupCleared();
        renderBrowse(browseResult({ path: 'docs', entries: [file] }));

        const actions = actionsOf(results, 'a.txt');
        const menu = menuOf(actions);
        const btn = menuBtnOf(actions);
        expect(menu.className).toBe('row-menu');
        expect(menu.hidden).toBe(true);
        expect(btn.getAttribute('aria-expanded')).toBe('false');
      });

      it('the actions cell direct children are exactly [button.row-menu-btn, div.row-menu]', async () => {
        const { results } = await setupCleared();
        renderBrowse(browseResult({ path: 'docs', entries: [file] }));

        const actions = actionsOf(results, 'a.txt');
        const kids = Array.from(actions.children);
        expect(kids).toHaveLength(2);
        expect(kids[0]).toBe(menuBtnOf(actions));
        expect((kids[1] as HTMLElement).className).toBe('row-menu');
      });
    });

    describe('menu contents', () => {
      it('file menu: Download(a) + Delete/Move/Copy(buttons) in that order, all inside .row-menu', async () => {
        const { results } = await setupCleared();
        renderBrowse(browseResult({ path: 'docs', entries: [file] }));

        const menu = menuOf(actionsOf(results, 'a.txt'));
        const items = Array.from(menu.children);
        expect(items).toHaveLength(4);
        expect(items[0].tagName).toBe('A');
        expect((items[0].textContent ?? '').trim()).toBe('Download');
        expect((items[0] as HTMLElement).className).toBe('btn');
        expect(items[1].tagName).toBe('BUTTON');
        expect((items[1].textContent ?? '').trim()).toBe('Delete');
        expect(items[2].tagName).toBe('BUTTON');
        expect((items[2].textContent ?? '').trim()).toBe('Move');
        expect(items[3].tagName).toBe('BUTTON');
        expect((items[3].textContent ?? '').trim()).toBe('Copy');
      });

      it('folder menu: Delete/Move/Copy only (NO Download anchor), inside .row-menu', async () => {
        const { results } = await setupCleared();
        renderBrowse(browseResult({ path: 'docs', entries: [dir] }));

        const menu = menuOf(actionsOf(results, 'sub'));
        expect(menu.querySelector('a')).toBeNull();
        const items = Array.from(menu.children);
        expect(items).toHaveLength(3);
        expect((items[0].textContent ?? '').trim()).toBe('Delete');
        expect((items[1].textContent ?? '').trim()).toBe('Move');
        expect((items[2].textContent ?? '').trim()).toBe('Copy');
      });

      it('the ⋮ button is not matched by buttonsByText(Delete|Move|Copy) and is not an <a>', async () => {
        const { results } = await setupCleared();
        renderBrowse(browseResult({ path: 'docs', entries: [file, dir] }));

        for (const name of ['a.txt', 'sub']) {
          const actions = actionsOf(results, name);
          // Exactly one of each — the ⋮ button (text '⋮') does not collide.
          expect(buttonsByText(actions, 'Delete')).toHaveLength(1);
          expect(buttonsByText(actions, 'Move')).toHaveLength(1);
          expect(buttonsByText(actions, 'Copy')).toHaveLength(1);
          // The ⋮ control is a <button>, never an <a> (so the 'folders have no
          // <a>' characterization still holds for folder rows).
          expect(menuBtnOf(actions).tagName).toBe('BUTTON');
        }
      });

      it('each data row still has exactly 4 td (column count unchanged)', async () => {
        const { results } = await setupCleared();
        renderBrowse(browseResult({ path: 'docs', entries: [file, dir] }));

        for (const row of dataRows(results.querySelector('table')!)) {
          expect(cellsOf(row)).toHaveLength(4);
        }
      });
    });

    describe('open/close via the ⋮ button', () => {
      it('clicking the ⋮ button opens the menu (not hidden, aria-expanded="true") and positions it', async () => {
        const { results } = await setupCleared();
        renderBrowse(browseResult({ path: 'docs', entries: [file] }));

        const actions = actionsOf(results, 'a.txt');
        const btn = menuBtnOf(actions);
        const menu = menuOf(actions);

        btn.click();

        expect(menu.hidden).toBe(false);
        expect(btn.getAttribute('aria-expanded')).toBe('true');
        // Positioned at pixel coordinates (from getBoundingClientRect).
        expect(menu.style.left).toMatch(/^-?\d+px$/);
        expect(menu.style.top).toMatch(/^-?\d+px$/);
      });

      it('clicking the ⋮ button again closes the menu', async () => {
        const { results } = await setupCleared();
        renderBrowse(browseResult({ path: 'docs', entries: [file] }));

        const actions = actionsOf(results, 'a.txt');
        const btn = menuBtnOf(actions);
        const menu = menuOf(actions);

        btn.click();
        expect(menu.hidden).toBe(false);

        btn.click();
        expect(menu.hidden).toBe(true);
        expect(btn.getAttribute('aria-expanded')).toBe('false');
      });

      it('a click anywhere outside the menu closes an open menu', async () => {
        const { results } = await setupCleared();
        renderBrowse(browseResult({ path: 'docs', entries: [file] }));

        const actions = actionsOf(results, 'a.txt');
        const btn = menuBtnOf(actions);
        const menu = menuOf(actions);

        btn.click();
        expect(menu.hidden).toBe(false);

        // A click on an unrelated element bubbles up to document and closes.
        const outside = document.createElement('div');
        document.body.append(outside);
        outside.click();
        outside.remove();

        expect(menu.hidden).toBe(true);
        expect(btn.getAttribute('aria-expanded')).toBe('false');
      });

      it('pressing Escape closes an open menu', async () => {
        const { results } = await setupCleared();
        renderBrowse(browseResult({ path: 'docs', entries: [file] }));

        const actions = actionsOf(results, 'a.txt');
        const btn = menuBtnOf(actions);
        const menu = menuOf(actions);

        btn.click();
        expect(menu.hidden).toBe(false);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

        expect(menu.hidden).toBe(true);
        expect(btn.getAttribute('aria-expanded')).toBe('false');
      });

      it('clicking a menu item bubbles to document and closes the open menu', async () => {
        const { results } = await setupCleared();
        renderBrowse(browseResult({ path: 'docs', entries: [file] }));
        // Cancel the confirm so no delete / re-render happens — isolates the
        // close behavior to the click-bubbles-to-document path.
        vi.spyOn(window, 'confirm').mockReturnValue(false);

        const actions = actionsOf(results, 'a.txt');
        menuBtnOf(actions).click();
        const menu = menuOf(actions);
        expect(menu.hidden).toBe(false);

        buttonsByText(actions, 'Delete')[0].click();

        expect(menu.hidden).toBe(true);
      });
    });

    describe('right-click context menu', () => {
      it('contextmenu on a data row prevents default and opens the menu at clientX/clientY', async () => {
        const { results } = await setupCleared();
        renderBrowse(browseResult({ path: 'docs', entries: [file] }));

        const row = rowByName(results.querySelector('table')!, 'a.txt')!;
        const actions = actionsOf(results, 'a.txt');
        const menu = menuOf(actions);
        const btn = menuBtnOf(actions);

        const evt = new MouseEvent('contextmenu', {
          cancelable: true,
          bubbles: true,
          clientX: 137,
          clientY: 242,
        });
        row.dispatchEvent(evt);

        expect(evt.defaultPrevented).toBe(true);
        expect(menu.hidden).toBe(false);
        expect(btn.getAttribute('aria-expanded')).toBe('true');
        expect(menu.style.left).toBe('137px');
        expect(menu.style.top).toBe('242px');
      });

      it('contextmenu opens the SAME menu element that lives in the row actions cell', async () => {
        const { results } = await setupCleared();
        renderBrowse(browseResult({ path: 'docs', entries: [file] }));

        const row = rowByName(results.querySelector('table')!, 'a.txt')!;
        const menuInCell = menuOf(actionsOf(results, 'a.txt'));

        row.dispatchEvent(
          new MouseEvent('contextmenu', {
            cancelable: true,
            bubbles: true,
            clientX: 1,
            clientY: 2,
          }),
        );

        // No second menu was created — the now-visible menu IS the cell's menu.
        expect(results.querySelectorAll('.row-menu')).toHaveLength(1);
        expect(menuInCell.hidden).toBe(false);
        expect(document.querySelector('.row-menu')).toBe(menuInCell);
      });

      it('opening a second row menu closes the first (only one open at a time)', async () => {
        const entries = [
          fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false, size: 10 }),
          fileEntry({ name: 'b.txt', path: 'docs/b.txt', isDirectory: false, size: 20 }),
        ];
        const { results } = await setupCleared();
        renderBrowse(browseResult({ path: 'docs', entries }));

        const rowB = rowByName(results.querySelector('table')!, 'b.txt')!;
        const menuA = menuOf(actionsOf(results, 'a.txt'));
        const menuB = menuOf(actionsOf(results, 'b.txt'));

        // Open A via its ⋮ button.
        menuBtnOf(actionsOf(results, 'a.txt')).click();
        expect(menuA.hidden).toBe(false);

        // Open B via right-click — A must close (only one menu at a time).
        rowB.dispatchEvent(
          new MouseEvent('contextmenu', {
            cancelable: true,
            bubbles: true,
            clientX: 9,
            clientY: 9,
          }),
        );
        expect(menuB.hidden).toBe(false);
        expect(menuA.hidden).toBe(true);
      });

      it('the ".." parent row has no .row-menu-btn / .row-menu and right-click opens nothing / does not preventDefault', async () => {
        const { results } = await setupCleared();
        renderBrowse(browseResult({ path: 'docs/sub', parent: 'docs', entries: [file] }));

        const parentRow = rowByName(results.querySelector('table')!, '..')!;
        const parentActions = cellsOf(parentRow)[3];
        expect(parentActions.querySelector('.row-menu-btn')).toBeNull();
        expect(parentActions.querySelector('.row-menu')).toBeNull();
        expect((parentActions.textContent ?? '').trim()).toBe('');

        const evt = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
        parentRow.dispatchEvent(evt);
        // No menu appeared anywhere, and the event was NOT prevented (the
        // parent row has no contextmenu handler).
        expect(evt.defaultPrevented).toBe(false);
        expect(results.querySelectorAll('.row-menu:not([hidden])')).toHaveLength(0);
      });
    });
  });
});
