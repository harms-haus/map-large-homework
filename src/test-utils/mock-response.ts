/**
 * Minimal fetch `Response` stand-in for the mocked global `fetch`.
 *
 * `text()` returns the raw text (defaults to the JSON-stringified body).
 * `json()` returns the parsed `body` when supplied, otherwise parses `text` as
 * JSON, finally falling back to `{}`. `ok` is derived from `status` (true for
 * any 2xx) unless given explicitly.
 *
 * Test-only: excluded from the production build via the `src/test-utils/**`
 * glob in `tsconfig.json`'s `exclude`, so it never ships to `wwwroot/dist`.
 */
export interface MockResponseOptions {
  ok?: boolean;
  status?: number;
  body?: unknown;
  text?: string;
}

export function mockResponse(opts: MockResponseOptions): Response {
  const status = opts.status ?? 200;
  const ok = opts.ok ?? (status >= 200 && status < 300);
  const text = opts.text ?? JSON.stringify(opts.body ?? {});
  return {
    ok,
    status,
    text: async () => text,
    json: async () => opts.body ?? (opts.text ? JSON.parse(opts.text) : {}),
  } as unknown as Response;
}
