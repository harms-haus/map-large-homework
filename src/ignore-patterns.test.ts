// @vitest-environment node
/**
 * Tests for the ignore patterns in `.prettierignore` and `.oxlintrc.json`.
 *
 * The build emits to `wwwroot/dist/` (see `tsconfig.json` `outDir` and
 * `scripts/copy-assets.mjs`). There is no root-level `dist/` directory and none
 * is ever created, so an ignore entry for bare `dist/` is DEAD — it ignores
 * nothing. Both files point at the real output, `wwwroot/dist/`.
 *
 * (`wwwroot/` is already ignored in both files, so `wwwroot/dist/` is already
 * transitively covered; the explicit `wwwroot/dist/` entry exists so removing
 * the dead `dist/` leaves no ambiguity about intent.)
 *
 * Pinned to the `node` environment: these read config files from disk and assert
 * on their contents (the same approach `src/app.css.test.ts` and
 * `src/readme.test.ts` use for static files).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const PRETTIERIGNORE = readFileSync(resolve(ROOT, '.prettierignore'), 'utf8');

interface OxlintConfig {
  $schema?: string;
  ignorePatterns: string[];
  categories?: Record<string, string>;
  rules?: Record<string, string>;
}
const OXLINTRC = JSON.parse(readFileSync(resolve(ROOT, '.oxlintrc.json'), 'utf8')) as OxlintConfig;

/** Escape a literal string for embedding in a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when `text` contains a line whose entire content is exactly `line`. */
function hasLine(text: string, line: string): boolean {
  return new RegExp(`^${escapeRegex(line)}$`, 'm').test(text);
}

/* ===========================================================================
 * .prettierignore — target the real build output, drop the dead `dist/`.
 * ========================================================================= */
describe('.prettierignore — ignores the real build output wwwroot/dist/', () => {
  it('contains a `wwwroot/dist/` line', () => {
    expect(hasLine(PRETTIERIGNORE, 'wwwroot/dist/')).toBe(true);
  });

  it('does NOT contain the dead root-level `dist/` line', () => {
    // Anchored to a whole line: `^dist/$` matches a bare `dist/` line but NOT
    // `wwwroot/dist/`.
    expect(hasLine(PRETTIERIGNORE, 'dist/')).toBe(false);
  });
});

describe('.prettierignore — preserves every other ignore entry', () => {
  // Characterization: the `dist/` -> `wwwroot/dist/` change must not drop any
  // sibling entry.
  const kept = [
    'node_modules/',
    '.engin/',
    'wwwroot/',
    'bin/',
    'obj/',
    'coverage/',
    'SampleFiles/',
    'package-lock.json',
    '*.sln',
    '*.csproj',
    '*.cs',
  ];
  for (const pat of kept) {
    it(`still ignores ${pat}`, () => {
      expect(hasLine(PRETTIERIGNORE, pat), `.prettierignore must keep the ${pat} line`).toBe(true);
    });
  }
});

/* ===========================================================================
 * .oxlintrc.json — target the real build output, drop the dead `dist/`.
 * ========================================================================= */
describe('.oxlintrc.json — is valid JSON with an ignorePatterns array', () => {
  it('ignorePatterns is a non-empty array of strings', () => {
    expect(Array.isArray(OXLINTRC.ignorePatterns)).toBe(true);
    expect(OXLINTRC.ignorePatterns.length).toBeGreaterThan(0);
    expect(OXLINTRC.ignorePatterns.every((p) => typeof p === 'string')).toBe(true);
  });

  it('keeps the correctness category as error (config otherwise intact)', () => {
    expect(OXLINTRC.categories?.correctness).toBe('error');
  });
});

describe('.oxlintrc.json — ignorePatterns targets the real build output', () => {
  it('includes the "wwwroot/dist/" entry', () => {
    expect(OXLINTRC.ignorePatterns).toContain('wwwroot/dist/');
  });

  it('does NOT include the dead root-level "dist/" entry', () => {
    // Exact array-element check: 'wwwroot/dist/' is not equal to 'dist/'.
    expect(OXLINTRC.ignorePatterns).not.toContain('dist/');
  });
});

describe('.oxlintrc.json — preserves every other ignorePattern', () => {
  const kept = [
    'node_modules/',
    '.engin/',
    'wwwroot/',
    'bin/',
    'obj/',
    'SampleFiles/',
    'coverage/',
    'package-lock.json',
  ];
  for (const pat of kept) {
    it(`still ignores ${pat}`, () => {
      expect(
        OXLINTRC.ignorePatterns.includes(pat),
        `.oxlintrc.json must keep the "${pat}" ignorePattern`,
      ).toBe(true);
    });
  }
});
