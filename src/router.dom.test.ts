/**
 * DOM-bound router helper tests.
 *
 * These run in the project-default `happy-dom` environment (see
 * vitest.config.ts) because they exercise `window`, `window.location`, and the
 * `hashchange` event. The pure parsers/serializers are covered separately in
 * `router.test.ts` (pinned to the `node` environment).
 *
 * Independence: every test starts from a clean `window.location.hash` and any
 * listener registered during a test is guaranteed to be removed before the next
 * test runs, even if an assertion throws.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getCurrentRoute, subscribe, navigate } from './router';

describe('getCurrentRoute', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('returns the default browse route when the hash is empty', () => {
    expect(getCurrentRoute()).toEqual({ view: 'browse', path: '', query: '' });
  });

  it('reflects the current browse hash from window.location', () => {
    window.location.hash = '#/browse/docs/2024';
    expect(getCurrentRoute()).toEqual({ view: 'browse', path: 'docs/2024', query: '' });
  });

  it('reflects the current search hash from window.location', () => {
    window.location.hash = '#/search?q=term&path=folder';
    expect(getCurrentRoute()).toEqual({ view: 'search', query: 'term', path: 'folder' });
  });
});

describe('navigate', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  it('sets window.location.hash to the provided value', () => {
    navigate('#/browse/docs');
    expect(window.location.hash).toBe('#/browse/docs');
  });

  it('updates the location so getCurrentRoute reflects the new route', () => {
    navigate('#/search?q=hi&path=x');
    expect(getCurrentRoute()).toEqual({ view: 'search', query: 'hi', path: 'x' });
  });
});

describe('subscribe', () => {
  // Collect unsubscribe functions so listeners can never leak between tests,
  // even if a test fails mid-way through its assertions.
  const teardowns: Array<() => void> = [];

  beforeEach(() => {
    window.location.hash = '';
  });

  afterEach(() => {
    let teardown: (() => void) | undefined;
    while ((teardown = teardowns.pop()) !== undefined) {
      teardown();
    }
    window.location.hash = '';
  });

  it('invokes the callback when a hashchange event is dispatched', () => {
    const cb = vi.fn();
    teardowns.push(subscribe(cb));

    window.dispatchEvent(new Event('hashchange'));

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('does not invoke the callback before any hashchange occurs', () => {
    const cb = vi.fn();
    teardowns.push(subscribe(cb));

    expect(cb).not.toHaveBeenCalled();
  });

  it('returns an unsubscribe function that stops further callbacks', () => {
    const cb = vi.fn();
    const unsubscribe = subscribe(cb);
    // Also register it for safety; calling it twice is harmless.
    teardowns.push(unsubscribe);

    window.dispatchEvent(new Event('hashchange'));
    expect(cb).toHaveBeenCalledTimes(1);

    unsubscribe();

    window.dispatchEvent(new Event('hashchange'));
    window.dispatchEvent(new Event('hashchange'));
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('keeps multiple independent subscriptions isolated', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = subscribe(first);
    teardowns.push(unsubscribeFirst);
    teardowns.push(subscribe(second));

    window.dispatchEvent(new Event('hashchange'));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unsubscribeFirst();

    window.dispatchEvent(new Event('hashchange'));
    expect(first).toHaveBeenCalledTimes(1); // unchanged after its removal
    expect(second).toHaveBeenCalledTimes(2); // still active
  });

  it('fires for successive hashchange events while subscribed', () => {
    const cb = vi.fn();
    teardowns.push(subscribe(cb));

    window.dispatchEvent(new Event('hashchange'));
    window.dispatchEvent(new Event('hashchange'));
    window.dispatchEvent(new Event('hashchange'));

    expect(cb).toHaveBeenCalledTimes(3);
  });
});
