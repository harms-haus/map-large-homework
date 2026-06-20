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
    expect(/flex-direction\s*:\s*column/.test(open!), 'open dialog must be a flex column').toBe(
      true,
    );
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

/* ===========================================================================
 * Browse table — per-row action menu & browse-only column alignment
 *
 * The browse table carries `browse-table` IN ADDITION to the shared
 * `results-table` class. It renders a per-row "⋮" button (`.row-menu-btn`)
 * that opens a fixed-position dropdown (`.row-menu`) of `<button class="btn">`
 * / `<a class="btn">` action items. These tests pin the CSS contract for those
 * pieces plus the browse-only column alignment. As above, they parse the raw
 * stylesheet because the vitest environment does not load app.css.
 *
 * Critical gotcha re-tested below (the SAME class of bug already documented for
 * `.browser-dialog`): `.row-menu` closes via the HTML `hidden` attribute (UA
 * `[hidden]{display:none}`), but the AUTHOR `.row-menu{display:flex}` rule would
 * override the UA sheet and keep a closed menu visible on screen. An explicit,
 * higher-specificity `.row-menu[hidden]{display:none}` override MUST exist.
 * ========================================================================= */
describe('src/app.css — browse table column alignment (scoped to .browse-table)', () => {
  it('stretches the Name column (1st) to absorb the remaining table width', () => {
    // width:100% on column 1 + the table being width:100% / table-layout:auto
    // with nowrap cells means the other (content-width) columns hold their size
    // and Name takes the remainder — the "flex:1-like" stretch for col 1.
    const col1 = ruleDeclarations(/\.browse-table td:nth-child\(1\)/);
    expect(col1, 'a .browse-table column-1 rule (td:nth-child(1)) must exist').not.toBeNull();
    expect(/width\s*:\s*100%/.test(col1!), 'column 1 must set width:100%').toBe(true);
    // The header cell must be covered too, not only the body cell.
    expect(CSS, 'column-1 rule must also target th:nth-child(1)').toContain(
      '.browse-table th:nth-child(1)',
    );
  });

  it('right-aligns Size, Modified, Actions (columns 2-4) for header and body cells', () => {
    // A single grouped rule lists th+td for columns 2,3,4 and sets
    // text-align:right. We anchor on the LAST selector (td:nth-child(4)) so the
    // helper captures this group rule's declaration block.
    const rightAlign = ruleDeclarations(/\.browse-table td:nth-child\(4\)/);
    expect(
      rightAlign,
      'a .browse-table right-align rule ending in td:nth-child(4) must exist',
    ).not.toBeNull();
    expect(
      /text-align\s*:\s*right/.test(rightAlign!),
      'columns 2-4 must set text-align:right',
    ).toBe(true);
    // The selector must enumerate th+td for each of columns 2, 3 and 4.
    for (const n of [2, 3, 4]) {
      expect(CSS, `column ${n} header cell must be targeted`).toContain(
        `.browse-table th:nth-child(${n})`,
      );
      expect(CSS, `column ${n} body cell must be targeted`).toContain(
        `.browse-table td:nth-child(${n})`,
      );
    }
  });

  it('does NOT alter the shared search table: global .results-table cells stay left-aligned', () => {
    // The search table only has `results-table` (no `browse-table`), so its
    // columns must keep the global text-align:left. This guards against the
    // right-align being accidentally scoped to bare `.results-table`.
    const cells = ruleDeclarations(/\.results-table td/);
    expect(cells, 'the global .results-table td rule must still exist').not.toBeNull();
    expect(/text-align\s*:\s*left/.test(cells!), 'search-table cells stay text-align:left').toBe(
      true,
    );
  });
});

