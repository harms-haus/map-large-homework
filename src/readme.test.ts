// @vitest-environment node
/**
 * Static-asset documentation tests for `README.md`.
 *
 * Pinned to the `node` environment (mirroring `src/index.html.test.ts`):
 * these tests only inspect the README source by reading it from disk and
 * asserting on its text/structure. They need no DOM, and pinning `node`
 * keeps them fast and side-effect-free.
 *
 * These tests guard the README against drifting from the ACTUAL UI. The search
 * area was reworked from a standalone "Search" `<button>` into an instant,
 * debounced (~200 ms) search-as-you-type input (see `src/app/search-wrapper.test.ts`
 * and `src/app/toolbar-handlers.test.ts`): Enter submits immediately, Escape
 * clears the query and returns to browse, an in-input ✕ clear button resets
 * the query, and a spinner is shown in the results area while a search fetch
 * is in flight. The README must (1) update its end-to-end checklist item 13 to
 * match, and (2) document the search UX in a dedicated `## Search` section.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const README_PATH = resolve(__dirname, '../README.md');
const README = readFileSync(README_PATH, 'utf8');

/* ===========================================================================
 * Helpers
 * ========================================================================= */

/**
 * Assert every substring in `substrings` is present in `text`, reporting ALL
 * missing ones in a single failure message (so a docs drift surfaces every gap
 * at once instead of one-at-a-time).
 */
function expectAllPresent(label: string, text: string, substrings: string[]): void {
  const missing = substrings.filter((s) => !text.includes(s));
  expect(
    missing,
    `${label}: expected all of ${JSON.stringify(substrings)} but was missing ${JSON.stringify(missing)}`,
  ).toEqual([]);
}

/**
 * Assert NONE of `substrings` are present in `text`, reporting every offender.
 */
function expectNonePresent(label: string, text: string, substrings: string[]): void {
  const present = substrings.filter((s) => text.includes(s));
  expect(
    present,
    `${label}: expected none of ${JSON.stringify(substrings)} but found ${JSON.stringify(present)}`,
  ).toEqual([]);
}

interface Section {
  /** Heading text without the leading `##` (trimmed). */
  title: string;
  /** The full heading line, e.g. `## Search`. */
  headingLine: string;
  /** Body text between this heading and the next level-2 heading (or EOF). */
  body: string;
  /** Character offset of the heading line within the document. */
  start: number;
}

/**
 * Parse the document into an ordered list of level-2 (`##`) sections.
 *
 * `##(?!#)` ensures only EXACTLY-two-`#` headings match (so a stray `###
 * Search` or `# Search` would NOT be picked up — guarding the new section's
 * heading level). Sections are returned in document order, so callers can
 * assert on section ordering.
 */
function parseH2Sections(md: string): Section[] {
  const headingRe = /^##(?!#)[ \t]+(.+?)\r?\n/gm;
  const headers: { title: string; start: number; lineEnd: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = headingRe.exec(md)) !== null) {
    headers.push({
      title: m[1].trim(),
      start: m.index,
      lineEnd: m.index + m[0].length,
    });
  }

  const sections: Section[] = [];
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const bodyEnd = i + 1 < headers.length ? headers[i + 1].start : md.length;
    sections.push({
      title: h.title,
      headingLine: md.slice(h.start, h.lineEnd).trimEnd(),
      body: md.slice(h.lineEnd, bodyEnd),
      start: h.start,
    });
  }
  return sections;
}

/** Find the single level-2 section with the exact `title` (undefined if absent). */
function findSection(md: string, title: string): Section | undefined {
  return parseH2Sections(md).find((s) => s.title === title);
}

/**
 * Extract the text of a numbered verification-checklist item (`N.` at the
 * start of a line), without the leading `N.` marker. Returns undefined if no
 * such item exists.
 */
function getChecklistItem(md: string, n: number): string | undefined {
  const re = new RegExp(`^${n}\\.\\s+(.+)$`, 'm');
  const m = md.match(re);
  return m ? m[1] : undefined;
}

/* ===========================================================================
 * Checklist item 13 — must reflect the current search UX, not the removed
 * "Search button"
 * ========================================================================= */
