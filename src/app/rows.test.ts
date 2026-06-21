/**
 * Unit tests for `rows.ts` — the browse / search / parent table-row builders
 * (`makeParentRow`, `makeBrowseRow`, `makeSearchRow`).
 *
 * What is pinned per function:
 *   - `makeParentRow` : parent-row class, 4 cells, '..' link, whole-row
 *                       navigation, no context menu.
 *   - `makeBrowseRow` : file vs folder row structure, classes, actions-cell
 *                       exception, right-click opens the row menu, injection-safe.
 *   - `makeSearchRow` : file (download <a>) vs directory (nav <a>) name cell,
 *                       path/size/modified columns, injection-safe.
 *
 * Handler-level behavior (Delete/Move/Copy/Download confirmations, error
 * surfacing, re-rendering) is exhaustively covered by `render-browse.test.ts`
 * and `menus.test.ts`; these tests pin only the row-level structural contract
 * and the whole-row / right-click wiring that live in the row builders.
 *
 * Environment: happy-dom (these tests need a DOM).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeParentRow, makeBrowseRow, makeSearchRow } from './rows';
import { createMenuState } from './menus';
import { toBrowseHash } from '../router';
import { formatBytes } from '../format';
import { getApi } from './context';
import { fileEntry, ISO_FMT, installAppTestLifecycle } from './test-helpers';

installAppTestLifecycle();

// Reset the location hash before each test so whole-row / link navigation
// assertions start from a known state.
beforeEach(() => {
  window.location.hash = '';
});

/* ===========================================================================
 * makeParentRow — the ".." parent navigation row (→ rows.ts)
 * ========================================================================= */
describe('makeParentRow', () => {
  it('returns a <tr class="parent-row"> with exactly four <td> cells', () => {
    const row = makeParentRow('docs');
    expect(row.tagName).toBe('TR');
    expect(row.className).toBe('parent-row');
    const cells = Array.from(row.querySelectorAll('td'));
    expect(cells).toHaveLength(4);
  });

  it('the first cell holds an <a> labelled ".." pointing at toBrowseHash(parent); the other three cells are empty', () => {
    const row = makeParentRow('docs/sub');
    const cells = Array.from(row.querySelectorAll('td'));
    const link = cells[0].querySelector('a')!;
    expect(link.textContent).toBe('..');
    expect(link.getAttribute('href')).toBe(toBrowseHash('docs/sub'));
    for (const cell of cells.slice(1)) {
      expect(cell.textContent).toBe('');
      expect(cell.children).toHaveLength(0);
    }
  });

  it('clicking anywhere in the row (not just the link) navigates to the parent browse hash', () => {
    const row = makeParentRow('docs');
    // Click the empty Size cell — whole-row navigation should still fire.
    const sizeCell = row.querySelectorAll('td')[1];
    sizeCell.dispatchEvent(new MouseEvent('click', { cancelable: true, bubbles: true }));
    expect(window.location.hash).toBe(toBrowseHash('docs'));
  });

  it('does not attach a row context menu — right-click does not preventDefault', () => {
    const row = makeParentRow('docs');
    const evt = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    row.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);
  });
});

/* ===========================================================================
 * makeBrowseRow — one browse data row (→ rows.ts)
 *
 * Handler-level behavior (Delete/Move/Copy/Download confirmations, error
 * surfacing, re-rendering) is exhaustively covered by render-browse.test.ts and
 * menus.test.ts; these tests pin only the row-level structural contract
 * and the whole-row / right-click wiring that live in makeBrowseRow.
 * ========================================================================= */
