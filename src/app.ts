/**
 * SPA entry — wires `api`, `router`, and the DOM into a file-browser UI
 * rendered inside a native `<dialog>`.
 *
 * Builds the DOM imperatively, wires toolbar/dialog events, binds the element
 * refs into the render orchestrator (which owns route dispatch and the render
 * lifecycle), and kicks off the initial render.
 *
 * The `.file-browser` widget (toolbar + .results + .status) is chromeless: no
 * border, background, or title of its own. One lives permanently in the
 * embedded host; while the dialog is open a second one lives in the dialog
 * body. Only the dialog adds the frame + titlebar. A widget is the active
 * render target while its refs are bound into the shared context; the dialog
 * is modal, so only the open widget is interactive at a time.
 *
 * All user-controlled strings (file/folder names, paths) are inserted via
 * `textContent` / element creation — never via `innerHTML`.
 */
import { doSearch, clearSearch } from './app/toolbar-handlers.js';
import { init, render } from './app/render-orchestrator.js';
import { setMenuState, setRefs, type DomRefs } from './app/context.js';
import { createMenuState } from './app/menus.js';

/** Delay (ms) after the last keystroke before firing a search query. */
const SEARCH_DEBOUNCE_MS = 200;

/**
 * Build a chromeless `.file-browser` widget: toolbar (breadcrumb + search
 * wrapper), results, and status, and wire its search input / clear / keydown
 * listeners. Returns the widget and the {@link DomRefs} the render orchestrator
 * writes into while this widget is the active target.
 */
function createFileBrowserWidget(): { widget: HTMLElement; refs: DomRefs } {
  const widget = document.createElement('div');
  widget.className = 'file-browser';

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  const breadcrumbEl = document.createElement('div');
  breadcrumbEl.className = 'breadcrumb';
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search...';

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
  // ORDER MATTERS: input, then icon, then clear-btn (CSS uses the ~ sibling combinator).
  searchWrapper.append(searchInput, searchIcon, searchClearBtn);
  toolbar.append(breadcrumbEl, searchWrapper);

  const resultsEl = document.createElement('div');
  resultsEl.className = 'results';
  const statusEl = document.createElement('footer');
  statusEl.className = 'status';

  widget.append(toolbar, resultsEl, statusEl);

  // Per-widget debounce timer.
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  searchInput.addEventListener('input', () => {
    if (searchDebounceTimer !== null) {
      clearTimeout(searchDebounceTimer);
    }
    searchDebounceTimer = setTimeout(() => {
      searchDebounceTimer = null;
      doSearch();
    }, SEARCH_DEBOUNCE_MS);
  });
  searchClearBtn.addEventListener('click', clearSearch);
  searchInput.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      doSearch();
    } else if (event.key === 'Escape') {
      // stopPropagation: when the widget is inside the open <dialog>, the
      // native ESC-to-close would otherwise dismiss the dialog.
      event.stopPropagation();
      clearSearch();
    }
  });

  const refs: DomRefs = {
    results: resultsEl,
    status: statusEl,
    breadcrumb: breadcrumbEl,
    searchInput,
  };
  return { widget, refs };
}

/** Bind `refs` (and a fresh menu state) into the shared context and render the
 * current route into them, making this widget the active render target. */
function activateWidget(refs: DomRefs): void {
  setRefs(refs);
  setMenuState(createMenuState());
  render();
}

export function startApp(root: HTMLElement): void {
  root.innerHTML = '';

  const embedded = createFileBrowserWidget();
  const embeddedHost = document.createElement('div');
  embeddedHost.className = 'file-browser-host';
  embeddedHost.append(embedded.widget);

  const trigger = document.createElement('button');
  trigger.className = 'trigger';
  trigger.textContent = 'Browse Files';

  const dialog = document.createElement('dialog');
  dialog.className = 'browser-dialog';

  const header = document.createElement('div');
  header.className = 'dialog-header';
  const titleSpan = document.createElement('span');
  titleSpan.className = 'title';
  titleSpan.textContent = 'File Browser';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-btn';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close');
  const closeIcon = document.createElement('i');
  closeIcon.className = 'bi bi-x-lg';
  closeBtn.append(closeIcon);
  header.append(titleSpan, closeBtn);

  const dialogBody = document.createElement('div');
  dialogBody.className = 'dialog-body';

  dialog.append(header, dialogBody);
  root.append(embeddedHost, trigger, dialog);

  init(embedded.refs);

  trigger.addEventListener('click', () => {
    const dialogWidget = createFileBrowserWidget();
    dialogBody.replaceChildren(dialogWidget.widget);
    activateWidget(dialogWidget.refs);
    dialog.showModal();
  });

  dialog.addEventListener('close', () => {
    activateWidget(embedded.refs);
    dialogBody.replaceChildren();
  });

  closeBtn.addEventListener('click', () => dialog.close());
}

const appRoot = document.getElementById('app');
if (appRoot) {
  startApp(appRoot);
}
