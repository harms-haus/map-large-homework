/**
 * Pure DOM-construction helpers for the file-browser tables, breadcrumb, and
 * action controls.
 *
 * Every function here builds and returns a DOM subtree (or, for
 * `renderBreadcrumb`, populates the shared breadcrumb element from the
 * context). They hold no state of their own; the shared element refs and API
 * client are read from `./context.js`.
 *
 * All user-controlled strings (file/folder names, paths) are inserted via
 * `textContent` / element creation — never via `innerHTML` — to prevent HTML
 * injection.
 */
import type { FileEntry } from '../api.js';
import { formatBytes, formatDate, joinPath, normalizeRelativePath } from '../format.js';
import { navigate, toBrowseHash } from '../router.js';
import { getApi, getBreadcrumb, getStatus, rerender } from './context.js';

/* -------------------------------------------------------------------------
 * Row action menu open/close state
 *
 * At most one row menu (the "⋮" dropdown OR a right-click context menu) is
 * open at a time. `openRowMenu` holds the close function of whichever menu is
 * currently showing, so `closeAllRowMenus()` can dismiss it before opening
 * another and — crucially — so the menu's document-level click / Escape
 * listeners are removed on close rather than leaking across renders or rapid
 * open/close cycles. Module-scoped (not per-row) because the "only one menu
 * open" invariant spans every row in the table.
 * ---------------------------------------------------------------------- */
let openRowMenu: { close: () => void } | null = null;

/** Close whichever row menu (if any) is currently open. Idempotent no-op when none is open. */
function closeAllRowMenus(): void {
  openRowMenu?.close();
  openRowMenu = null;
}

/**
 * Build a `<table>` with a `<thead>` (one `<th>` per header label) and an empty
 * `<tbody>`. The caller appends rows to the `<tbody>`.
 */
export function buildTable(headers: string[]): HTMLTableElement {
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
 * Render clickable breadcrumb segments into the shared breadcrumb element: a
 * leading "Home" link (root) followed by one link per path segment, each
 * navigating to its cumulative path. Separators are plain '/' text spans.
 */
export function renderBreadcrumb(path: string): void {
  const breadcrumbEl = getBreadcrumb();
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
export function makeNavLink(text: string, hash: string): HTMLAnchorElement {
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
export function makeParentRow(parent: string): HTMLTableRowElement {
  const row = document.createElement('tr');
  const nameCell = document.createElement('td');
  nameCell.append(makeNavLink('..', toBrowseHash(parent)));
  const sizeCell = document.createElement('td');
  const modifiedCell = document.createElement('td');
  const actionsCell = document.createElement('td');
  row.append(nameCell, sizeCell, modifiedCell, actionsCell);
  return row;
}

/**
 * Build the per-row "⋮" action menu for a browse data row: a `.row-menu-btn`
 * (the three-dots trigger) and its `.row-menu` dropdown of action items
 * (Download for files only, then Delete / Move / Copy). Returns both elements
 * plus the row-local `openMenu(x, y)` so `makeBrowseRow` can also open the
 * SAME menu on a right-click anywhere on the row.
 *
 * Open / close lifecycle:
 *  - The button toggles: when closed, `stopPropagation()` on the opening
 *    click (so it never reaches the just-registered document listener) then
 *    `openMenu` below the button via `getBoundingClientRect()`; when open, a
 *    second click closes it.
 *  - `openMenu` first calls `closeAllRowMenus()` (only one open at a time),
 *    positions the `position: fixed` menu at viewport `(x, y)` px, reveals it,
 *    flips `aria-expanded` to `'true'`, registers one-shot document `click`
 *    (close on the next click anywhere — outside OR on a menu item, after the
 *    item's own handler has run) and `keydown` (close on Escape) listeners,
 *    and records itself as the open menu.
 *  - `closeMenu` hides the menu, restores `aria-expanded` to `'false'`, removes
 *    both document listeners, and clears `openRowMenu` if it still points here.
 *
 * The action-item handler bodies are identical to the former inline buttons
 * (same `window.confirm` / `prompt`, `getApi().delete/move/copy`,
 * `normalizeRelativePath`, and `rerender()` calls) so all behavior is
 * preserved. The items keep `class="btn"` (the `.row-menu .btn` CSS restyles
 * them into menu items) so existing query/characterization assertions hold.
 */
function makeRowMenu(entry: FileEntry): {
  btn: HTMLButtonElement;
  menu: HTMLElement;
  openMenu: (x: number, y: number) => void;
} {
  const btn = document.createElement('button');
  btn.className = 'row-menu-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Actions');
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  btn.textContent = '⋮';

  const menu = document.createElement('div');
  menu.className = 'row-menu';
  menu.hidden = true;

  // Menu items — same handlers/attributes as the former inline controls.
  if (!entry.isDirectory) {
    const download = document.createElement('a');
    download.className = 'btn';
    download.setAttribute('href', getApi().downloadUrl(entry.path));
    download.setAttribute('download', entry.name);
    download.textContent = 'Download';
    menu.append(download);
  }
  menu.append(
    makeActionButton('Delete', async () => {
      if (!window.confirm('Delete "' + entry.name + '"?')) {
        return;
      }
      await getApi().delete(entry.path);
      rerender();
    }),
  );
  menu.append(
    makeActionButton('Move', async () => {
      const dest = window.prompt('Move to relative destination path:', entry.path);
      if (dest === null) {
        return;
      }
      await getApi().move(entry.path, normalizeRelativePath(dest));
      rerender();
    }),
  );
  menu.append(
    makeActionButton('Copy', async () => {
      const dest = window.prompt('Copy to relative destination path:', entry.path);
      if (dest === null) {
        return;
      }
      await getApi().copy(entry.path, normalizeRelativePath(dest));
      rerender();
    }),
  );

  // Document listeners registered on open, removed on close. Kept as named
  // references so removeEventListener tears down the exact functions.
  function onDocClick(): void {
    closeMenu();
  }
  function onDocKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      closeMenu();
    }
  }

  function closeMenu(): void {
    menu.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onDocKey);
    if (openRowMenu?.close === closeMenu) {
      openRowMenu = null;
    }
  }

  function openMenu(x: number, y: number): void {
    closeAllRowMenus();
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onDocKey);
    openRowMenu = { close: closeMenu };
  }

  // Toggle: open below the button, or close if already open. stopPropagation on
  // the OPENING click is critical — without it the click would bubble to the
  // document listener registered by openMenu and close the menu immediately.
  btn.addEventListener('click', (event) => {
    if (menu.hidden) {
      event.stopPropagation();
      const rect = btn.getBoundingClientRect();
      openMenu(rect.left, rect.bottom);
    } else {
      closeMenu();
    }
  });

  return { btn, menu, openMenu };
}

