/**
 * Characterization tests for `src/app.ts` — pin the EXACT observable behavior
 * (DOM structure, element attributes, child ordering, and render-lifecycle
 * semantics) that the upcoming split into `src/app/*` domain modules must
 * preserve.
 *
 * Why this file exists alongside `src/app.test.ts`:
 *   The behavioral suite (`app.test.ts`) is thorough on user-facing scenarios
 *   but asserts many DOM-construction details only loosely (via `toContain` on
 *   text, or via click→hash side effects rather than the DOM itself). Those
 *   loose assertions are precisely what a STRUCTURAL refactor can silently
 *   break — e.g. dropping a `class`, reordering toolbar children, setting an
 *   attribute via a property instead of `setAttribute`, or wiring the shared
 *   status-element ref incorrectly when bare module-level `let`s become a
 *   context object. The tests here pin those details exactly so the split is
 *   provably behavior-preserving.
 *
 * Every assertion is driven through the PUBLIC API (`startApp` /
 * `renderBrowse` / `renderSearch` / synthesized user events) so the tests stay
 * valid no matter how the internals are reorganized into
 * `dom-builders.ts`, `render-browse.ts`, `render-search.ts`,
 * `toolbar-handlers.ts`, and `render-orchestrator.ts`.
 *
 * Environment: project-default happy-dom (these tests need a DOM).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { startApp, renderBrowse, renderSearch } from './app';
import type { BrowseResult, FileEntry, SearchResult } from './api';
import { toBrowseHash, navigate } from './router';
import { formatBytes, formatDate } from './format';

/* ===========================================================================
 * Shared helpers (self-contained so this file is independent of app.test.ts)
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
    path: opts.path ?? `docs/${opts.name}`,
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

/** Let pending microtasks / queued hashchange renders settle. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface Ctx {
  root: HTMLElement;
  widget: HTMLElement;
  toolbar: HTMLElement;
  breadcrumb: HTMLElement;
  searchInput: HTMLInputElement;
  searchBtn: HTMLButtonElement;
  uploadLabel: HTMLLabelElement;
  uploadInput: HTMLInputElement;
  results: HTMLElement;
  status: HTMLElement;
}

/**
 * Build a fresh app inside a fresh container (clears `document.body` first so
 * every test is independent), then return typed handles to the key elements.
 */
function setup(options: { hash?: string } = {}): Ctx {
  document.body.innerHTML = '';
  window.location.hash = options.hash ?? '';

  const root = document.createElement('div');
  document.body.append(root);
  startApp(root);

  const button = (text: string): HTMLButtonElement =>
    Array.from(root.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === text,
    ) as HTMLButtonElement;

  return {
    root,
    widget: root.querySelector('.file-browser') as HTMLElement,
    toolbar: root.querySelector('.toolbar') as HTMLElement,
    breadcrumb: root.querySelector('.breadcrumb') as HTMLElement,
    searchInput: root.querySelector('input[type="text"]') as HTMLInputElement,
    searchBtn: button('Search'),
    uploadLabel: root.querySelector('label.btn') as HTMLLabelElement,
    uploadInput: root.querySelector('input[type="file"]') as HTMLInputElement,
    results: root.querySelector('.results') as HTMLElement,
    status: root.querySelector('.status') as HTMLElement,
  };
}

/**
 * `setup()` plus a flush (so startApp's initial `render()` settles) and a clear
 * of `.results`, mirroring what `render()` does before delegating to
 * `renderBrowse`/`renderSearch`. Used by tests that exercise those helpers
 * directly so their assertions are isolated from the initial render's output.
 */
async function setupCleared(options: { hash?: string } = {}): Promise<Ctx> {
  const ctx = setup(options);
  await flush();
  ctx.results.innerHTML = '';
  return ctx;
}

