// @vitest-environment node

/**
 * Documentation tests for the README's deep-linking section.
 *
 * task.md lists "Deep linkable URL pattern" as an explicit requirement and
 * states that "the state of the UI should be kept in the URL". The router in
 * `src/router.ts` implements this with a hash-based scheme. These tests guard
 * the *user-facing documentation* of that feature: they fail until README.md
 * documents the deep-linking behavior so a reader can discover that any folder
 * or search result is bookmarkable and shareable via URL.
 *
 * This file is pinned to the `node` environment (see the docblock above)
 * because it reads README.md from disk using `node:fs`; no DOM is required.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const readmePath = fileURLToPath(new URL('../README.md', import.meta.url));
const readme = readFileSync(readmePath, 'utf8');

/** Find the 0-based offset of a level-2 section header in the README. */
function headingOffset(text: string, title: RegExp): number {
  const match = text.match(new RegExp(`^##\\s+${title.source}`, 'mi'));
  return match === null ? -1 : match.index ?? -1;
}

/** Return the body of a level-2 section (up to the next `## ` header). */
function sectionBody(text: string, title: RegExp): string {
  const start = headingOffset(text, title);
  if (start === -1) return '';
  const rest = text.slice(start);
  const nextHeader = rest.slice(1).search(/^##\s+/m);
  return nextHeader === -1 ? rest : rest.slice(0, nextHeader + 1);
}

describe('README deep-linking documentation', () => {
  describe('section presence and placement', () => {
    it('contains a "## Deep Linking" level-2 section', () => {
      expect(headingOffset(readme, /Deep Linking/i)).not.toBe(-1);
    });

    it('places the Deep Linking section between Configuration and Running Tests', () => {
      const config = headingOffset(readme, /Configuration\b/);
      const deepLinking = headingOffset(readme, /Deep Linking/i);
      const runningTests = headingOffset(readme, /Running Tests\b/);

      // Sanity: the anchors we order against must all exist.
      expect(config).not.toBe(-1);
      expect(runningTests).not.toBe(-1);
      expect(deepLinking).not.toBe(-1);

      expect(config).toBeLessThan(deepLinking);
      expect(deepLinking).toBeLessThan(runningTests);
    });
  });

  describe('explains the concept', () => {
    const body = sectionBody(readme, /Deep Linking/i);

    it('states that the current view/location is kept in the URL hash', () => {
      // The implementation uses the URL *hash* (fragment) for routing.
      expect(body).toMatch(/\burl\b/i);
      expect(body).toMatch(/\bhash\b/i);
    });

    it('notes that a location can be bookmarked or shared', () => {
      expect(body).toMatch(/bookmark|share/i);
    });
  });

  describe('documents concrete URL examples', () => {
    const body = sectionBody(readme, /Deep Linking/i);

    it('documents the root browse URL "#/browse"', () => {
      // Literally present as a code span / fenced block.
      expect(body).toContain('#/browse');
    });

    it('documents a nested folder URL "#/browse/Documents/Reports"', () => {
      expect(body).toContain('#/browse/Documents/Reports');
    });

    it('documents a scoped search URL "#/search?q=budget&path=Documents"', () => {
      expect(body).toContain('#/search?q=budget&path=Documents');
    });

    it('documents that each path segment is percent-encoded (spaces -> %20)', () => {
      expect(body).toMatch(/percent/i);
      expect(body).toContain('%20');
    });
  });
});
