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

/* ===========================================================================
 * Parsing helpers for the search-wrapper / icon / spinner tests below.
 *
 * `ruleDeclarations` above returns only the FIRST matching rule block and so
 * cannot cope with selectors that own MORE than one rule — e.g. `.clear-btn`
 * has a positioning rule, a base-styling rule, AND a default-hidden
 * `display:none` rule — nor with comma-grouped selectors. The helpers below
 * parse the stylesheet into discrete `{ selector, declarations }` blocks.
 *
 * Comments are stripped first because the file's explanatory comments contain
 * literal braces (the `.browser-dialog` block quotes `dialog:not([open])
 * { display: none }` and the `.row-menu` block quotes `.results { overflow:auto
 * }`), which would otherwise corrupt naive brace-counting.
 * ========================================================================= */

/** Strip C-style block comments (delimited by slash-star and star-slash). */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

interface CssRule {
  selector: string;
  declarations: string;
}

/**
 * Split a stylesheet into top-level rules, honouring nested braces so an
 * `@keyframes` body is kept as ONE rule rather than split at its inner `to {}`.
 */
function parseRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    const selector = css.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth++;
      else if (css[j] === '}') depth--;
      j++;
    }
    const declarations = css.slice(open + 1, j - 1);
    if (selector.length > 0) rules.push({ selector, declarations });
    i = j;
  }
  return rules;
}

const RULES: CssRule[] = parseRules(stripComments(CSS));

/** Every rule whose selector contains `selectorToken` (compiled as a regex). */
function rulesMatching(selectorToken: string): CssRule[] {
  const re = new RegExp(selectorToken);
  return RULES.filter((r) => re.test(r.selector));
}

/** True if ANY rule matching `selectorToken` also declares something matching `decl`. */
function hasDecl(selectorToken: string, decl: RegExp): boolean {
  return rulesMatching(selectorToken).some((r) => decl.test(r.declarations));
}

/** The first rule matching `selectorToken` that ALSO declares `decl`, or undefined. */
function ruleWith(selectorToken: string, decl: RegExp): CssRule | undefined {
  return rulesMatching(selectorToken).find((r) => decl.test(r.declarations));
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

  it('suppresses the global a:hover underline so the Download anchor does not get a stray underline', () => {
    // The Download menu item is the only <a> in the menu (Delete/Move/Copy
    // are <button>s), so the global `a:hover { text-decoration: underline }`
    // rule singled it out for a stray underline on hover. `.row-menu .btn`
    // (specificity 0,2,0) dominates `a:hover` (0,1,1), so declaring
    // text-decoration:none on the base item rule covers both states and keeps
    // the Download item visually consistent with the buttons.
    const item = ruleDeclarations(/\.row-menu \.btn/)!;
    expect(/text-decoration\s*:\s*none/.test(item), 'text-decoration:none override').toBe(true);
  });
});

/* ===========================================================================
 * Search input wrapper, in-input icons, visibility toggling & spinner
 *
 * The toolbar's search field is wrapped in `.search-wrapper`, which owns the
 * positioning for two affordances layered absolutely over the input: a
 * decorative search glyph (`.search-icon`) and a clear button (`.clear-btn`).
 * Their visibility is toggled purely in CSS via `:placeholder-shown` (the glyph
 * shows when the field is empty; the clear button shows once the user has
 * typed). A separate `.spinning` / `.search-spinner` pair styles the loading
 * indicator shown during an in-flight search.
 *
 * As with the sections above, the raw stylesheet is parsed (the vitest env does
 * not load app.css) — here via `parseRules`, which splits the file into
 * per-rule blocks after stripping comments.
 * ========================================================================= */
describe('src/app.css — search input wrapper (.search-wrapper)', () => {
  // The wrapper replaces the bare <input> as the direct flex child of .toolbar,
  // so it — not the input — must carry the `margin-left:auto` that right-aligns
  // the search control. `position:relative` establishes the containing block for
  // the absolutely-positioned icons; `inline-flex` + `align-items:center` keep
  // the input and overlays vertically centered.
  const wrapper = () => rulesMatching('^\\.search-wrapper$')[0];

  it('exists as a base .search-wrapper rule', () => {
    expect(wrapper(), 'a base .search-wrapper { ... } rule must exist').toBeDefined();
  });

  it('is position:relative so its absolutely-positioned icons anchor to it', () => {
    expect(wrapper(), 'a base .search-wrapper rule must exist').toBeDefined();
    expect(/position\s*:\s*relative/.test(wrapper()!.declarations), 'position:relative').toBe(true);
  });

  it('is an inline-flex, vertically-centered row container', () => {
    expect(/display\s*:\s*inline-flex/.test(wrapper()!.declarations), 'display:inline-flex').toBe(
      true,
    );
    expect(/align-items\s*:\s*center/.test(wrapper()!.declarations), 'align-items:center').toBe(
      true,
    );
  });

  it('right-aligns within the toolbar via margin-left:auto', () => {
    expect(/margin-left\s*:\s*auto/.test(wrapper()!.declarations), 'margin-left:auto').toBe(true);
  });
});

