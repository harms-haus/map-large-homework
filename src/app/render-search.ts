/**
 * Render a {@link SearchResult} into the shared results/breadcrumb/status
 * elements: a four-column table (Name | Path | Size | Modified).
 */
import type { SearchResult } from '../api.js';
import { renderBreadcrumb } from './breadcrumb.js';
import { getResults, getStatus } from './context.js';
import { makeSearchRow } from './rows.js';
import { buildTable } from './tables.js';

export function renderSearch(result: SearchResult): void {
  renderBreadcrumb(result.path);

  getStatus().textContent = result.results.length + ' results for "' + result.query + '"';

  const resultsEl = getResults();
  resultsEl.innerHTML = '';
  const table = buildTable(['Name', 'Path', 'Size', 'Modified']);
  const tbody = table.querySelector('tbody')!;

  for (const entry of result.results) {
    tbody.append(makeSearchRow(entry));
  }

  resultsEl.append(table);
}
