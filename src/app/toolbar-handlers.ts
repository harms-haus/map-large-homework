/**
 * Toolbar handlers: search submission, search clearing, and upload into an
 * arbitrary folder (via the context-menu / row "Upload" action). They operate
 * against the shared DOM/API context and trigger a re-render via the context's
 * render hook.
 */
import { getCurrentRoute, navigate, toBrowseHash, toSearchHash } from '../router.js';
import { normalizeRelativePath } from '../format.js';
import { getApi, getSearchInput, getStatus, rerender } from './context.js';

/**
 * Navigate to a search hash for the current input value and browse path. A
 * query shorter than two characters (after trimming) does not search: it
 * navigates to the browse route instead, so the server never receives a
 * too-short `query`. The input's text is left intact.
 */
export function doSearch(): void {
  const path = normalizeRelativePath(getCurrentRoute().path);
  const query = getSearchInput().value.trim();
  if (query.length < 2) {
    navigate(toBrowseHash(path));
    return;
  }
  navigate(toSearchHash(query, path));
}

/** Clear the search input and return to the browse view for the current path. */
export function clearSearch(): void {
  getSearchInput().value = '';
  const path = normalizeRelativePath(getCurrentRoute().path);
  navigate(toBrowseHash(path));
}

/**
 * Open the native file picker and upload every selected file into `dirPath`
 * (an arbitrary directory, not necessarily the current route).
 *
 * Uses a transient `<input type="file" multiple>` appended hidden to body,
 * clicked within the menu-item's user gesture so the picker may open, awaited
 * until it settles, then removed. Because the `cancel` event is non-standard
 * and not fired by every browser, a `window` `focus` event (fired when the
 * dialog closes) is also used as a fallback settle signal — deferred briefly
 * so a real `change` with chosen files wins first. Per-file failures are
 * collected and surfaced in the status footer without aborting the rest.
 */
export async function pickAndUploadInto(dirPath: string): Promise<void> {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.style.display = 'none';
  document.body.append(input);

  const files = await new Promise<File[]>((resolve) => {
    // Grace window letting a real `change` win over the focus fallback.
    const FOCUS_SETTLE_DELAY_MS = 100;
    let settled = false;
    const onFocus = (): void => {
      setTimeout(
        () => finish(input.files && input.files.length > 0 ? Array.from(input.files) : []),
        FOCUS_SETTLE_DELAY_MS,
      );
    };
    const finish = (list: File[]): void => {
      if (settled) {
        return;
      }
      settled = true;
      window.removeEventListener('focus', onFocus);
      resolve(list);
    };
    input.addEventListener('change', () => {
      finish(input.files ? Array.from(input.files) : []);
    });
    input.addEventListener('cancel', () => finish([]));
    window.addEventListener('focus', onFocus);
    input.click();
  });
  input.remove();

  if (files.length === 0) {
    return;
  }
  const path = normalizeRelativePath(dirPath);
  const failed: string[] = [];
  for (const file of files) {
    try {
      await getApi().upload(path, file);
    } catch {
      failed.push(file.name);
    }
  }
  await rerender();
  if (failed.length > 0) {
    const succeeded = files.length - failed.length;
    getStatus().textContent = `Uploaded ${succeeded} file(s); failed: ${failed.join(', ')}`;
  }
}