/* Table-traversal helpers. */
function dataRows(table: Element): Element[] {
  return Array.from(table.querySelectorAll('tbody tr'));
}
function rowByName(table: Element, name: string): Element {
  const row = dataRows(table).find(
    (tr) => (tr.querySelector('td')?.textContent ?? '').trim() === name,
  );
  if (!row) throw new Error(`no row named ${name}`);
  return row;
}
function cellsOf(row: Element): Element[] {
  return Array.from(row.querySelectorAll('td'));
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
  // Permissive default: browse/search GETs return recognizable results derived
  // from the requested path/query; mutations return 200. Individual tests
  // override as needed. This also keeps incidental background renders (from
  // any lingering hashchange listener) from throwing unhandled rejections.
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'GET' && u.includes('/browse')) {
      const raw = u.split('path=')[1] ?? '';
      const path = decodeURIComponent(raw);
      const child = 'child-of-' + (path || 'root');
      return mockResponse({
        body: browseResult({
          path,
          entries: [fileEntry({ name: child, path: `${path}/${child}` })],
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
          results: [fileEntry({ name: 'result-for-' + query, path: `docs/result-for-${query}` })],
        } as SearchResult,
      });
    }
    return mockResponse({ status: 200, body: {} });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  // Clear the body while fetch is still stubbed (so any in-flight render's
  // already-issued request stays mocked), then restore globals. The hash is
  // reset at the start of the next setup() — never here (see app.test.ts for
  // the rationale: resetting it here would drive a render through real fetch).
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/* ===========================================================================
 * buildTable — exact table structure
 *
 * Pinned because `buildTable` is being extracted verbatim into
 * `dom-builders.ts`; a dropped class name or restructured thead/tbody would
 * change the DOM the tests in app.test.ts rely on (tbody-traversal helpers).
 * ========================================================================= */
describe('buildTable (table structure)', () => {
  it('gives the table the class "results-table"', async () => {
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [] }));
    expect(results.querySelector('table')!.className).toBe('results-table');
  });

  it('builds a <thead> with exactly one <tr> holding one <th> per header', async () => {
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [] }));
    const table = results.querySelector('table')!;
    const theadRows = table.querySelectorAll('thead tr');
    expect(theadRows).toHaveLength(1);
    const headers = Array.from(theadRows[0].querySelectorAll('th')).map(
      (h) => h.textContent!,
    );
    expect(headers).toEqual(['Name', 'Size', 'Modified', 'Actions']);
  });

  it('always creates a <tbody>, even when there are no data rows', async () => {
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: '', parent: null, entries: [] }));
    const table = results.querySelector('table')!;
    expect(table.querySelector('tbody')).toBeTruthy();
    expect(dataRows(table)).toHaveLength(0);
  });

  it('places header <th>s in <thead> and data <td>s in <tbody> (never mixed)', async () => {
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [fileEntry({ name: 'a.txt' })] }));
    const table = results.querySelector('table')!;
    // Every th lives under thead; every td lives under tbody.
    expect(table.querySelectorAll('thead td')).toHaveLength(0);
    expect(table.querySelectorAll('tbody th')).toHaveLength(0);
    expect(table.querySelectorAll('thead th').length).toBeGreaterThan(0);
    expect(table.querySelectorAll('tbody td').length).toBeGreaterThan(0);
  });
});

/* ===========================================================================
 * renderBreadcrumb — exact breadcrumb structure
 *
 * Pinned because the breadcrumb builder is the most structure-heavy helper
 * (Home link + alternating separators + cumulative-path links) and is moving
 * to `dom-builders.ts`. The behavioral suite only clicks segments and checks
 * the resulting hash; it never asserts the separator spans, the Home link, or
 * the exact child sequence.
 * ========================================================================= */
