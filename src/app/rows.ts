/**
 * Table-row builders for the browse and search results tables.
 *
 *  - `makeBrowseRow` — one file/folder row (Name | Size | Modified | Actions),
 *    where Actions holds the per-row ⋮ menu and a right-click anywhere opens it.
 *  - `makeSearchRow` — one search-result row (Name | Path | Size | Modified).
 *  - `makeParentRow` — the ".." navigation row.
 *
 * All user-controlled strings are inserted via `textContent` / element
 * creation — never `innerHTML`.
 */
import type { FileEntry } from '../api.js';
import { formatBytes, formatDate } from '../format.js';
import { navigate, toBrowseHash } from '../router.js';
import { getApi } from './context.js';
import { makeNavLink } from './breadcrumb.js';
import { makeRowMenu, type MenuState } from './menus.js';

/** Size-cell text: files show byte size; directories show their immediate-child
 *  count, blank when zero so an empty folder renders nothing rather than "0". */
function formatSizeColumn(entry: FileEntry): string {
  if (entry.isDirectory) {
    const count = entry.itemCount ?? 0;
    return count > 0 ? String(count) : '';
  }
  return formatBytes(entry.size);
}

/**
 * Make a row navigate to `hash` on a click anywhere within it (whole-row
 * navigation for folder/parent rows). Clicks inside `except` (e.g. a folder
 * row's actions cell) are ignored so those controls keep working.
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
  navigateRowOnClick(row, toBrowseHash(parent));
  return row;
}

/** One data row in the browse table (a file or folder entry). */
export function makeBrowseRow(entry: FileEntry, state: MenuState): HTMLTableRowElement {
  const row = document.createElement('tr');

  const nameCell = document.createElement('td');
  if (entry.isDirectory) {
    nameCell.append(makeNavLink(entry.name, toBrowseHash(entry.path)));
  } else {
    nameCell.textContent = entry.name;
  }

  const sizeCell = document.createElement('td');
  sizeCell.textContent = formatSizeColumn(entry);

  const modifiedCell = document.createElement('td');
  modifiedCell.textContent = formatDate(entry.lastModified);

  const actionsCell = document.createElement('td');
  const { btn, menu, openMenu } = makeRowMenu(entry, state);
  actionsCell.append(btn, menu);
  row.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openMenu({
      left: event.clientX,
      top: event.clientY,
      right: event.clientX,
      bottom: event.clientY,
    });
  });

  row.append(nameCell, sizeCell, modifiedCell, actionsCell);

  if (entry.isDirectory) {
    row.classList.add('folder-row');
    navigateRowOnClick(row, toBrowseHash(entry.path), actionsCell);
  }

  return row;
}

/** One data row in the search-results table. */
export function makeSearchRow(entry: FileEntry): HTMLTableRowElement {
  const row = document.createElement('tr');

  // Directory names browse into; file names open their download URL.
  const nameCell = document.createElement('td');
  if (entry.isDirectory) {
    nameCell.append(makeNavLink(entry.name, toBrowseHash(entry.path)));
  } else {
    const link = document.createElement('a');
    link.setAttribute('href', getApi().downloadUrl(entry.path));
    link.textContent = entry.name;
    nameCell.append(link);
  }

  const pathCell = document.createElement('td');
  pathCell.textContent = entry.path;

  const sizeCell = document.createElement('td');
  sizeCell.textContent = formatSizeColumn(entry);

  const modifiedCell = document.createElement('td');
  modifiedCell.textContent = formatDate(entry.lastModified);

  row.append(nameCell, pathCell, sizeCell, modifiedCell);
  return row;
}
