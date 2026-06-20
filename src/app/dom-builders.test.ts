/**
 * Tests for the row-menu placement helpers in `dom-builders.ts`:
 *
 *  - `computeMenuPosition` — the pure off-screen flip math (no DOM). By
 *    default a menu opens below + left-aligned with its anchor; when that
 *    would run off a viewport edge it flips direction (down→up, left→right)
 *    and is finally clamped inside the viewport.
 *  - `openMenu` wiring — when a row menu is opened, its real measured size
 *    and the live viewport size are fed into `computeMenuPosition`, so the
 *    flip actually takes effect (not just the pure function in isolation).
 *
 * Environment: happy-dom, which performs NO layout (`getBoundingClientRect`
 * always reports width/height 0). The pure suite is therefore independent of
 * the DOM, and the wiring test injects a synthetic menu rect + viewport via
 * spies/assignment rather than relying on rendered geometry.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeMenuPosition, MENU_EDGE_MARGIN, makeIcon, makeActionButton } from './dom-builders';
import { renderBrowse } from '../app';
import {
  setupCleared,
  browseResult,
  fileEntry,
  rowByName,
  cellsOf,
  installAppTestLifecycle,
} from './test-helpers';

installAppTestLifecycle();

/* A typical ⋮ button rect and a menu size, used across the pure suite. */
const BTN = { left: 900, top: 200, right: 920, bottom: 224 };
const SIZE = { width: 160, height: 140 };
const VIEW = { width: 1000, height: 600 };

describe('computeMenuPosition — default (no overflow)', () => {
  it('opens below + left-aligned with the anchor: left=anchor.left, top=anchor.bottom', () => {
    const anchor = { left: 100, top: 200, right: 120, bottom: 224 };
    const p = computeMenuPosition(anchor, SIZE, VIEW);
    expect(p).toEqual({ left: 100, top: 224 });
  });

  it('keeps the cursor coords for a zero-size (right-click) anchor that fits', () => {
    const cursor = { left: 137, top: 242, right: 137, bottom: 242 };
    const p = computeMenuPosition(cursor, SIZE, VIEW);
    expect(p).toEqual({ left: 137, top: 242 });
  });
});

describe('computeMenuPosition — horizontal flip (would overflow the right edge)', () => {
  it('right-aligns the menu to the anchor right edge instead (open leftward)', () => {
    // anchor.left(900) + width(160) = 1060 > viewport(1000) - margin → flip.
    const p = computeMenuPosition(BTN, SIZE, VIEW);
    expect(p.left).toBe(BTN.right - SIZE.width); // 920 - 160 = 760
    expect(p.top).toBe(BTN.bottom); // vertical still fits → unchanged
  });

  it('right-click near the right edge flips so the menu extends left of the cursor', () => {
    const cursor = { left: 980, top: 100, right: 980, bottom: 100 };
    const p = computeMenuPosition(cursor, SIZE, VIEW);
    expect(p.left).toBe(980 - 160); // 820
  });

  it('does NOT flip when the menu fits within the margin of the right edge', () => {
    // 836 + 160 = 996 == viewport(1000) - margin(4): exactly at the limit, fits.
    const anchor = { left: 836, top: 200, right: 856, bottom: 224 };
    expect(computeMenuPosition(anchor, SIZE, VIEW).left).toBe(836);
  });
});

describe('computeMenuPosition — vertical flip (would overflow the bottom edge)', () => {
  it('opens upward, aligning the menu bottom to the anchor top', () => {
    // anchor.bottom(500) + height(140) = 640 > viewport(600) - margin → flip.
    const anchor = { left: 100, top: 476, right: 120, bottom: 500 };
    const p = computeMenuPosition(anchor, SIZE, VIEW);
    expect(p.top).toBe(anchor.top - SIZE.height); // 476 - 140 = 336
    expect(p.left).toBe(anchor.left); // horizontal still fits → unchanged
  });

  it('right-click near the bottom flips so the menu extends above the cursor', () => {
    const cursor = { left: 100, top: 580, right: 100, bottom: 580 };
    const p = computeMenuPosition(cursor, SIZE, VIEW);
    expect(p.top).toBe(580 - 140); // 440
  });
});

describe('computeMenuPosition — both axes flip at once', () => {
  it('right-aligns AND opens upward when the anchor is in the bottom-right corner', () => {
    const anchor = { left: 900, top: 476, right: 920, bottom: 500 };
    const p = computeMenuPosition(anchor, SIZE, VIEW);
    expect(p).toEqual({ left: 760, top: 336 });
  });
});

