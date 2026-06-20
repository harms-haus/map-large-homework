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
import { pickAndUploadInto } from './toolbar-handlers.js';

/**
 * The text for a row's Size cell. Files show their byte size (formatBytes);
 * directories show their immediate-child count (files + folders) — or blank
 * when the count is zero, so an empty folder renders nothing rather than "0".
 */
function formatSizeColumn(entry: FileEntry): string {
  if (entry.isDirectory) {
    const count = entry.itemCount ?? 0;
    return count > 0 ? String(count) : '';
  }
  return formatBytes(entry.size);
}

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
 * The rectangle a row menu is anchored to: either the ⋮ button's own rect
 * (click) or a zero-size rect at the cursor (right-click). Only the four edges
 * are read, so a real `DOMRect` satisfies this structurally without adaptation.
 */
export interface MenuAnchor {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Pixel gap kept between the menu and each viewport edge when clamping. */
export const MENU_EDGE_MARGIN = 4;

/**
 * Compute the CSS `left`/`top` for a `position: fixed` row menu so it stays on
 * screen, opening below and left-aligned with `anchor` by default and flipping
 * direction when that would run off the viewport:
 *
 *  - Vertical: open DOWN (top = `anchor.bottom`); if `anchor.bottom + height`
 *    would overflow the bottom edge, flip to open UP (top = `anchor.top -
 *    height`) so the menu's bottom edge meets the anchor's top.
 *  - Horizontal: open LEFT-aligned (left = `anchor.left`); if `anchor.left +
 *    width` would overflow the right edge, flip to RIGHT-align (left =
 *    `anchor.right - width`) so the menu's right edge meets the anchor's right.
 *
 * Finally the result is clamped to at least {@link MENU_EDGE_MARGIN} so a menu
 * larger than the viewport rests against the top-left corner instead of going
 * negative.
 *
 * Pure (no DOM access) so the flip behavior can be unit-tested directly with
 * arbitrary anchor / size / viewport triples; `openMenu` measures the real
 * values and feeds them in.
 */
export function computeMenuPosition(
  anchor: MenuAnchor,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  let left = anchor.left;
  let top = anchor.bottom;

  // Overflowing the right edge → open leftward (right-align to the anchor).
  if (left + size.width > viewport.width - MENU_EDGE_MARGIN) {
    left = anchor.right - size.width;
  }
  // Overflowing the bottom edge → open upward (bottom-align to the anchor).
  if (top + size.height > viewport.height - MENU_EDGE_MARGIN) {
    top = anchor.top - size.height;
  }

  // Clamp into the viewport (also covers a menu larger than the viewport).
  if (left < MENU_EDGE_MARGIN) {
    left = MENU_EDGE_MARGIN;
  }
  if (top < MENU_EDGE_MARGIN) {
    top = MENU_EDGE_MARGIN;
  }

  return { left, top };
}

/**
 * The viewport size used to flip/clamp menus. Falls back from
 * `document.documentElement.clientWidth/Height` (the layout viewport) to
 * `window.innerWidth/Height` — the fallback matters in test DOMs (e.g.
 * happy-dom) where the `<html>` element reports a 0×0 client size.
 */
function getViewportSize(): { width: number; height: number } {
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight,
  };
}

/**
 * Build a `.row-menu` dropdown from `items` with the shared open/close
 * lifecycle used by EVERY menu in the browse view (the per-row ⋮ menu, the
 * right-click row menu, and the current-directory blank-space menu). Returns
 * the menu element plus its `openMenu`/`closeMenu` controls.
 *
 * Lifecycle:
 *  - `openMenu(anchor)` first calls `closeAllRowMenus()` (the module-level
 *    single-open invariant — at most one menu shows at a time across every
 *    row and the directory menu), reveals the menu, measures it, and positions
 *    it at `anchor` via {@link computeMenuPosition} (flipping/clamping to stay
 *    on screen). It then registers one-shot document `click` (close on the
 *    next click anywhere — outside OR on a menu item, after the item's own
 *    handler has run) and `keydown` (close on Escape) listeners.
 *  - `closeMenu()` hides the menu, removes both listeners, and clears the
 *    module open-menu slot if it still points here.
 *
 * `btn`, when supplied (the ⋮ trigger), gets its `aria-expanded` toggled with
 * the menu; a directory menu has no trigger button, so it omits `btn`.
 */
