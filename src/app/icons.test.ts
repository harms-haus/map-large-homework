/**
 * Unit tests for `icons.ts` — the Bootstrap Icons glyph and action-button
 * builders (`makeIcon`, `makeActionButton`).
 *
 * makeIcon builds an empty `<i class="bi bi-<name>">` (the glyph is painted by
 * the bootstrap-icons CSS ::before, so the element has no text content).
 * makeActionButton prepends that glyph when given an `icon` arg, and otherwise
 * behaves exactly as before (label-only, className exactly "btn").
 *
 * Environment: happy-dom.
 */
import { describe, it, expect } from 'vitest';
import { makeIcon, makeActionButton } from './icons';
import { installAppTestLifecycle } from './test-helpers';

installAppTestLifecycle();

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
