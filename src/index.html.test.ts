// @vitest-environment node
/**
 * Static-asset tests for `wwwroot/index.html` — the host page that boots the
 * SPA (`<div id="app">` + `<script type="module" src="dist/app.js">`).
 *
 * Pinned to the `node` environment because these tests only inspect the HTML
 * source: they read the file from disk and assert on its markup. They need no
 * DOM, and pinning here keeps them fast and side-effect-free. (Parsing the page
 * with happy-dom's `DOMParser` would instead try to fetch/evaluate the page's
 * `<script src="dist/app.js">` and emit unhandled rejections, so the assertions
 * below parse the raw string deterministically instead.)
 *
 * The headline contract under test is the UI/UX accessibility requirement that
 * users who arrive with JavaScript disabled/blocked see an explanatory
 * `<noscript>` message rather than a blank page, while every pre-existing
 * bootstrap element (charset, viewport, title, stylesheet, mount point, module
 * script) is left intact.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = resolve(__dirname, '../wwwroot/index.html');
const HTML = readFileSync(HTML_PATH, 'utf8');

/* ===========================================================================
 * Helpers
 * ========================================================================= */

/**
 * Extract the full `<noscript>...</noscript>` block. Non-greedy so it captures
 * only the first (and, per the "exactly one" assertion, only) noscript element.
 */
const NOSCRIPT_RE = /<noscript\b[^>]*>([\s\S]*?)<\/noscript>/i;
const noscriptMatch = HTML.match(NOSCRIPT_RE);
const noscriptBlock = noscriptMatch?.[0] ?? '';
const noscriptInner = noscriptMatch?.[1] ?? '';

/**
 * Pull an attribute's value out of a markup fragment, honoring whichever quote
 * character (`"` or `'`) delimits it. This matters here because the fallback's
 * inline `style="..."` contains single-quoted font names (e.g. 'Segoe UI')
 * inside a double-quoted attribute, so a naive `[^"']*` capture would stop at
 * the first single quote.
 */
function getAttribute(markup: string, name: string): string | null {
  const re = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
  const m = markup.match(re);
  return m ? (m[1] ?? m[2] ?? '') : null;
}

/**
 * Relative luminance of a CSS color literal, per the sRGB / WCAG definition.
 * Used to assert the fallback text is *light enough to read* on the dark
 * `#1e1e1e` body background defined in `dist/app.css`, rather than merely
 * "some color". Accepts `#rgb`, `#rrggbb`, and `rgb()/rgba()` forms plus a
 * small allow-list of light named colors.
 */
function isLightColor(value: string): boolean {
  const v = value.trim().toLowerCase();
  let r: number;
  let g: number;
  let b: number;

  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) {
      h = h
        .split('')
        .map((c) => c + c)
        .join('');
    }
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else if (v.startsWith('rgb')) {
    const nums = v.match(/\d+(\.\d+)?/g);
    if (!nums || nums.length < 3) return false;
    [r, g, b] = nums.map(Number);
  } else if (
    [
      'white',
      'whitesmoke',
      'aliceblue',
      'azure',
      'ivory',
      'snow',
      'seashell',
      'floralwhite',
      'mintcream',
    ].includes(v)
  ) {
    return true;
  } else {
    // Unknown format: cannot prove it is light, so fail closed.
    return false;
  }

  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  // WCAG's light/dark crossover (~0.179). #1e1e1e → ~0.013 (dark),
  // #e6e6e6 (the theme text color) → ~0.79 (light).
  return L > 0.179;
}

/* ===========================================================================
 * Document skeleton + preserved bootstrap markup
 * ========================================================================= */
describe('wwwroot/index.html — document skeleton', () => {
  it('is an HTML5 document', () => {
    expect(HTML).toMatch(/^<!DOCTYPE html>/i);
    expect(HTML).toMatch(/<html\b/i);
  });

  it('has <head> and <body> sections', () => {
    expect(HTML).toMatch(/<head\b/i);
    expect(HTML).toMatch(/<\/head>/i);
    expect(HTML).toMatch(/<body\b/i);
    expect(HTML).toMatch(/<\/body>/i);
  });
});

