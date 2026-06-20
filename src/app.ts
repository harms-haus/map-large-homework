/**
 * SPA entry — wires `api`, `router`, and the DOM into a file-browser UI
 * rendered inside a native `<dialog>` widget.
 *
 * Structure (built imperatively via `document.createElement`):
 *
 *   .file-browser-host   — primary chromeless surface; hosts the widget while
 *                          the dialog is closed (embedded view)
 *   <button class="trigger">Browse Files</button>
 *   <dialog class="browser-dialog">  — frame + titlebar (dialog-only chrome)
 *     .dialog-header     — title <span> + Close icon <button>
 *     .dialog-body        — empty slot; the shared widget moves here on open
 *
 *   The shared .file-browser widget (toolbar + .results + .status) is MOVED
 *   between the embedded host and the dialog body as the dialog opens/closes.
 *   It carries no border/background/title of its own — only the dialog adds
 *   the frame + titlebar, so the embedded view is chromeless.
 *
 *   .file-browser:
 *     toolbar   — .breadcrumb + search <input> + <button> + <label> upload
 *     .results  — file/folder <table>
 *     <footer class="status"> — summary line
 *
 * All user-controlled strings (file/folder names, paths) are inserted via
 * `textContent` / element creation — never via `innerHTML` — to prevent HTML
 * injection.
 */
import { ApiClient } from './api.js';
import type { BrowseResult, FileEntry, SearchResult } from './api.js';
import { parseHash, getCurrentRoute, subscribe, toBrowseHash, toSearchHash, navigate } from './router.js';
import type { Route } from './router.js';
import { formatBytes, normalizeRelativePath, joinPath, parentPath, basename, formatDate } from './format.js';

const api = new ApiClient();

/* -------------------------------------------------------------------------
 * Module-level DOM references
 *
 * `startApp` populates these once per mount. `render`, `renderBrowse`, and
 * `renderSearch` (the latter two are exported for direct unit testing) all
 * operate against them, so they always target the most recently mounted app.
 * Tests re-run `startApp` against a fresh container, re-binding these each
 * time.
 * ---------------------------------------------------------------------- */
let resultsEl!: HTMLElement;
let statusEl!: HTMLElement;
let breadcrumbEl!: HTMLElement;
let searchInput!: HTMLInputElement;
let uploadInput!: HTMLInputElement;

/* =========================================================================
 * startApp — build the DOM, wire events, kick off rendering
 * ========================================================================= */