describe('renderBreadcrumb (breadcrumb structure)', () => {
  /** Tag names + text of the breadcrumb's direct children, in order. */
  function breadcrumbShape(el: Element): Array<{ tag: string; text: string }> {
    return Array.from(el.children).map((c) => ({
      tag: c.tagName,
      text: (c.textContent ?? '').trim(),
    }));
  }

  it('renders only a Home link for the root (empty) path — no separators', async () => {
    const { breadcrumb } = await setupCleared();
    renderBrowse(browseResult({ path: '', entries: [] }));
    expect(breadcrumb.children).toHaveLength(1);
    expect(breadcrumbShape(breadcrumb)).toEqual([{ tag: 'A', text: 'Home' }]);
  });

  it('renders Home + "/" separator + one segment link for a single-segment path', async () => {
    const { breadcrumb } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [] }));
    expect(breadcrumbShape(breadcrumb)).toEqual([
      { tag: 'A', text: 'Home' },
      { tag: 'SPAN', text: '/' },
      { tag: 'A', text: 'docs' },
    ]);
  });

  it('inserts one "/" separator span between each pair of links', async () => {
    const { breadcrumb } = await setupCleared();
    renderBrowse(browseResult({ path: 'a/b/c', entries: [] }));
    // Home, sep, a, sep, b, sep, c
    const shape = breadcrumbShape(breadcrumb);
    expect(shape).toHaveLength(7);
    expect(shape.map((s) => s.tag)).toEqual(['A', 'SPAN', 'A', 'SPAN', 'A', 'SPAN', 'A']);
    // Every separator is a SPAN whose text is exactly '/'.
    expect(shape.filter((s) => s.tag === 'SPAN')).toEqual([
      { tag: 'SPAN', text: '/' },
      { tag: 'SPAN', text: '/' },
      { tag: 'SPAN', text: '/' },
    ]);
  });

  it('the Home link navigates to the root browse hash', async () => {
    const { breadcrumb } = await setupCleared({ hash: toBrowseHash('deep/nested') });
    renderBrowse(browseResult({ path: 'deep/nested', entries: [] }));

    const home = breadcrumb.querySelector('a') as HTMLAnchorElement;
    expect(home.textContent).toBe('Home');
    expect(home.getAttribute('href')).toBe('#/browse');

    home.click();
    expect(window.location.hash).toBe('#/browse');
  });

  it('each segment link carries href equal to toBrowseHash(cumulative path)', async () => {
    const { breadcrumb } = await setupCleared();
    renderBrowse(browseResult({ path: 'a/b', entries: [] }));
    const links = Array.from(breadcrumb.querySelectorAll('a')) as HTMLAnchorElement[];
    // [Home, a, b]
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      toBrowseHash(''),
      toBrowseHash('a'),
      toBrowseHash('a/b'),
    ]);
  });

  it('collapses slashes in the path before splitting into segments', async () => {
    // '//a//b//' normalizes to 'a/b' → Home, sep, a, sep, b (no empty links).
    const { breadcrumb } = await setupCleared();
    renderBrowse(browseResult({ path: '//a//b//', entries: [] }));
    const texts = Array.from(breadcrumb.querySelectorAll('a')).map(
      (a) => a.textContent,
    );
    expect(texts).toEqual(['Home', 'a', 'b']);
  });
});

/* ===========================================================================
 * makeNavLink — anchor attributes & preventDefault
 *
 * Pinned because `makeNavLink` sets `href` via `setAttribute` deliberately (to
 * preserve the raw attribute exactly — important for download URLs that must
 * not be URL-normalized) and calls `preventDefault` + `navigate`. The
 * behavioral suite checks the resulting hash but not the href attribute nor
 * that default is prevented.
 * ========================================================================= */
