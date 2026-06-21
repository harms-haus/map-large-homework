/**
 * Pure formatting helpers for the file-browser UI. All side-effect free
 * (no DOM, no network) so each is unit-testable in isolation.
 */

/** Binary (1024-based) byte-unit suffixes, from bytes up to terabytes. */
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Format a byte count using binary (1024-based) units. Values below 1024
 * render as an integer byte count (`0 B`, `1023 B`); 1024 and above render
 * with one decimal place (`1.0 KB`, `1.5 MB`). The unit caps at `TB`.
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
    return `${Math.round(value)} ${units[unitIndex]}`;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Normalize a relative path: backslashes → forward slashes, leading/trailing
 * slashes trimmed, runs of repeated slashes collapsed, and `.`/`..` segments
 * dropped (filtered, not resolved — this also neutralizes path-traversal
 * segments). Empty/root input collapses to `""`.
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

/** Format an ISO 8601 date string as `yyyy-MM-dd HH:mm` (local calendar time).
 *  Returns `""` for empty or unparseable input. */
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