/** One data row in the browse table (a file or folder entry). */
export function makeBrowseRow(entry: FileEntry): HTMLTableRowElement {
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

  // Actions — a "⋮" dropdown button + its menu (also opened by right-clicking
  // anywhere on the row, positioned at the cursor). The action items and their
  // handlers are built by makeRowMenu; see its doc comment for the open/close
  // contract.
  const actionsCell = document.createElement('td');
  const { btn, menu, openMenu } = makeRowMenu(entry);
  actionsCell.append(btn, menu);
  row.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openMenu(event.clientX, event.clientY);
  });

  row.append(nameCell, sizeCell, modifiedCell, actionsCell);
  return row;
}

/**
 * Build a `<button class="btn">` with the given label and click handler.
 *
 * The handler is wrapped so that any synchronous throw or promise rejection
 * surfaces the error via the status footer — consistent with how `render()`
 * already displays fetch errors. On normal resolution no error message is
 * shown.
 */
export function makeActionButton(label: string, handler: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.type = 'button';
  btn.textContent = label;
  btn.addEventListener('click', () => {
    try {
      Promise.resolve(handler()).catch((err: unknown) => {
        getStatus().textContent = 'Error: ' + (err instanceof Error ? err.message : String(err));
      });
    } catch (err) {
      getStatus().textContent = 'Error: ' + (err instanceof Error ? err.message : String(err));
    }
  });
  return btn;
}

/** One data row in the search-results table. */
export function makeSearchRow(entry: FileEntry): HTMLTableRowElement {
  const row = document.createElement('tr');

  // Name — directories browse into; files open their download URL.
  const nameCell = document.createElement('td');
  if (entry.isDirectory) {
    nameCell.append(makeNavLink(entry.name, toBrowseHash(entry.path)));
  } else {
    const link = document.createElement('a');
    link.setAttribute('href', getApi().downloadUrl(entry.path));
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
