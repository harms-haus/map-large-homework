/**
 * Toolbar event handlers: search submission and file upload.
 *
 * Both operate against the shared DOM/API context (search input value, upload
 * input file list, current route) and trigger a re-render via the context's
 * render hook.
 */
import { getCurrentRoute, navigate, toBrowseHash, toSearchHash } from '../router.js';
import { normalizeRelativePath } from '../format.js';
import { getApi, getSearchInput, getStatus, getUploadInput, rerender } from './context.js';

/**
 * Navigate to a search hash for the current input value and browse path.
 *
 * An empty (or whitespace-only) query clears the search instead: it navigates
 * to the browse route for the current path so the server never receives an
 * empty `query`, which it rejects with 400.
 */
export function doSearch(): void {
  const path = normalizeRelativePath(getCurrentRoute().path);
  const query = getSearchInput().value.trim();
  if (query === '') {
    navigate(toBrowseHash(path));
    return;
  }
  navigate(toSearchHash(query, path));
}

/**
 * Upload every selected file to the current path, handle per-file errors, then
 * clear the input, re-render the listing, and surface any failures in the
 * status footer.
 */
export async function handleUpload(): Promise<void> {
  const uploadInput = getUploadInput();
  const list = uploadInput.files;
  const files = list ? Array.from(list) : [];
  if (files.length === 0) {
    return;
  }
  const path = normalizeRelativePath(getCurrentRoute().path);
  const failed: string[] = [];
  for (const file of files) {
    try {
      await getApi().upload(path, file);
    } catch {
      failed.push(file.name);
    }
  }
  // Clear the input so selecting the same file again re-fires `change`.
  uploadInput.value = '';
  // Re-render the listing first so normal browse/search status is set.
  await rerender();
  // Surface failures after the normal render, so the message is not overwritten.
  if (failed.length > 0) {
    const succeeded = files.length - failed.length;
    getStatus().textContent = `Uploaded ${succeeded} file(s); failed: ${failed.join(', ')}`;
  }
}