describe('makeBrowseRow', () => {
  it('a FILE row: 4 cells, plain-text name (no link), no folder-row class, and an actions cell holding one .row-menu-btn + one .row-menu', () => {
    const row = makeBrowseRow(
      fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false, size: 10 }),
      createMenuState(),
    );
    expect(row.className).toBe('');
    const cells = Array.from(row.querySelectorAll('td'));
    expect(cells).toHaveLength(4);
    expect(cells[0].children).toHaveLength(0); // plain text, no <a>
    expect(cells[0].textContent).toBe('a.txt');
    const actions = cells[3];
    expect(actions.querySelectorAll('.row-menu-btn')).toHaveLength(1);
    expect(actions.querySelectorAll('.row-menu')).toHaveLength(1);
  });

  it('a FOLDER row: name cell is a navigation <a>, the row carries folder-row, and the size cell shows the child count', () => {
    const row = makeBrowseRow(
      fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true, itemCount: 7 }),
      createMenuState(),
    );
    expect(row.classList.contains('folder-row')).toBe(true);
    const cells = Array.from(row.querySelectorAll('td'));
    const link = cells[0].querySelector('a')!;
    expect(link.textContent).toBe('sub');
    expect(link.getAttribute('href')).toBe(toBrowseHash('docs/sub'));
    expect(cells[1].textContent).toBe('7');
  });

  it('a folder row navigates on a click in the Size cell, but NOT on a click in the actions cell', () => {
    const row = makeBrowseRow(
      fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true, itemCount: 0 }),
      createMenuState(),
    );
    const cells = Array.from(row.querySelectorAll('td'));
    const sizeCell = cells[1];
    const actionsCell = cells[3];

    // Size cell click → whole-row navigation.
    sizeCell.dispatchEvent(new MouseEvent('click', { cancelable: true, bubbles: true }));
    expect(window.location.hash).toBe(toBrowseHash('docs/sub'));

    // Actions cell click → excluded from whole-row navigation (no nav change).
    window.location.hash = '';
    actionsCell.dispatchEvent(new MouseEvent('click', { cancelable: true, bubbles: true }));
    expect(window.location.hash).toBe('');
  });

  it('clicking the ⋮ button opens the row menu (hidden=false) and does not navigate', () => {
    const row = makeBrowseRow(
      fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false, size: 0 }),
      createMenuState(),
    );
    const btn = row.querySelector('.row-menu-btn') as HTMLButtonElement;
    const menu = row.querySelector('.row-menu') as HTMLElement;
    expect(menu.hidden).toBe(true);

    btn.click();

    expect(menu.hidden).toBe(false);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(window.location.hash).toBe('');
  });

  it('right-clicking a data row prevents default and opens the row menu at the cursor', () => {
    const row = makeBrowseRow(
      fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false, size: 0 }),
      createMenuState(),
    );
    const menu = row.querySelector('.row-menu') as HTMLElement;

    const evt = new MouseEvent('contextmenu', {
      cancelable: true,
      bubbles: true,
      clientX: 30,
      clientY: 40,
    });
    row.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true);
    expect(menu.hidden).toBe(false);
    expect(menu.style.left).toBe('30px');
    expect(menu.style.top).toBe('40px');
  });

  it('inserts the file name via textContent (markup in the name is not parsed as HTML)', () => {
    const row = makeBrowseRow(
      fileEntry({ name: '<img src=x onerror=alert(1)>', path: 'docs/x', isDirectory: false }),
      createMenuState(),
    );
    const nameCell = Array.from(row.querySelectorAll('td'))[0];
    expect(nameCell.querySelector('img')).toBeNull();
    expect(nameCell.textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

/* ===========================================================================
 * makeSearchRow — one search-result data row (→ rows.ts)
 * ========================================================================= */
describe('makeSearchRow', () => {
  it('a FILE result: 4 cells (Name | Path | Size | Modified); name is an <a> whose href is the raw downloadUrl', () => {
    const entry = fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false, size: 1536 });
    const row = makeSearchRow(entry);
    expect(row.tagName).toBe('TR');
    const cells = Array.from(row.querySelectorAll('td'));
    expect(cells).toHaveLength(4);

    const link = cells[0].querySelector('a')!;
    expect(link.textContent).toBe('a.txt');
    // href set verbatim via setAttribute (must equal the raw download URL).
    expect(link.getAttribute('href')).toBe(getApi().downloadUrl('docs/a.txt'));
    expect(link.getAttribute('download')).toBeNull(); // search name link is not a download anchor

    expect(cells[1].textContent).toBe('docs/a.txt'); // Path
    expect(cells[2].textContent).toBe(formatBytes(1536)); // Size
    expect(cells[3].textContent).toBe(ISO_FMT); // Modified
  });

  it('a DIRECTORY result: name is a navigation <a> pointing at toBrowseHash(entry.path)', () => {
    const entry = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true, itemCount: 3 });
    const row = makeSearchRow(entry);
    const cells = Array.from(row.querySelectorAll('td'));
    const link = cells[0].querySelector('a')!;
    expect(link.textContent).toBe('sub');
    expect(link.getAttribute('href')).toBe(toBrowseHash('docs/sub'));
    expect(cells[2].textContent).toBe('3'); // child count
  });

  it('a directory with itemCount 0 renders a blank Size cell (not "0")', () => {
    const row = makeSearchRow(
      fileEntry({ name: 'empty', path: 'docs/empty', isDirectory: true, itemCount: 0 }),
    );
    const cells = Array.from(row.querySelectorAll('td'));
    expect(cells[2].textContent).toBe('');
  });

  it('inserts the name and path via textContent (no HTML injection)', () => {
    const evil = fileEntry({
      name: '<b>name</b>',
      path: '<script>x</script>',
      isDirectory: false,
    });
    const row = makeSearchRow(evil);
    const cells = Array.from(row.querySelectorAll('td'));
    expect(cells[0].querySelector('b')).toBeNull();
    expect(cells[0].textContent).toBe('<b>name</b>');
    expect(cells[1].querySelector('script')).toBeNull();
    expect(cells[1].textContent).toBe('<script>x</script>');
  });
});
