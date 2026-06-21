/**
 * Row-menu and directory-context-menu lifecycle and viewport-edge positioning.
 *
 * Owns the open/close lifecycle shared by every browse-view menu (the per-row
 * ⋮ dropdown, the right-click row menu, and the blank-space directory menu),
 * plus the pure placement math (`computeMenuPosition`) and the per-mount
 * single-open state (`createMenuState` / `MenuState`).
 */
import type { FileEntry } from '../api.js';
import { joinPath, normalizeRelativePath } from '../format.js';
import { getApi, rerender } from './context.js';
import { makeActionButton, makeIcon } from './icons.js';
import { pickAndUploadInto } from './toolbar-handlers.js';

/**
 * The rectangle a row menu is anchored to: either the ⋮ button's rect (click)
 * or a zero-size rect at the cursor (right-click). Only the four edges are
 * read, so a real `DOMRect` satisfies this structurally without adaptation.
 */
export interface MenuAnchor {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Per-mount menu open/close state. At most one row menu (the ⋮ dropdown or a
 * right-click context menu) is open at a time within a mount. It is scoped to
 * the mount rather than module-level so a re-mount never inherits a previous
 * mount's open-menu references (an open menu in mount #2 could otherwise call
 * mount #1's stale close function and hide a detached menu).
 */
export interface MenuState {
  /** The close function of the currently-open row menu (null when none). */
  openRowMenu: { close: () => void } | null;
  /** The current-directory menu's open function (rebound each render). */
  openCurrentDirMenu: (anchor: MenuAnchor) => void;
  /** Close the open row menu, if any. Idempotent no-op when none is open. */
  closeAllRowMenus(): void;
}

/** Create a fresh, isolated {@link MenuState} for one mount. */
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
 * screen. Opens below + left-aligned with `anchor` by default and flips
 * direction when that would overflow the viewport (down→up, left→right),
 * then clamps to at least {@link MENU_EDGE_MARGIN} so a menu larger than the
 * viewport rests against the top-left corner.
 *
 * Pure (no DOM access) so placement is unit-testable in isolation.
 */
export function computeMenuPosition(
  anchor: MenuAnchor,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  let left = anchor.left;
  let top = anchor.bottom;

  if (left + size.width > viewport.width - MENU_EDGE_MARGIN) {
    left = anchor.right - size.width;
  }
  if (top + size.height > viewport.height - MENU_EDGE_MARGIN) {
    top = anchor.top - size.height;
  }
  if (left < MENU_EDGE_MARGIN) {
    left = MENU_EDGE_MARGIN;
  }
  if (top < MENU_EDGE_MARGIN) {
    top = MENU_EDGE_MARGIN;
  }

  return { left, top };
}

/** Layout viewport size, falling back to `innerWidth/Height` for test DOMs
 *  where `<html>` reports a 0×0 client size. */
function getViewportSize(): { width: number; height: number } {
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: document.documentElement.clientHeight || window.innerHeight,
  };
}

/**
 * Build a `.row-menu` dropdown from `items` with the shared open/close
 * lifecycle. Returns the menu element plus its `openMenu`/`closeMenu` controls.
 *
 * `openMenu` enforces the single-open invariant, reveals the menu, measures
 * it, positions it via {@link computeMenuPosition}, then registers one-shot
 * document `click` and `keydown` listeners. `closeMenu` hides the menu,
 * removes both listeners, and clears the mount's open-menu slot if it still
 * points here. When `btn` (the ⋮ trigger) is supplied its `aria-expanded`
 * toggles with the menu; a directory menu has no trigger button.
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

  function onDocClick(): void {
    closeMenu();
  }
  function onDocKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      closeMenu();
      return;
    }
    // WAI-ARIA Menu Button contract: ArrowDown/ArrowUp move focus between
    // items with wrapping, Home/End jump to the ends. preventDefault keeps
    // these keys from also scrolling the page.
    const count = items.length;
    if (count === 0) return;
    const current = items.findIndex((el) => el === document.activeElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = current < 0 ? 0 : (current + 1) % count;
        break;
      case 'ArrowUp':
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

/**
 * Build the current-directory menu for `dirPath`: Upload into `dirPath`, then
 * New directory (a subdirectory under `dirPath`). No trigger button — opened
 * only by the results-view `contextmenu` listener.
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
        // Empty/whitespace names and a cancelled prompt do nothing. joinPath
        // normalizes the combined path and the service sandboxes it again.
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
 * blank-space `contextmenu` listener. The menu is rebuilt + re-appended each
 * render (cleared by the render's `innerHTML = ''`); the listener attaches
 * exactly once per results element (guarded by a data attribute, since the
 * results element persists across renders within a mount).
 *
 * The listener opens the menu only for genuine blank space — a right-click
 * inside the `table` (any header/data row) or an open `.row-menu` is ignored
 * so those keep their existing behavior.
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
 * trigger and its `.row-menu` dropdown (Download for files only, then
 * Delete / Move / Copy; folders get Upload first). Returns both elements plus
 * the row-local `openMenu` so the same menu can be opened on a right-click
 * anywhere on the row.
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

  const { menu, openMenu, closeMenu } = createMenu(state, items, btn);

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