function createMenu(
  items: HTMLElement[],
  btn?: HTMLButtonElement,
): {
  menu: HTMLElement;
  openMenu: (anchor: MenuAnchor) => void;
  closeMenu: () => void;
} {
  const menu = document.createElement('div');
  menu.className = 'row-menu';
  menu.hidden = true;
  menu.append(...items);

  // Document listeners registered on open, removed on close. Kept as named
  // references so removeEventListener tears down the exact functions.
  function onDocClick(): void {
    closeMenu();
  }
  function onDocKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      closeMenu();
      return;
    }
    // WAI-ARIA Menu Button keyboard contract: ArrowDown/ArrowUp move focus
    // between items (wrapping at the ends) and Home/End jump to the first /
    // last item. These are handled only while the menu is open (this listener
    // is registered by openMenu and removed by closeMenu), and they call
    // preventDefault so the keys never also scroll the page. Any other key is
    // ignored so typing / tabbing etc. behave normally.
    const count = items.length;
    if (count === 0) return;
    const current = items.findIndex((el) => el === document.activeElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        // No item focused yet → land on the first; otherwise advance with wrap.
        next = current < 0 ? 0 : (current + 1) % count;
        break;
      case 'ArrowUp':
        // No item focused yet → land on the last; otherwise retreat with wrap.
        next = current < 0 ? count - 1 : (current - 1 + count) % count;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    items[next].focus();
  }

  function closeMenu(): void {
    menu.hidden = true;
    btn?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onDocKey);
    if (openRowMenu?.close === closeMenu) {
      openRowMenu = null;
    }
  }

  function openMenu(anchor: MenuAnchor): void {
    closeAllRowMenus();
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    const placement = computeMenuPosition(
      anchor,
      { width: rect.width, height: rect.height },
      getViewportSize(),
    );
    menu.style.left = placement.left + 'px';
    menu.style.top = placement.top + 'px';
    btn?.setAttribute('aria-expanded', 'true');
    document.addEventListener('click', onDocClick);
    document.addEventListener('keydown', onDocKey);
    openRowMenu = { close: closeMenu };
  }

  return { menu, openMenu, closeMenu };
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
  row.classList.add('parent-row');
  const nameCell = document.createElement('td');
  nameCell.append(makeNavLink('..', toBrowseHash(parent)));
  const sizeCell = document.createElement('td');
  const modifiedCell = document.createElement('td');
  const actionsCell = document.createElement('td');
  row.append(nameCell, sizeCell, modifiedCell, actionsCell);
  // Whole-row click browses to the parent (consistent with folder rows).
  navigateRowOnClick(row, toBrowseHash(parent));
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
  openMenu: (anchor: MenuAnchor) => void;
} {
  const btn = document.createElement('button');
  btn.className = 'row-menu-btn';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Actions');
  btn.setAttribute('aria-haspopup', 'true');
  btn.setAttribute('aria-expanded', 'false');
  btn.textContent = '⋮';

  // Menu items. Folders get an Upload-into-this-folder action first; files
  // get a Download anchor first. Both then get Delete / Move / Copy. Each
  // item carries a leading Bootstrap Icons glyph (see makeIcon) so the action
  // is recognizable at a glance; the label text follows.
  const items: HTMLElement[] = [];
  if (entry.isDirectory) {
    items.push(makeActionButton('Upload', () => pickAndUploadInto(entry.path), 'upload'));
  } else {
    const download = document.createElement('a');
    download.className = 'btn';
    download.setAttribute('href', getApi().downloadUrl(entry.path));
    download.setAttribute('download', entry.name);
    download.append(makeIcon('download'), 'Download');
    items.push(download);
  }
  items.push(
    makeActionButton(
      'Delete',
      async () => {
        if (!window.confirm('Delete "' + entry.name + '"?')) {
          return;
        }
        await getApi().delete(entry.path);
        rerender();
      },
      'trash',
    ),
  );
  items.push(
    makeActionButton(
      'Move',
      async () => {
        const dest = window.prompt('Move to relative destination path:', entry.path);
        if (dest === null) {
          return;
        }
        await getApi().move(entry.path, normalizeRelativePath(dest));
        rerender();
      },
      'arrows-move',
    ),
  );
  items.push(
    makeActionButton(
      'Copy',
      async () => {
        const dest = window.prompt('Copy to relative destination path:', entry.path);
        if (dest === null) {
          return;
        }
        await getApi().copy(entry.path, normalizeRelativePath(dest));
        rerender();
      },
      'files',
    ),
  );

  // Shared open/close + positioning lifecycle (see createMenu). The ⋮ button
  // is passed so its aria-expanded toggles with the menu.
  const { menu, openMenu, closeMenu } = createMenu(items, btn);

  // Toggle: open below the button, or close if already open. stopPropagation on
  // the OPENING click is critical — without it the click would bubble to the
  // document listener registered by openMenu and close the menu immediately.
  btn.addEventListener('click', (event) => {
    if (menu.hidden) {
      event.stopPropagation();
      openMenu(btn.getBoundingClientRect());
    } else {
      closeMenu();
    }
  });

  return { btn, menu, openMenu };
}

