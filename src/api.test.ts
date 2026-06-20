import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApiClient, type FileEntry, type BrowseResult, type SearchResult } from './api';
import { mockResponse } from './test-utils/mock-response';

describe('ApiClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('defaults baseUrl to /api/files', () => {
      const client = new ApiClient();
      expect(client.downloadUrl('x')).toBe('/api/files/download?path=x');
    });

    it('honors a custom baseUrl', () => {
      const client = new ApiClient('/custom/api');
      expect(client.downloadUrl('x')).toBe('/custom/api/download?path=x');
    });
  });

  describe('browse', () => {
    it('GETs the browse endpoint with an encoded path and returns parsed JSON', async () => {
      const client = new ApiClient();
      const entries: FileEntry[] = [
        {
          name: 'a.txt',
          path: '/root/a.txt',
          isDirectory: false,
          size: 10,
          lastModified: '2024-01-01T00:00:00Z',
        },
      ];
      const result: BrowseResult = {
        path: '/root',
        parent: '/',
        entries,
        folderCount: 0,
        fileCount: 1,
        totalSize: 10,
      };
      fetchMock.mockResolvedValueOnce(mockResponse({ body: result }));

      const data = await client.browse('/root');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/files/browse?path=' + encodeURIComponent('/root'));
      expect(init?.method).toBe('GET');
      expect(data).toEqual(result);
    });

    it('encodes special characters in the path', async () => {
      const client = new ApiClient();
      fetchMock.mockResolvedValueOnce(
        mockResponse({
          body: { path: '', parent: null, entries: [], folderCount: 0, fileCount: 0, totalSize: 0 },
        }),
      );
      const tricky = '/foo bar/baz?x=1&y=2';
      await client.browse(tricky);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/files/browse?path=' + encodeURIComponent(tricky));
    });

    it('throws an Error containing status and response text on non-2xx', async () => {
      const client = new ApiClient();
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 404, text: 'Not Found' }));

      await expect(client.browse('/missing')).rejects.toThrow('404: Not Found');
      await expect(client.browse('/missing')).rejects.toBeInstanceOf(Error);
    });

    it('throws a plain Error instance (not a string) on failure', async () => {
      const client = new ApiClient();
      fetchMock.mockResolvedValue(mockResponse({ status: 500, text: 'boom' }));
      await expect(client.browse('/x')).rejects.toBeInstanceOf(Error);
    });
  });

  describe('search', () => {
    it('GETs the search endpoint with encoded query and path and returns parsed JSON', async () => {
      const client = new ApiClient();
      const results: FileEntry[] = [
        {
          name: 'match.txt',
          path: '/root/match.txt',
          isDirectory: false,
          size: 5,
          lastModified: '2024-02-02T00:00:00Z',
        },
      ];
      const out: SearchResult = { query: 'mat', path: '/root', results };
      fetchMock.mockResolvedValueOnce(mockResponse({ body: out }));

      const data = await client.search('mat', '/root');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        '/api/files/search?query=' +
          encodeURIComponent('mat') +
          '&path=' +
          encodeURIComponent('/root'),
      );
      expect(init?.method).toBe('GET');
      expect(data).toEqual(out);
    });

    it('encodes special characters in both query and path', async () => {
      const client = new ApiClient();
      fetchMock.mockResolvedValueOnce(mockResponse({ body: { query: '', path: '', results: [] } }));
      const q = 'a b&c';
      const p = '/dir x/y?z=1';
      await client.search(q, p);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe(
        '/api/files/search?query=' + encodeURIComponent(q) + '&path=' + encodeURIComponent(p),
      );
    });

    it('throws on non-2xx', async () => {
      const client = new ApiClient();
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 400, text: 'Bad Request' }));
      await expect(client.search('q', '/p')).rejects.toThrow('400: Bad Request');
    });
  });

  describe('upload', () => {
    it('POSTs multipart form data with a file field named "file" and returns parsed JSON', async () => {
      const client = new ApiClient();
      const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });
      fetchMock.mockResolvedValueOnce(mockResponse({ body: { path: '/root/hello.txt' } }));

      const data = await client.upload('/root', file);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/files/upload?path=' + encodeURIComponent('/root'));
      expect(init?.method).toBe('POST');
      const body = init?.body;
      expect(body).toBeInstanceOf(FormData);
      expect((body as FormData).get('file')).toBe(file);
      expect(data).toEqual({ path: '/root/hello.txt' });
    });

    it('encodes the destination path in the query string', async () => {
      const client = new ApiClient();
      const file = new File(['x'], 'x.txt');
      fetchMock.mockResolvedValueOnce(mockResponse({ body: { path: '' } }));
      const dest = '/some dir/sub?x=1';
      await client.upload(dest, file);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/files/upload?path=' + encodeURIComponent(dest));
    });

    it('throws on non-2xx', async () => {
      const client = new ApiClient();
      const file = new File(['x'], 'x.txt');
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 413, text: 'Too Large' }));
      await expect(client.upload('/root', file)).rejects.toThrow('413: Too Large');
    });
  });

  describe('delete', () => {
    it('issues a DELETE to the delete endpoint and resolves to void on success', async () => {
      const client = new ApiClient();
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 204, body: null }));

      const result = await client.delete('/root/old.txt');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/files/delete?path=' + encodeURIComponent('/root/old.txt'));
      expect(init?.method).toBe('DELETE');
      expect(result).toBeUndefined();
    });

    it('encodes the path', async () => {
      const client = new ApiClient();
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 204 }));
      const p = '/a b/c?d=1';
      await client.delete(p);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/files/delete?path=' + encodeURIComponent(p));
    });

    it('throws on non-2xx', async () => {
      const client = new ApiClient();
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 403, text: 'Forbidden' }));
      await expect(client.delete('/nope')).rejects.toThrow('403: Forbidden');
    });
  });

  describe('move', () => {
    it('POSTs JSON { sourcePath, destinationPath } with Content-Type application/json and resolves void', async () => {
      const client = new ApiClient();
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: {} }));

      const result = await client.move('/a/b.txt', '/c/b.txt');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/files/move');
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init!.body as string)).toEqual({
        sourcePath: '/a/b.txt',
        destinationPath: '/c/b.txt',
      });
      expect(result).toBeUndefined();
    });

    it('does not encode paths because they ride in a JSON body', async () => {
      const client = new ApiClient();
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 200 }));
      await client.move('/a b/c?x=1', '/d e/f?y=2');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body).toEqual({ sourcePath: '/a b/c?x=1', destinationPath: '/d e/f?y=2' });
    });

    it('throws on non-2xx', async () => {
      const client = new ApiClient();
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 409, text: 'Conflict' }));
      await expect(client.move('/a', '/b')).rejects.toThrow('409: Conflict');
    });
  });

  describe('copy', () => {
    it('POSTs JSON { sourcePath, destinationPath } with Content-Type application/json and resolves void', async () => {
      const client = new ApiClient();
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: {} }));

      const result = await client.copy('/a/b.txt', '/c/b.txt');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/files/copy');
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/json');
      expect(JSON.parse(init!.body as string)).toEqual({
        sourcePath: '/a/b.txt',
        destinationPath: '/c/b.txt',
      });
      expect(result).toBeUndefined();
    });

    it('sends the raw paths in the JSON body', async () => {
      const client = new ApiClient();
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 200 }));
      await client.copy('/src dir/f?x=1', '/dst dir/g?y=2');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
      expect(body).toEqual({ sourcePath: '/src dir/f?x=1', destinationPath: '/dst dir/g?y=2' });
    });

    it('throws on non-2xx', async () => {
      const client = new ApiClient();
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 500, text: 'Server Error' }));
      await expect(client.copy('/a', '/b')).rejects.toThrow('500: Server Error');
    });
  });

  describe('createDirectory', () => {
    it('POSTs to the mkdir endpoint with an encoded path and resolves void on success', async () => {
      const client = new ApiClient();
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 200, body: { success: true } }));

      const result = await client.createDirectory('docs/new folder');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/files/mkdir?path=' + encodeURIComponent('docs/new folder'));
      expect(init?.method).toBe('POST');
      // No request body — the path rides in the query string.
      expect(init?.body).toBeUndefined();
      expect(result).toBeUndefined();
    });

    it('encodes the path', async () => {
      const client = new ApiClient();
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 200 }));
      const p = 'a b/c?d=1';
      await client.createDirectory(p);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/files/mkdir?path=' + encodeURIComponent(p));
    });

    it('throws on non-2xx', async () => {
      const client = new ApiClient();
      fetchMock.mockResolvedValueOnce(mockResponse({ status: 400, text: 'Bad Request' }));
      await expect(client.createDirectory('../escape')).rejects.toThrow('400: Bad Request');
    });
  });

  describe('downloadUrl', () => {
    it('returns the encoded download URL synchronously without calling fetch', () => {
      const client = new ApiClient();
      const url = client.downloadUrl('/root/file.txt');
      expect(url).toBe('/api/files/download?path=' + encodeURIComponent('/root/file.txt'));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('encodes special characters', () => {
      const client = new ApiClient();
      const tricky = '/a b/c?d=1&e=2';
      expect(client.downloadUrl(tricky)).toBe(
        '/api/files/download?path=' + encodeURIComponent(tricky),
      );
    });

    it('respects a custom baseUrl', () => {
      const client = new ApiClient('/api/v2/files');
      expect(client.downloadUrl('x')).toBe('/api/v2/files/download?path=x');
    });
  });
});

