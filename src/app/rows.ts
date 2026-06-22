/**
 * Table-row builders for the browse and search results tables.
 *
 *  - `makeBrowseRow` — one file/folder row (Name | Size | Modified | Actions),
 *    where Actions holds the per-row ⋮ menu and a right-click anywhere opens it.
 *  - `makeSearchRow` — one search-result row mirroring a browse row
 *    (Name | Path | Size | Modified | Actions): same ⋮ menu + right-click
 *    context menu, whole-row folder navigation, and a Path column showing only
 *    the containing directory as a browse link.
 *  - `makeParentRow` — the ".." navigation row.
 *
 * All user-controlled strings are inserted via `textContent` / element
 * creation — never `innerHTML`.
 */
import type { FileEntry } from '../api.js';
import { formatBytes, formatDate, normalizeRelativePath } from '../format.js';
import { navigate, toBrowseHash } from '../router.js';
import { makeNavLink } from './breadcrumb.js';
import { makeRowMenu, type MenuState } from './menus.js';

/** The containing directory of `path`: everything before the last segment.
 *  Empty for root-level or empty input. Backslashes and `.`/`..` segments are
 *  normalized away first so the result is always a clean relative path. */
function parentDirectory(path: string): string {
  const normalized = normalizeRelativePath(path);
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? '' : normalized.slice(0, idx);
}

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
 * navigation for folder/parent rows). Clicks inside any element in `excepts`
 * (e.g. a folder row's actions cell, or a search row's path link) are ignored
 * so those controls keep working.
 */
function navigateRowOnClick(row: HTMLTableRowElement, hash: string, excepts: Element[] = []): void {
  row.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof Node && excepts.some((el) => el.contains(target))) {
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
    navigateRowOnClick(row, toBrowseHash(entry.path), [actionsCell]);
  }

  return row;
}

/** One data row in the search-results table. Mirrors a browse row
 *  (Name | Path | Size | Modified | Actions): the per-row ⋮ menu + right-click
 *  context menu, whole-row navigation for folders, and a Path column showing
 *  only the containing directory (the entry's parent) as a browse link.
 *  File names are plain text — download lives in the actions menu, same as
 *  browse rows. */
export function makeSearchRow(entry: FileEntry, state: MenuState): HTMLTableRowElement {
  const row = document.createElement('tr');

  const nameCell = document.createElement('td');
  if (entry.isDirectory) {
    nameCell.append(makeNavLink(entry.name, toBrowseHash(entry.path)));
  } else {
    nameCell.textContent = entry.name;
  }

  const pathCell = document.createElement('td');
  const dir = parentDirectory(entry.path);
  if (dir !== '') {
    pathCell.append(makeNavLink(dir, toBrowseHash(dir)));
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

  row.append(nameCell, pathCell, sizeCell, modifiedCell, actionsCell);

  if (entry.isDirectory) {
    row.classList.add('folder-row');
    navigateRowOnClick(row, toBrowseHash(entry.path), [pathCell, actionsCell]);
  }

  return row;
}
