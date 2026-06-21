/**
 * Generic results-table skeleton builder.
 *
 * `buildTable` creates the `<table class="results-table">` with a populated
 * `<thead>` (one `<th>` per header label, inserted via `textContent` so header
 * text is HTML-injection-safe) and an empty `<tbody>` that the caller appends
 * rows into. The browse and search renderers share this skeleton and only
 * differ in their header labels and row builders.
 */

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
