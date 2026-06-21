/**
 * Bootstrap Icons glyph and action-button builders.
 *
 * `makeIcon` produces the empty `<i class="bi bi-<name>">` element whose glyph
 * is painted by the bootstrap-icons stylesheet's `::before` pseudo-element, and
 * `makeActionButton` produces the `<button class="btn">` used by every menu
 * item (the row ⋮ menu, the right-click row menu, and the directory context
 * menu). Both insert user-controlled text via element creation / text nodes —
 * never `innerHTML` — to prevent HTML injection.
 */
import { getStatus } from './context.js';

/**
 * Build a Bootstrap Icons glyph element: an empty `<i class="bi bi-<name>">`.
 * The glyph itself is painted by the bootstrap-icons stylesheet's `::before`
 * pseudo-element (content set in CSS), so the element has NO text content of
 * its own — which keeps `textContent` assertions on the parent (e.g. a menu
 * item whose visible label is "Download") unchanged.
 */
export function makeIcon(name: string): HTMLElement {
  const icon = document.createElement('i');
  icon.className = 'bi bi-' + name;
  return icon;
}

/**
 * Build a `<button class="btn">` with the given label and click handler, and an
 * optional leading Bootstrap Icons glyph.
 *
 * The handler is wrapped so that any synchronous throw or promise rejection
 * surfaces the error via the status footer — consistent with how `render()`
 * already displays fetch errors. On normal resolution no error message is
 * shown.
 *
 * When `icon` is given it is prepended as `makeIcon(icon)` (an empty `<i>`),
 * followed by the label as a bare text node — so the button's `textContent`
 * remains exactly `label` and its `className` stays exactly `"btn"`.
 */
export function makeActionButton(
  label: string,
  handler: () => void,
  icon?: string,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.type = 'button';
  if (icon) {
    btn.append(makeIcon(icon));
  }
  btn.append(label);
  btn.addEventListener('click', () => {
    try {
      Promise.resolve(handler()).catch((err: unknown) => {
        getStatus().textContent = 'Error: ' + (err instanceof Error ? err.message : String(err));
      });
    } catch (err) {
      getStatus().textContent = 'Error: ' + (err instanceof Error ? err.message : String(err));
    }
  });
  return btn;
}
