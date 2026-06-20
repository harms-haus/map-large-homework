/**
 * Tests for `src/app.ts` — the SPA entry that wires `api` + `router` + DOM.
 *
 * Environment: the project-default `happy-dom` (these tests need a DOM).
 *
 * This module is being developed test-first, so the assertions below pin the
 * observable contract from the task spec. Where the spec left the exact
 * mechanism open, these contract decisions are encoded and documented inline:
 *
 *  - In-app navigation (directory links, the ".." parent row, breadcrumb
 *    segments, search-result directory names) is verified by asserting on
 *    `window.location.hash` after a click. This is robust to either
 *    implementation strategy: a click handler that calls `navigate(...)`, or an
 *    `<a href="#...">` (happy-dom follows hash-fragment href clicks).
 *  - Clicking a search-result FILE name opens its download URL. The spec does
 *    not pin the mechanism, so that test accepts EITHER an
 *    `<a href={downloadUrl}>` OR a `window.open(downloadUrl)` call.
 *  - The action controls Delete / Move / Copy are `<button>` elements whose
 *    trimmed `textContent` is exactly `"Delete"` / `"Move"` / `"Copy"`.
 *  - `renderBrowse` / `renderSearch` operate against the DOM context that
 *    `startApp` establishes (module-level element references), so every test
 *    calls `setup()` first.
 *  - The results table uses a `<thead>` (header `<th>` row) and a `<tbody>`
 *    (data `<td>` rows). Column order for browse is
 *    `Name | Size | Modified | Actions`; for search `Name | Path | Size |
 *    Modified`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startApp, renderBrowse, renderSearch } from './app';
import type { BrowseResult, FileEntry, SearchResult } from './api';
import type { Route } from './router';
import { toBrowseHash, toSearchHash, navigate } from './router';
import { normalizeRelativePath, formatBytes } from './format';

/* ===========================================================================
 * Shared helpers
 * ========================================================================= */

/** Minimal fetch `Response` stand-in for the stubbed global `fetch`. */
function mockResponse(opts: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  text?: string;
}): Response {
  const status = opts.status ?? 200;
  const ok = opts.ok ?? (status >= 200 && status < 300);
  const text = opts.text ?? JSON.stringify(opts.body ?? {});
  return {
    ok,
    status,
    text: async () => text,
    json: async () => (opts.body ?? {}),
  } as unknown as Response;
}

const ISO = '2024-03-15T10:30:00'; // offset-free → parsed as local time
const ISO_FMT = '2024-03-15 10:30'; // expected formatDate(...) output

function fileEntry(opts: Partial<FileEntry> & { name: string }): FileEntry {
  return {
    name: opts.name,
    path: opts.path ?? joinPathHelper('docs', opts.name),
    isDirectory: opts.isDirectory ?? false,
    size: opts.size ?? 0,
    lastModified: opts.lastModified ?? ISO,
  };
}

function browseResult(opts: Partial<BrowseResult> = {}): BrowseResult {
  return {
    path: opts.path ?? '',
    parent: opts.parent ?? null,
    entries: opts.entries ?? [],
    folderCount: opts.folderCount ?? 0,
    fileCount: opts.fileCount ?? 0,
    totalSize: opts.totalSize ?? 0,
  };
}

// local join to avoid pulling joinPath into the test's asserted import set
function joinPathHelper(base: string, name: string): string {
  return (base ? base + '/' : '') + name;
}

const browseRoute = (path: string): Route => ({ view: 'browse', path, query: '' });
const searchRoute = (query: string, path = ''): Route => ({ view: 'search', query, path });

/** Let pending microtasks / queued hashchange renders settle. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface SetupCtx {
  root: HTMLElement;
  embeddedHost: HTMLElement;
  widget: HTMLElement;
  dialog: HTMLDialogElement;
  trigger: HTMLButtonElement;
  closeBtn: HTMLButtonElement;
  breadcrumb: HTMLElement;
  searchInput: HTMLInputElement;
  searchBtn: HTMLButtonElement;
  uploadLabel: HTMLLabelElement;
  uploadInput: HTMLInputElement;
  results: HTMLElement;
  status: HTMLElement;
}

/**
 * Build a fresh app inside a fresh container. Clears `document.body` first so
 * every test is independent (no leakage of elements, and document-scoped
 * queries inside `renderBrowse`/`renderSearch` always resolve to the current
 * test's DOM).
 */
