/**
 * Row-menu and directory-context-menu lifecycle and viewport-edge positioning.
 *
 * This module owns the entire open/close lifecycle shared by EVERY menu in the
 * browse view (the per-row ⋮ dropdown, the right-click row menu, and the
 * current-directory blank-space menu), plus the pure off-screen flip/clamp
 * placement math (`computeMenuPosition`) and the per-mount single-open state
 * (`createMenuState` / `MenuState`).
 *
 * Placement highlights preserved here:
 *  - `computeMenuPosition` opens a menu below + left-aligned with its anchor by
 *    default and flips direction (down→up, left→right) when that would run off
 *    the viewport, finally clamping to at least `MENU_EDGE_MARGIN`. It is pure
 *    (no DOM access) so the flip behavior is unit-testable in isolation.
 *  - `createMenu` implements the WAI-ARIA Menu Button keyboard contract
 *    (ArrowDown/ArrowUp move focus with wrapping, Home/End jump to the ends,
 *    Escape and an outside document click close the menu).
 *  - The per-mount `MenuState` enforces the single-open invariant: at most one
 *    row menu is open at a time within a mount.
 *
 * Menu action items are built with `makeActionButton` / `makeIcon` from
 * `./icons.js`; the mutation handlers re-render via the context's render hook
 * and surface errors through the shared status footer.
 */
import type { FileEntry } from '../api.js';
import { joinPath, normalizeRelativePath } from '../format.js';
import { getApi, rerender } from './context.js';
import { makeActionButton, makeIcon } from './icons.js';
import { pickAndUploadInto } from './toolbar-handlers.js';

/* -------------------------------------------------------------------------
 * Row action menu open/close state — per-mount (see MenuState below).
 *
 * At most one row menu (the "⋮" dropdown OR a right-click context menu) is
 * open at a time within a mount. The state is encapsulated in a fresh
 * {@link MenuState} created per `startApp` mount (via {@link createMenuState},
 * threaded through the shared context) rather than module-level singletons, so
 * a re-mount never inherits a previous mount's open-menu references: opening a
 * menu in mount #2 cannot call mount #1's stale close function and hide its
 * (now-detached) menu. The single-open invariant still spans every row in the
 * table — just scoped to the mount that owns the state.
 * ---------------------------------------------------------------------- */

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

/**
 * Per-mount menu open/close state. Created fresh for each `startApp` mount via
 * {@link createMenuState} and threaded through the shared context
 * (`setMenuState` / `getMenuState` in `./context.js`), so a re-mount never
 * inherits a previous mount's open-menu references.
 *
 *  - `openRowMenu` holds the close function of whichever row menu (the "⋮"
 *    dropdown OR a right-click context menu) is currently showing, so
 *    {@link MenuState.closeAllRowMenus} can dismiss it before opening another
 *    and — crucially — so the menu's document-level click / Escape listeners
 *    are removed on close rather than leaking across renders or rapid
 *    open/close cycles.
 *  - `openCurrentDirMenu` holds the current-directory menu's open function,
 *    rebound on every render so the once-attached `contextmenu` listener
 *    always targets the current directory.
 *
 * Both are scoped per-mount (not per-row) because the "only one menu open"
 * invariant spans every row AND the directory menu within one mount.
 */
export interface MenuState {
  /** The close function of the currently-open row menu (null when none). */
  openRowMenu: { close: () => void } | null;
  /** The current-directory menu's open function (rebound each render). */
  openCurrentDirMenu: (anchor: MenuAnchor) => void;
  /** Close the open row menu, if any. Idempotent no-op when none is open. */
  closeAllRowMenus(): void;
}

/**
 * Create a fresh, isolated {@link MenuState} for one mount. `createMenu`,
 * `makeRowMenu`, and `makeDirMenu` read/write its fields, so the single-open
 * invariant is scoped to the mount that owns the state — never shared across
 * mounts. `render-orchestrator.init` calls this on every mount and stores the
 * result in the shared context.
 */