describe('src/app.css — row action "⋮" button (.row-menu-btn)', () => {
  it('is a chromeless, muted, clickable button with compact sizing', () => {
    const btn = ruleDeclarations(/\.row-menu-btn/);
    expect(btn, 'a base .row-menu-btn { ... } rule must exist').not.toBeNull();
    expect(/background\s*:\s*none/.test(btn!), 'background:none').toBe(true);
    expect(/border\s*:\s*none/.test(btn!), 'border:none').toBe(true);
    expect(/color\s*:\s*#9a9a9a/.test(btn!), 'muted foreground #9a9a9a').toBe(true);
    expect(/cursor\s*:\s*pointer/.test(btn!), 'cursor:pointer').toBe(true);
    expect(/border-radius\s*:\s*4px/.test(btn!), 'border-radius:4px').toBe(true);
    expect(/font-size\s*:\s*16px/.test(btn!), 'font-size:16px').toBe(true);
    expect(/line-height\s*:\s*1/.test(btn!), 'line-height:1').toBe(true);
    // modest padding (e.g. 2px 6px); assert it is present and pixel-based.
    expect(/padding\s*:\s*\d+px/.test(btn!), 'padding present').toBe(true);
  });

  it('is hidden and non-interactive by default (revealed only on hover/open)', () => {
    const btn = ruleDeclarations(/\.row-menu-btn/)!;
    expect(/opacity\s*:\s*0\b/.test(btn), 'opacity:0 by default').toBe(true);
    expect(/pointer-events\s*:\s*none/.test(btn), 'pointer-events:none by default').toBe(true);
  });

  it('becomes visible + interactive on row hover and when its menu is open', () => {
    // The grouped reveal rule covers both conditions; anchor on the
    // [aria-expanded="true"] selector which is the last one before the brace.
    const reveal = ruleDeclarations(/\.row-menu-btn\[aria-expanded="true"\]/);
    expect(reveal, 'a reveal rule covering [aria-expanded="true"] must exist').not.toBeNull();
    expect(/opacity\s*:\s*1/.test(reveal!), 'revealed opacity:1').toBe(true);
    expect(/pointer-events\s*:\s*auto/.test(reveal!), 'revealed pointer-events:auto').toBe(true);
    // Row-hover must also be one of the reveal selectors.
    expect(CSS, 'hover reveal must include the browse row-hover selector').toContain(
      '.browse-table tbody tr:hover .row-menu-btn',
    );
  });

  it('brightens to full foreground on its own hover', () => {
    const hover = ruleDeclarations(/\.row-menu-btn:hover/);
    expect(hover, 'a .row-menu-btn:hover rule must exist').not.toBeNull();
    expect(/color\s*:\s*#e6e6e6/.test(hover!), 'hover color #e6e6e6').toBe(true);
  });
});

describe('src/app.css — row action dropdown menu (.row-menu)', () => {
  it('is a fixed-position, flex-column overlay that floats above the scroll container', () => {
    const menu = ruleDeclarations(/\.row-menu/);
    expect(menu, 'a base .row-menu { ... } rule must exist').not.toBeNull();
    // position:fixed so a menu placed at viewport clientX/clientY is NOT clipped
    // by the .results{overflow:auto} scroll container and layers correctly.
    expect(/position\s*:\s*fixed/.test(menu!), 'position:fixed').toBe(true);
    // Must sit above the sticky th (which has z-index:1).
    const z = menu!.match(/z-index\s*:\s*(\d+)/);
    expect(z, 'z-index declared').not.toBeNull();
    expect(Number(z![1]), 'z-index must be > 1 to sit above the sticky th').toBeGreaterThan(1);
    expect(/display\s*:\s*flex/.test(menu!), 'display:flex').toBe(true);
    expect(/flex-direction\s*:\s*column/.test(menu!), 'flex-direction:column').toBe(true);
    expect(/min-width\s*:\s*140px/.test(menu!), 'min-width:140px').toBe(true);
    expect(/box-shadow\s*:/.test(menu!), 'box-shadow present').toBe(true);
    expect(/background\s*:\s*#2d2d30/.test(menu!), 'background:#2d2d30').toBe(true);
    expect(/border-radius\s*:\s*4px/.test(menu!), 'border-radius:4px').toBe(true);
  });

  it('is actually hidden when [hidden] despite the author display:flex (critical override)', () => {
    // Same class of bug as .browser-dialog above: the menu closes via the HTML
    // `hidden` attribute (UA [hidden]{display:none}), but the author
    // `.row-menu{display:flex}` rule overrides the UA sheet and would keep a
    // closed menu visible. An explicit `.row-menu[hidden]{display:none}` rule
    // (higher specificity than the base) MUST exist to defeat that.
    const hidden = ruleDeclarations(/\.row-menu\[hidden\]/);
    expect(hidden, 'a .row-menu[hidden] { ... } override rule must exist').not.toBeNull();
    expect(/display\s*:\s*none/.test(hidden!), '.row-menu[hidden] must set display:none').toBe(
      true,
    );
  });
});

describe('src/app.css — row menu items (.row-menu .btn)', () => {
  it('flattens .btn into a full-width, left-aligned menu-item look', () => {
    const item = ruleDeclarations(/\.row-menu \.btn/);
    expect(item, 'a .row-menu .btn { ... } rule must exist').not.toBeNull();
    expect(/background\s*:\s*none/.test(item!), 'background:none').toBe(true);
    expect(/border\s*:\s*none/.test(item!), 'border:none').toBe(true);
    expect(/color\s*:\s*#e6e6e6/.test(item!), 'color:#e6e6e6').toBe(true);
    expect(/width\s*:\s*100%/.test(item!), 'width:100%').toBe(true);
    expect(/text-align\s*:\s*left/.test(item!), 'text-align:left').toBe(true);
    expect(/justify-content\s*:\s*flex-start/.test(item!), 'justify-content:flex-start').toBe(true);
  });

  it('shows a hover background on menu items', () => {
    const hover = ruleDeclarations(/\.row-menu \.btn:hover/);
    expect(hover, 'a .row-menu .btn:hover rule must exist').not.toBeNull();
    expect(/background\s*:\s*#3a3d41/.test(hover!), 'hover background #3a3d41').toBe(true);
  });
});
