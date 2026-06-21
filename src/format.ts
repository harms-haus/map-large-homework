/**
 * Pure formatting helpers for the file browser UI.
 *
 * Every function in this module is side-effect free (no DOM access, no network)
 * so each can be unit-tested in isolation. The module exports ONLY the four
 * functions declared here.
 */

/** Binary (1024-based) byte-unit suffixes, from bytes up to terabytes. */
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Format a byte count as a human-readable string using binary (1024-based)
 * units.
 *
 * - Values below 1024 render as an integer byte count, e.g. `0 B`, `1023 B`.
 * - Values of 1024 and above render with exactly one decimal place, keeping a
 *   trailing `.0`, e.g. `1.0 KB`, `1.5 KB`, `1.0 MB`.
 *
 * The unit caps at `TB`; values beyond 1024 TB remain expressed in terabytes.
 */
export function formatBytes(bytes: number): string {
  const units = BYTE_UNITS;
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  if (unitIndex === 0) {
    // Below the KB boundary: render as an integer byte count.
    return `${Math.round(value)} ${units[unitIndex]}`;
  }

  // KB and above: one decimal place (trailing .0 preserved per spec).
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Normalize a relative path into a clean, slash-joined form.
 *
 * - backslashes (`\`) become forward slashes
 * - leading/trailing slashes are trimmed
 * - runs of repeated slashes collapse to one
 * - `.` and `..` segments are dropped (filtered out, NOT resolved against the
 *   parent — this also neutralizes path-traversal segments)
 * - empty/root input collapses to `""`
 */
export function normalizeRelativePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..')
    .join('/');
}

/**
 * Join two path fragments with a single separating slash, then normalize the
 * result (see {@link normalizeRelativePath}).
 */
export function joinPath(base: string, name: string): string {
  return normalizeRelativePath(`${base}/${name}`);
}

/** Left-pad a number to two digits with a leading zero. */
function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * Format an ISO 8601 date string as `yyyy-MM-dd HH:mm` (local calendar time).
 *
 * Returns `""` for empty or unparseable input instead of throwing.
 */
export function formatDate(iso: string): string {
  if (!iso) {
    return '';
  }

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const year = date.getFullYear();
  const month = padTwo(date.getMonth() + 1);
  const day = padTwo(date.getDate());
  const hours = padTwo(date.getHours());
  const minutes = padTwo(date.getMinutes());

  return `${year}-${month}-${day} ${hours}:${minutes}`;
}