describe('makeNavLink (anchor attributes & preventDefault)', () => {
  it('directory row name is an <a> whose href equals toBrowseHash(entry.path)', async () => {
    const dir = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true });
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [dir] }));
    const link = rowByName(results.querySelector('table')!, 'sub')
      .querySelector('td')!
      .querySelector('a') as HTMLAnchorElement;
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe(toBrowseHash('docs/sub'));
    expect(link.textContent).toBe('sub');
  });

  it('the ".." parent link href equals toBrowseHash(parent)', async () => {
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs/sub', parent: 'docs', entries: [] }));
    const link = rowByName(results.querySelector('table')!, '..')
      .querySelector('td')!
      .querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(toBrowseHash('docs'));
    expect(link.textContent).toBe('..');
  });

  it('calls preventDefault on click (the href is not followed by the UA)', async () => {
    const { breadcrumb } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [] }));
    const link = breadcrumb.querySelector('a') as HTMLAnchorElement;

    const evt = new MouseEvent('click', { cancelable: true, bubbles: true });
    link.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true);
  });

  it('encodes special characters in the href via toBrowseHash', async () => {
    const dir = fileEntry({ name: 'a & b', path: 'docs/a & b', isDirectory: true });
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [dir] }));
    const link = rowByName(results.querySelector('table')!, 'a & b')
      .querySelector('td')!
      .querySelector('a') as HTMLAnchorElement;
    // The href preserves the percent-encoded form exactly.
    expect(link.getAttribute('href')).toBe(toBrowseHash('docs/a & b'));
    expect(link.getAttribute('href')).toBe('#/browse/docs/a%20%26%20b');
  });
});

/* ===========================================================================
 * makeActionButton — button attributes
 *
 * Pinned because Delete/Move/Copy buttons are constructed in `makeBrowseRow`
 * (→ dom-builders.ts) and only their text is checked today, never their
 * `class="btn"` / `type="button"`. CSS and form-submission semantics depend on
 * those attributes.
 * ========================================================================= */
describe('makeActionButton (action button attributes)', () => {
  const file = fileEntry({ name: 'a.txt', path: 'docs/a.txt', size: 10 });
  const dir = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true });

  it('Delete/Move/Copy are <button class="btn" type="button">', async () => {
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [file, dir] }));

    for (const name of ['a.txt', 'sub']) {
      const actions = cellsOf(rowByName(results.querySelector('table')!, name))[3];
      for (const label of ['Delete', 'Move', 'Copy']) {
        const btn = buttonsByText(actions, label)[0];
        expect(btn.tagName).toBe('BUTTON');
        expect(btn.className).toBe('btn');
        expect(btn.getAttribute('type')).toBe('button');
        expect(btn.textContent?.trim()).toBe(label);
      }
    }
  });

  it('the Download control is an <a class="btn"> with text "Download" (files only)', async () => {
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [file] }));
    const actions = cellsOf(rowByName(results.querySelector('table')!, 'a.txt'))[3];
    const dl = actions.querySelector('a.btn') as HTMLAnchorElement;
    expect(dl.tagName).toBe('A');
    expect(dl.textContent?.trim()).toBe('Download');
    // The download anchor is distinct from the action buttons: it is NOT a
    // <button> and carries the native download attribute.
    expect(dl.getAttribute('download')).toBe('a.txt');
  });

  it('folders have no Download control and no <a> in their actions cell', async () => {
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [dir] }));
    const actions = cellsOf(rowByName(results.querySelector('table')!, 'sub'))[3];
    expect(actions.querySelector('a')).toBeNull();
    // But they still get the three action buttons.
    expect(buttonsByText(actions, 'Delete')).toHaveLength(1);
    expect(buttonsByText(actions, 'Move')).toHaveLength(1);
    expect(buttonsByText(actions, 'Copy')).toHaveLength(1);
  });
});

/* ===========================================================================
 * makeParentRow — parent ("..") row cell layout
 * ========================================================================= */
describe('makeParentRow (parent row cells)', () => {
  it('has four cells; the first holds the ".." link and the rest are empty', async () => {
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs/sub', parent: 'docs', entries: [] }));
    const cells = cellsOf(rowByName(results.querySelector('table')!, '..'));
    expect(cells).toHaveLength(4);
    expect(cells[0].querySelector('a')?.textContent).toBe('..');
    // Size / Modified / Actions are intentionally blank for the parent row.
    expect((cells[1].textContent ?? '').trim()).toBe('');
    expect((cells[2].textContent ?? '').trim()).toBe('');
    expect((cells[3].textContent ?? '').trim()).toBe('');
  });
});

/* ===========================================================================
 * Row cell counts — makeBrowseRow / makeSearchRow
 * ========================================================================= */
