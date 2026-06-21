/**
 * Tests for the toolbar handlers: the search doSearch() entry points, the
 * clear-search handler, and the upload handler, including the per-file upload
 * error-handling contract.
 *
 * The core search-area behaviors (debounce fires after 200 ms, the debounce
 * resets per keystroke, query trimming, Enter submits immediately, Escape
 * clears + stops propagation, the clear (✕) button resets) are covered in
 * `./search-wrapper.test.ts`; the `search` describe here keeps only the
 * toolbar-handler-specific edge cases not covered there (the exact 200 ms
 * boundary, the empty-query-returns-to-browse branch, and the min-2-char
 * search guard).
 *
 * Shared fixtures, DOM scaffolding, and the per-test fetch stub come from
 * `./test-helpers`.
 *
 * Environment: the project-default `happy-dom` (these tests need a DOM).
 */
import { describe, it, expect, vi } from 'vitest';
import { toBrowseHash, toSearchHash } from '../router';
import { normalizeRelativePath } from '../format';
import { mockResponse } from '../test-utils/mock-response';
import { setup, flush, browseResult, fetchMock, installAppTestLifecycle } from './test-helpers';
import { clearSearch, pickAndUploadInto } from './toolbar-handlers';

installAppTestLifecycle();

/* ===========================================================================
 * Toolbar handlers
 * ========================================================================= */