function setup(options: { hash?: string } = {}): SetupCtx {
  document.body.innerHTML = '';
  window.location.hash = options.hash ?? '';

  const root = document.createElement('div');
  document.body.append(root);
  startApp(root);

  const button = (text: string): HTMLButtonElement | undefined =>
    Array.from(root.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === text,
    ) as HTMLButtonElement | undefined;

  return {
    root,
    embeddedHost: root.querySelector('.file-browser-host') as HTMLElement,
    widget: root.querySelector('.file-browser') as HTMLElement,
    dialog: root.querySelector('dialog.browser-dialog') as HTMLDialogElement,
    trigger: root.querySelector('button.trigger') as HTMLButtonElement,
    closeBtn: root.querySelector('.close-btn') as HTMLButtonElement,
    breadcrumb: root.querySelector('.breadcrumb') as HTMLElement,
    searchInput: root.querySelector('input[type="text"]') as HTMLInputElement,
    searchBtn: button('Search') as HTMLButtonElement,
    uploadLabel: root.querySelector('label.btn') as HTMLLabelElement,
    uploadInput: root.querySelector('input[type="file"]') as HTMLInputElement,
    results: root.querySelector('.results') as HTMLElement,
    status: root.querySelector('.status') as HTMLElement,
  };
}

/**
 * `setup()` plus a flush (so startApp's initial `render()` settles) and a clear
 * of `.results`, mimicking what `render()` does before delegating to
 * `renderBrowse`/`renderSearch`. Used by tests that exercise those helpers
 * directly so their assertions are isolated from the initial render's output.
 */
async function setupCleared(options: { hash?: string } = {}): Promise<SetupCtx> {
  const ctx = setup(options);
  await flush();
  ctx.results.innerHTML = '';
  return ctx;
}

/* Table-traversal helpers (browser-agnostic; work on Element). */
function dataRows(table: Element): Element[] {
  return Array.from(table.querySelectorAll('tbody tr'));
}
function rowByName(table: Element, name: string): Element | undefined {
  return dataRows(table).find(
    (tr) => (tr.querySelector('td')?.textContent ?? '').trim() === name,
  );
}
function cellsOf(row: Element): Element[] {
  return Array.from(row.querySelectorAll('td'));
}
function clickNameLink(row: Element): void {
  const nameCell = cellsOf(row)[0];
  const link = nameCell.querySelector('a, button') as HTMLElement | null;
  (link ?? (nameCell as HTMLElement)).click();
}
function buttonsByText(container: Element, text: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button')).filter(
    (b) => (b.textContent ?? '').trim() === text,
  );
}