describe('src/app.css — wrapped search input (.search-wrapper input[type=text])', () => {
  // The inherited `.toolbar input[type='text']` rule sets `margin-left:auto`;
  // the wrapper-scoped override must reset it to 0 (the wrapper now owns
  // right-alignment) and add right padding so typed text never slips under the
  // absolutely-positioned overlay icon.
  const token = "\\.search-wrapper\\s+input\\[type='text'\\]";

  it('resets margin-left to 0 (the wrapper owns positioning now)', () => {
    expect(hasDecl(token, /margin-left\s*:\s*0/), 'margin-left:0').toBe(true);
  });

  it('reserves right padding so text does not run under the overlay icon', () => {
    expect(hasDecl(token, /padding-right\s*:\s*28px/), 'padding-right:28px').toBe(true);
  });
});

describe('src/app.css — in-input overlay icons (.search-icon / .clear-btn)', () => {
  it('absolutely positions the search glyph at the right edge in muted foreground', () => {
    const rule = ruleWith('\\.search-icon', /position\s*:\s*absolute/);
    expect(rule, 'a rule positioning .search-icon must exist').toBeDefined();
    expect(/right\s*:\s*6px/.test(rule!.declarations), 'right:6px').toBe(true);
    expect(/color\s*:\s*#9a9a9a/.test(rule!.declarations), 'muted color #9a9a9a').toBe(true);
  });

  it('makes the search glyph non-interactive (decorative only)', () => {
    expect(hasDecl('\\.search-icon', /pointer-events\s*:\s*none/), 'pointer-events:none').toBe(
      true,
    );
  });

  it('absolutely positions the clear button at the right edge in muted foreground', () => {
    const rule = ruleWith('\\.clear-btn', /position\s*:\s*absolute/);
    expect(rule, 'a rule positioning .clear-btn must exist').toBeDefined();
    expect(/right\s*:\s*6px/.test(rule!.declarations), 'right:6px').toBe(true);
    expect(/color\s*:\s*#9a9a9a/.test(rule!.declarations), 'muted color #9a9a9a').toBe(true);
  });

  it('styles .clear-btn as a chromeless inline-flex icon button', () => {
    const rule = ruleWith('\\.clear-btn', /background\s*:\s*none/);
    expect(rule, 'a base .clear-btn styling rule must exist').toBeDefined();
    expect(/border\s*:\s*none/.test(rule!.declarations), 'border:none').toBe(true);
    expect(/cursor\s*:\s*pointer/.test(rule!.declarations), 'cursor:pointer').toBe(true);
    expect(/padding\s*:\s*2px/.test(rule!.declarations), 'padding:2px').toBe(true);
    expect(/display\s*:\s*inline-flex/.test(rule!.declarations), 'display:inline-flex').toBe(true);
    expect(/align-items\s*:\s*center/.test(rule!.declarations), 'align-items:center').toBe(true);
    expect(/line-height\s*:\s*1/.test(rule!.declarations), 'line-height:1').toBe(true);
  });

  it('keeps the clear button CLICKABLE — no rule may set pointer-events:none on it', () => {
    // The decorative .search-icon is pointer-events:none, but the clear button
    // must remain clickable. Guard against that declaration being copied onto
    // .clear-btn by mistake (which would make it unclickable).
    const clearRules = rulesMatching('\\.clear-btn');
    expect(clearRules.length, 'at least one .clear-btn rule must exist').toBeGreaterThan(0);
    const offending = clearRules.filter((r) => /pointer-events\s*:\s*none/.test(r.declarations));
    expect(offending, 'no .clear-btn rule may set pointer-events:none').toEqual([]);
  });

  it('brightens the clear button to full foreground on hover', () => {
    expect(hasDecl('\\.clear-btn:hover', /color\s*:\s*#e6e6e6/), 'hover color #e6e6e6').toBe(true);
  });
});

describe('src/app.css — icon visibility toggling via :placeholder-shown', () => {
  // Pure-CSS toggling (no JS): when the field is empty its placeholder is shown
  // and the clear button stays hidden; once the user types the placeholder is
  // no longer shown, so the search glyph is hidden and the clear button shown.
  it('hides the clear button by default (input empty / placeholder shown)', () => {
    expect(
      hasDecl('\\.clear-btn', /display\s*:\s*none/),
      'a .clear-btn rule must set display:none as the default (empty) state',
    ).toBe(true);
  });

  it('hides the search glyph once the user has typed (placeholder NOT shown)', () => {
    expect(
      hasDecl('input:not\\(:placeholder-shown\\)\\s*~\\s*\\.search-icon', /display\s*:\s*none/),
      '.search-icon must be display:none when the input is not showing its placeholder',
    ).toBe(true);
  });

  it('reveals the clear button once the user has typed', () => {
    expect(
      hasDecl(
        'input:not\\(:placeholder-shown\\)\\s*~\\s*\\.clear-btn',
        /display\s*:\s*inline-flex/,
      ),
      '.clear-btn must be display:inline-flex when the input is not showing its placeholder',
    ).toBe(true);
  });
});

describe('src/app.css — spinner animation', () => {
  it('defines a @keyframes spin that rotates a full turn', () => {
    expect(
      hasDecl('@keyframes\\s+spin\\b', /transform\s*:\s*rotate\(360deg\)/),
      '@keyframes spin must declare transform: rotate(360deg)',
    ).toBe(true);
  });

  it('.spinning applies the spin loop as an infinite inline-block', () => {
    const rule = rulesMatching('^\\.spinning$')[0];
    expect(rule, 'a .spinning { ... } rule must exist').toBeDefined();
    expect(
      /animation\s*:\s*spin\s+1s\s+linear\s+infinite/.test(rule!.declarations),
      'animation: spin 1s linear infinite',
    ).toBe(true);
    expect(/display\s*:\s*inline-block/.test(rule!.declarations), 'display:inline-block').toBe(
      true,
    );
  });

  it('.search-spinner is a centered, muted placeholder for the spinner', () => {
    const rule = rulesMatching('^\\.search-spinner$')[0];
    expect(rule, 'a .search-spinner { ... } rule must exist').toBeDefined();
    expect(/display\s*:\s*flex/.test(rule!.declarations), 'display:flex').toBe(true);
    expect(/justify-content\s*:\s*center/.test(rule!.declarations), 'justify-content:center').toBe(
      true,
    );
    expect(/align-items\s*:\s*center/.test(rule!.declarations), 'align-items:center').toBe(true);
    expect(/padding\s*:\s*16px/.test(rule!.declarations), 'padding:16px').toBe(true);
    expect(/color\s*:\s*#9a9a9a/.test(rule!.declarations), 'muted color #9a9a9a').toBe(true);
    expect(/font-size\s*:\s*20px/.test(rule!.declarations), 'font-size:20px').toBe(true);
  });
});

describe('src/app.css — new rules placed in the toolbar section / at end of file', () => {
  it('search-wrapper rules come after the existing search-input :focus rule', () => {
    const focusIdx = RULES.findIndex((r) => /input\[type='text'\]:focus/.test(r.selector));
    const wrapperIdx = RULES.findIndex((r) => r.selector === '.search-wrapper');
    expect(
      focusIdx,
      'the existing .toolbar input:focus rule must be present',
    ).toBeGreaterThanOrEqual(0);
    expect(wrapperIdx, 'a .search-wrapper rule must be present').toBeGreaterThanOrEqual(0);
    expect(wrapperIdx, '.search-wrapper must come after the :focus rule').toBeGreaterThan(focusIdx);
  });

  it('places the spinner animation rules at the very end of the file', () => {
    expect(RULES.at(-1)!.selector, '.search-spinner is the final rule').toBe('.search-spinner');
    const last3 = new Set(RULES.slice(-3).map((r) => r.selector));
    expect(last3, 'keyframes/spinning/search-spinner occupy the last three rule slots').toEqual(
      new Set(['@keyframes spin', '.spinning', '.search-spinner']),
    );
  });
});

/* ===========================================================================
 * Search wrapper, in-input icons & spinner — companion contract via
 * ruleDeclarations().
 *
 * A focused restatement of the search-wrapper / icon / spinner contract that
 * uses the simple first-match `ruleDeclarations` helper (instead of the
 * `parseRules`-based helpers used in the blocks above). Most of these
 * selectors own exactly one rule, so `ruleDeclarations` resolves them
 * directly.
 *
 * Two selectors own MORE than one rule, so `ruleDeclarations` (which returns
 * only the FIRST match) cannot single out the specific declaration under test:
 *   - `.search-wrapper .clear-btn` appears as a combined positioning rule
 *     (`.search-icon, .clear-btn { position:absolute; ... }`) BEFORE its
 *     default-hidden `.clear-btn { display:none }` rule;
 *   - `.search-wrapper .search-icon`'s first brace-terminated rule is the
 *     `pointer-events:none` rule, not the combined positioning rule.
 * For those two assertions we match the raw `CSS` string directly — the same
 * technique the `.browse-table` block above and this block's own clear-btn
 * position check already use.
 * ========================================================================= */
describe('src/app.css — search wrapper and in-input icons', () => {
  it('.search-wrapper is a relative inline-flex container with margin-left:auto', () => {
    const rule = ruleDeclarations(/\.search-wrapper(?![\w[#.])/);
    expect(rule, 'a .search-wrapper rule must exist').not.toBeNull();
    expect(/position\s*:\s*relative/.test(rule!), 'position:relative').toBe(true);
    expect(/display\s*:\s*inline-flex/.test(rule!), 'display:inline-flex').toBe(true);
    expect(/align-items\s*:\s*center/.test(rule!), 'align-items:center').toBe(true);
    expect(/margin-left\s*:\s*auto/.test(rule!), 'margin-left:auto').toBe(true);
  });

  it('.search-wrapper input overrides margin-left to 0 and adds right padding', () => {
    const rule = ruleDeclarations(/\.search-wrapper input\[type='text'\]/);
    expect(rule, 'a .search-wrapper input rule must exist').not.toBeNull();
    expect(/margin-left\s*:\s*0/.test(rule!), 'margin-left:0 override').toBe(true);
    expect(/padding-right\s*:\s*\d+px/.test(rule!), 'padding-right present').toBe(true);
  });

  it('.search-wrapper .clear-btn is hidden by default (display:none)', () => {
    // .clear-btn owns several rules (a combined positioning rule comes first,
    // then a styling rule, then the default-hidden rule), so ruleDeclarations
    // cannot return the display:none rule — verify it against the raw CSS.
    expect(CSS, 'a default-hidden .search-wrapper .clear-btn rule must exist').toMatch(
      /\.search-wrapper \.clear-btn\s*\{[^}]*display\s*:\s*none/,
    );
  });

  it('the clear button becomes visible when the input has text (:placeholder-shown toggling)', () => {
    const showRule = ruleDeclarations(
      /\.search-wrapper input:not\(:placeholder-shown\) ~ \.clear-btn/,
    );
    expect(showRule, 'a :placeholder-shown clear-btn reveal rule must exist').not.toBeNull();
    expect(
      /display\s*:\s*(?:inline-flex|flex|block)/.test(showRule!),
      'clear-btn shown when text present',
    ).toBe(true);
  });

  it('the search icon is hidden when the input has text', () => {
    const hideRule = ruleDeclarations(
      /\.search-wrapper input:not\(:placeholder-shown\) ~ \.search-icon/,
    );
    expect(hideRule, 'a :placeholder-shown search-icon hide rule must exist').not.toBeNull();
    expect(/display\s*:\s*none/.test(hideRule!), 'search-icon hidden when text present').toBe(true);
  });

  it('the search icon and clear button are absolutely positioned right-aligned', () => {
    // The position:absolute declaration lives in the combined
    // `.search-icon, .clear-btn` rule, and the first `.search-icon` rule
    // ruleDeclarations returns is the pointer-events rule — so verify the
    // positioning against the raw CSS string instead.
    expect(CSS, 'search-icon must declare position:absolute').toMatch(
      /\.search-wrapper \.search-icon[^{]*\{[^}]*position\s*:\s*absolute/,
    );
    expect(CSS, 'search-icon must have a right offset').toMatch(
      /\.search-wrapper \.search-icon[^{]*\{[^}]*right\s*:\s*\d+px/,
    );
    expect(CSS, 'clear-btn must declare position:absolute somewhere').toMatch(
      /\.clear-btn[^{]*\{[^}]*position\s*:\s*absolute/,
    );
  });
});

describe('src/app.css — spinner animation', () => {
  it('defines a @keyframes spin animation', () => {
    expect(CSS, '@keyframes spin must exist').toMatch(/@keyframes\s+spin\s*\{/);
    expect(CSS, 'spin keyframes must rotate to 360deg').toMatch(
      /transform\s*:\s*rotate\(\s*360deg\s*\)/,
    );
  });

  it('.spinning class applies the spin animation infinitely', () => {
    const rule = ruleDeclarations(/\.spinning(?![\w[#.])/);
    expect(rule, 'a .spinning rule must exist').not.toBeNull();
    expect(/animation\s*:\s*spin/.test(rule!), 'animation references spin keyframes').toBe(true);
    expect(/infinite/.test(rule!), 'animation runs infinitely').toBe(true);
  });

  it('.search-spinner centers the spinner with padding', () => {
    const rule = ruleDeclarations(/\.search-spinner(?![\w[#.])/);
    expect(rule, 'a .search-spinner rule must exist').not.toBeNull();
    expect(/display\s*:\s*flex/.test(rule!), 'display:flex').toBe(true);
    expect(/justify-content\s*:\s*center/.test(rule!), 'justify-content:center').toBe(true);
    expect(/padding\s*:\s*\d+px/.test(rule!), 'padding present').toBe(true);
  });
});