export function startApp(root: HTMLElement): void {
  root.innerHTML = '';

  /* --- File-browser widget (chromeless; shared by the embedded view and the
     dialog). It owns the toolbar, results, and status. The frame and titlebar
     belong to whichever host renders it — never to the widget itself — so when
     it is embedded directly in the page it carries no border/background/title. --- */
  const widget = document.createElement('div');
  widget.className = 'file-browser';

  // Toolbar: breadcrumb, search, upload
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  breadcrumbEl = document.createElement('div');
  breadcrumbEl.className = 'breadcrumb';
  searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search...';
  const searchBtn = document.createElement('button');
  searchBtn.className = 'btn';
  searchBtn.type = 'button';
  searchBtn.textContent = 'Search';
  const uploadLabel = document.createElement('label');
  uploadLabel.className = 'btn';
  uploadLabel.textContent = 'Upload';
  uploadInput = document.createElement('input');
  uploadInput.type = 'file';
  uploadInput.hidden = true;
  uploadInput.multiple = true;
  uploadLabel.append(uploadInput);
  toolbar.append(breadcrumbEl, searchInput, searchBtn, uploadLabel);

  // Results container + status footer
  resultsEl = document.createElement('div');
  resultsEl.className = 'results';
  statusEl = document.createElement('footer');
  statusEl.className = 'status';

  widget.append(toolbar, resultsEl, statusEl);

  /* --- Embedded host: the primary, chromeless surface. The widget lives here
     while the dialog is closed. --- */
  const embeddedHost = document.createElement('div');
  embeddedHost.className = 'file-browser-host';
  embeddedHost.append(widget);

  /* --- Trigger button --- */
  const trigger = document.createElement('button');
  trigger.className = 'trigger';
  trigger.textContent = 'Browse Files';

  /* --- Native <dialog>: supplies the frame (border/background) and titlebar
     (title + close). Its body is an empty slot the shared widget drops into
     when opened. --- */
  const dialog = document.createElement('dialog');
  dialog.className = 'browser-dialog';

  // Titlebar: centered title + Close (icon) button
  const header = document.createElement('div');
  header.className = 'dialog-header';
  const titleSpan = document.createElement('span');
  titleSpan.className = 'title';
  titleSpan.textContent = 'File Browser';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-btn';
  closeBtn.type = 'button';
  // Icon button has no visible text, so expose an accessible name.
  closeBtn.setAttribute('aria-label', 'Close');
  const closeIcon = document.createElement('i');
  closeIcon.className = 'bi bi-x-lg';
  closeBtn.append(closeIcon);
  header.append(titleSpan, closeBtn);

  // Dialog body slot: the widget is moved here on open, back to the host on close.
  const dialogBody = document.createElement('div');
  dialogBody.className = 'dialog-body';

  dialog.append(header, dialogBody);
  root.append(embeddedHost, trigger, dialog);

  /* --- Event wiring --- */
  // Opening the dialog MOVES the shared widget into the dialog body (reusing
  // the same nodes, so module-level refs and any in-flight render stay valid),
  // then shows it. Closing — via the close button, ESC, etc. — fires the
  // dialog's `close` event, which moves the widget back to the embedded host.
  trigger.addEventListener('click', () => {
    dialogBody.append(widget);
    dialog.showModal();
  });
  dialog.addEventListener('close', () => {
    embeddedHost.append(widget);
  });
  closeBtn.addEventListener('click', () => dialog.close());

  searchBtn.addEventListener('click', doSearch);
  searchInput.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      doSearch();
    }
  });

  uploadInput.addEventListener('change', handleUpload);

  /* --- Route subscription + initial render --- */
  subscribe(render);
  render();
}

/* =========================================================================
 * Toolbar handlers
 * ========================================================================= */

/**
 * Navigate to a search hash for the current input value and browse path.
 *
 * An empty (or whitespace-only) query clears the search instead: it navigates
 * to the browse route for the current path so the server never receives an
 * empty `query`, which it rejects with 400.
 */
function doSearch(): void {
  const path = normalizeRelativePath(getCurrentRoute().path);
  const query = searchInput.value.trim();
  if (query === '') {
    navigate(toBrowseHash(path));
    return;
  }
  navigate(toSearchHash(query, path));
}

/** Upload every selected file to the current path, then clear + re-render. */
async function handleUpload(): Promise<void> {
  const list = uploadInput.files;
  const files = list ? Array.from(list) : [];
  if (files.length === 0) {
    return;
  }
  const path = normalizeRelativePath(getCurrentRoute().path);
  for (const file of files) {
    await api.upload(path, file);
  }
  // Clear the input so selecting the same file again re-fires `change`.
  uploadInput.value = '';
  render();
}

/* =========================================================================
 * render — route dispatcher
 *
 * Clears the results container synchronously (so a pending/failed fetch never
 * leaves a stale table behind) but does NOT clear the breadcrumb or status
 * here. Clearing those synchronously would remove in-page navigation targets
 * in the middle of a click handler: `navigate()` dispatches `hashchange`
 * synchronously in happy-dom, which would re-enter `render` and wipe the
 * breadcrumb before the click's caller can read the next segment. The
 * breadcrumb/status are instead refreshed by `renderBrowse`/`renderSearch`
 * once data arrives.
 * ========================================================================= */