/* -------------------------------------------------------------------------
 * Current-directory context menu (right-click on blank space)
 *
 * Right-clicking the blank area of the results view (NOT on a row or the
 * header) opens a menu that acts on the CURRENTLY browsed directory: upload
 * into it, or create a new subdirectory. The menu for the current dir is
 * rebuilt on every render (the path changes with navigation) and lives as a
 * hidden `.row-menu` inside the results element; `openCurrentDirMenu` is the
 * latest menu's open function, read by the once-attached `contextmenu`
 * listener so it always targets the current directory.
 * ---------------------------------------------------------------------- */
let openCurrentDirMenu: (anchor: MenuAnchor) => void = () => {};

/**
 * Build the current-directory menu for `dirPath`: Upload (into `dirPath`) then
 * New directory (a new subdirectory under `dirPath`). Has no trigger button —
 * it is opened only by the results-view `contextmenu` listener.
 */
function makeDirMenu(dirPath: string): {
  menu: HTMLElement;
  openMenu: (anchor: MenuAnchor) => void;
} {
  const items: HTMLElement[] = [
    makeActionButton('Upload', () => pickAndUploadInto(dirPath), 'upload'),
    makeActionButton(
      'New directory',
      async () => {
        const name = window.prompt('New directory name:', '');
        // Empty / whitespace-only names (and a cancelled prompt) do nothing.
        // joinPath normalizes the combined path, and the service's SafeResolve
        // sandboxes it again, so a traversal-laden name cannot escape root.
        if (name === null || name.trim() === '') {
          return;
        }
        await getApi().createDirectory(joinPath(dirPath, name));
        rerender();
      },
      'folder-plus',
    ),
  ];
  return createMenu(items);
}

/**
 * Mount the current-directory menu for `dirPath` into `resultsEl` and wire the
 * blank-space `contextmenu` listener. Called from `renderBrowse` on every
 * render: the menu is rebuilt + re-appended each time (cleared by the render's
 * `innerHTML = ''`), while the listener attaches exactly once per results
 * element (guarded by a data attribute, since the results element persists
 * across renders within a mount).
 *
 * The listener opens the current-dir menu ONLY for genuine blank space: a
 * right-click whose target is inside the `table` (any header or data row —
 * folder/file rows handle themselves via their own listeners, and the ".."
 * parent row is navigation-only) or inside an already-open `.row-menu` is
 * ignored, so those keep their existing behavior.
 */
