/**
 * SPA entry — wires `api`, `router`, and the DOM into a file-browser UI
 * rendered inside a native `<dialog>` widget.
 *
 * This module is the thin entry point: it builds the DOM imperatively, wires
 * toolbar/dialog events, binds the resulting element refs into the render
 * orchestrator (which owns the route dispatch and render lifecycle), and kicks
 * off the initial render. The rendering logic itself lives in the focused
 * modules under `./app/`:
 *
 *   - `./app/context.js`             — shared API client, DOM refs, render hook
 *   - `./app/dom-builders.js`        — table/breadcrumb/row/action-button builders
 *   - `./app/render-browse.js`       — browse-result rendering
 *   - `./app/render-search.js`       — search-result rendering
 *   - `./app/toolbar-handlers.js`    — search + upload-into-folder handlers
 *   - `./app/render-orchestrator.js` — route dispatch + render lifecycle
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
 *     toolbar   — .breadcrumb + .search-wrapper (search <input> +
 *                search-icon + clear-btn)
 *     .results  — file/folder <table>
 *     <footer class="status"> — summary line
 *
 * All user-controlled strings (file/folder names, paths) are inserted via
 * `textContent` / element creation — never via `innerHTML` — to prevent HTML
 * injection.
 *
 * `renderBrowse` and `renderSearch` are re-exported so `src/app.test.ts`'s
 * existing `import { startApp, renderBrowse, renderSearch } from './app'`
 * continues to resolve without modification.
 */
import { doSearch, clearSearch } from './app/toolbar-handlers.js';
import { init } from './app/render-orchestrator.js';
import type { DomRefs } from './app/context.js';

export { renderBrowse } from './app/render-browse.js';
export { renderSearch } from './app/render-search.js';

/* =========================================================================
 * startApp — build the DOM, wire events, bind refs, kick off rendering
 * ========================================================================= */

export function startApp(root: HTMLElement): void {
  root.innerHTML = '';

  /* --- File-browser widget (chromeless; shared by the embedded view and the
     dialog). It owns the toolbar, results, and status. The frame and titlebar
     belong to whichever host renders it — never to the widget itself — so when
     it is embedded directly in the page it carries no border/background/title. --- */
  const widget = document.createElement('div');
  widget.className = 'file-browser';

  // Toolbar: breadcrumb, search
  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  const breadcrumbEl = document.createElement('div');
  breadcrumbEl.className = 'breadcrumb';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search...';
  // Search affordance: a wrapper holding the input, a leading search icon,
  // and a trailing clear button (the latter toggled purely by CSS via
  // `:placeholder-shown`, so it needs no ref in DomRefs).
  const searchWrapper = document.createElement('div');
  searchWrapper.className = 'search-wrapper';
  const searchIcon = document.createElement('i');
  searchIcon.className = 'bi bi-search search-icon';
  const searchClearBtn = document.createElement('button');
  searchClearBtn.className = 'clear-btn';
  searchClearBtn.type = 'button';
  searchClearBtn.setAttribute('aria-label', 'Clear search');
  const clearIcon = document.createElement('i');
  clearIcon.className = 'bi bi-x-lg';
  searchClearBtn.append(clearIcon);
  // ORDER MATTERS: input first, then icon, then clear-btn (CSS uses ~ sibling combinator)
  searchWrapper.append(searchInput, searchIcon, searchClearBtn);
  toolbar.append(breadcrumbEl, searchWrapper);

  // Results container + status footer
  const resultsEl = document.createElement('div');
  resultsEl.className = 'results';
  const statusEl = document.createElement('footer');
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
  // the same nodes, so the context refs and any in-flight render stay valid),
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

  // Debounced search: re-fire `doSearch` 200ms after the last keystroke so
  // typing a query doesn't pound the API on every character.
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  searchInput.addEventListener('input', () => {
    if (searchDebounceTimer !== null) {
      clearTimeout(searchDebounceTimer);
    }
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null;
      doSearch();
    }, 200);
  });
  // Clear button: wipe the input and return to the browse view.
  searchClearBtn.addEventListener('click', clearSearch);
  searchInput.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      doSearch();
    } else if (event.key === 'Escape') {
      // stopPropagation is critical: when the widget lives inside the open
      // <dialog>, the native ESC-to-close would otherwise dismiss the dialog.
      event.stopPropagation();
      clearSearch();
    }
  });

  /* --- Bind refs into the orchestrator + context, subscribe, and kick off
     the initial render. --- */
  const refs: DomRefs = {
    results: resultsEl,
    status: statusEl,
    breadcrumb: breadcrumbEl,
    searchInput,
  };
  init(refs);
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
