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