export function createMenuState(): MenuState {
  const state: MenuState = {
    openRowMenu: null,
    openCurrentDirMenu: () => {},
    closeAllRowMenus: () => {
      state.openRowMenu?.close();
      state.openRowMenu = null;
    },
  };
  return state;
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
 * The viewport size used by computeMenuPosition to flip/clamp menus. Falls
 * back from `document.documentElement.clientWidth/Height` (the layout
 * viewport) to `window.innerWidth/Height` — the fallback matters in test
 * DOMs (e.g. happy-dom) where the `<html>` element reports a 0×0 client
 * size.
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
 *  - `openMenu(anchor)` first calls `state.closeAllRowMenus()` (the per-mount
 *    single-open invariant — at most one menu shows at a time across every
 *    row and the directory menu), reveals the menu, measures it, and positions
 *    it at `anchor` via {@link computeMenuPosition} (flipping/clamping to stay
 *    on screen). It then registers one-shot document `click` (close on the
 *    next click anywhere — outside OR on a menu item, after the item's own
 *    handler has run) and `keydown` (close on Escape) listeners.
 *  - `closeMenu()` hides the menu, removes both listeners, and clears the
 *    mount's open-menu slot if it still points here.
 *
 * `btn`, when supplied (the ⋮ trigger), gets its `aria-expanded` toggled with
 * the menu; a directory menu has no trigger button, so it omits `btn`.
 */
function createMenu(
  state: MenuState,
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
    if (state.openRowMenu?.close === closeMenu) {
      state.openRowMenu = null;
    }
  }

  function openMenu(anchor: MenuAnchor): void {
    state.closeAllRowMenus();
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
    state.openRowMenu = { close: closeMenu };
  }

  return { menu, openMenu, closeMenu };
}

/* -------------------------------------------------------------------------
 * Current-directory context menu (right-click on blank space)
 *
 * Right-clicking the blank area of the results view (NOT on a row or the
 * header) opens a menu that acts on the CURRENTLY browsed directory: upload
 * into it, or create a new subdirectory. The menu for the current dir is
 * rebuilt on every render (the path changes with navigation) and lives as a
 * hidden `.row-menu` inside the results element; the per-mount `MenuState`'s
 * `openCurrentDirMenu` holds the latest menu's open function, read by the
 * once-attached `contextmenu` listener so it always targets the current
 * directory.
 * ---------------------------------------------------------------------- */

/**
 * Build the current-directory menu for `dirPath`: Upload (into `dirPath`) then
 * New directory (a new subdirectory under `dirPath`). Has no trigger button —
 * it is opened only by the results-view `contextmenu` listener.
 */
function makeDirMenu(
  dirPath: string,
  state: MenuState,
): {
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
        await rerender();
      },
      'folder-plus',
    ),
  ];
  return createMenu(state, items);
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
export function setupDirContextMenu(
  resultsEl: HTMLElement,
  dirPath: string,
  state: MenuState,
): void {
  const { menu, openMenu } = makeDirMenu(dirPath, state);
  resultsEl.append(menu);
  state.openCurrentDirMenu = openMenu;

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
    state.openCurrentDirMenu({
      left: event.clientX,
      top: event.clientY,
      right: event.clientX,
      bottom: event.clientY,
    });
  });
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
 *    both document listeners, and clears the mount's open-menu slot if it
 *    still points here.
 *
 * The action-item handler bodies use the same `window.confirm` / `prompt`,
 * `getApi().delete/move/copy`, `normalizeRelativePath`, and `rerender()`
 * calls as the previous inline-button handlers, so all behavior is
 * preserved. The items keep `class="btn"` (the `.row-menu .btn` CSS restyles
 * them into menu items) so existing query/characterization assertions hold.
 */
export function makeRowMenu(
  entry: FileEntry,
  state: MenuState,
): {
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
        await rerender();
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
        await rerender();
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
        await rerender();
      },
      'files',
    ),
  );

  // Shared open/close + positioning lifecycle (see createMenu). The ⋮ button
  // is passed so its aria-expanded toggles with the menu.
  const { menu, openMenu, closeMenu } = createMenu(state, items, btn);

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
