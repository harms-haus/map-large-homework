import { describe, it, expect } from 'vitest';
import * as formatModule from './format';
import {
    formatBytes,
    normalizeRelativePath,
    joinPath,
    parentPath,
    basename,
    formatDate,
} from './format';

/* ===========================================================================
 * Module surface
 *
 * The spec requires that `src/format.ts` exports ONLY these six functions and
 * nothing else. This guard test pins that contract so a stray export does not
 * sneak in.
 * ========================================================================= */
describe('format module surface', () => {
    it('exports exactly the six documented functions', () => {
        expect(Object.keys(formatModule).sort()).toEqual(
            ['basename', 'formatBytes', 'formatDate', 'joinPath', 'normalizeRelativePath', 'parentPath'],
        );
    });
});

/* ===========================================================================
 * formatBytes
 *
 * Binary (1024-based) units: B, KB, MB, GB, TB.
 *  - bytes < 1024 render as an integer byte count (e.g. "1023 B").
 *  - bytes >= 1024 render with exactly one decimal place (e.g. "1.5 KB").
 * ========================================================================= */
describe('formatBytes', () => {
    it('formats zero bytes', () => {
        expect(formatBytes(0)).toBe('0 B');
    });

    it('formats a single byte', () => {
        expect(formatBytes(1)).toBe('1 B');
    });

    it('renders values under 1024 as an integer byte count with no decimals', () => {
        expect(formatBytes(1023)).toBe('1023 B');
        expect(formatBytes(512)).toBe('512 B');
    });

    it('renders exactly one kilobyte keeping the ".0" decimal', () => {
        // Spec: 1 decimal when >= 1024, so the trailing .0 is preserved.
        expect(formatBytes(1024)).toBe('1.0 KB');
    });

    it('formats 1536 bytes as 1.5 KB (the documented example)', () => {
        expect(formatBytes(1536)).toBe('1.5 KB');
    });

    it('rounds to one decimal place (2000 -> 2.0 KB)', () => {
        // 2000 / 1024 = 1.953125 -> one decimal rounds up to 2.0
        expect(formatBytes(2000)).toBe('2.0 KB');
    });

    it('formats exactly one megabyte keeping the ".0" decimal (documented example)', () => {
        expect(formatBytes(1048576)).toBe('1.0 MB');
    });

    it('formats 1.5 megabytes', () => {
        expect(formatBytes(1572864)).toBe('1.5 MB'); // 1.5 * 1024 * 1024
    });

    it('formats exactly one gigabyte', () => {
        expect(formatBytes(1073741824)).toBe('1.0 GB'); // 1024 ** 3
    });

    it('formats exactly one terabyte', () => {
        expect(formatBytes(1099511627776)).toBe('1.0 TB'); // 1024 ** 4
    });

    it('does not exceed the TB unit for very large values', () => {
        // 1024 ** 5 would be PB, but the documented unit set stops at TB.
        expect(formatBytes(1099511627776 * 2)).toBe('2.0 TB');
    });
});

/* ===========================================================================
 * normalizeRelativePath
 *
 *  - replace backslashes with '/'
 *  - trim leading/trailing '/'
 *  - collapse repeated '/'
 *  - drop '.' segments and '..' segments (filtered out, NOT resolved)
 *  - return '' for root/empty
 * ========================================================================= */