describe('README.md — Final End-to-End Verification Checklist, item 13 (Search)', () => {
  it('has a numbered item 13', () => {
    expect(getChecklistItem(README, 13), 'a checklist item "13." must exist').toBeDefined();
  });

  it('no longer references the removed standalone "Search button"', () => {
    // The old line was: "Search — Search input and button filter entries
    // recursively by name." The "and button" phrasing refers to the removed
    // button and must be gone. (The new text legitimately mentions a "clear
    // button", so we assert against the old "input and button" phrase rather
    // than the bare word "button".)
    const item = getChecklistItem(README, 13) ?? '';
    expectNonePresent('checklist item 13', item, ['Search input and button', 'and button filter']);
  });

  it('documents the instant, debounced search-as-you-type behavior', () => {
    const item = getChecklistItem(README, 13) ?? '';
    expectAllPresent('checklist item 13', item, [
      'instant',
      'debounced',
      '200 ms',
      'search-as-you-type',
    ]);
  });

  it('documents Enter (submit immediately)', () => {
    const item = getChecklistItem(README, 13) ?? '';
    expectAllPresent('checklist item 13', item, ['Enter', 'immediately']);
  });

  it('documents Escape (clears the query and returns to browse)', () => {
    const item = getChecklistItem(README, 13) ?? '';
    expectAllPresent('checklist item 13', item, ['Escape clears the query and returns to browse']);
  });

  it('documents the in-input ✕ clear button', () => {
    const item = getChecklistItem(README, 13) ?? '';
    expectAllPresent('checklist item 13', item, ['✕', 'clear button']);
  });

  it('documents the spinner shown while a search fetch is in flight', () => {
    const item = getChecklistItem(README, 13) ?? '';
    expectAllPresent('checklist item 13', item, ['spinner', 'while a search fetch is in flight']);
  });
});

/* ===========================================================================
 * A dedicated `## Search` section must document the search UX
 * ========================================================================= */
describe('README.md — `## Search` section exists and documents the UX', () => {
  it('has exactly one level-2 section titled "Search"', () => {
    const searchSections = parseH2Sections(README).filter((s) => s.title === 'Search');
    expect(
      searchSections,
      'there must be exactly one `## Search` section (heading level must be exactly two `#`)',
    ).toHaveLength(1);
  });

  it('uses exactly two `#` for the heading (not `#` or `###`)', () => {
    const section = findSection(README, 'Search');
    expect(section, '`## Search` section must exist').toBeDefined();
    expect(section!.headingLine).toBe('## Search');
  });

  it('documents that search is instant and debounced (~200 ms), with no separate Search button', () => {
    const body = findSection(README, 'Search')?.body ?? '';
    expectAllPresent('`## Search` body', body, [
      'instant',
      'debounced',
      '200 ms',
      'no separate Search button',
    ]);
  });

  it('documents Enter submits the current query immediately', () => {
    const body = findSection(README, 'Search')?.body ?? '';
    expectAllPresent('`## Search` body', body, ['Enter', 'immediately']);
  });

  it('documents Escape clears the query and returns to browse', () => {
    const body = findSection(README, 'Search')?.body ?? '';
    expectAllPresent('`## Search` body', body, ['Escape clears the query and returns to browse']);
  });

  it('documents the in-input ✕ clear button that resets the query', () => {
    const body = findSection(README, 'Search')?.body ?? '';
    expectAllPresent('`## Search` body', body, ['✕', 'clear']);
  });

  it('documents the spinner shown while a search request is in flight', () => {
    const body = findSection(README, 'Search')?.body ?? '';
    expectAllPresent('`## Search` body', body, ['spinner']);
  });
});

/* ===========================================================================
 * Section ordering — `## Search` sits between "Symlinks and junctions" and
 * "Deep Linking", preserving the existing document order
 * ========================================================================= */
describe('README.md — `## Search` section ordering', () => {
  it('is placed immediately after "Symlinks and junctions"', () => {
    const titles = parseH2Sections(README).map((s) => s.title);
    const symlinksIdx = titles.indexOf('Symlinks and junctions');
    const searchIdx = titles.indexOf('Search');
    expect(symlinksIdx, '## Symlinks and junctions must exist').toBeGreaterThanOrEqual(0);
    expect(searchIdx, '## Search must exist').toBeGreaterThan(symlinksIdx);
    // "Search" must be the VERY NEXT section after "Symlinks and junctions".
    expect(titles[symlinksIdx + 1]).toBe('Search');
  });

  it('is placed immediately before "Deep Linking"', () => {
    const titles = parseH2Sections(README).map((s) => s.title);
    const searchIdx = titles.indexOf('Search');
    const deepLinkingIdx = titles.indexOf('Deep Linking');
    expect(searchIdx, '## Search must exist').toBeGreaterThanOrEqual(0);
    expect(deepLinkingIdx, '## Deep Linking must exist').toBeGreaterThan(searchIdx);
    // "Deep Linking" must be the VERY NEXT section after "Search".
    expect(titles[searchIdx + 1]).toBe('Deep Linking');
  });

  it('keeps the overall order: Symlinks and junctions → Search → Deep Linking', () => {
    const sections = parseH2Sections(README);
    const symlinks = sections.find((s) => s.title === 'Symlinks and junctions');
    const search = sections.find((s) => s.title === 'Search');
    const deepLinking = sections.find((s) => s.title === 'Deep Linking');
    expect(symlinks && search && deepLinking, 'all three sections must exist').toBeTruthy();
    expect(symlinks!.start).toBeLessThan(search!.start);
    expect(search!.start).toBeLessThan(deepLinking!.start);
  });
});
