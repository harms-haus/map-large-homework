import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApiClient, type FileEntry, type BrowseResult, type SearchResult } from './api';

/**
 * Builds a minimal fetch Response stand-in for the mocked global fetch.
 * `json()` returns the parsed body; `text()` returns the raw text (defaults to
 * the JSON-stringified body). `ok` is derived from status unless overridden.
 */
function mockResponse(opts: {
  ok?: boolean;
  status?: number;
  body?: unknown;
  text?: string;
}): Response {
  const status = opts.status ?? 200;
  const ok = opts.ok ?? (status >= 200 && status < 300);
  const text = opts.text ?? JSON.stringify(opts.body ?? {});
  return {
    ok,
    status,
    text: async () => text,
    json: async () => (opts.body ?? (opts.text ? JSON.parse(opts.text) : {})),
  } as unknown as Response;
}

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
        { name: 'a.txt', path: '/root/a.txt', isDirectory: false, size: 10, lastModified: '2024-01-01T00:00:00Z' },
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
        mockResponse({ body: { path: '', parent: null, entries: [], folderCount: 0, fileCount: 0, totalSize: 0 } })
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
        { name: 'match.txt', path: '/root/match.txt', isDirectory: false, size: 5, lastModified: '2024-02-02T00:00:00Z' },
      ];
      const out: SearchResult = { query: 'mat', path: '/root', results };
      fetchMock.mockResolvedValueOnce(mockResponse({ body: out }));

      const data = await client.search('mat', '/root');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        '/api/files/search?query=' + encodeURIComponent('mat') + '&path=' + encodeURIComponent('/root')
      );
      expect(init?.method).toBe('GET');
      expect(data).toEqual(out);
    });

    it('encodes special characters in both query and path', async () => {
      const client = new ApiClient();
      fetchMock.mockResolvedValueOnce(
        mockResponse({ body: { query: '', path: '', results: [] } })
      );
      const q = 'a b&c';
      const p = '/dir x/y?z=1';
      await client.search(q, p);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('/api/files/search?query=' + encodeURIComponent(q) + '&path=' + encodeURIComponent(p));
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
      expect(JSON.parse(init!.body as string)).toEqual({ sourcePath: '/a/b.txt', destinationPath: '/c/b.txt' });
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
      expect(JSON.parse(init!.body as string)).toEqual({ sourcePath: '/a/b.txt', destinationPath: '/c/b.txt' });
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
      expect(client.downloadUrl(tricky)).toBe('/api/files/download?path=' + encodeURIComponent(tricky));
    });

    it('respects a custom baseUrl', () => {
      const client = new ApiClient('/api/v2/files');
      expect(client.downloadUrl('x')).toBe('/api/v2/files/download?path=x');
    });
  });

  describe('shared response types', () => {
    it('FileEntry shape matches the DTO contract', () => {
      const entry: FileEntry = {
        name: 'file.txt',
        path: '/root/file.txt',
        isDirectory: false,
        size: 123,
        lastModified: '2024-01-01T00:00:00Z',
      };
      expect(entry.name).toBe('file.txt');
      expect(entry.isDirectory).toBe(false);
    });

    it('BrowseResult shape matches the DTO contract including nullable parent', () => {
      const result: BrowseResult = {
        path: '/root',
        parent: null,
        entries: [],
        folderCount: 0,
        fileCount: 0,
        totalSize: 0,
      };
      expect(result.parent).toBeNull();
      expect(Array.isArray(result.entries)).toBe(true);
    });

    it('SearchResult shape matches the DTO contract', () => {
      const result: SearchResult = {
        query: 'foo',
        path: '/root',
        results: [
          { name: 'foo.txt', path: '/root/foo.txt', isDirectory: false, size: 1, lastModified: '2024-01-01T00:00:00Z' },
        ],
      };
      expect(result.results).toHaveLength(1);
    });
  });
});