/* ===========================================================================
 * Test lifecycle
 * ========================================================================= */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // A permissive default: every browse/search GET returns a recognizable result
  // derived from the requested path/query, and every mutation returns 200.
  // Individual tests override with `fetchMock.mockImplementation(...)` or
  // `.mockResolvedValueOnce(...)` for specific scenarios. This also means
  // incidental background renders (e.g. from accumulated hashchange listeners)
  // never throw unhandled rejections.
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && u.includes('/browse')) {
      const raw = u.split('path=')[1] ?? '';
      const path = decodeURIComponent(raw);
      const childName = 'child-of-' + (path || 'root');
      return mockResponse({
        body: browseResult({
          path,
          entries: [fileEntry({ name: childName, path: joinPathHelper(path, childName) })],
          fileCount: 1,
          totalSize: 10,
        }),
      });
    }
    if (method === 'GET' && u.includes('/search')) {
      const afterQuery = u.slice(u.indexOf('query=') + 6);
      const query = decodeURIComponent(afterQuery.split('&')[0]);
      return mockResponse({
        body: {
          query,
          path: '',
          results: [fileEntry({ name: 'result-for-' + query, path: joinPathHelper('docs', 'result-for-' + query) })],
        } as SearchResult,
      });
    }
    return mockResponse({ status: 200, body: {} });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  // NOTE: do NOT touch window.location.hash here. In happy-dom, assigning to
  // location.hash dispatches `hashchange` synchronously, and startApp
  // subscribes a render() listener that is never unsubscribed. Resetting the
  // hash after `vi.unstubAllGlobals()` would therefore drive a render through
  // the REAL fetch. We clear the body first (while fetch is still stubbed, so
  // any in-flight render's already-issued request stays mocked) and reset the
  // hash at the start of the next test's setup() instead.
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
    // Importing this test file already imported './app'. That import ran the
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

    it('renders a search text input with the Search... placeholder and a Search button', () => {
      const { searchInput, searchBtn } = setup();
      expect(searchInput).toBeTruthy();
      expect(searchInput.type).toBe('text');
      expect(searchInput.getAttribute('placeholder')).toBe('Search...');
      expect(searchBtn).toBeTruthy();
      expect(searchBtn.textContent?.trim()).toBe('Search');
      expect(searchBtn.className).toBe('btn');
    });

    it('renders an upload control: label.btn wrapping a hidden, multiple file input', () => {
      const { uploadLabel, uploadInput } = setup();
      expect(uploadLabel).toBeTruthy();
      expect(uploadLabel.className).toBe('btn');
      expect(uploadLabel.textContent).toContain('Upload');
      expect(uploadInput).toBeTruthy();
      expect(uploadInput.type).toBe('file');
      expect(uploadInput.hasAttribute('hidden')).toBe(true);
      expect(uploadInput.hasAttribute('multiple')).toBe(true);
      expect(uploadLabel.contains(uploadInput)).toBe(true);
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

  /* The file browser is a single chromeless widget shared between the embedded
     host (primary view) and the dialog body. Opening the dialog MOVES the same
     nodes into the dialog; closing moves them back — so there is never a second
     copy, and the embedded view stays chromeless (no frame/title). */
  describe('shared widget (embedded host vs dialog)', () => {
    it('renders an embedded host and a single chromeless .file-browser widget', () => {
      const { embeddedHost, widget } = setup();
      expect(embeddedHost).toBeTruthy();
      expect(embeddedHost.className).toBe('file-browser-host');
      expect(widget).toBeTruthy();
      expect(widget.className).toBe('file-browser');
      // There is exactly one widget in the whole document.
      expect(document.querySelectorAll('.file-browser')).toHaveLength(1);
    });

    it('hosts the widget in the embedded host while the dialog is closed', () => {
      const { embeddedHost, widget, dialog } = setup();
      expect(embeddedHost.contains(widget)).toBe(true);
      // The widget (and thus its table/search/status) is NOT inside the dialog
      // until the dialog is opened.
      expect(dialog.contains(widget)).toBe(false);
    });

    it('moves the widget into the dialog body when the dialog opens', () => {
      const { embeddedHost, widget, dialog, trigger } = setup();

      trigger.click();

      expect(dialog.open).toBe(true);
      expect(dialog.contains(widget)).toBe(true);
      // Same node reference, not a clone — only one widget exists.
      expect(document.querySelectorAll('.file-browser')).toHaveLength(1);
      expect(embeddedHost.contains(widget)).toBe(false);
    });

    it('moves the widget back to the embedded host when the dialog closes', () => {
      const { embeddedHost, widget, dialog, trigger } = setup();
      trigger.click();
      expect(dialog.contains(widget)).toBe(true);

      dialog.close();

      expect(dialog.open).toBe(false);
      expect(embeddedHost.contains(widget)).toBe(true);
      expect(dialog.contains(widget)).toBe(false);
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
 * renderBrowse — table, rows, columns, navigation, actions
 * ========================================================================= */
describe('renderBrowse', () => {
  it('builds a table with header Name | Size | Modified | Actions', async () => {
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [] }), browseRoute('docs'));

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
    renderBrowse(browseResult({ path: 'docs', entries }), browseRoute('docs'));

    expect(dataRows(results.querySelector('table')!)).toHaveLength(2);
  });

  it('prepends a ".." parent row only when result.parent is not null', async () => {
    const entry = fileEntry({ name: 'a.txt' });
    const { results } = await setupCleared();

    renderBrowse(browseResult({ path: 'docs/sub', parent: 'docs', entries: [entry] }), browseRoute('docs/sub'));
    const tableWithParent = results.querySelector('table')!;
    const rowsWithParent = dataRows(tableWithParent);
    expect(rowsWithParent).toHaveLength(2);
    expect(cellsOf(rowsWithParent[0])[0].textContent?.trim()).toBe('..');

    results.innerHTML = '';
    renderBrowse(browseResult({ path: 'docs', parent: null, entries: [entry] }), browseRoute('docs'));
    const tableNoParent = results.querySelector('table')!;
    expect(dataRows(tableNoParent)).toHaveLength(1);
    expect(cellsOf(dataRows(tableNoParent)[0])[0].textContent?.trim()).toBe('a.txt');
  });

  it('clicking the ".." row navigates to toBrowseHash(result.parent)', async () => {
    const { results } = await setupCleared();
    renderBrowse(
      browseResult({ path: 'docs/sub', parent: 'docs', entries: [] }),
      browseRoute('docs/sub'),
    );
    const parentRow = rowByName(results.querySelector('table')!, '..')!;

    clickNameLink(parentRow);

    expect(window.location.hash).toBe(toBrowseHash('docs'));
  });

  describe('directory rows', () => {
    it('renders the name and an em-dash size, and clicking the name navigates into the folder', async () => {
      const dir = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true });
      const { results } = await setupCleared();
      renderBrowse(browseResult({ path: 'docs', entries: [dir] }), browseRoute('docs'));

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
      renderBrowse(browseResult({ path: 'docs', entries: [file] }), browseRoute('docs'));
      const row = rowByName(results.querySelector('table')!, 'a.txt')!;
      const [nameCell] = cellsOf(row);
      expect(nameCell.textContent?.trim()).toBe('a.txt');
      expect(nameCell.querySelector('a, button')).toBeNull();
    });

    it('shows formatBytes(size) for the Size column', async () => {
      const { results } = await setupCleared();
      renderBrowse(browseResult({ path: 'docs', entries: [file] }), browseRoute('docs'));
      const row = rowByName(results.querySelector('table')!, 'a.txt')!;
      const sizeCell = cellsOf(row)[1];
      expect(sizeCell.textContent?.trim()).toBe(formatBytes(1536));
      expect(sizeCell.textContent?.trim()).toBe('1.5 KB');
    });

    it('shows formatDate(lastModified) for the Modified column', async () => {
      const { results } = await setupCleared();
      renderBrowse(browseResult({ path: 'docs', entries: [file] }), browseRoute('docs'));
      const row = rowByName(results.querySelector('table')!, 'a.txt')!;
      const modifiedCell = cellsOf(row)[2];
      expect(modifiedCell.textContent?.trim()).toBe(ISO_FMT);
    });

    it('escapes names via textContent (no HTML injection)', async () => {
      const evil = fileEntry({ name: '<img src=x onerror=alert(1)>', path: 'docs/x', isDirectory: false });
      const { results } = await setupCleared();
      renderBrowse(browseResult({ path: 'docs', entries: [evil] }), browseRoute('docs'));

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
      renderBrowse(browseResult({ path: 'docs', entries: [file] }), browseRoute('docs'));

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
        browseRoute('docs'),
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
      renderBrowse(browseResult({ path: 'docs', entries: [dir] }), browseRoute('docs'));
      const actions = actionsCell(results, 'sub');
      expect(actions.querySelector('a')).toBeNull();
    });

    it('Delete confirms then calls api.delete(entry.path)', async () => {
      const { results } = setup();
      await flush();
      results.innerHTML = '';
      renderBrowse(browseResult({ path: 'docs', entries: [file] }), browseRoute('docs'));
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
      renderBrowse(browseResult({ path: 'docs', entries: [file] }), browseRoute('docs'));
      vi.spyOn(window, 'confirm').mockReturnValue(false);

      buttonsByText(actionsCell(results, 'a.txt'), 'Delete')[0].click();
      await flush();

      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/delete'))).toBe(false);
    });

    it('Move prompts for a destination then calls api.move with the normalized path', async () => {
      const { results } = setup();
      await flush();
      results.innerHTML = '';
      renderBrowse(browseResult({ path: 'docs', entries: [file] }), browseRoute('docs'));
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
      renderBrowse(browseResult({ path: 'docs', entries: [file] }), browseRoute('docs'));
      vi.spyOn(window, 'prompt').mockReturnValue(null);

      buttonsByText(actionsCell(results, 'a.txt'), 'Move')[0].click();
      await flush();

      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/move'))).toBe(false);
    });

    it('Copy prompts for a destination then calls api.copy with the normalized path', async () => {
      const { results } = setup();
      await flush();
      results.innerHTML = '';
      renderBrowse(browseResult({ path: 'docs', entries: [file] }), browseRoute('docs'));
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
  });

  describe('breadcrumb', () => {
    function leafByText(container: Element, text: string): Element | undefined {
      return Array.from(container.querySelectorAll('*')).find(
        (el) => el.children.length === 0 && (el.textContent ?? '').trim() === text,
      );
    }

    it('renders clickable segments that navigate to each cumulative path', async () => {
      const { breadcrumb } = await setupCleared();
      renderBrowse(browseResult({ path: 'a/b', entries: [] }), browseRoute('a/b'));

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
        browseRoute('docs'),
      );

      const text = status.textContent ?? '';
      expect(text).toContain('2 folders');
      expect(text).toContain('3 files');
      expect(text).toContain(formatBytes(1536)); // "1.5 KB"
    });
  });
});

/* ===========================================================================
 * renderSearch — table, rows, navigation
 * ========================================================================= */
describe('renderSearch', () => {
  it('builds a table with header Name | Path | Size | Modified', async () => {
    const { results } = await setupCleared();
    renderSearch(
      { query: 'foo', path: '', results: [] },
      searchRoute('foo'),
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
    renderSearch({ query: 'q', path: '', results: results_data }, searchRoute('q'));

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
    renderSearch({ query: 'match', path: '', results: [dir] }, searchRoute('match'));

    clickNameLink(rowByName(results.querySelector('table')!, 'matchdir')!);
    expect(window.location.hash).toBe(toBrowseHash('docs/matchdir'));
  });

  it('clicking a file result name opens api.downloadUrl(entry.path)', async () => {
    const file = fileEntry({ name: 'match.txt', path: 'docs/match.txt', isDirectory: false });
    const { results } = await setupCleared();
    renderSearch({ query: 'match', path: '', results: [file] }, searchRoute('match'));
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
      searchRoute('foo'),
    );

    expect(status.textContent).toContain('2 results for "foo"');
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
 * Toolbar handlers
 * ========================================================================= */
describe('toolbar handlers', () => {
  describe('search', () => {
    it('navigates to a search hash for the input value and current path when the Search button is clicked', async () => {
      const { searchInput, searchBtn } = setup({ hash: toBrowseHash('docs') });
      await flush();

      searchInput.value = 'hello world';
      searchBtn.click();

      expect(window.location.hash).toBe(toSearchHash('hello world', normalizeRelativePath('docs')));
    });

    it('trims the query before navigating', async () => {
      const { searchInput, searchBtn } = setup({ hash: toBrowseHash('docs') });
      await flush();

      searchInput.value = '   spaced   ';
      searchBtn.click();

      expect(window.location.hash).toBe(toSearchHash('spaced', 'docs'));
    });

    it('clears the search (returns to browse) when the query is empty', async () => {
      const { searchInput, searchBtn } = setup({ hash: toSearchHash('foo', 'docs') });
      await flush();

      searchInput.value = '';
      searchBtn.click();

      expect(window.location.hash).toBe(toBrowseHash('docs'));
    });

    it('clears the search when the query is only whitespace', async () => {
      const { searchInput, searchBtn } = setup({ hash: toSearchHash('foo', 'docs') });
      await flush();

      searchInput.value = '   \t  ';
      searchBtn.click();

      expect(window.location.hash).toBe(toBrowseHash('docs'));
    });

    it('navigates when Enter is pressed inside the search input', async () => {
      const { searchInput } = setup({ hash: toBrowseHash('docs') });
      await flush();

      searchInput.value = 'foo';
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(window.location.hash).toBe(toSearchHash('foo', 'docs'));
    });
  });

  describe('upload', () => {
    function setFiles(input: HTMLInputElement, names: string[]): void {
      const dt = new DataTransfer();
      for (const n of names) dt.items.add(new File(['data-' + n], n));
      input.files = dt.files as unknown as FileList;
    }

    it('uploads each selected file to the current browse path, then clears the input and re-renders', async () => {
      const { uploadInput } = setup({ hash: toBrowseHash('docs') });
      await flush();

      setFiles(uploadInput, ['a.txt', 'b.txt']);
      uploadInput.dispatchEvent(new Event('change'));
      await flush();
      await flush();

      const uploadCalls = fetchMock.mock.calls.filter(
        ([u, init]) => String(u).includes('/upload') && (init?.method ?? 'GET') === 'POST',
      );
      expect(uploadCalls).toHaveLength(2);
      for (const [, init] of uploadCalls) {
        expect(init?.body).toBeInstanceOf(FormData);
        expect((init!.body as FormData).get('file')).toBeInstanceOf(File);
      }
      // All uploads target the current browse path.
      expect(uploadCalls.every(([u]) => String(u).includes('path=' + encodeURIComponent('docs')))).toBe(true);
      // The input is cleared afterwards.
      expect(uploadInput.value).toBe('');
      // And a re-render occurred (browse fetched again after upload).
      const browseCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/browse'));
      expect(browseCalls.length).toBeGreaterThan(0);
    });

    it('uploads nothing when no files are selected', async () => {
      const { uploadInput } = setup({ hash: toBrowseHash('docs') });
      await flush();

      uploadInput.dispatchEvent(new Event('change'));
      await flush();

      expect(
        fetchMock.mock.calls.some(([u]) => String(u).includes('/upload')),
      ).toBe(false);
    });
  });
});
