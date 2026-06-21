/**
 * Unit tests for `tables.ts` — the generic results-table skeleton builder
 * (`buildTable`).
 *
 * Pins the exact DOM shape: the `results-table` class, a single `<thead>`
 * holding one `<tr>` with one `<th>` per header, exactly one empty `<tbody>`,
 * and HTML-injection-safe / whitespace-preserving header text.
 *
 * Environment: happy-dom (the table builder needs `document`).
 */
import { describe, it, expect } from 'vitest';
import { buildTable } from './tables';
import { installAppTestLifecycle } from './test-helpers';

installAppTestLifecycle();

describe('buildTable', () => {
  it('returns an HTMLTableElement whose className is exactly "results-table"', () => {
    const table = buildTable(['Name']);
    expect(table).toBeInstanceOf(HTMLTableElement);
    expect(table.className).toBe('results-table');
  });

  it('creates one <thead> holding a single <tr> with one <th> per header label, in order', () => {
    const table = buildTable(['Name', 'Size', 'Modified', '']);
    const theads = table.querySelectorAll('thead');
    expect(theads).toHaveLength(1);
    const headRows = theads[0].querySelectorAll('tr');
    expect(headRows).toHaveLength(1);
    const ths = Array.from(headRows[0].querySelectorAll('th'));
    expect(ths.map((th) => th.textContent)).toEqual(['Name', 'Size', 'Modified', '']);
  });

  it('creates exactly one empty <tbody> (no rows) so the caller appends into it', () => {
    const table = buildTable(['A', 'B']);
    const tbodies = table.querySelectorAll('tbody');
    expect(tbodies).toHaveLength(1);
    expect(tbodies[0].querySelectorAll('tr')).toHaveLength(0);
  });

  it('inserts header labels via textContent (HTML-special characters are NOT parsed)', () => {
    // A label that looks like markup must remain literal text, proving headers
    // are HTML-injection-safe even when sourced from user input.
    const table = buildTable(['<b>bold</b>', 'a&b']);
    const ths = Array.from(table.querySelectorAll('thead th'));
    expect(ths[0].textContent).toBe('<b>bold</b>');
    expect(ths[0].querySelector('b')).toBeNull();
    expect(ths[1].textContent).toBe('a&b');
  });

  it('preserves header whitespace verbatim (no trimming)', () => {
    const table = buildTable(['  spaced  ']);
    expect(table.querySelector('thead th')!.textContent).toBe('  spaced  ');
  });

  it('handles an empty headers array: thead has an empty <tr>, tbody still present', () => {
    const table = buildTable([]);
    expect(table.querySelectorAll('thead tr')).toHaveLength(1);
    expect(table.querySelectorAll('thead th')).toHaveLength(0);
    expect(table.querySelectorAll('tbody')).toHaveLength(1);
  });
});
