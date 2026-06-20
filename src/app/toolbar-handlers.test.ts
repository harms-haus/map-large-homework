/**
 * Tests for the toolbar handlers — the search button / Enter-key handler and
 * the upload (change) handler, including the per-file upload error-handling
 * contract.
 *
 * Split out of the former `src/app.test.ts` monolith (task-29). Shared
 * fixtures, DOM scaffolding, and the per-test fetch stub come from
 * `./test-helpers`.
 *
 * Environment: the project-default `happy-dom` (these tests need a DOM).
 */
import { describe, it, expect } from 'vitest';
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

installAppTestLifecycle();

/* ===========================================================================
 * Toolbar handlers
 * ========================================================================= */
describe('toolbar handlers', () => {
  describe('search', () => {
    it('navigates to a search hash for the input value and current path when the Search button is clicked', async () => {
      const { searchInput, searchBtn } = setup({ hash: toBrowseHash('docs') });
      await flush();

      searchInput.value = 'hello world';
      searchBtn.click();

      expect(window.location.hash).toBe(toSearchHash('hello world', normalizeRelativePath('docs')));
    });

    it('trims the query before navigating', async () => {
      const { searchInput, searchBtn } = setup({ hash: toBrowseHash('docs') });
      await flush();

      searchInput.value = '   spaced   ';
      searchBtn.click();

      expect(window.location.hash).toBe(toSearchHash('spaced', 'docs'));
    });

    it('clears the search (returns to browse) when the query is empty', async () => {
      const { searchInput, searchBtn } = setup({ hash: toSearchHash('foo', 'docs') });
      await flush();

      searchInput.value = '';
      searchBtn.click();

      expect(window.location.hash).toBe(toBrowseHash('docs'));
    });

    it('clears the search when the query is only whitespace', async () => {
      const { searchInput, searchBtn } = setup({ hash: toSearchHash('foo', 'docs') });
      await flush();

      searchInput.value = '   \t  ';
      searchBtn.click();

      expect(window.location.hash).toBe(toBrowseHash('docs'));
    });

    it('navigates when Enter is pressed inside the search input', async () => {
      const { searchInput } = setup({ hash: toBrowseHash('docs') });
      await flush();

      searchInput.value = 'foo';
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

      expect(window.location.hash).toBe(toSearchHash('foo', 'docs'));
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
        .map(([, init]) => ((init?.body as FormData | undefined)?.get('file') as File | null)?.name ?? '');
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
      expect(uploadCalls.every(([u]) => String(u).includes('path=' + encodeURIComponent('docs')))).toBe(true);
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

      expect(
        fetchMock.mock.calls.some(([u]) => String(u).includes('/upload')),
      ).toBe(false);
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
});