describe('normalizeRelativePath', () => {
    it('returns empty string for empty input', () => {
        expect(normalizeRelativePath('')).toBe('');
    });

    it('returns empty string for root', () => {
        expect(normalizeRelativePath('/')).toBe('');
    });

    it('returns empty string for a lone backslash (windows root)', () => {
        expect(normalizeRelativePath('\\')).toBe('');
    });

    it('returns empty string for an all-root input', () => {
        expect(normalizeRelativePath('///')).toBe('');
    });

    it('keeps a single clean segment unchanged', () => {
        expect(normalizeRelativePath('foo')).toBe('foo');
    });

    it('keeps multiple clean segments unchanged', () => {
        expect(normalizeRelativePath('foo/bar/baz')).toBe('foo/bar/baz');
    });

    it('trims a leading slash', () => {
        expect(normalizeRelativePath('/foo')).toBe('foo');
    });

    it('trims a trailing slash', () => {
        expect(normalizeRelativePath('foo/')).toBe('foo');
    });

    it('trims both leading and trailing slashes', () => {
        expect(normalizeRelativePath('/foo/bar/')).toBe('foo/bar');
    });

    it('collapses repeated slashes', () => {
        expect(normalizeRelativePath('foo//bar')).toBe('foo/bar');
        expect(normalizeRelativePath('//foo//bar//')).toBe('foo/bar');
    });

    it('replaces backslashes with forward slashes', () => {
        expect(normalizeRelativePath('foo\\bar')).toBe('foo/bar');
        expect(normalizeRelativePath('foo\\bar\\baz')).toBe('foo/bar/baz');
    });

    it('drops a single "." segment', () => {
        expect(normalizeRelativePath('foo/./bar')).toBe('foo/bar');
    });

    it('drops a trailing "." segment', () => {
        expect(normalizeRelativePath('foo/bar/.')).toBe('foo/bar');
    });

    it('drops a leading "." segment', () => {
        expect(normalizeRelativePath('./foo')).toBe('foo');
    });

    it('returns empty string for a lone "." or ".."', () => {
        expect(normalizeRelativePath('.')).toBe('');
        expect(normalizeRelativePath('..')).toBe('');
    });

    it('drops ".." segments rather than resolving them against the parent', () => {
        // Spec wording: "drop '.' segments and '..' segments". A ".." token is
        // filtered out of the segment list; it does NOT pop the previous segment.
        expect(normalizeRelativePath('foo/../bar')).toBe('foo/bar');
        expect(normalizeRelativePath('../foo')).toBe('foo');
    });

    it('drops mixed "." and ".." segments together with repeated slashes', () => {
        expect(normalizeRelativePath('a/../..//b')).toBe('a/b');
    });

    it('returns empty string when every segment is dropped', () => {
        expect(normalizeRelativePath('/./../')).toBe('');
    });

    it('drops multi-level "../../.." sequences entirely (still no resolution)', () => {
        // Reviewer suggestion: multi-level dotdots. Per the "drop" semantics all
        // of these are filtered out, leaving nothing.
        expect(normalizeRelativePath('../../..')).toBe('');
        expect(normalizeRelativePath('../../../')).toBe('');
    });

    it('drops interleaved multi-level dotdots while keeping real segments', () => {
        // segments: [a, .., .., b, ..] -> filter dots -> [a, b]
        expect(normalizeRelativePath('a/../../b/..')).toBe('a/b');
    });
});

/* ===========================================================================
 * joinPath
 *
 * join with a single '/' then run the result through normalizeRelativePath.
 * ========================================================================= */
describe('joinPath', () => {
    it('joins two simple segments', () => {
        expect(joinPath('foo', 'bar')).toBe('foo/bar');
    });

    it('normalizes a trailing slash on the base', () => {
        expect(joinPath('foo/', 'bar')).toBe('foo/bar');
    });

    it('normalizes a leading slash on the name', () => {
        expect(joinPath('foo', '/bar')).toBe('foo/bar');
    });

    it('normalizes slashes on both sides', () => {
        expect(joinPath('foo/', '/bar')).toBe('foo/bar');
    });

    it('returns just the name when the base is empty', () => {
        expect(joinPath('', 'bar')).toBe('bar');
    });

    it('returns just the base when the name is empty', () => {
        // base + '/' + '' -> 'foo/' -> normalize -> 'foo'
        expect(joinPath('foo', '')).toBe('foo');
    });

    it('returns empty string when both parts are empty', () => {
        expect(joinPath('', '')).toBe('');
    });

    it('joins multi-segment paths', () => {
        expect(joinPath('a/b', 'c/d')).toBe('a/b/c/d');
    });

    it('normalizes backslashes in the joined result', () => {
        expect(joinPath('foo\\', 'bar')).toBe('foo/bar');
    });
});

/* ===========================================================================
 * parentPath
 *
 * Normalized parent relative path; '' when already at root.
 * ========================================================================= */
