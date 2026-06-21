/**
 * Table-row builders for the browse and search results tables.
 *
 * Each builder constructs and returns a single `<tr>` DOM subtree:
 *  - `makeBrowseRow` — one file/folder data row with a Name | Size | Modified
 *    | Actions layout, where the Actions cell holds the per-row ⋮ menu (built
 *    by `makeRowMenu` in `./menus.js`) and the whole row opens that menu on a
 *    right-click.
 *  - `makeSearchRow` — one search-result data row with a Name | Path | Size |
 *    Modified layout.
 *  - `makeParentRow` — the ".." navigation row that browses to the parent.
 *
 * All user-controlled strings (file/folder names, paths) are inserted via
 * `textContent` / element creation — never via `innerHTML` — to prevent HTML
 * injection.
 */
import type { FileEntry } from '../api.js';
import { formatBytes, formatDate } from '../format.js';
import { navigate, toBrowseHash } from '../router.js';
import { getApi } from './context.js';
import { makeNavLink } from './breadcrumb.js';
import { makeRowMenu, type MenuState } from './menus.js';

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

/** One data row in the browse table (a file or folder entry). */
export function makeBrowseRow(entry: FileEntry, state: MenuState): HTMLTableRowElement {
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
  const { btn, menu, openMenu } = makeRowMenu(entry, state);
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