describe('computeMenuPosition — clamping into the viewport', () => {
  it('clamps left to the edge margin when a flip would push it off the left edge', () => {
    // Cursor near the left edge + a menu wider than the tiny viewport: the
    // right-align flip computes left = 10 - 160 = -150, which clamps to the
    // margin.
    const tinyView = { width: 100, height: 600 };
    const cursor = { left: 10, top: 200, right: 10, bottom: 224 };
    const p = computeMenuPosition(cursor, SIZE, tinyView);
    expect(p.left).toBe(MENU_EDGE_MARGIN);
  });

  it('clamps top to the edge margin when opening upward would go above the top', () => {
    const tinyView = { width: 1000, height: 100 };
    const anchor = { left: 100, top: 40, right: 120, bottom: 60 };
    const p = computeMenuPosition(anchor, SIZE, tinyView);
    expect(p.top).toBe(MENU_EDGE_MARGIN);
  });
});

/* ===========================================================================
 * makeIcon / makeActionButton — Bootstrap Icons glyphs on menu items.
 *
 * makeIcon builds an empty `<i class="bi bi-<name>">` (the glyph is painted by
 * the bootstrap-icons CSS ::before, so the element has no text content).
 * makeActionButton prepends that glyph when given an `icon` arg, and otherwise
 * behaves exactly as before (label-only, className exactly "btn").
 * ========================================================================= */
describe('makeIcon', () => {
  it('builds an empty <i class="bi bi-<name>"> with no text content', () => {
    const icon = makeIcon('trash');
    expect(icon.tagName).toBe('I');
    expect(icon.className).toBe('bi bi-trash');
    expect(icon.textContent).toBe('');
    expect(icon.children).toHaveLength(0);
  });
});

describe('makeActionButton — icon support', () => {
  it('with an icon: prepends an empty <i class="bi bi-<name>"> as the first child and keeps className exactly "btn"', () => {
    const btn = makeActionButton('Delete', () => undefined, 'trash');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.className).toBe('btn');
    expect(btn.getAttribute('type')).toBe('button');
    expect(btn.children).toHaveLength(1);
    const icon = btn.firstElementChild as HTMLElement;
    expect(icon.tagName).toBe('I');
    expect(icon.className).toBe('bi bi-trash');
    // The icon adds no text, so the button's textContent is still just the label.
    expect(btn.textContent).toBe('Delete');
  });

  it('without an icon: has no child elements and textContent is the label (default unchanged)', () => {
    const btn = makeActionButton('Search', () => undefined);
    expect(btn.children).toHaveLength(0);
    expect(btn.textContent).toBe('Search');
    expect(btn.className).toBe('btn');
  });
});

/* ===========================================================================
 * openMenu wiring — the measured menu size + live viewport drive the flip.
 *
 * happy-dom reports a 0×0 rect for every element, so we spy on the menu's
 * getBoundingClientRect to inject a known size and shrink window.innerWidth/
 * innerHeight to force an overflow, then assert the menu's inline left/top
 * match what computeMenuPosition would produce.
 * ========================================================================= */
describe('openMenu applies computeMenuPosition to the rendered menu', () => {
  const file = fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false, size: 10 });

  let savedW: number;
  let savedH: number;

  beforeEach(() => {
    savedW = window.innerWidth;
    savedH = window.innerHeight;
    // Ensure no menu is left open by a prior test.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  });
  afterEach(() => {
    window.innerWidth = savedW;
    window.innerHeight = savedH;
  });

  function menuOf(results: HTMLElement): HTMLElement {
    const row = rowByName(results.querySelector('table')!, 'a.txt')!;
    return cellsOf(row)[3].querySelector('.row-menu') as HTMLElement;
  }

  it('flips up + right when the right-click point is in the bottom-right corner', async () => {
    window.innerWidth = 1000;
    window.innerHeight = 600;
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [file] }));
    const menu = menuOf(results);
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 160,
      bottom: 140,
      width: 160,
      height: 140,
      x: 0,
      y: 0,
      toJSON() {},
    });

    const row = rowByName(results.querySelector('table')!, 'a.txt')!;
    row.dispatchEvent(
      new MouseEvent('contextmenu', {
        cancelable: true,
        bubbles: true,
        clientX: 900,
        clientY: 500,
      }),
    );

    // Cursor anchor {900,500,900,500}, size 160×140, viewport 1000×600:
    // horizontal flip → left = 900 - 160 = 740; vertical flip → top = 500 - 140 = 360.
    expect(menu.hidden).toBe(false);
    expect(menu.style.left).toBe('740px');
    expect(menu.style.top).toBe('360px');
  });

  it('leaves the cursor position untouched when the menu fits (no measured overflow)', async () => {
    // Default happy-dom viewport (1024×768) with a measured size that fits.
    window.innerWidth = 1024;
    window.innerHeight = 768;
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [file] }));
    const menu = menuOf(results);
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 160,
      bottom: 60,
      width: 160,
      height: 60,
      x: 0,
      y: 0,
      toJSON() {},
    });

    const row = rowByName(results.querySelector('table')!, 'a.txt')!;
    row.dispatchEvent(
      new MouseEvent('contextmenu', {
        cancelable: true,
        bubbles: true,
        clientX: 137,
        clientY: 242,
      }),
    );

    expect(menu.hidden).toBe(false);
    expect(menu.style.left).toBe('137px');
    expect(menu.style.top).toBe('242px');
  });
});