describe('wwwroot/index.html — preserved bootstrap markup', () => {
  it('declares a UTF-8 charset', () => {
    expect(HTML).toMatch(/<meta\s+charset=["']?utf-8["']?/i);
  });

  it('keeps the responsive viewport meta', () => {
    expect(HTML).toMatch(/<meta\s+name=["']viewport["']/i);
    expect(HTML).toMatch(/width=device-width/i);
    expect(HTML).toMatch(/initial-scale=1/i);
  });

  it('keeps the "File Browser" title', () => {
    expect(HTML).toMatch(/<title>\s*File Browser\s*<\/title>/i);
  });

  it('still links the compiled stylesheet dist/app.css', () => {
    expect(HTML).toMatch(/<link[^>]+href=["']dist\/app\.css["']/i);
  });

  it('still mounts the SPA into an empty #app container', () => {
    expect(HTML).toMatch(/<div\s+id=["']app["']>\s*<\/div>/i);
  });

  it('still loads the app as an ES module script dist/app.js', () => {
    expect(HTML).toMatch(/<script[^>]+type=["']module["'][^>]+src=["']dist\/app\.js["']/i);
  });
});

/* ===========================================================================
 * <noscript> fallback — the accessibility fix under test
 * ========================================================================= */
describe('wwwroot/index.html — <noscript> fallback', () => {
  it('contains exactly one <noscript> element', () => {
    const openingTags = HTML.match(/<noscript\b/gi) ?? [];
    expect(openingTags.length).toBe(1);
    expect(noscriptBlock, 'a <noscript>...</noscript> block must exist').toBeTruthy();
  });

  it('is located inside <body> (not in <head>)', () => {
    const bodyOpen = HTML.search(/<body\b/i);
    const bodyClose = HTML.search(/<\/body>/i);
    const nsStart = HTML.search(/<noscript\b/i);
    const nsEnd = nsStart >= 0 ? nsStart + noscriptBlock.length : -1;

    expect(bodyOpen, '<body> must open before the noscript').toBeGreaterThanOrEqual(0);
    expect(bodyClose, '</body> must exist').toBeGreaterThan(bodyOpen);
    expect(nsStart, 'noscript must start after <body> opens').toBeGreaterThan(bodyOpen);
    expect(nsEnd, 'noscript must end before </body>').toBeLessThan(bodyClose);
  });

  it('is placed after the #app mount point', () => {
    // The fix places the fallback immediately after `<div id="app"></div>`;
    // it must not precede the mount container.
    const appIdx = HTML.search(/<div\s+id=["']app["']/i);
    const nsIdx = HTML.search(/<noscript\b/i);
    expect(appIdx).toBeGreaterThanOrEqual(0);
    expect(nsIdx).toBeGreaterThan(appIdx);
  });

  it('provides a non-empty, human-readable message', () => {
    const text = noscriptInner
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    expect(text.length).toBeGreaterThan(20);
  });

  it('tells the user the app requires JavaScript', () => {
    expect(noscriptInner.toLowerCase()).toContain('javascript');
  });

  it('is actionable — instructs the user to enable JavaScript', () => {
    expect(noscriptInner.toLowerCase()).toContain('enable');
  });

  it('uses only plain text — no interactive controls or scripts inside <noscript>', () => {
    // A fallback shown when scripting is off cannot rely on buttons, links,
    // forms, or scripts. Allow text + simple structural tags only.
    expect(
      /<(button|a|input|form|select|textarea|script|iframe|object|embed)\b/i.test(noscriptInner),
    ).toBe(false);
  });

  it('styles the message so it is visible against the dark theme background', () => {
    // dist/app.css paints the body background #1e1e1e (near-black). If the
    // stylesheet also fails to load, the fallback must still be legible, so the
    // message needs an inline light foreground color.
    const style = getAttribute(noscriptInner, 'style');
    expect(style, 'the message element must carry an inline style attribute').not.toBeNull();

    // The foreground `color` declaration (guarded so it does not match
    // `background-color` / `border-color`).
    const colorMatch = style!.toLowerCase().match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
    expect(colorMatch, 'inline style must set a foreground `color`').not.toBeNull();

    const colorValue = colorMatch![1].trim();
    expect(
      isLightColor(colorValue),
      `color "${colorValue}" must be light enough to read on #1e1e1e`,
    ).toBe(true);
  });
});