async function render(): Promise<void> {
  const route = getCurrentRoute();
  resultsEl.innerHTML = '';
  try {
    if (route.view === 'browse') {
      const result = await api.browse(normalizeRelativePath(route.path));
      renderBrowse(result, route);
    } else {
      const result = await api.search(route.query, normalizeRelativePath(route.path));
      renderSearch(result, route);
    }
  } catch (err) {
    // textContent replaces all children, so any stale table is removed too.
    resultsEl.textContent = err instanceof Error
      ? 'Error: ' + err.message
      : 'Error: ' + String(err);
  }
}

/* =========================================================================
 * renderBrowse — table for a BrowseResult
 * ========================================================================= */

export function renderBrowse(result: BrowseResult, route: Route): void {
  void route; // signature per spec; the API result is the source of truth

  // Breadcrumb (clickable cumulative-path segments)
  renderBreadcrumb(result.path);

  // Status footer: "N folders, M files, total S"
  statusEl.textContent =
    result.folderCount + ' folders, ' +
    result.fileCount + ' files, total ' +
    formatBytes(result.totalSize);

  // Results table
  resultsEl.innerHTML = '';
  const table = buildTable(['Name', 'Size', 'Modified', 'Actions']);
  const tbody = table.querySelector('tbody')!;

  if (result.parent !== null) {
    tbody.append(makeParentRow(result.parent));
  }
  for (const entry of result.entries) {
    tbody.append(makeBrowseRow(entry));
  }

  resultsEl.append(table);
}

/* =========================================================================
 * renderSearch — table for a SearchResult
 * ========================================================================= */

export function renderSearch(result: SearchResult, route: Route): void {
  void route;

  // Breadcrumb reflects the search-scope path.
  renderBreadcrumb(result.path);

  // Status footer: 'R results for "q"'
  statusEl.textContent = result.results.length + ' results for "' + result.query + '"';

  // Results table
  resultsEl.innerHTML = '';
  const table = buildTable(['Name', 'Path', 'Size', 'Modified']);
  const tbody = table.querySelector('tbody')!;

  for (const entry of result.results) {
    tbody.append(makeSearchRow(entry));
  }

  resultsEl.append(table);
}

/* =========================================================================
 * DOM-builder helpers
 * ========================================================================= */

/**
 * Build a `<table>` with a `<thead>` (one `<th>` per header label) and an empty
 * `<tbody>`. The caller appends rows to the `<tbody>`.
 */
function buildTable(headers: string[]): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'results-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of headers) {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement('tbody');
  table.append(thead, tbody);
  return table;
}

/**
 * Render clickable breadcrumb segments into `breadcrumbEl`: a leading "Home"
 * link (root) followed by one link per path segment, each navigating to its
 * cumulative path. Separators are plain '/' text spans.
 */
function renderBreadcrumb(path: string): void {
  breadcrumbEl.innerHTML = '';
  const normalized = normalizeRelativePath(path);
  const segments = normalized === '' ? [] : normalized.split('/');

  breadcrumbEl.append(makeNavLink('Home', toBrowseHash('')));

  let cumulative = '';
  for (const segment of segments) {
    cumulative = joinPath(cumulative, segment);
    const separator = document.createElement('span');
    separator.textContent = '/';
    breadcrumbEl.append(separator, makeNavLink(segment, toBrowseHash(cumulative)));
  }
}

/**
 * Build an `<a>` that navigates to `hash` on click. The `href` is set via
 * `setAttribute` (so the raw attribute is preserved exactly — important for
 * download URLs that must not be URL-normalized) and a click handler calls
 * `navigate(hash)` with `preventDefault` so navigation is reliable across DOM
 * implementations. The href also enables middle-click / copy-link support.
 */
function makeNavLink(text: string, hash: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.setAttribute('href', hash);
  link.textContent = text;
  link.addEventListener('click', (event) => {
    event.preventDefault();
    navigate(hash);
  });
  return link;
}