export function setupDirContextMenu(resultsEl: HTMLElement, dirPath: string): void {
  const { menu, openMenu } = makeDirMenu(dirPath);
  resultsEl.append(menu);
  openCurrentDirMenu = openMenu;

  if (resultsEl.dataset.dirMenuWired === '1') {
    return;
  }
  resultsEl.dataset.dirMenuWired = '1';
  resultsEl.addEventListener('contextmenu', (event) => {
    if (
      !(event.target instanceof Element) ||
      event.target.closest('table') !== null ||
      event.target.closest('.row-menu') !== null
    ) {
      return;
    }
    event.preventDefault();
    openCurrentDirMenu({
      left: event.clientX,
      top: event.clientY,
      right: event.clientX,
      bottom: event.clientY,
    });
  });
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

  // Size — directories show their immediate-child count (blank when 0);
  // files show their byte size.
  const sizeCell = document.createElement('td');
  sizeCell.textContent = formatSizeColumn(entry);

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
    // Zero-size anchor at the cursor: the menu opens with its top-left at the
    // cursor (extending right/down) and flips to extend left/up only when that
    // would leave the viewport — see computeMenuPosition.
    openMenu({
      left: event.clientX,
      top: event.clientY,
      right: event.clientX,
      bottom: event.clientY,
    });
  });

  row.append(nameCell, sizeCell, modifiedCell, actionsCell);

  // A whole folder row browses into the folder on click (not just the name
  // link), EXCEPT clicks in the actions cell (the ⋮ button + its menu) which
  // keep their own behavior. The name link stays in place for middle-click /
  // copy-link accessibility; clicking it calls navigate() with the same hash,
  // and the bubbled row call repeats that same no-op (setting the hash to its
  // current value fires no hashchange, so there is no double render).
  if (entry.isDirectory) {
    row.classList.add('folder-row');
    navigateRowOnClick(row, toBrowseHash(entry.path), actionsCell);
  }

  return row;
}

/**
 * Make a table row navigate to `hash` on a click anywhere within it, so folder
 * and parent rows browse on a whole-row click rather than only on the name
 * link. Clicks originating inside `except` (e.g. a folder row's actions cell —
 * the ⋮ button and its menu) are ignored so those controls keep working.
 *
 * `event.target instanceof Node` both narrows the `EventTarget | null` target
 * to a `Node` for `Element.contains` (type-safe, no cast) and guards against a
 * null target in edge synthetic events.
 */
function navigateRowOnClick(row: HTMLTableRowElement, hash: string, except?: Element): void {
  row.addEventListener('click', (event) => {
    if (except && event.target instanceof Node && except.contains(event.target)) {
      return;
    }
    navigate(hash);
  });
}

/**
 * Build a Bootstrap Icons glyph element: an empty `<i class="bi bi-<name>">`.
 * The glyph itself is painted by the bootstrap-icons stylesheet's `::before`
 * pseudo-element (content set in CSS), so the element has NO text content of
 * its own — which keeps `textContent` assertions on the parent (e.g. a menu
 * item whose visible label is "Download") unchanged.
 */
export function makeIcon(name: string): HTMLElement {
  const icon = document.createElement('i');
  icon.className = 'bi bi-' + name;
  return icon;
}

/**
 * Build a `<button class="btn">` with the given label and click handler, and an
 * optional leading Bootstrap Icons glyph.
 *
 * The handler is wrapped so that any synchronous throw or promise rejection
 * surfaces the error via the status footer — consistent with how `render()`
 * already displays fetch errors. On normal resolution no error message is
 * shown.
 *
 * When `icon` is given it is prepended as `makeIcon(icon)` (an empty `<i>`),
 * followed by the label as a bare text node — so the button's `textContent`
 * remains exactly `label` and its `className` stays exactly `"btn"`.
 */
export function makeActionButton(
  label: string,
  handler: () => void,
  icon?: string,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.type = 'button';
  if (icon) {
    btn.append(makeIcon(icon));
  }
  btn.append(label);
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

  // Size — directories show their immediate-child count (blank when 0);
  // files show their byte size.
  const sizeCell = document.createElement('td');
  sizeCell.textContent = formatSizeColumn(entry);

  // Modified
  const modifiedCell = document.createElement('td');
  modifiedCell.textContent = formatDate(entry.lastModified);

  row.append(nameCell, pathCell, sizeCell, modifiedCell);
  return row;
}
