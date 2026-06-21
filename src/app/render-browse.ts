/**
 * Render a {@link BrowseResult} into the shared results/breadcrumb/status
 * elements: a four-column table (Name | Size | Modified | —) with an empty
 * Actions header cell and the browse-table CSS class, plus an optional
 * leading ".." parent row.
 *
 * Operates against the DOM context established by `startApp` (via
 * `render-orchestrator.init`), so it always targets the most recently mounted
 * app.
 */
import type { BrowseResult } from '../api.js';
import { formatBytes } from '../format.js';
import { renderBreadcrumb } from './breadcrumb.js';
import { getResults, getStatus, getMenuState } from './context.js';
import { setupDirContextMenu } from './menus.js';
import { makeBrowseRow, makeParentRow } from './rows.js';
import { buildTable } from './tables.js';

export function renderBrowse(result: BrowseResult): void {
  // Breadcrumb (clickable cumulative-path segments)
  renderBreadcrumb(result.path);

  // Status footer: "N folders, M files, total S"
  getStatus().textContent =
    result.folderCount +
    ' folders, ' +
    result.fileCount +
    ' files, total ' +
    formatBytes(result.totalSize);

  // Results table
  const resultsEl = getResults();
  resultsEl.innerHTML = '';
  const table = buildTable(['Name', 'Size', 'Modified', '']);
  table.classList.add('browse-table');
  const tbody = table.querySelector('tbody')!;

  // Per-mount menu state (row + directory menus) — threaded into the row and
  // directory-menu builders so the single-open invariant is scoped to this
  // mount rather than a shared module-level singleton.
  const menuState = getMenuState();
  if (result.parent !== null) {
    tbody.append(makeParentRow(result.parent));
  }
  for (const entry of result.entries) {
    tbody.append(makeBrowseRow(entry, menuState));
  }

  resultsEl.append(table);

  // Mount the current-directory context menu (right-click on blank space) and
  // wire its listener. Rebuilds the menu each render for the current path; the
  // listener attaches once. Must run AFTER the table is appended so the menu
  // is a later sibling (document order) than the row menus inside the table.
  setupDirContextMenu(resultsEl, result.path, menuState);
}