describe('row cell counts', () => {
  it('makeBrowseRow produces exactly 4 <td> (Name, Size, Modified, Actions)', async () => {
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [fileEntry({ name: 'a.txt' })] }));
    const cells = cellsOf(rowByName(results.querySelector('table')!, 'a.txt'));
    expect(cells).toHaveLength(4);
    expect(cells.every((c) => c.tagName === 'TD')).toBe(true);
  });

  it('makeSearchRow produces exactly 4 <td> (Name, Path, Size, Modified)', async () => {
    const { results } = await setupCleared();
    renderSearch({
      query: 'q',
      path: '',
      results: [fileEntry({ name: 'a.txt', path: 'docs/a.txt' })],
    });
    const cells = cellsOf(rowByName(results.querySelector('table')!, 'a.txt'));
    expect(cells).toHaveLength(4);
    expect(cells.every((c) => c.tagName === 'TD')).toBe(true);
  });
});

/* ===========================================================================
 * startApp DOM ordering — widget & toolbar child sequence
 *
 * Pinned because imperative DOM construction relies on `append` order; a
 * refactor that reorders the appends (or moves a node into the wrong parent)
 * would change layout/CSS targeting without breaking any text-based assertion.
 * ========================================================================= */
describe('startApp DOM ordering', () => {
  it('the widget holds toolbar, results, and status in that order', () => {
    const { widget } = setup();
    const kids = Array.from(widget.children);
    expect(kids[0].className).toBe('toolbar');
    expect(kids[1].className).toBe('results');
    expect(kids[2].tagName).toBe('FOOTER');
    expect(kids[2].className).toBe('status');
  });

  it('the toolbar holds breadcrumb, search input, search button, upload label in that order', () => {
    const { toolbar } = setup();
    const kids = Array.from(toolbar.children);
    expect(kids[0].tagName).toBe('DIV');
    expect(kids[0].className).toBe('breadcrumb');
    expect(kids[1].tagName).toBe('INPUT');
    expect((kids[1] as HTMLInputElement).type).toBe('text');
    expect(kids[2].tagName).toBe('BUTTON');
    expect(kids[2].className).toBe('btn');
    expect((kids[2].textContent ?? '').trim()).toBe('Search');
    expect(kids[3].tagName).toBe('LABEL');
    expect(kids[3].className).toBe('btn');
  });

  it('the root holds the embedded host, the trigger, then the dialog in that order', () => {
    const { root } = setup();
    const kids = Array.from(root.children);
    expect(kids[0].className).toBe('file-browser-host');
    expect(kids[1].tagName).toBe('BUTTON');
    expect(kids[1].className).toBe('trigger');
    expect(kids[2].tagName).toBe('DIALOG');
    expect(kids[2].className).toBe('browser-dialog');
  });

  it('the dialog holds the header then the body slot in that order', () => {
    const { root } = setup();
    const dialog = root.querySelector('dialog.browser-dialog')!;
    const kids = Array.from(dialog.children);
    expect(kids[0].className).toBe('dialog-header');
    expect(kids[1].className).toBe('dialog-body');
  });
});

/* ===========================================================================
 * Status footer — exact format
 *
 * The behavioral suite checks these with `toContain`; pinning the exact string
 * guards the wording / punctuation / spacing against a careless template edit
 * during the move into render-browse.ts / render-search.ts.
 * ========================================================================= */
describe('status footer exact format', () => {
  it('renderBrowse: "N folders, M files, total S"', async () => {
    const { status } = await setupCleared();
    renderBrowse(
      browseResult({ path: 'docs', folderCount: 2, fileCount: 3, totalSize: 1536 }),
    );
    expect(status.textContent).toBe('2 folders, 3 files, total ' + formatBytes(1536));
    expect(status.textContent).toBe('2 folders, 3 files, total 1.5 KB');
  });

  it('renderSearch: N results for "q"', async () => {
    const { status } = await setupCleared();
    renderSearch({
      query: 'foo',
      path: '',
      results: [fileEntry({ name: 'a' }), fileEntry({ name: 'b' })],
    });
    expect(status.textContent).toBe('2 results for "foo"');
  });
});

