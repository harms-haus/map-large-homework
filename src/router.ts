export type View = 'browse' | 'search';

export interface Route {
  view: View;
  path: string;
  query: string;
}

const DEFAULT_ROUTE: Route = { view: 'browse', path: '', query: '' };

/**
 * Parse a full hash (including leading '#') into a Route.
 *
 * Browse format:  #/browse  or  #/browse/<segments>
 * Search format:  #/search?q=<query>&path=<path>
 * Anything else returns the default browse route.
 */
export function parseHash(hash: string): Route {
  if (hash.startsWith('#/browse')) {
    const afterPrefix = hash.slice('#/browse'.length); // everything after "#/browse"
    // Remove the leading '/' if present, then URL-decode what remains
    const path = afterPrefix.startsWith('/')
      ? decodeURIComponent(afterPrefix.slice(1))
      : decodeURIComponent(afterPrefix);
    return { view: 'browse', path, query: '' };
  }

  if (hash.startsWith('#/search')) {
    const queryString = hash.slice('#/search'.length);
    const params = new URLSearchParams(queryString);
    const query = params.get('q') ?? '';
    const path = params.get('path') ?? '';
    return { view: 'search', query, path };
  }

  return DEFAULT_ROUTE;
}

/**
 * Serialize a browse path into a browse hash.
 * Each segment is independently percent-encoded.
 */
export function toBrowseHash(path: string): string {
  if (path === '') {
    return '#/browse';
  }
  const segments = path.split('/');
  const encoded = segments.map((s) => encodeURIComponent(s)).join('/');
  return '#/browse/' + encoded;
}

/**
 * Serialize query and path values into a search hash.
 * Both values are percent-encoded.
 */
export function toSearchHash(query: string, path: string): string {
  return `#/search?q=${encodeURIComponent(query)}&path=${encodeURIComponent(path)}`;
}

/**
 * Read the current route from window.location.hash.
 */
export function getCurrentRoute(): Route {
  return parseHash(window.location.hash);
}

/**
 * Subscribe to hash-change events.
 * Returns an unsubscribe function.
 */
export function subscribe(callback: () => void): () => void {
  window.addEventListener('hashchange', callback);
  return () => {
    window.removeEventListener('hashchange', callback);
  };
}

/**
 * Navigate to a given hash (sets window.location.hash).
 */
export function navigate(hash: string): void {
  window.location.hash = hash;
}
