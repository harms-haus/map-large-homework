/**
 * Render a {@link SearchResult} into the shared results/breadcrumb/status
 * elements: a five-column table (Name | Path | Size | Modified | —) whose
 * rows mirror browse rows — the per-row ⋮ actions menu + right-click context
 * menu, whole-row folder navigation, and a Path column showing only the
 * containing directory as a browse link.
 */
import type { SearchResult } from '../api.js';
import { renderBreadcrumb } from './breadcrumb.js';
import { getResults, getStatus, getMenuState } from './context.js';
import { makeSearchRow } from './rows.js';
import { buildTable } from './tables.js';

export function renderSearch(result: SearchResult): void {
  renderBreadcrumb(result.path);

  getStatus().textContent = result.results.length + ' results for "' + result.query + '"';

  const resultsEl = getResults();
  resultsEl.innerHTML = '';
  const table = buildTable(['Name', 'Path', 'Size', 'Modified', '']);
  table.classList.add('search-table');
  const tbody = table.querySelector('tbody')!;

  const menuState = getMenuState();
  for (const entry of result.results) {
    tbody.append(makeSearchRow(entry, menuState));
  }

  resultsEl.append(table);
}
