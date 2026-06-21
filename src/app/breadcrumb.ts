/**
 * Breadcrumb and in-app navigation-link builders.
 *
 * `renderBreadcrumb` populates the shared breadcrumb element (read from
 * `./context.js`) with a leading "Home" link followed by one cumulative-path
 * segment link per path component. `makeNavLink` builds the individual `<a>`
 * elements used by the breadcrumb, folder name cells, and the ".." parent row.
 *
 * All user-controlled strings (path segments) are inserted via `textContent` /
 * element creation — never via `innerHTML` — to prevent HTML injection.
 */
import { joinPath, normalizeRelativePath } from '../format.js';
import { navigate, toBrowseHash } from '../router.js';
import { getBreadcrumb } from './context.js';

/**
 * Render clickable breadcrumb segments into the shared breadcrumb element: a
 * leading "Home" link (root) followed by one link per path segment, each
 * navigating to its cumulative path. Separators are plain '/' text spans.
 */
export function renderBreadcrumb(path: string): void {
  const breadcrumbEl = getBreadcrumb();
  breadcrumbEl.innerHTML = '';
  const normalized = normalizeRelativePath(path);
  const segments = normalized === '' ? [] : normalized.split('/');

  breadcrumbEl.append(makeNavLink('Home', toBrowseHash('')));

  let cumulative = '';
  for (const segment of segments) {
    cumulative = joinPath(cumulative, segment);
    const separator = document.createElement('span');
    separator.textContent = '/';
    breadcrumbEl.append(separator, makeNavLink(segment, toBrowseHash(cumulative)));
  }
}

/**
 * Build an `<a>` that navigates to `hash` on click. The `href` is set via
 * `setAttribute` (so the raw attribute is preserved exactly — important for
 * download URLs that must not be URL-normalized) and a click handler calls
 * `navigate(hash)` with `preventDefault` so navigation is reliable across DOM
 * implementations. The href also enables middle-click / copy-link support.
 */
export function makeNavLink(text: string, hash: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.setAttribute('href', hash);
  link.textContent = text;
  link.addEventListener('click', (event) => {
    event.preventDefault();
    navigate(hash);
  });
  return link;
}