/* ===========================================================================
 * mockResponse helper characterization
 *
 * `mockResponse` (defined at the top of this file) is shared test
 * infrastructure that builds a minimal fetch `Response` stand-in for the
 * stubbed global `fetch`. An effectively-identical copy also lives inline in
 * `src/app.test.ts`; the two copies differ ONLY in `json()`'s fallback for
 * the text-only case — this file parses the text as JSON, app.test.ts returns
 * `{}`. This suite pins down the UNION semantics (the more capable variant,
 * which is what the extracted shared module should adopt) so that when the
 * helper is deduplicated into a shared module both call sites keep working
 * without behavioral drift.
 *
 * These tests intentionally target the branches the behavioral ApiClient
 * tests above do NOT exercise: on the error path ApiClient only calls
 * `.text()` (never `.json()`), and on the success path a `body` is always
 * supplied — so the `ok` derivation, the `text()` default, and every `json()`
 * fallback (null/undefined body → {}, text-only → parsed JSON, body-wins-over-
 * text, primitive/nullish `body` passthrough) are otherwise uncharacterized.
 *
 * They live here (next to the union copy) and pass against the CURRENT inline
 * implementation; after the helper is extracted into a shared module and this
 * file imports it, the same assertions validate the shared implementation.
 * ========================================================================= */
