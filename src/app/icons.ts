/**
 * Bootstrap Icons glyph and action-button builders.
 *
 * `makeIcon` produces an empty `<i class="bi bi-<name>">` whose glyph is
 * painted by the bootstrap-icons stylesheet, and `makeActionButton` produces
 * the `<button class="btn">` used by every menu item. Both insert
 * user-controlled text via element creation / text nodes — never
 * `innerHTML`.
 */
import { getStatus } from './context.js';

/**
 * Build a Bootstrap Icons glyph element: an empty `<i class="bi bi-<name>">`.
 * The glyph is painted by the stylesheet, so the element has no text content
 * of its own — keeping parent `textContent` assertions (e.g. a menu item whose
 * label is "Download") unchanged.
 */
export function makeIcon(name: string): HTMLElement {
  const icon = document.createElement('i');
  icon.className = 'bi bi-' + name;
  return icon;
}

/**
 * Build a `<button class="btn">` with `label` and click `handler`, plus an
 * optional leading glyph. The handler is wrapped so any synchronous throw or
 * promise rejection surfaces in the status footer (consistent with how
 * `render()` displays fetch errors). The icon is an empty `<i>` and the label
 * a bare text node, so the button's `textContent` stays exactly `label`.
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
    // Surface both synchronous throws and async rejections from the handler in
    // the status footer, consistent with how render() displays fetch errors.
    const reportError = (err: unknown): void => {
      const message = err instanceof Error ? err.message : String(err);
      getStatus().textContent = 'Error: ' + message;
    };
    try {
      Promise.resolve(handler()).catch(reportError);
    } catch (err) {
      reportError(err);
    }
  });
  return btn;
}