/* ===========================================================================
 * render() — error message exact format in .results
 *
 * The behavioral suite only checks the error text is non-empty; pinning the
 * exact "Error: <status>: <body>" form guards the catch branch in the
 * orchestrator (which is moving to render-orchestrator.ts).
 * ========================================================================= */
describe('render error message exact format', () => {
  it('surfaces "Error: <status>: <body>" in .results when the fetch fails', async () => {
    fetchMock.mockImplementation(async () => mockResponse({ status: 500, text: 'boom' }));
    const { results } = setup();
    await flush();
    expect(results.querySelector('table')).toBeNull();
    expect(results.textContent).toBe('Error: 500: boom');
  });

  it('surfaces the body text verbatim across multi-word error bodies', async () => {
    fetchMock.mockImplementation(async () =>
      mockResponse({ status: 404, text: 'not found here' }),
    );
    const { results } = setup();
    await flush();
    expect(results.textContent).toBe('Error: 404: not found here');
  });
});

/* ===========================================================================
 * render() lifecycle — synchronous clear semantics
 *
 * Documented, intentional behavior: `render()` clears `.results` synchronously
 * at the start (before the fetch) so a pending or failed fetch never leaves a
 * stale table, but it does NOT clear the breadcrumb/status synchronously
 * (those are refreshed by renderBrowse/renderSearch once data arrives —
 * clearing them mid-click would wipe in-page navigation targets). Pinning this
 * guards the orchestrator extraction: if the clear moves inside renderBrowse
 * (post-await) or the breadcrumb/status get cleared too early, these fail.
 * ========================================================================= */
describe('render synchronous clear semantics', () => {
  it('clears .results synchronously on navigation, before the fetch resolves', async () => {
    const ctx = setup({ hash: toBrowseHash('initial') });
    await flush();
    expect(ctx.results.querySelector('table')).toBeTruthy(); // populated

    // Hold the next browse fetch open until release().
    let release!: () => void;
    const held = new Promise<Response>((resolve) => {
      release = () =>
        resolve(
          mockResponse({
            body: browseResult({
              path: 'slow',
              entries: [fileEntry({ name: 'child-of-slow', path: 'slow/child-of-slow' })],
              fileCount: 1,
              totalSize: 1,
            }),
          }),
        );
    });
    fetchMock.mockImplementation(async (url, init) => {
      const u = String(url);
      const m = (init?.method ?? 'GET').toUpperCase();
      if (m === 'GET' && u.includes('/browse')) {
        const path = decodeURIComponent(u.split('path=')[1] ?? '');
        if (path === 'slow') return held;
        return mockResponse({ body: browseResult({ path }) });
      }
      return mockResponse({ status: 200, body: {} });
    });

    // Snapshot what the completed 'initial' render left behind.
    const oldBreadcrumbHtml = ctx.breadcrumb.innerHTML;
    const oldStatusText = ctx.status.textContent;

    // navigate() dispatches hashchange synchronously in happy-dom, so render()
    // runs up to its first `await` synchronously — clearing .results but NOT
    // yet touching breadcrumb/status.
    navigate(toBrowseHash('slow'));

    expect(ctx.results.querySelector('table')).toBeNull();
    expect(ctx.results.children.length).toBe(0);
    // Breadcrumb + status are intentionally retained until the new data lands.
    expect(ctx.breadcrumb.innerHTML).toBe(oldBreadcrumbHtml);
    expect(ctx.status.textContent).toBe(oldStatusText);

    release();
    await flush();
    expect(ctx.results.textContent).toContain('child-of-slow');
  });
});

/* ===========================================================================
 * render context — module refs re-bind on each startApp
 *
 * The refactor replaces bare module-level `let resultsEl!` variables with a
 * shared context object (`context.ts` / `init(domRefs)`). This test pins the
 * invariant those refs must preserve: `renderBrowse`/`renderSearch` always
 * target the MOST RECENTLY mounted app's elements, never a stale earlier
 * mount's. If the context is captured instead of re-bound, this fails.
 * ========================================================================= */
