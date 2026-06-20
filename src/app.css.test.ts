/**
 * Static-asset tests for `src/app.css` — guards against a subtle native-<dialog>
 * CSS regression.
 *
 * A closed `<dialog>` is hidden by the UA rule `dialog:not([open]){display:none}`.
 * But an AUTHOR `display` declaration overrides the UA stylesheet regardless of
 * specificity, so setting `display` on the base `.browser-dialog` rule keeps the
 * closed dialog (and therefore its frame/titlebar) visible on the page — the
 * "frame in the middle of the screen with no dialog open" bug.
 *
 * The contract under test:
 *   - the base `.browser-dialog { ... }` rule (selector without `[open]`) must
 *     NOT declare `display`;
 *   - the flex-column layout must live on `.browser-dialog[open]` so it only
 *     applies while the dialog is shown.
 *
 * These tests parse the raw CSS string (the vitest environment does not load
 * app.css, so `getComputedStyle` cannot observe author rules), matching the
 * approach used in `index.html.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATH = resolve(__dirname, './app.css');
const CSS = readFileSync(CSS_PATH, 'utf8');

/**
 * Extract the declaration block of the FIRST rule whose selector matches the
 * given selector regex anchor, stopping at the first `}`. Returns null if no
 * such rule exists.
 *
 * `anchor` must match the selector up to (but not including) the opening brace;
 * callers pass a regex that is anchored to avoid prefix collisions (e.g. the
 * base `.browser-dialog` rule must not be confused with `.browser-dialog[open]`
 * or `.browser-dialog .dialog-body`).
 */
function ruleDeclarations(selectorRegex: RegExp): string | null {
  const re = new RegExp(selectorRegex.source + '\\s*\\{([^}]*)\\}');
  const m = CSS.match(re);
  return m ? m[1] : null;
}

