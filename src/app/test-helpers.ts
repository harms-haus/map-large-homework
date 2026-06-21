/**
 * Shared helpers for the `src/app/*.test.ts` files: fixture builders
 * (`fileEntry`, `browseResult`, `joinPathHelper`), timing (`flush`), DOM
 * scaffolding (`setup`, `setupCleared`, `SetupCtx`), table/row traversal, and
 * the shared per-test fetch stub lifecycle (`installAppTestLifecycle`).
 *
 * Test-only: excluded from the production build via `tsconfig.json`'s
 * `exclude`, so it never ships to `wwwroot/dist`.
 */
import { vi, beforeEach, afterEach } from 'vitest';
import { startApp } from '../app';
import type { BrowseResult, FileEntry, SearchResult } from '../api';
import { mockResponse } from '../test-utils/mock-response';

/* ===========================================================================
 * Constants & fixture builders
 * ========================================================================= */

export const ISO = '2024-03-15T10:30:00'; // offset-free → parsed as local time
export const ISO_FMT = '2024-03-15 10:30'; // expected formatDate(...) output

export function fileEntry(opts: Partial<FileEntry> & { name: string }): FileEntry {
  return {
    name: opts.name,
    path: opts.path ?? joinPathHelper('docs', opts.name),
    isDirectory: opts.isDirectory ?? false,
    size: opts.size ?? 0,
    lastModified: opts.lastModified ?? ISO,
    itemCount: opts.itemCount ?? 0,
  };
}

export function browseResult(opts: Partial<BrowseResult> = {}): BrowseResult {
  return {
    path: opts.path ?? '',
    parent: opts.parent ?? null,
    entries: opts.entries ?? [],
    folderCount: opts.folderCount ?? 0,
    fileCount: opts.fileCount ?? 0,
    totalSize: opts.totalSize ?? 0,
  };
}

// local join to avoid pulling joinPath into a test's asserted import set
export function joinPathHelper(base: string, name: string): string {
  return (base ? base + '/' : '') + name;
}

/* ===========================================================================
 * Timing
 * ========================================================================= */

/** Let pending microtasks / queued hashchange renders settle. */
export const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/* ===========================================================================
 * DOM scaffolding
 * ========================================================================= */

export interface SetupCtx {
  root: HTMLElement;
  embeddedHost: HTMLElement;
  widget: HTMLElement;
  dialog: HTMLDialogElement;
  trigger: HTMLButtonElement;
  closeBtn: HTMLButtonElement;
  breadcrumb: HTMLElement;
  searchInput: HTMLInputElement;
  searchWrapper: HTMLElement;
  searchClearBtn: HTMLButtonElement;
  searchIcon: HTMLElement;
  results: HTMLElement;
  status: HTMLElement;
}

/**
 * Build a fresh app inside a fresh container. Clears `document.body` first so
 * every test is independent and document-scoped queries resolve to the
 * current test's DOM.
 */
export function setup(options: { hash?: string } = {}): SetupCtx {
  document.body.innerHTML = '';
  window.location.hash = options.hash ?? '';

  const root = document.createElement('div');
  document.body.append(root);
  startApp(root);

  return {
    root,
    embeddedHost: root.querySelector('.file-browser-host') as HTMLElement,
    widget: root.querySelector('.file-browser') as HTMLElement,
    dialog: root.querySelector('dialog.browser-dialog') as HTMLDialogElement,
    trigger: root.querySelector('button.trigger') as HTMLButtonElement,
    closeBtn: root.querySelector('.close-btn') as HTMLButtonElement,
    breadcrumb: root.querySelector('.breadcrumb') as HTMLElement,
    searchInput: root.querySelector('input[type="text"]') as HTMLInputElement,
    searchWrapper: root.querySelector('.search-wrapper') as HTMLElement,
    searchClearBtn: root.querySelector('.search-wrapper .clear-btn') as HTMLButtonElement,
    searchIcon: root.querySelector('.search-wrapper .search-icon') as HTMLElement,
    results: root.querySelector('.results') as HTMLElement,
    status: root.querySelector('.status') as HTMLElement,
  };
}

/**
 * `setup()` plus a flush (so startApp's initial `render()` settles) and a
 * clear of `.results`, mimicking what `render()` does before delegating to
 * `renderBrowse`/`renderSearch`. Used by tests that exercise those helpers
 * directly so their assertions are isolated from the initial render's output.
 */
export async function setupCleared(options: { hash?: string } = {}): Promise<SetupCtx> {
  const ctx = setup(options);
  await flush();
  ctx.results.innerHTML = '';
  return ctx;
}

/* ===========================================================================
 * Table-traversal helpers (browser-agnostic; work on Element).
 * ========================================================================= */

export function dataRows(table: Element): Element[] {
  return Array.from(table.querySelectorAll('tbody tr'));
}
export function rowByName(table: Element, name: string): Element | undefined {
  return dataRows(table).find((tr) => (tr.querySelector('td')?.textContent ?? '').trim() === name);
}
export function cellsOf(row: Element): Element[] {
  return Array.from(row.querySelectorAll('td'));
}
export function clickNameLink(row: Element): void {
  const nameCell = cellsOf(row)[0];
  const link = nameCell.querySelector('a, button') as HTMLElement | null;
  (link ?? (nameCell as HTMLElement)).click();
}
export function buttonsByText(container: Element, text: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button')).filter(
    (b) => (b.textContent ?? '').trim() === text,
  );
}

/* ===========================================================================
 * Shared per-test fetch stub lifecycle
 *
 * `fetchMock` is an `export let` live binding: `installAppTestLifecycle()`'s
 * `beforeEach` rebinds it to a fresh permissive `vi.fn` each test, and every
 * importer sees the rebound value. Tests therefore read `fetchMock.mock.calls`
 * directly, without a per-file declaration.
 * ========================================================================= */

export let fetchMock: ReturnType<typeof vi.fn> = vi.fn(async () => mockResponse({ body: {} }));

/**
 * Register the shared `beforeEach` (permissive default fetch stub) and
 * `afterEach` (DOM + mock cleanup) used by every split app test file. Call
 * exactly once at module top level in each `*.test.ts`.
 */
export function installAppTestLifecycle(): void {
  beforeEach(() => {
    // A permissive default: browse/search GETs return a recognizable result
    // derived from the requested path/query, and mutations return 200.
    // Individual tests override with `fetchMock.mockImplementation(...)` or
    // `.mockResolvedValueOnce(...)`. This also keeps incidental background
    // renders (e.g. from accumulated hashchange listeners) from throwing
    // unhandled rejections.
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
            results: [
              fileEntry({
                name: 'result-for-' + query,
                path: joinPathHelper('docs', 'result-for-' + query),
              }),
            ],
          } as SearchResult,
        });
      }
      return mockResponse({ status: 200, body: {} });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    // NOTE: do NOT touch window.location.hash here. In happy-dom, assigning
    // to location.hash dispatches `hashchange` synchronously. The current
    // test's render() listener remains active until the next test's setup()
    // re-mounts, so resetting the hash after `vi.unstubAllGlobals()` would
    // drive a render through the REAL fetch. Clear the body first (while fetch
    // is still stubbed) and reset the hash in the next test's setup() instead.
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
}