describe('render context re-bind on re-mount', () => {
  it('renderBrowse targets the most recent mount, not an earlier one', () => {
    document.body.innerHTML = '';
    window.location.hash = '';

    const rootA = document.createElement('div');
    document.body.append(rootA);
    startApp(rootA);

    const rootB = document.createElement('div');
    document.body.append(rootB);
    startApp(rootB);

    // After two mounts, the shared refs must point at rootB's elements.
    renderBrowse(browseResult({ path: 'docs', entries: [fileEntry({ name: 'target-marker' })] }));

    const resultsB = rootB.querySelector('.results') as HTMLElement;
    const resultsA = rootA.querySelector('.results') as HTMLElement;
    expect(resultsB.textContent).toContain('target-marker');
    // rootA's results must NOT have received this render — proves the ref was
    // re-bound to rootB rather than still pointing at rootA.
    expect(resultsA.textContent).not.toContain('target-marker');
  });

  it('renderSearch targets the most recent mount, not an earlier one', () => {
    document.body.innerHTML = '';
    window.location.hash = '';

    const rootA = document.createElement('div');
    document.body.append(rootA);
    startApp(rootA);

    const rootB = document.createElement('div');
    document.body.append(rootB);
    startApp(rootB);

    renderSearch({
      query: 'q',
      path: '',
      results: [fileEntry({ name: 'search-marker', path: 'docs/search-marker' })],
    });

    const resultsB = rootB.querySelector('.results') as HTMLElement;
    const resultsA = rootA.querySelector('.results') as HTMLElement;
    expect(resultsB.textContent).toContain('search-marker');
    expect(resultsA.textContent).not.toContain('search-marker');
  });
});

/* ===========================================================================
 * Search result link details — file vs directory
 *
 * In search results a directory name is a nav link (makeNavLink → browse),
 * while a file name is a plain download anchor (no class, no download attr).
 * Pin the distinction so the row builder extraction can't blur them.
 * ========================================================================= */
describe('search result link details (file vs directory)', () => {
  it('a directory result name is a nav link to toBrowseHash(entry.path)', async () => {
    const dir = fileEntry({ name: 'matchdir', path: 'docs/matchdir', isDirectory: true });
    const { results } = await setupCleared();
    renderSearch({ query: 'match', path: '', results: [dir] });
    const link = rowByName(results.querySelector('table')!, 'matchdir')
      .querySelector('td')!
      .querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(toBrowseHash('docs/matchdir'));
    expect(link.textContent).toBe('matchdir');
  });

  it('a file result name is a plain <a> to downloadUrl with NO class and NO download attr', async () => {
    const file = fileEntry({ name: 'match.txt', path: 'docs/match.txt', isDirectory: false });
    const { results } = await setupCleared();
    renderSearch({ query: 'match', path: '', results: [file] });
    const link = rowByName(results.querySelector('table')!, 'match.txt')
      .querySelector('td')!
      .querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/api/files/download?path=' + encodeURIComponent('docs/match.txt'));
    expect(link.textContent).toBe('match.txt');
    // Distinct from the browse Download control: no .btn class, no download attr.
    expect(link.className).toBe('');
    expect(link.hasAttribute('download')).toBe(false);
  });

  it('the search Path cell shows the entry path as plain text (no link)', async () => {
    const file = fileEntry({ name: 'a.txt', path: 'deep/nested/a.txt' });
    const { results } = await setupCleared();
    renderSearch({ query: 'q', path: '', results: [file] });
    const pathCell = cellsOf(rowByName(results.querySelector('table')!, 'a.txt'))[1];
    expect(pathCell.textContent).toBe('deep/nested/a.txt');
    expect(pathCell.querySelector('a, button')).toBeNull();
  });
});

/* ===========================================================================
 * HTML-injection edge cases (characterization for the textContent discipline)
 *
 * The behavioral suite covers a FILE name with markup; here we cover a
 * DIRECTORY name (which becomes a nav link's textContent) and the breadcrumb
 * segment path, to pin that EVERY user-controlled string flows through
 * textContent / attribute values, never innerHTML.
 * ========================================================================= */