describe('src/app.css — native <dialog> visibility contract', () => {
  it('the base .browser-dialog rule does NOT declare display', () => {
    // Selector must be exactly `.browser-dialog` followed by `{` — the negative
    // lookahead prevents matching `.browser-dialog[open]`, `.browser-dialog .x`,
    // or `.browser-dialog::backdrop`.
    const base = ruleDeclarations(/\.browser-dialog(?![\w[#.])/);
    expect(base, 'a base .browser-dialog { ... } rule must exist').not.toBeNull();
    expect(
      /display\s*:/.test(base!),
      'the base .browser-dialog rule must not set `display` — that would override ' +
        'the UA `dialog:not([open]){display:none}` and render the closed dialog visible',
    ).toBe(false);
  });

  it('the flex-column layout is scoped to .browser-dialog[open]', () => {
    const open = ruleDeclarations(/\.browser-dialog\[open\]/);
    expect(open, 'a .browser-dialog[open] { ... } rule must exist').not.toBeNull();
    expect(/display\s*:\s*flex/.test(open!), 'open dialog must use display:flex').toBe(true);
    expect(/flex-direction\s*:\s*column/.test(open!), 'open dialog must be a flex column').toBe(true);
  });
});

/* ===========================================================================
 * Upload control — keyboard accessibility contract
 *
 * The file input is visually hidden via a `visually-hidden` (sr-only) class
 * instead of the `hidden` HTML attribute, precisely so it STAYS in the tab
 * order and is keyboard-focusable (the `hidden` attribute's UA `display:none`
 * made Upload unreachable via keyboard — WCAG 2.1.1). These tests pin the
 * CSS half of that contract by parsing the raw stylesheet:
 *
 *   - `.visually-hidden` must use the standard clip-to-1x1 sr-only pattern
 *     (position:absolute + width/height:1px + clip:rect(0,0,0,0) + overflow:
 *     hidden + white-space:nowrap). Crucially it must NOT use `display:none`
 *     NOR `visibility:hidden` — both of which remove an element from the tab
 *     order and would re-introduce the exact bug the class exists to avoid.
 *   - `.toolbar label.btn:focus-within` must apply a visible focus indicator
 *     so a sighted keyboard user can see that focus has landed on the Upload
 *     button (the input itself is clipped to 1x1, so its own focus outline is
 *     not a reliable signal; the wrapping label must reflect the focus).
 *
 * As above, the raw CSS is parsed because the vitest environment does not load
 * app.css, so `getComputedStyle` cannot observe author rules.
 * ========================================================================= */
describe('src/app.css — upload control keyboard accessibility', () => {
  describe('.visually-hidden uses the sr-only clip pattern (NOT display:none / visibility:hidden)', () => {
    it('a .visually-hidden rule exists', () => {
      // Negative lookahead so `.visually-hidden` is not confused with a
      // hypothetical `.visually-hidden-something` descendant/compound selector.
      const rule = ruleDeclarations(/\.visually-hidden(?![\w[#.:])/);
      expect(rule, 'a .visually-hidden { ... } rule must exist').not.toBeNull();
    });

    it('positions the element absolutely and clips it to a 1x1 box (sr-only pattern)', () => {
      const rule = ruleDeclarations(/\.visually-hidden(?![\w[#.:])/)!;
      expect(/position\s*:\s*absolute/.test(rule), 'position:absolute').toBe(true);
      expect(/width\s*:\s*1px/.test(rule), 'width:1px').toBe(true);
      expect(/height\s*:\s*1px/.test(rule), 'height:1px').toBe(true);
      expect(/overflow\s*:\s*hidden/.test(rule), 'overflow:hidden').toBe(true);
      expect(/clip\s*:\s*rect\(/.test(rule), 'clip:rect(...)').toBe(true);
      expect(/white-space\s*:\s*nowrap/.test(rule), 'white-space:nowrap').toBe(true);
    });

    it('collapses padding/margin/border so the 1x1 box carries no visible footprint', () => {
      const rule = ruleDeclarations(/\.visually-hidden(?![\w[#.:])/)!;
      expect(/padding\s*:\s*0/.test(rule), 'padding:0').toBe(true);
      expect(/border\s*:\s*0/.test(rule), 'border:0').toBe(true);
      // margin is typically -1px to pull the 1x1 box fully out of flow.
      expect(/margin\s*:\s*-1px/.test(rule), 'margin:-1px').toBe(true);
    });

    it('does NOT use display:none (which would re-introduce the keyboard-inaccessibility bug)', () => {
      const rule = ruleDeclarations(/\.visually-hidden(?![\w[#.:])/)!;
      expect(
        /display\s*:\s*none/.test(rule),
        'visually-hidden must NOT use display:none — that removes the element from ' +
          'the tab order, which is exactly the keyboard failure the class exists to avoid',
      ).toBe(false);
    });

    it('does NOT use visibility:hidden (which also ejects the element from the tab order)', () => {
      const rule = ruleDeclarations(/\.visually-hidden(?![\w[#.:])/)!;
      // `visibility:hidden` has the same effect as `display:none` for keyboard
      // access: an element with `visibility:hidden` cannot receive focus and is
      // removed from the sequential focus order. The classic sr-only clip
      // pattern intentionally omits it (it clips with `overflow:hidden` +
      // `clip:rect(0,0,0,0)` instead), so its presence would re-introduce the
      // exact bug the class exists to fix.
      expect(
        /visibility\s*:\s*hidden/.test(rule),
        'visually-hidden must NOT use visibility:hidden — like display:none, an element ' +
          'with visibility:hidden is removed from the tab order and cannot receive focus',
      ).toBe(false);
    });
  });

  describe('.toolbar label.btn shows a visible focus ring when its input is focused', () => {
    it('a .toolbar label.btn:focus-within rule exists', () => {
      const rule = ruleDeclarations(/\.toolbar\s+label\.btn:focus-within/);
      expect(
        rule,
        'a .toolbar label.btn:focus-within { ... } rule must exist so the Upload ' +
          'button shows focus when the (clipped) input inside it receives keyboard focus',
      ).not.toBeNull();
    });

    it('applies a visible focus indicator (outline/border/box-shadow)', () => {
      const rule = ruleDeclarations(/\.toolbar\s+label\.btn:focus-within/)!;
      // Accept any of the common visible focus indicators. `outline: none` does
      // NOT count (it suppresses the indicator); a real outline value does.
      const hasOutline = /outline\s*:\s*(?!none\b)/.test(rule);
      const hasBorder = /border\s*:\s*(?!none\b)/.test(rule);
      const hasBoxShadow = /box-shadow\s*:\s*(?!none\b)/.test(rule);
      const hasBackground = /background\s*:\s*(?!none\b)/.test(rule);
      expect(
        hasOutline || hasBorder || hasBoxShadow || hasBackground,
        ':focus-within must set a visible focus indicator ' +
          '(a non-none outline/border/box-shadow/background)',
      ).toBe(true);
    });
  });
});
