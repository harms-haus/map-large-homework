/**
 * Unit tests for `breadcrumb.ts` — the in-app navigation anchor
 * (`makeNavLink`) and the shared breadcrumb element populator
 * (`renderBreadcrumb`).
 *
 * What is pinned per function:
 *   - `makeNavLink`      : href set verbatim via setAttribute (no
 *                          normalization), label via textContent (HTML-safe),
 *                          click → preventDefault + navigate, carries a real
 *                          href (middle-click / copy-link).
 *   - `renderBreadcrumb` : Home link + cumulative segment links + classless
 *                          '/' separators, path normalization, and content
 *                          replacement (not append) on each call.
 *
 * `renderBreadcrumb` needs the app context (getBreadcrumb) established by
 * startApp, so its tests mount the app via `setupCleared()` before calling it
 * directly. Shared fixtures come from `./test-helpers`.
 *
 * Environment: happy-dom (these tests need a DOM).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeNavLink, renderBreadcrumb } from './breadcrumb';
import { toBrowseHash } from '../router';
import { setupCleared, installAppTestLifecycle } from './test-helpers';

installAppTestLifecycle();

// Reset the location hash before each test so navigation assertions start from
// a known state. Between tests no app is mounted (the shared lifecycle clears
// document.body in afterEach), so assigning the hash fires no hashchange
// listener. Tests that mount an app (renderBreadcrumb) call setupCleared()
// afterwards, which sets the hash itself.
beforeEach(() => {
  window.location.hash = '';
});

/* ===========================================================================
 * makeNavLink — the in-app navigation anchor (→ breadcrumb.ts)
 * ========================================================================= */
describe('makeNavLink', () => {
  it('returns an <a> whose textContent is the label and href is the hash', () => {
    const link = makeNavLink('sub', '#/browse/docs/sub');
    expect(link.tagName).toBe('A');
    expect(link.textContent).toBe('sub');
    expect(link.getAttribute('href')).toBe('#/browse/docs/sub');
  });

  it('sets href via setAttribute so the raw value is preserved exactly (no normalization)', () => {
    // A hash containing a literal space and a '?' must be stored verbatim so
    // middle-click / copy-link yield the exact target (the doc calls this out
    // as important for download URLs especially).
    const link = makeNavLink('weird', '#/browse/a b?c=d');
    expect(link.getAttribute('href')).toBe('#/browse/a b?c=d');
  });

  it('inserts the label via textContent (markup in the label is not parsed)', () => {
    const link = makeNavLink('<img src=x>', '#/browse/x');
    expect(link.textContent).toBe('<img src=x>');
    expect(link.querySelector('img')).toBeNull();
  });

  it('on click calls preventDefault and navigates so window.location.hash becomes the hash', () => {
    const link = makeNavLink('sub', toBrowseHash('docs/sub'));
    const evt = new MouseEvent('click', { cancelable: true, bubbles: true });
    link.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(true);
    expect(window.location.hash).toBe(toBrowseHash('docs/sub'));
  });

  it('carries an href attribute (enables middle-click / copy-link, not only a JS handler)', () => {
    const link = makeNavLink('x', toBrowseHash('x'));
    expect(link.hasAttribute('href')).toBe(true);
  });
});

/* ===========================================================================
 * renderBreadcrumb — the shared breadcrumb element populator (→ breadcrumb.ts)
 * ========================================================================= */
describe('renderBreadcrumb', () => {
  it('for the root path renders only a Home link (no separators)', async () => {
    const { breadcrumb } = await setupCleared();
    renderBreadcrumb('');

    const links = Array.from(breadcrumb.querySelectorAll('a'));
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe('Home');
    expect(links[0].getAttribute('href')).toBe(toBrowseHash(''));
    expect(breadcrumb.querySelectorAll('span')).toHaveLength(0);
  });

  it('for "a/b/c" renders Home + three segment links and three "/" separators with cumulative hrefs', async () => {
    const { breadcrumb } = await setupCleared();
    renderBreadcrumb('a/b/c');

    const links = Array.from(breadcrumb.querySelectorAll('a'));
    expect(links.map((a) => a.textContent)).toEqual(['Home', 'a', 'b', 'c']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      toBrowseHash(''),
      toBrowseHash('a'),
      toBrowseHash('a/b'),
      toBrowseHash('a/b/c'),
    ]);
    const separators = Array.from(breadcrumb.querySelectorAll('span'));
    expect(separators).toHaveLength(3);
    for (const sep of separators) {
      expect(sep.textContent).toBe('/');
      expect(sep.className).toBe('');
    }
  });

  it('replaces (not appends to) previous breadcrumb content on each call', async () => {
    const { breadcrumb } = await setupCleared();
    renderBreadcrumb('a/b/c');
    renderBreadcrumb('x');

    const links = Array.from(breadcrumb.querySelectorAll('a'));
    expect(links.map((a) => a.textContent)).toEqual(['Home', 'x']);
  });

  it('normalizes leading/trailing/doubled slashes before splitting into segments', async () => {
    const { breadcrumb } = await setupCleared();
    renderBreadcrumb('//a//b//');

    const links = Array.from(breadcrumb.querySelectorAll('a'));
    expect(links.map((a) => a.textContent)).toEqual(['Home', 'a', 'b']);
  });

  it("clicking a segment navigates to that segment's cumulative browse hash", async () => {
    const { breadcrumb } = await setupCleared();
    renderBreadcrumb('a/b');

    const segB = Array.from(breadcrumb.querySelectorAll('a')).find((a) => a.textContent === 'b')!;
    segB.dispatchEvent(new MouseEvent('click', { cancelable: true, bubbles: true }));

    expect(window.location.hash).toBe(toBrowseHash('a/b'));
  });
});