describe('HTML-injection escape edge cases', () => {
  it('a directory name containing markup is rendered as literal text (no <b> parsed)', async () => {
    const dir = fileEntry({ name: '<b>bold</b>', path: 'docs/<b>bold</b>', isDirectory: true });
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [dir] }));
    const link = rowByName(results.querySelector('table')!, '<b>bold</b>')
      .querySelector('td')!
      .querySelector('a') as HTMLAnchorElement;
    expect(link.textContent).toBe('<b>bold</b>');
    expect(results.querySelector('b')).toBeNull();
  });

  it('a breadcrumb segment containing markup is rendered as literal text', async () => {
    const { breadcrumb } = await setupCleared();
    renderBrowse(browseResult({ path: '<img src=x>', entries: [] }));
    const seg = Array.from(breadcrumb.querySelectorAll('a')).find(
      (a) => a.textContent === '<img src=x>',
    ) as HTMLAnchorElement | undefined;
    expect(seg).toBeTruthy();
    expect(breadcrumb.querySelector('img')).toBeNull();
  });

  it('a file name containing markup in a search result is rendered as literal text', async () => {
    const file = fileEntry({ name: '<script>alert(1)</script>', path: 'docs/x' });
    const { results } = await setupCleared();
    renderSearch({ query: 'q', path: '', results: [file] });
    expect(results.querySelector('script')).toBeNull();
    const link = rowByName(results.querySelector('table')!, '<script>alert(1)</script>')
      .querySelector('td')!
      .querySelector('a') as HTMLAnchorElement;
    expect(link.textContent).toBe('<script>alert(1)</script>');
  });
});

/* ===========================================================================
 * Cell content derivation (format helpers wired into rows)
 *
 * Pin the exact cell-text derivation for a representative file so the row
 * builders stay wired to formatBytes / formatDate after extraction.
 * ========================================================================= */
describe('cell content derivation', () => {
  it('browse file row: Size=formatBytes(size), Modified=formatDate(lastModified)', async () => {
    const file = fileEntry({ name: 'a.bin', path: 'docs/a.bin', size: 1048576 });
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [file] }));
    const cells = cellsOf(rowByName(results.querySelector('table')!, 'a.bin'));
    expect(cells[1].textContent?.trim()).toBe(formatBytes(1048576)); // "1.0 MB"
    expect(cells[1].textContent?.trim()).toBe('1.0 MB');
    expect(cells[2].textContent?.trim()).toBe(formatDate(ISO));
    expect(cells[2].textContent?.trim()).toBe(ISO_FMT);
  });

  it('browse folder row: Size is an em-dash but Modified still shows formatDate(lastModified)', async () => {
    // Only the Size column is folder-special (em-dash); the Modified column
    // is populated the same way as for files, from the entry's lastModified.
    const dir = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true });
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [dir] }));
    const cells = cellsOf(rowByName(results.querySelector('table')!, 'sub'));
    expect(cells[1].textContent?.trim()).toBe('—');
    expect(cells[2].textContent?.trim()).toBe(ISO_FMT);
    expect(cells[2].textContent?.trim()).toBe(formatDate(ISO));
  });

  it('search row: Size=formatBytes(size), Modified=formatDate(lastModified)', async () => {
    const file = fileEntry({ name: 'a.bin', path: 'docs/a.bin', size: 2048 });
    const { results } = await setupCleared();
    renderSearch({ query: 'q', path: '', results: [file] });
    const cells = cellsOf(rowByName(results.querySelector('table')!, 'a.bin'));
    // Search columns: Name, Path, Size, Modified
    expect(cells[2].textContent?.trim()).toBe(formatBytes(2048)); // "2.0 KB"
    expect(cells[2].textContent?.trim()).toBe('2.0 KB');
    expect(cells[3].textContent?.trim()).toBe(ISO_FMT);
  });
});
