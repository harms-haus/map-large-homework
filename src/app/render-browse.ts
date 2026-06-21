/**
 * Render a {@link BrowseResult} into the shared results/breadcrumb/status
 * elements: a four-column table (Name | Size | Modified | —) with an optional
 * leading ".." parent row.
 */
import type { BrowseResult } from '../api.js';
import { formatBytes } from '../format.js';
import { renderBreadcrumb } from './breadcrumb.js';
import { getResults, getStatus, getMenuState } from './context.js';
import { setupDirContextMenu } from './menus.js';
import { makeBrowseRow, makeParentRow } from './rows.js';
import { buildTable } from './tables.js';

export function renderBrowse(result: BrowseResult): void {
  renderBreadcrumb(result.path);

  getStatus().textContent =
    result.folderCount +
    ' folders, ' +
    result.fileCount +
    ' files, total ' +
    formatBytes(result.totalSize);

  const resultsEl = getResults();
  resultsEl.innerHTML = '';
  const table = buildTable(['Name', 'Size', 'Modified', '']);
  table.classList.add('browse-table');
  const tbody = table.querySelector('tbody')!;

  const menuState = getMenuState();
  if (result.parent !== null) {
    tbody.append(makeParentRow(result.parent));
  }
  for (const entry of result.entries) {
    tbody.append(makeBrowseRow(entry, menuState));
  }

  resultsEl.append(table);

  setupDirContextMenu(resultsEl, result.path, menuState);
}
