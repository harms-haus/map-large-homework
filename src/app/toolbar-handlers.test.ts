/**
 * Tests for the toolbar handlers — the search button / Enter-key handler, the
 * clear-search handler, and the upload (change) handler, including the
 * per-file upload error-handling contract.
 *
 * Split out of the former `src/app.test.ts` monolith (task-29). Shared
 * fixtures, DOM scaffolding, and the per-test fetch stub come from
 * `./test-helpers`.
 *
 * Environment: the project-default `happy-dom` (these tests need a DOM).
 */
import { describe, it, expect, vi } from 'vitest';
import { toBrowseHash, toSearchHash } from '../router';
import { normalizeRelativePath } from '../format';
import { mockResponse } from '../test-utils/mock-response';
import {
  setup,
  flush,
  browseResult,
  fileEntry,
  joinPathHelper,
  fetchMock,
  installAppTestLifecycle,
} from './test-helpers';
import { clearSearch, pickAndUploadInto } from './toolbar-handlers';

installAppTestLifecycle();

/* ===========================================================================
 * Toolbar handlers
 * ========================================================================= */
describe('toolbar handlers', () => {
  describe('search', () => {
    it('navigates to a search hash 200ms after the user types in the input (debounced)', async () => {
      vi.useFakeTimers();
      try {
        const { searchInput } = setup({ hash: toBrowseHash('docs') });
        vi.advanceTimersByTime(1000); // settle initial render

        searchInput.value = 'hello world';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));

        // Not yet — debounce hasn't fired
        expect(window.location.hash).toBe(toBrowseHash('docs'));

        vi.advanceTimersByTime(200);
        expect(window.location.hash).toBe(toSearchHash('hello world', 'docs'));
      } finally {
        vi.useRealTimers();
      }
    });

    it('resets the debounce timer on each keystroke (only fires after 200ms of silence)', async () => {
      vi.useFakeTimers();
      try {
        const { searchInput } = setup({ hash: toBrowseHash('docs') });
        vi.advanceTimersByTime(1000);

        searchInput.value = 'h';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(150); // not enough
        searchInput.value = 'he';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(150); // 150ms since last keystroke, still not enough
        expect(window.location.hash).toBe(toBrowseHash('docs'));

        vi.advanceTimersByTime(50); // now 200ms since last keystroke
        expect(window.location.hash).toBe(toSearchHash('he', 'docs'));
      } finally {
        vi.useRealTimers();
      }
    });

    it('trims the query before navigating', async () => {
      vi.useFakeTimers();
      try {
        const { searchInput } = setup({ hash: toBrowseHash('docs') });
        vi.advanceTimersByTime(1000);

        searchInput.value = '   spaced   ';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(200);

        expect(window.location.hash).toBe(toSearchHash('spaced', 'docs'));
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears the search (returns to browse) when the query becomes empty', async () => {
      vi.useFakeTimers();
      try {
        const { searchInput } = setup({ hash: toSearchHash('foo', 'docs') });
        vi.advanceTimersByTime(1000);

        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(200);

        expect(window.location.hash).toBe(toBrowseHash('docs'));
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears the search input and navigates to browse when the X (clear) button is clicked', async () => {
      const { searchInput, searchClearBtn } = setup({ hash: toSearchHash('foo', 'docs') });
      await flush();

      searchInput.value = 'foo';
      searchClearBtn.click();

      expect(searchInput.value).toBe('');
      expect(window.location.hash).toBe(toBrowseHash('docs'));
    });

    it('clears the search input and navigates to browse when Escape is pressed', async () => {
      const { searchInput } = setup({ hash: toSearchHash('foo', 'docs') });
      await flush();

      searchInput.value = 'foo';
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

      expect(searchInput.value).toBe('');
      expect(window.location.hash).toBe(toBrowseHash('docs'));
    });

    it('Escape key stops propagation (does not close the parent <dialog>)', async () => {
      const { searchInput } = setup({ hash: toBrowseHash('docs') });
      await flush();

      const parentEl = searchInput.closest('.file-browser') ?? document.body;
      parentEl.addEventListener('keydown', () => {
        // should NOT fire if stopPropagation worked
      });

      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      const stopSpy = vi.spyOn(event, 'stopPropagation');
      searchInput.dispatchEvent(event);

      expect(stopSpy).toHaveBeenCalled();
    });

    it('still navigates immediately when Enter is pressed (bypasses debounce)', async () => {
      vi.useFakeTimers();
      try {
        const { searchInput } = setup({ hash: toBrowseHash('docs') });
        vi.advanceTimersByTime(1000);

        searchInput.value = 'foo';
        searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

        // Enter fires immediately, no debounce wait needed
        expect(window.location.hash).toBe(toSearchHash('foo', 'docs'));
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('clearSearch', () => {
    // clearSearch() is the explicit "clear the search box and return to browse"
    // handler (e.g. an "×" / Clear button). It must (1) blank the shared search
    // input, (2) read the CURRENT route's path, and (3) navigate to the browse
    // hash for that path — mirroring doSearch()'s empty-query branch, but as a
    // dedicated, unconditional entry point that also wipes the input text.

    it('resets the search input value to an empty string', async () => {
      const { searchInput } = setup({ hash: toSearchHash('foo', 'docs') });
      await flush();

      searchInput.value = 'leftover query';
      clearSearch();
      await flush();

      expect(searchInput.value).toBe('');
    });

    it('navigates to the browse hash for the current browse path', async () => {
      setup({ hash: toBrowseHash('docs/sub') });
      await flush();

      clearSearch();
      await flush();

      expect(window.location.hash).toBe(toBrowseHash(normalizeRelativePath('docs/sub')));
    });

    it('uses the current route path even when the app is showing a search view', async () => {
      // A search route carries its own `path` (the search scope); clearSearch
      // must drop the query and return to browsing THAT path, not root.
      setup({ hash: toSearchHash('anything', 'docs') });
      await flush();

      clearSearch();
      await flush();

      expect(window.location.hash).toBe(toBrowseHash('docs'));
    });

    it('normalizes the current path before building the browse hash', async () => {
      // A trailing slash (or backslashes) in the current path is collapsed by
      // normalizeRelativePath so the resulting browse hash is canonical.
      setup({ hash: toBrowseHash('docs/') });
      await flush();

      clearSearch();
      await flush();

      expect(window.location.hash).toBe(toBrowseHash('docs'));
    });

    it('navigates to the root browse hash when the current path is empty', async () => {
      setup({ hash: '' });
      await flush();

      clearSearch();
      await flush();

      expect(window.location.hash).toBe(toBrowseHash(''));
    });

    it('clears the input and navigates to browse together', async () => {
      const { searchInput } = setup({ hash: toSearchHash('foo', 'docs') });
      await flush();

      searchInput.value = 'stale text';
      clearSearch();
      await flush();

      expect(searchInput.value).toBe('');
      expect(window.location.hash).toBe(toBrowseHash('docs'));
    });
  });

  describe('upload', () => {
    function setFiles(input: HTMLInputElement, names: string[]): void {
      const dt = new DataTransfer();
      for (const n of names) dt.items.add(new File(['data-' + n], n));
      input.files = dt.files as unknown as FileList;
    }

    /** Drain queued microtasks enough times for the upload loop + re-render. */
    const settle = async (n = 10): Promise<void> => {
      for (let i = 0; i < n; i++) await flush();
    };

    /**
     * Build a fetch impl that rejects POST /upload for the named files (via a
     * non-ok Response, exactly how `ApiClient.request` surfaces failures) while
     * still serving normal browse/upload responses for everything else.
     */
    function failingUploadImpl(failingNames: string[]) {
      const failing = new Set(failingNames);
      return async (url: string, init?: RequestInit): Promise<Response> => {
        const u = String(url);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST' && u.includes('/upload')) {
          const file = (init?.body as FormData | undefined)?.get('file') as File | null;
          if (file && failing.has(file.name)) {
            return mockResponse({ ok: false, status: 413, text: 'too large' });
          }
          return mockResponse({ status: 200, body: { path: file?.name ?? '' } });
        }
        if (method === 'GET' && u.includes('/browse')) {
          const raw = u.split('path=')[1] ?? '';
          const path = decodeURIComponent(raw);
          const child = 'child-of-' + (path || 'root');
          return mockResponse({
            body: browseResult({
              path,
              entries: [fileEntry({ name: child, path: joinPathHelper(path, child) })],
              fileCount: 1,
              totalSize: 10,
            }),
          });
        }
        return mockResponse({ status: 200, body: {} });
      };
    }

    /** Ordered names of files POSTed to /upload so far. */
    function uploadedFileNames(): string[] {
      return fetchMock.mock.calls
        .filter(([u, init]) => String(u).includes('/upload') && (init?.method ?? 'GET') === 'POST')
        .map(
          ([, init]) =>
            ((init?.body as FormData | undefined)?.get('file') as File | null)?.name ?? '',
        );
    }

    /** Count of GET /browse calls observed so far. */
    function browseCount(): number {
      return fetchMock.mock.calls.filter(
        ([u, init]) => String(u).includes('/browse') && (init?.method ?? 'GET') === 'GET',
      ).length;
    }

    it('uploads each selected file to the current browse path, then clears the input and re-renders', async () => {
      const { uploadInput } = setup({ hash: toBrowseHash('docs') });
      await flush();

      setFiles(uploadInput, ['a.txt', 'b.txt']);
      uploadInput.dispatchEvent(new Event('change'));
      await flush();
      await flush();

      const uploadCalls = fetchMock.mock.calls.filter(
        ([u, init]) => String(u).includes('/upload') && (init?.method ?? 'GET') === 'POST',
      );
      expect(uploadCalls).toHaveLength(2);
      for (const [, init] of uploadCalls) {
        expect(init?.body).toBeInstanceOf(FormData);
        expect((init!.body as FormData).get('file')).toBeInstanceOf(File);
      }
      // All uploads target the current browse path.
      expect(
        uploadCalls.every(([u]) => String(u).includes('path=' + encodeURIComponent('docs'))),
      ).toBe(true);
      // The input is cleared afterwards.
      expect(uploadInput.value).toBe('');
      // And a re-render occurred (browse fetched again after upload).
      const browseCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/browse'));
      expect(browseCalls.length).toBeGreaterThan(0);
    });

    it('uploads nothing when no files are selected', async () => {
      const { uploadInput } = setup({ hash: toBrowseHash('docs') });
      await flush();

      uploadInput.dispatchEvent(new Event('change'));
      await flush();

      expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/upload'))).toBe(false);
    });

    // ---- per-file error handling -------------------------------------------
    // A single failing upload must NOT abort the remaining uploads, swallow the
    // re-render, or leave the input uncleared. Each failure is surfaced in the
    // status footer (see task spec: "Uploaded N file(s); failed: a.txt, b.txt").

    it('continues uploading the remaining files when a middle upload fails, then clears the input, re-renders, and surfaces the failure', async () => {
      fetchMock.mockImplementation(failingUploadImpl(['b.txt']));
      const { uploadInput, status } = setup({ hash: toBrowseHash('docs') });
      await flush();
      const browseBefore = browseCount();

      setFiles(uploadInput, ['a.txt', 'b.txt', 'c.txt']);
      uploadInput.dispatchEvent(new Event('change'));
      await settle();

      // All three uploads were attempted — including the failing one — in order.
      expect(uploadedFileNames()).toEqual(['a.txt', 'b.txt', 'c.txt']);
      // The input is cleared even though one upload failed.
      expect(uploadInput.value).toBe('');
      // A re-render still happened after the upload loop.
      expect(browseCount()).toBeGreaterThan(browseBefore);
      // The failure is surfaced in the status footer: it names the failing
      // file and acknowledges the two files that did upload.
      expect(status.textContent).toMatch(/failed/i);
      expect(status.textContent).toContain('b.txt');
      expect(status.textContent).toMatch(/Uploaded\s+2/i);
      // Successful files are not flagged as failed.
      expect(status.textContent).not.toContain('c.txt');
      expect(status.textContent).not.toContain('a.txt');
    });

    it('continues uploading subsequent files when the first upload fails', async () => {
      fetchMock.mockImplementation(failingUploadImpl(['bad.txt']));
      const { uploadInput, status } = setup({ hash: toBrowseHash('docs') });
      await flush();

      setFiles(uploadInput, ['bad.txt', 'good.txt']);
      uploadInput.dispatchEvent(new Event('change'));
      await settle();

      expect(uploadedFileNames()).toEqual(['bad.txt', 'good.txt']);
      expect(uploadInput.value).toBe('');
      expect(status.textContent).toMatch(/failed/i);
      expect(status.textContent).toContain('bad.txt');
      expect(status.textContent).not.toContain('good.txt');
    });

    it('clears the input, re-renders, and lists every failure when all uploads fail', async () => {
      fetchMock.mockImplementation(failingUploadImpl(['x.txt', 'y.txt']));
      const { uploadInput, status } = setup({ hash: toBrowseHash('docs') });
      await flush();
      const browseBefore = browseCount();

      setFiles(uploadInput, ['x.txt', 'y.txt']);
      uploadInput.dispatchEvent(new Event('change'));
      await settle();

      expect(uploadedFileNames()).toEqual(['x.txt', 'y.txt']);
      expect(uploadInput.value).toBe('');
      expect(browseCount()).toBeGreaterThan(browseBefore);
      expect(status.textContent).toMatch(/failed/i);
      expect(status.textContent).toContain('x.txt');
      expect(status.textContent).toContain('y.txt');
    });

    it('does not surface a failure message when every upload succeeds (status stays the normal browse summary)', async () => {
      const { uploadInput, status } = setup({ hash: toBrowseHash('docs') });
      await flush();

      setFiles(uploadInput, ['a.txt', 'b.txt']);
      uploadInput.dispatchEvent(new Event('change'));
      await settle();

      expect(uploadInput.value).toBe('');
      // No failure report; renderBrowse's normal "N folders, M files, total S"
      // summary is what the re-render leaves behind.
      expect(status.textContent).not.toMatch(/failed/i);
      expect(status.textContent).toMatch(/folders.*files.*total/);
    });
  });

  describe('pickAndUploadInto (upload into an arbitrary folder)', () => {
    // Exercises pickAndUploadInto directly: it builds a transient
    // <input type=file multiple>, awaits its change/cancel, uploads every
    // chosen file into the GIVEN path (not the current route), then removes
    // the input and re-renders — mirroring handleUpload's contract but with a
    // caller-chosen destination.

    /** Grab the transient picker input that pickAndUploadInto appended to body. */
    function findPickerInput(): HTMLInputElement | undefined {
      // The transient input is a DIRECT child of <body>; the toolbar upload
      // input lives inside <label class="btn">, so its parent is not body.
      return Array.from(document.querySelectorAll('input[type=file]')).find(
        (i) => i.parentElement === document.body,
      ) as HTMLInputElement | undefined;
    }

    function setFiles(input: HTMLInputElement, names: string[]): void {
      const dt = new DataTransfer();
      for (const n of names) dt.items.add(new File(['data-' + n], n));
      input.files = dt.files as unknown as FileList;
    }

    const settle = async (n = 10): Promise<void> => {
      for (let i = 0; i < n; i++) await flush();
    };

    function uploadCalls(): [string, RequestInit | undefined][] {
      return fetchMock.mock.calls.filter(
        ([u, init]) => String(u).includes('/upload') && (init?.method ?? 'GET') === 'POST',
      );
    }

    it('creates a hidden <input type=file multiple> appended to body, then uploads each file into the given path', async () => {
      setup({ hash: toBrowseHash('current/dir') });
      await flush();

      // Suspend on the awaited picker: do NOT await yet.
      const p = pickAndUploadInto('target/folder');
      const pickInput = findPickerInput();
      expect(pickInput, 'a transient picker input must be appended to body').toBeTruthy();
      expect(pickInput!.type).toBe('file');
      expect(pickInput!.multiple).toBe(true);

      setFiles(pickInput!, ['a.txt', 'b.txt']);
      pickInput!.dispatchEvent(new Event('change'));
      await p;
      await settle();

      // Uploads target the GIVEN path, NOT the current route.
      expect(uploadCalls()).toHaveLength(2);
      expect(
        uploadCalls().every(([u]) =>
          String(u).includes('path=' + encodeURIComponent('target/folder')),
        ),
      ).toBe(true);
      // The transient input was removed after the upload loop.
      expect(findPickerInput()).toBeUndefined();
    });

    it('uploads nothing and removes the input when the picker is cancelled (no files)', async () => {
      setup({ hash: toBrowseHash('docs') });
      await flush();

      const p = pickAndUploadInto('target/folder');
      const pickInput = findPickerInput();
      expect(pickInput).toBeTruthy();

      // Dismiss the picker without choosing — the `cancel` event resolves
      // the awaited promise with an empty list.
      pickInput!.dispatchEvent(new Event('cancel'));
      await p;
      await settle();

      expect(uploadCalls()).toHaveLength(0);
      expect(findPickerInput()).toBeUndefined();
    });

    it('surfaces per-file failures in the status footer while still uploading the rest', async () => {
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        const u = String(url);
        const method = (init?.method ?? 'GET').toUpperCase();
        if (method === 'POST' && u.includes('/upload')) {
          const file = (init?.body as FormData | undefined)?.get('file') as File | null;
          if (file && file.name === 'bad.txt') {
            return mockResponse({ ok: false, status: 413, text: 'too large' });
          }
          return mockResponse({ status: 200, body: { path: file?.name ?? '' } });
        }
        if (method === 'GET' && u.includes('/browse')) {
          return mockResponse({ body: browseResult({ path: 'target/folder', entries: [] }) });
        }
        return mockResponse({ status: 200, body: {} });
      });
      const { status } = setup({ hash: toBrowseHash('docs') });
      await flush();

      const p = pickAndUploadInto('target/folder');
      const pickInput = findPickerInput();
      setFiles(pickInput!, ['good.txt', 'bad.txt']);
      pickInput!.dispatchEvent(new Event('change'));
      await p;
      await settle();

      // Both were attempted; only bad.txt is flagged.
      expect(
        uploadCalls().map(([, init]) => ((init!.body as FormData).get('file') as File).name),
      ).toEqual(['good.txt', 'bad.txt']);
      expect(status.textContent).toMatch(/failed/i);
      expect(status.textContent).toContain('bad.txt');
      expect(status.textContent).not.toContain('good.txt');
    });
  });
});