describe('mockResponse helper', () => {
  describe('status and ok', () => {
    it('defaults status to 200 and ok to true', () => {
      const res = mockResponse({});
      expect(res.status).toBe(200);
      expect(res.ok).toBe(true);
    });

    it('derives ok=true for every 2xx status', () => {
      for (const status of [200, 201, 204, 299]) {
        expect(mockResponse({ status }).ok).toBe(true);
      }
    });

    it('derives ok=false for every non-2xx status (including 3xx redirects)', () => {
      for (const status of [301, 400, 404, 500, 503]) {
        expect(mockResponse({ status }).ok).toBe(false);
      }
    });

    it('preserves an explicit status on the response', () => {
      expect(mockResponse({ status: 418 }).status).toBe(418);
    });

    it('an explicit ok=true overrides a status that would otherwise be not-ok', () => {
      expect(mockResponse({ ok: true, status: 500 }).ok).toBe(true);
    });

    it('an explicit ok=false overrides a status that would otherwise be ok (nullish, not falsy, coalescing)', () => {
      // Guards against a future bug where `ok ?? derived` is accidentally
      // rewritten as `ok || derived`, which would ignore an explicit false.
      expect(mockResponse({ ok: false, status: 200 }).ok).toBe(false);
    });
  });

  describe('text()', () => {
    it('returns the explicit text when provided', async () => {
      expect(await mockResponse({ text: 'Not Found' }).text()).toBe('Not Found');
    });

    it('defaults to JSON.stringify(body) when no text is given', async () => {
      expect(await mockResponse({ body: { a: 1 } }).text()).toBe(JSON.stringify({ a: 1 }));
    });

    it('defaults to "{}" when neither body nor text is given', async () => {
      expect(await mockResponse({}).text()).toBe('{}');
    });

    it('defaults to "{}" when body is null', async () => {
      expect(await mockResponse({ body: null }).text()).toBe('{}');
    });

    it('uses the explicit text verbatim even when a body is also present', async () => {
      // The error path relies on this: mockResponse({ status: 404, text: 'Not Found' })
      // must surface 'Not Found' via .text(), NOT the JSON-stringified body.
      expect(await mockResponse({ body: { a: 1 }, text: 'Not Found' }).text()).toBe('Not Found');
    });

    it('serializes a primitive body when no text is given', async () => {
      expect(await mockResponse({ body: 0 }).text()).toBe('0');
    });
  });

  describe('json()', () => {
    it('returns the body object when provided', async () => {
      const body = { path: '/x', entries: [1, 2, 3] };
      expect(await mockResponse({ body }).json()).toEqual(body);
    });

    it('returns the body array when provided', async () => {
      expect(await mockResponse({ body: [1, 2, 3] }).json()).toEqual([1, 2, 3]);
    });

    it('returns a string body unchanged', async () => {
      expect(await mockResponse({ body: 'hello' }).json()).toBe('hello');
    });

    it('returns a falsy-but-defined numeric body unchanged (nullish coalescing, not ||)', async () => {
      // `body ?? fallback` must keep 0; `body || fallback` would drop it.
      expect(await mockResponse({ body: 0 }).json()).toBe(0);
    });

    it('returns a falsy-but-defined boolean body unchanged', async () => {
      expect(await mockResponse({ body: false }).json()).toBe(false);
    });

    it('returns {} when body is null', async () => {
      // app.test.ts uses mockResponse({ status: 204, body: null }) for the
      // delete endpoint; the shared module must keep mapping null → {}.
      expect(await mockResponse({ body: null }).json()).toEqual({});
    });

    it('returns {} when body is undefined', async () => {
      expect(await mockResponse({ body: undefined }).json()).toEqual({});
    });

    it('returns {} when neither body nor text is given', async () => {
      expect(await mockResponse({}).json()).toEqual({});
    });

    it('parses the text as JSON when only text is provided (UNION behavior)', async () => {
      // This is the one branch where the api.test.ts and app.test.ts copies
      // differ: this copy (api) parses; app.test.ts would return {}. The shared
      // module adopts the union (parse) semantics.
      expect(await mockResponse({ text: '{"a":1,"b":2}' }).json()).toEqual({ a: 1, b: 2 });
    });

    it('prefers body over text when both are provided', async () => {
      expect(await mockResponse({ body: { a: 1 }, text: '{"z":9}' }).json()).toEqual({ a: 1 });
    });
  });

  describe('async shape and Response-like surface', () => {
    it('text() and json() each return a Promise', () => {
      const res = mockResponse({ body: { a: 1 } });
      expect(res.text()).toBeInstanceOf(Promise);
      expect(res.json()).toBeInstanceOf(Promise);
    });

    it('awaits to the same values across repeated reads (idempotent accessors)', async () => {
      const res = mockResponse({ body: { a: 1 }, text: 'literal' });
      expect(await res.text()).toBe('literal');
      expect(await res.text()).toBe('literal');
      expect(await res.json()).toEqual({ a: 1 });
      expect(await res.json()).toEqual({ a: 1 });
    });

    it('exposes ok (boolean), status (number), and async text/json accessors', async () => {
      const res = mockResponse({ status: 404, text: 'Not Found' });
      expect(typeof res.ok).toBe('boolean');
      expect(typeof res.status).toBe('number');
      expect(typeof res.text).toBe('function');
      expect(typeof res.json).toBe('function');
      expect(await res.text()).toBe('Not Found');
    });
  });
});