describe('parentPath', () => {
    it('returns empty string for an already-root path', () => {
        expect(parentPath('')).toBe('');
    });

    it('returns empty string for a single-segment path', () => {
        expect(parentPath('foo')).toBe('');
    });

    it('returns the parent of a two-segment path', () => {
        expect(parentPath('foo/bar')).toBe('foo');
    });

    it('returns the parent of a deeper path', () => {
        expect(parentPath('a/b/c')).toBe('a/b');
    });

    it('normalizes before computing the parent', () => {
        expect(parentPath('/foo/bar/')).toBe('foo');
    });

    it('normalizes "." segments before computing the parent', () => {
        expect(parentPath('a/./b')).toBe('a');
    });

    it('normalizes backslashes before computing the parent', () => {
        expect(parentPath('foo\\bar\\baz')).toBe('foo/bar');
    });
});

/* ===========================================================================
 * basename
 *
 * The last segment of the normalized path.
 * ========================================================================= */
describe('basename', () => {
    it('returns empty string for an empty path', () => {
        expect(basename('')).toBe('');
    });

    it('returns the single segment of a shallow path', () => {
        expect(basename('foo')).toBe('foo');
    });

    it('returns the last segment of a multi-segment path', () => {
        expect(basename('foo/bar')).toBe('bar');
    });

    it('returns the last segment of a deeper path', () => {
        expect(basename('a/b/c')).toBe('c');
    });

    it('normalizes leading/trailing slashes before taking the last segment', () => {
        expect(basename('/foo/bar/')).toBe('bar');
    });

    it('normalizes backslashes before taking the last segment', () => {
        expect(basename('foo\\bar')).toBe('bar');
    });

    it('ignores a trailing "." segment when computing the basename', () => {
        expect(basename('foo/bar/.')).toBe('bar');
    });
});

/* ===========================================================================
 * formatDate
 *
 * Parse an ISO date string; return '' for empty/invalid; otherwise render as
 * 'yyyy-MM-dd HH:mm' (local calendar time). The offset-free ISO datetimes used
 * below are parsed as local time, so the expected output is stable regardless
 * of the host time zone for a manual local-getter formatter.
 * ========================================================================= */
describe('formatDate', () => {
    it('returns empty string for an empty input', () => {
        expect(formatDate('')).toBe('');
    });

    it('returns empty string for a non-date string', () => {
        expect(formatDate('not-a-date')).toBe('');
    });

    it('returns empty string for arbitrary garbage', () => {
        expect(formatDate('abc')).toBe('');
    });

    it('does not throw for invalid input', () => {
        expect(() => formatDate('nope')).not.toThrow();
    });

    it('formats a local datetime as yyyy-MM-dd HH:mm', () => {
        expect(formatDate('2023-06-15T09:05:00')).toBe('2023-06-15 09:05');
    });

    it('formats an evening datetime', () => {
        expect(formatDate('2024-02-29T23:59:00')).toBe('2024-02-29 23:59');
    });

    it('pads single-digit month, day, hour and minute with a leading zero', () => {
        expect(formatDate('2023-01-05T08:02:00')).toBe('2023-01-05 08:02');
    });

    it('drops seconds (only year-month-day hour:minute are rendered)', () => {
        expect(formatDate('2023-06-15T09:05:45')).toBe('2023-06-15 09:05');
    });

    it('accepts a UTC "Z" offset and renders the yyyy-MM-dd HH:mm shape', () => {
        // Reviewer suggestion: timezone offsets. A trailing 'Z' makes the input
        // UTC, so the exact local output depends on the host time zone. We
        // therefore assert the format/shape rather than a literal value, and
        // that a valid offset-bearing date is NOT treated as invalid (i.e. the
        // result is a non-empty, properly-shaped string).
        const result = formatDate('2023-06-15T09:05:00Z');
        expect(result).not.toBe('');
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });

    it('accepts a numeric "+HH:MM" offset and renders the yyyy-MM-dd HH:mm shape', () => {
        const result = formatDate('2023-06-15T09:05:00+05:30');
        expect(result).not.toBe('');
        expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    });
});
