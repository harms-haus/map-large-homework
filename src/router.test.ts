// @vitest-environment node

/**
 * Pure-function tests for the router's parsers and serializers.
 *
 * This file is pinned to the `node` environment (see the docblock above) on
 * purpose: the spec requires the pure helpers to be "unit-testable without a
 * DOM". Running them here — with no `window`, `document`, or happy-dom shim
 * available — guarantees that `parseHash`, `toBrowseHash`, and `toSearchHash`
 * (and therefore their importing module at load time) introduce no DOM
 * dependency. The DOM-bound helpers are covered separately in
 * `router.dom.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { parseHash, toBrowseHash, toSearchHash, type Route, type View } from './router';

const DEFAULT_ROUTE: Route = { view: 'browse', path: '', query: '' };

describe('parseHash', () => {
  describe('browse routes', () => {
    it('parses #/browse with no segments to an empty path', () => {
      expect(parseHash('#/browse')).toEqual(DEFAULT_ROUTE);
    });

    it('parses #/browse/ (trailing slash, no segments) to an empty path', () => {
      expect(parseHash('#/browse/')).toEqual(DEFAULT_ROUTE);
    });

    it('parses a single segment', () => {
      expect(parseHash('#/browse/docs')).toEqual({ view: 'browse', path: 'docs', query: '' });
    });

    it('joins multiple segments with /', () => {
      expect(parseHash('#/browse/docs/2024/reports')).toEqual({
        view: 'browse',
        path: 'docs/2024/reports',
        query: '',
      });
    });

    it('URL-decodes percent-encoded characters', () => {
      expect(parseHash('#/browse/hello%20world')).toEqual({
        view: 'browse',
        path: 'hello world',
        query: '',
      });
    });

    it('decodes each segment independently', () => {
      expect(parseHash('#/browse/a%20b/c%20d')).toEqual({
        view: 'browse',
        path: 'a b/c d',
        query: '',
      });
    });

    it('decodes an encoded slash (%2F) within a segment', () => {
      expect(parseHash('#/browse/sub%2Ffolder')).toEqual({
        view: 'browse',
        path: 'sub/folder',
        query: '',
      });
    });

    it('preserves a trailing slash in the decoded path', () => {
      expect(parseHash('#/browse/docs/')).toEqual({ view: 'browse', path: 'docs/', query: '' });
    });

    it('decodes multi-byte (unicode) percent sequences', () => {
      // 'café' encoded as UTF-8
      expect(parseHash('#/browse/caf%C3%A9')).toEqual({
        view: 'browse',
        path: 'café',
        query: '',
      });
    });
  });

  describe('search routes', () => {
    it('parses both query and path params', () => {
      expect(parseHash('#/search?q=hello&path=docs')).toEqual({
        view: 'search',
        query: 'hello',
        path: 'docs',
      });
    });

    it('defaults path to an empty string when absent', () => {
      expect(parseHash('#/search?q=hello')).toEqual({
        view: 'search',
        query: 'hello',
        path: '',
      });
    });

    it('defaults query to an empty string when absent', () => {
      expect(parseHash('#/search?path=docs')).toEqual({
        view: 'search',
        query: '',
        path: 'docs',
      });
    });

    it('treats #/search with no query string as an empty search', () => {
      expect(parseHash('#/search')).toEqual({ view: 'search', query: '', path: '' });
    });

    it('treats #/search? (bare question mark) as an empty search', () => {
      expect(parseHash('#/search?')).toEqual({ view: 'search', query: '', path: '' });
    });

    it('treats an explicitly empty q= as an empty query', () => {
      expect(parseHash('#/search?q=')).toEqual({ view: 'search', query: '', path: '' });
    });

    it('treats an explicitly empty path= as an empty path', () => {
      expect(parseHash('#/search?q=hi&path=')).toEqual({
        view: 'search',
        query: 'hi',
        path: '',
      });
    });

    it('URL-decodes encoded query and path values', () => {
      expect(parseHash('#/search?q=hello%20world&path=my%20docs')).toEqual({
        view: 'search',
        query: 'hello world',
        path: 'my docs',
      });
    });

    it('decodes a "+" in the query as a space (URLSearchParams behavior)', () => {
      expect(parseHash('#/search?q=hello+world&path=x')).toEqual({
        view: 'search',
        query: 'hello world',
        path: 'x',
      });
    });

    it('keeps an unencoded slash in path= intact', () => {
      expect(parseHash('#/search?q=a&path=docs/2024')).toEqual({
        view: 'search',
        query: 'a',
        path: 'docs/2024',
      });
    });

    it('returns the first value when a param is repeated', () => {
      // URLSearchParams.get() yields the first occurrence.
      expect(parseHash('#/search?q=a&q=b&path=c')).toEqual({
        view: 'search',
        query: 'a',
        path: 'c',
      });
    });

    it('decodes multi-byte (unicode) values', () => {
      expect(parseHash('#/search?q=caf%C3%A9&path=%C3%B1')).toEqual({
        view: 'search',
        query: 'café',
        path: 'ñ',
      });
    });
  });

  describe('fallback for unrecognized hashes', () => {
    it.each<[string, string]>([
      ['an empty string', ''],
      ['a lone hash', '#'],
      ['a hash-slash only', '#/'],
      ['an unknown view', '#/home'],
      ['a string with no leading hash', 'garbage'],
      ['browse missing the leading slash (#browse)', '#browse'],
      ['a completely unrelated fragment', '#section-1'],
    ])('returns the default browse route for %s', (_label, hash) => {
      expect(parseHash(hash)).toEqual(DEFAULT_ROUTE);
    });
  });

  describe('returned shape', () => {
    it('always returns an object with exactly view, path, and query', () => {
      const route = parseHash('#/browse/a');
      expect(route).toHaveProperty('view');
      expect(route).toHaveProperty('path');
      expect(route).toHaveProperty('query');
      expect(Object.keys(route).sort()).toEqual(['path', 'query', 'view']);
    });

    it('produces view values assignable to the View union', () => {
      const browseView: View = parseHash('#/browse').view;
      const searchView: View = parseHash('#/search?q=a').view;
      expect([browseView, searchView]).toEqual(['browse', 'search']);
    });
  });
});

describe('toBrowseHash', () => {
  it('returns #/browse for an empty path', () => {
    expect(toBrowseHash('')).toBe('#/browse');
  });

  it('returns #/browse/<segment> for a single segment', () => {
    expect(toBrowseHash('docs')).toBe('#/browse/docs');
  });

  it('joins multiple segments with /', () => {
    expect(toBrowseHash('docs/2024/reports')).toBe('#/browse/docs/2024/reports');
  });

  it('percent-encodes spaces within a segment', () => {
    expect(toBrowseHash('hello world')).toBe('#/browse/hello%20world');
  });

  it('encodes each segment independently (spaces do not leak across segments)', () => {
    expect(toBrowseHash('a b/c d')).toBe('#/browse/a%20b/c%20d');
  });

  it('encodes reserved characters such as ? and #', () => {
    expect(toBrowseHash('a?b#c')).toBe('#/browse/a%3Fb%23c');
  });

  it('encodes a literal percent sign', () => {
    expect(toBrowseHash('100%')).toBe('#/browse/100%25');
  });

  it('preserves a trailing slash as an empty trailing segment', () => {
    expect(toBrowseHash('docs/')).toBe('#/browse/docs/');
  });

  it('encodes multi-byte (unicode) characters as UTF-8 percent sequences', () => {
    expect(toBrowseHash('café')).toBe('#/browse/caf%C3%A9');
  });
});

describe('toSearchHash', () => {
  it('builds a search hash from query and path', () => {
    expect(toSearchHash('hello', 'docs')).toBe('#/search?q=hello&path=docs');
  });

  it('handles empty query and path', () => {
    expect(toSearchHash('', '')).toBe('#/search?q=&path=');
  });

  it('percent-encodes spaces in both query and path', () => {
    expect(toSearchHash('hello world', 'my docs')).toBe('#/search?q=hello%20world&path=my%20docs');
  });

  it('encodes characters that would otherwise break the query string (& and =)', () => {
    expect(toSearchHash('a&b', 'c=d')).toBe('#/search?q=a%26b&path=c%3Dd');
  });

  it('encodes a literal percent sign', () => {
    expect(toSearchHash('100% off', 'x')).toBe('#/search?q=100%25%20off&path=x');
  });

  it('encodes a slash in the path so it survives a single path= param', () => {
    expect(toSearchHash('a', 'b/c')).toBe('#/search?q=a&path=b%2Fc');
  });

  it('encodes multi-byte (unicode) characters as UTF-8 percent sequences', () => {
    expect(toSearchHash('café', 'ñ')).toBe('#/search?q=caf%C3%A9&path=%C3%B1');
  });
});

/**
 * Round-trip property tests. These do not couple to a particular encoding
 * scheme: they assert the spec-level invariant that serializing a value and
 * parsing it back is lossless. They serve as a behavioral safety net on top of
 * the exact-format assertions above.
 */
describe('round-trip serialization (serialize -> parse is lossless)', () => {
  it.each([
    ['empty path', ''],
    ['single segment', 'docs'],
    ['multiple segments', 'docs/2024/reports'],
    ['spaces within segments', 'a b/c d'],
    ['reserved characters', 'a?b#c'],
    ['literal percent', '100%'],
    ['trailing slash', 'docs/'],
    ['unicode', 'café'],
  ])('round-trips browse path: %s', (_label, path) => {
    expect(parseHash(toBrowseHash(path))).toEqual({ view: 'browse', path, query: '' });
  });

  it.each<[string, string, string]>([
    ['empty query and path', '', ''],
    ['query only', 'hello', ''],
    ['path only', '', 'docs'],
    ['both values', 'hello world', 'my docs'],
    ['query-string-breaking chars', 'a&b', 'c=d'],
    ['plus character', 'a+b', 'c'],
    ['percent character', '100% off', 'a/b'],
    ['unicode', 'café', 'ñ'],
  ])('round-trips search route: %s', (_label, query, path) => {
    expect(parseHash(toSearchHash(query, path))).toEqual({ view: 'search', query, path });
  });
});