describe('toolbar handlers', () => {
  describe('search', () => {
    it('fires at exactly the 200ms debounce boundary — one ms earlier it does not', async () => {
      // Pins the exact debounce value (200ms). The broader debounce behavior
      // (fires after 200ms, resets per keystroke) is covered in
      // search-wrapper.test.ts; this test additionally nails the precise
      // boundary — 199ms = no-fire, 200ms = fire — which those tests only
      // bound to a ~50ms band.
      vi.useFakeTimers();
      try {
        const { searchInput } = setup({ hash: toBrowseHash('docs') });
        vi.advanceTimersByTime(1000); // settle initial render

        searchInput.value = 'hello';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));

        // 199ms — one millisecond short of the threshold: still browsing.
        vi.advanceTimersByTime(199);
        expect(window.location.hash).toBe(toBrowseHash('docs'));

        // The final millisecond (200ms total) trips the debounce.
        vi.advanceTimersByTime(1);
        expect(window.location.hash).toBe(toSearchHash('hello', 'docs'));
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

    it('does NOT search when the query is a single character (stays on browse)', async () => {
      // A one-character (or empty) query is too short to search: doSearch falls
      // back to the browse route for the current path rather than issuing a
      // search, so the server never receives a too-short query.
      vi.useFakeTimers();
      try {
        const { searchInput } = setup({ hash: toBrowseHash('docs') });
        vi.advanceTimersByTime(1000);

        searchInput.value = 'h';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(200);

        expect(window.location.hash).toBe(toBrowseHash('docs'));
      } finally {
        vi.useRealTimers();
      }
    });

    it('does NOT search on Enter when the query is a single character', async () => {
      // The minimum-length guard applies to Enter too: one character must not
      // issue a search even when submitted explicitly.
      vi.useFakeTimers();
      try {
        const { searchInput } = setup({ hash: toBrowseHash('docs') });
        vi.advanceTimersByTime(1000);

        searchInput.value = 'q';
        searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

        expect(window.location.hash).toBe(toBrowseHash('docs'));
      } finally {
        vi.useRealTimers();
      }
    });

    it('searches once the query reaches two characters', async () => {
      vi.useFakeTimers();
      try {
        const { searchInput } = setup({ hash: toBrowseHash('docs') });
        vi.advanceTimersByTime(1000);

        searchInput.value = 'he';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(200);

        expect(window.location.hash).toBe(toSearchHash('he', 'docs'));
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears back to browse when an existing search is edited down to one character', async () => {
      // Editing a multi-character search down below the two-character minimum
      // stops searching and returns to the browse view for the current path.
      vi.useFakeTimers();
      try {
        const { searchInput } = setup({ hash: toSearchHash('hello', 'docs') });
        vi.advanceTimersByTime(1000);

        searchInput.value = 'h';
        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
        vi.advanceTimersByTime(200);

        expect(window.location.hash).toBe(toBrowseHash('docs'));
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

    /* ---------------------------------------------------------------------
     * window `focus` fallback (the `cancel` event is non-standard)
     *
     * `cancel` on <input type=file> is NOT fired by every browser (older
     * browsers, some embedded webviews). Without a fallback, dismissing the
     * picker in such a browser fired NEITHER `change` NOR `cancel`, leaving
     * the awaited promise pending forever and the transient <input> leaked in
     * the DOM. The window regaining focus is the fallback settle signal.
     *
     * These tests pin down both the new fallback and the behaviour that must
     * be preserved: a real `change` still wins (files aren't swallowed), the
     * `settled` guard prevents double-resolution, and the focus listener is
     * cleaned up once the promise settles.
     * ------------------------------------------------------------------ */
    describe('window focus fallback (cancel event is non-standard)', () => {
      it('settles the awaited promise (no upload) when the window regains focus without a change/cancel event', async () => {
        // Regression for the hang/memory-leak: in a browser that does NOT fire
        // the non-standard `cancel` event, dismissing the picker left the
        // awaited promise pending and the transient <input> in the DOM forever.
        // The window `focus` event is the fallback settle signal.
        vi.useFakeTimers();
        try {
          setup({ hash: toBrowseHash('docs') });

          const p = pickAndUploadInto('target/folder');
          const pickInput = findPickerInput();
          expect(pickInput, 'transient picker input must be appended to body').toBeTruthy();

          // Track resolution WITHOUT awaiting p directly, so a missing focus
          // fallback fails this assertion fast instead of hanging on `await p`.
          let resolved = false;
          void p.then(() => {
            resolved = true;
          });

          // Picker dismissed — window regains focus, no change/cancel dispatched.
          window.dispatchEvent(new Event('focus'));
          // The focus handler defers settling (so a real change can win first);
          // advance past that grace window so finish([]) runs.
          await vi.advanceTimersByTimeAsync(1000);

          expect(resolved, 'promise must settle on window focus').toBe(true);
          expect(uploadCalls(), 'nothing is uploaded when no files were chosen').toHaveLength(0);
          expect(findPickerInput(), 'transient input is removed after settling').toBeUndefined();
        } finally {
          vi.useRealTimers();
        }
      });

      it('does not swallow a real selection: a change arriving after focus still uploads the chosen files', async () => {
        // When files ARE chosen, the window regains focus and THEN `change`
        // fires. The focus fallback must NOT resolve with [] before `change`
        // can supply the files — a grace delay lets `change` win (the later
        // focus timeout becomes a no-op via the `settled` guard). A naive
        // immediate-focus handler would fail here with zero uploads.
        vi.useFakeTimers();
        try {
          setup({ hash: toBrowseHash('docs') });

          const p = pickAndUploadInto('target/folder');
          const pickInput = findPickerInput();
          expect(pickInput).toBeTruthy();

          // Window regains focus first (schedules the deferred finish([]))...
          window.dispatchEvent(new Event('focus'));
          // ...then the selection arrives as `change` (input.files now set).
          setFiles(pickInput!, ['a.txt', 'b.txt']);
          pickInput!.dispatchEvent(new Event('change'));
          // Advance past the focus grace window — finish([]) must be a no-op now.
          await vi.advanceTimersByTimeAsync(1000);
          await p;

          expect(uploadCalls()).toHaveLength(2);
          expect(
            uploadCalls().every(([u]) =>
              String(u).includes('path=' + encodeURIComponent('target/folder')),
            ),
          ).toBe(true);
          expect(findPickerInput()).toBeUndefined();
        } finally {
          vi.useRealTimers();
        }
      });

      it('removes the focus fallback listener once the promise settles (no lingering window listener)', async () => {
        // Cleanup contract: the transient focus listener is taken off `window`
        // after settling so it does not outlive the picker. Spying on
        // add/removeEventListener asserts the SAME handler reference that was
        // registered is later removed (works whether cleanup is explicit in
        // finish() or via { once: true }).
        vi.useFakeTimers();
        try {
          setup({ hash: toBrowseHash('docs') });

          const addSpy = vi.spyOn(window, 'addEventListener');
          const removeSpy = vi.spyOn(window, 'removeEventListener');

          const p = pickAndUploadInto('target/folder');
          const pickInput = findPickerInput();
          expect(pickInput).toBeTruthy();

          // Settle via `change` WITHOUT dispatching focus, so the { once: true }
          // auto-remove path is NOT what removes the listener — finish() must.
          setFiles(pickInput!, ['a.txt']);
          pickInput!.dispatchEvent(new Event('change'));
          await vi.advanceTimersByTimeAsync(1000);
          await p;

          const focusReg = addSpy.mock.calls.find(([type]) => type === 'focus');
          expect(focusReg, 'a focus fallback listener must be registered on window').toBeTruthy();
          expect(removeSpy).toHaveBeenCalledWith('focus', focusReg![1]);
          expect(findPickerInput()).toBeUndefined();
        } finally {
          vi.useRealTimers();
        }
      });

      it('never double-resolves: a focus event after change is a no-op (settled guard)', async () => {
        // `change` settles the promise; a later `focus` must not re-resolve or
        // re-run the upload loop (the `settled` guard). This pins down the
        // single-resolution contract now that a second settle path exists.
        vi.useFakeTimers();
        try {
          setup({ hash: toBrowseHash('docs') });

          const p = pickAndUploadInto('target/folder');
          const pickInput = findPickerInput();
          expect(pickInput).toBeTruthy();

          setFiles(pickInput!, ['only.txt']);
          pickInput!.dispatchEvent(new Event('change'));
          // Focus arrives AFTER change already settled — must be a no-op.
          window.dispatchEvent(new Event('focus'));
          await vi.advanceTimersByTimeAsync(1000);
          await p;

          expect(uploadCalls()).toHaveLength(1);
          expect(findPickerInput()).toBeUndefined();
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });
});
