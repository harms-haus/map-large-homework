/**
 * Toolbar event handlers: search submission, search clearing, and upload into
 * an arbitrary folder (via the context-menu / row "Upload" action).
 *
 * They operate against the shared DOM/API context (search input value, current
 * route) and trigger a re-render via the context's render hook.
 */
import { getCurrentRoute, navigate, toBrowseHash, toSearchHash } from '../router.js';
import { normalizeRelativePath } from '../format.js';
import { getApi, getSearchInput, getStatus, rerender } from './context.js';

/**
 * Navigate to a search hash for the current input value and browse path.
 *
 * A query of fewer than two characters (after trimming) does not search: it
 * navigates to the browse route for the current path instead, so the server
 * never receives a too-short `query`. This mirrors the empty-query fallback
 * and keeps the input's text intact (only the route changes).
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

/**
 * Clear the search input and return to the browse view for the current path.
 *
 * Resets the search input value to an empty string, reads the current path
 * (normalised), and navigates to the browse hash for that path — the same
 * behaviour as {@link doSearch} when the query is too short, but exposed as an
 * explicit, unconditional entry point that also wipes the input text.
 */
export function clearSearch(): void {
  getSearchInput().value = '';
  const path = normalizeRelativePath(getCurrentRoute().path);
  navigate(toBrowseHash(path));
}

/**
 * Open the native file picker and upload every selected file into `dirPath`
 * (an arbitrary directory, NOT necessarily the current route) — used by the
 * folder-row "Upload" and the current-directory context menus.
 *
 * Uses a self-contained, transient `<input type="file" multiple>` appended
 * hidden to body, clicked (within the menu-item click's user gesture so the
 * picker is allowed to open), awaited until either `change` (files chosen) or
 * `cancel` (dismissed), then removed — so a cancel resolves cleanly with no
 * upload and no leak. Each file is uploaded in order; per-file failures are
 * collected and surfaced in the status footer without aborting the rest.
 */
export async function pickAndUploadInto(dirPath: string): Promise<void> {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.style.display = 'none';
  document.body.append(input);

  const files = await new Promise<File[]>((resolve) => {
    let settled = false;
    const finish = (list: File[]): void => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(list);
    };
    input.addEventListener('change', () => {
      finish(input.files ? Array.from(input.files) : []);
    });
    // `cancel` fires when the user dismisses the picker without choosing —
    // resolve with an empty list so the input is removed and no upload runs.
    input.addEventListener('cancel', () => finish([]));
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
