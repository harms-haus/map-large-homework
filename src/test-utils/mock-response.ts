/**
 * Builds a minimal fetch `Response` stand-in for the mocked global `fetch`.
 *
 * `text()` returns the raw text (defaults to the JSON-stringified body).
 * `json()` returns the parsed body when one is provided; otherwise it falls
 * back to parsing `text` as JSON (when only `text` was given), and finally to
 * an empty object. `ok` is derived from `status` (true for any 2xx) unless an
 * explicit `ok` is supplied, in which case it wins.
 *
 * This is the UNION of the two previously-inline helpers that lived in
 * `src/api.test.ts` and `src/app.test.ts`. They were identical except in the
 * `json()` fallback for the text-only case: the `app` copy returned `{}`,
 * whereas the `api` copy parsed the text as JSON. Parsing is the more
 * permissive behavior (a strict superset) and is preserved here so every
 * existing call site keeps working. (No call site actually relies on this
 * branch: on the error path `ApiClient.request` only reads `.text()`, and on
 * the success path a `body` is always supplied.) The behavior is pinned by the
 * `mockResponse helper` characterization suite in `src/api.test.ts`.
 *
 * Test-only utility: deliberately kept out of the production `tsc` build via
 * the `src/test-utils/**` glob in `tsconfig.json`'s `exclude` array, so it is
 * never shipped to `wwwroot/dist`. Only test files import it.
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
