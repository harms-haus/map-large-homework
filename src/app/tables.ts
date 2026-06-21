/**
 * Build a `<table class="results-table">` with a `<thead>` (one `<th>` per
 * header label, inserted via `textContent`) and an empty `<tbody>` the caller
 * appends rows into. Shared by the browse and search renderers, which differ
 * only in labels and row builders.
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
