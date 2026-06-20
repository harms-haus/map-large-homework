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

  // Actions
  const actionsCell = document.createElement('td');
  if (!entry.isDirectory) {
    const download = document.createElement('a');
    download.className = 'btn';
    download.setAttribute('href', getApi().downloadUrl(entry.path));
    download.setAttribute('download', entry.name);
    download.textContent = 'Download';
    actionsCell.append(download);
  }
  actionsCell.append(
    makeActionButton('Delete', async () => {
      if (!window.confirm('Delete "' + entry.name + '"?')) {
        return;
      }
      await getApi().delete(entry.path);
      rerender();
    }),
  );
  actionsCell.append(
    makeActionButton('Move', async () => {
      const dest = window.prompt('Move to relative destination path:', entry.path);
      if (dest === null) {
        return;
      }
      await getApi().move(entry.path, normalizeRelativePath(dest));
      rerender();
    }),
  );
  actionsCell.append(
    makeActionButton('Copy', async () => {
      const dest = window.prompt('Copy to relative destination path:', entry.path);
      if (dest === null) {
        return;
      }
      await getApi().copy(entry.path, normalizeRelativePath(dest));
      rerender();
    }),
  );

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
