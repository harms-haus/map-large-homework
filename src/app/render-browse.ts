/**
 * Render a {@link BrowseResult} into the shared results/breadcrumb/status
 * elements: a four-column table (Name | Size | Modified | Actions) with an
 * optional leading ".." parent row.
 *
 * Operates against the DOM context established by `startApp` (via
 * `render-orchestrator.init`), so it always targets the most recently mounted
 * app.
 */
import type { BrowseResult } from '../api.js';
import { formatBytes } from '../format.js';
import { buildTable, makeBrowseRow, makeParentRow, renderBreadcrumb } from './dom-builders.js';
import { getResults, getStatus } from './context.js';

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
  const table = buildTable(['Name', 'Size', 'Modified', 'Actions']);
  const tbody = table.querySelector('tbody')!;

  if (result.parent !== null) {
    tbody.append(makeParentRow(result.parent));
  }
  for (const entry of result.entries) {
    tbody.append(makeBrowseRow(entry));
  }

  resultsEl.append(table);
}