/** The ".." parent row: a Name cell whose link navigates to the parent path. */
function makeParentRow(parent: string): HTMLTableRowElement {
  const row = document.createElement('tr');
  const nameCell = document.createElement('td');
  nameCell.append(makeNavLink('..', toBrowseHash(parent)));
  const sizeCell = document.createElement('td');
  const modifiedCell = document.createElement('td');
  const actionsCell = document.createElement('td');
  row.append(nameCell, sizeCell, modifiedCell, actionsCell);
  return row;
}

/** One data row in the browse table (a file or folder entry). */
function makeBrowseRow(entry: FileEntry): HTMLTableRowElement {
  const row = document.createElement('tr');

  // Name — directory names are navigation links; file names are plain text.
  const nameCell = document.createElement('td');
  if (entry.isDirectory) {
    nameCell.append(makeNavLink(entry.name, toBrowseHash(entry.path)));
  } else {
    nameCell.textContent = entry.name;
  }

  // Size — em-dash for folders, formatted bytes for files.
  const sizeCell = document.createElement('td');
  sizeCell.textContent = entry.isDirectory ? '—' : formatBytes(entry.size);

  // Modified
  const modifiedCell = document.createElement('td');
  modifiedCell.textContent = formatDate(entry.lastModified);

  // Actions
  const actionsCell = document.createElement('td');
  if (!entry.isDirectory) {
    const download = document.createElement('a');
    download.className = 'btn';
    download.setAttribute('href', api.downloadUrl(entry.path));
    download.setAttribute('download', entry.name);
    download.textContent = 'Download';
    actionsCell.append(download);
  }
  actionsCell.append(makeActionButton('Delete', async () => {
    if (!window.confirm('Delete "' + entry.name + '"?')) {
      return;
    }
    await api.delete(entry.path);
    render();
  }));
  actionsCell.append(makeActionButton('Move', async () => {
    const dest = window.prompt('Move to relative destination path:', entry.path);
    if (dest === null) {
      return;
    }
    await api.move(entry.path, normalizeRelativePath(dest));
    render();
  }));
  actionsCell.append(makeActionButton('Copy', async () => {
    const dest = window.prompt('Copy to relative destination path:', entry.path);
    if (dest === null) {
      return;
    }
    await api.copy(entry.path, normalizeRelativePath(dest));
    render();
  }));

  row.append(nameCell, sizeCell, modifiedCell, actionsCell);
  return row;
}

/** Build a `<button class="btn">` with the given label and click handler. */
function makeActionButton(label: string, handler: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.type = 'button';
  btn.textContent = label;
  btn.addEventListener('click', handler);
  return btn;
}

/** One data row in the search-results table. */
function makeSearchRow(entry: FileEntry): HTMLTableRowElement {
  const row = document.createElement('tr');

  // Name — directories browse into; files open their download URL.
  const nameCell = document.createElement('td');
  if (entry.isDirectory) {
    nameCell.append(makeNavLink(entry.name, toBrowseHash(entry.path)));
  } else {
    const link = document.createElement('a');
    link.setAttribute('href', api.downloadUrl(entry.path));
    link.textContent = entry.name;
    nameCell.append(link);
  }

  // Path
  const pathCell = document.createElement('td');
  pathCell.textContent = entry.path;

  // Size
  const sizeCell = document.createElement('td');
  sizeCell.textContent = formatBytes(entry.size);

  // Modified
  const modifiedCell = document.createElement('td');
  modifiedCell.textContent = formatDate(entry.lastModified);

  row.append(nameCell, pathCell, sizeCell, modifiedCell);
  return row;
}

/* =========================================================================
 * Bootstrap
 *
 * Guarded so the module is importable in tests (which have no #app element)
 * without side effects. Only mounts when a real #app container exists.
 * ========================================================================= */

const appRoot = document.getElementById('app');
if (appRoot) {
  startApp(appRoot);
}
