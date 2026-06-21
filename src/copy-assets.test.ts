// @vitest-environment node
/**
 * Tests for `scripts/copy-assets.mjs` — the post-build asset-copy step invoked
 * by `npm run build` (`tsc && node scripts/copy-assets.mjs`).
 *
 * Pinned to the `node` environment (mirroring `src/app.css.test.ts` and
 * `src/readme.test.ts`): these tests spawn a child process and inspect files on
 * disk; they need no DOM and stay side-effect-light.
 *
 * Two concerns are covered:
 *
 *  1. CHARACTERIZATION (must keep holding): the script copies `src/app.css` to
 *     `wwwroot/dist/app.css` and vendors the bootstrap-icons CSS + fonts under
 *     `wwwroot/dist/icons/`. Asserted by RUNNING the real script as a child
 *     process and inspecting the produced files — so a refactor that breaks the
 *     copy is caught.
 *
 *  2. ERROR HANDLING: the `src/app.css` `copyFile` must catch only `ENOENT` and
 *     re-throw the rest (`EACCES`, `ENOSPC`, …). This is asserted both
 *     structurally (source has no bare swallowing catch and instead guards on
 *     `err.code !== 'ENOENT'`) AND behaviorally (forcing the copy to fail with
 *     `EACCES` must crash the script). The behavioral test is intentionally
 *     RACE-FREE: it makes the DESTINATION `wwwroot/dist/app.css` unreadable
 *     rather than the source `src/app.css`, which the parallel `app.css.test.ts`
 *     reads at load time.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, chmodSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SCRIPT_PATH = resolve(ROOT, 'scripts', 'copy-assets.mjs');
const SOURCE = readFileSync(SCRIPT_PATH, 'utf8');
const DIST = resolve(ROOT, 'wwwroot', 'dist');
const SRC_CSS = resolve(ROOT, 'src', 'app.css');
const DEST_CSS = resolve(DIST, 'app.css');
const BI_FONT_CSS = resolve(ROOT, 'node_modules', 'bootstrap-icons', 'font', 'bootstrap-icons.css');

/** True when the bootstrap-icons dependency (copied by the script) is installed. */
const HAS_BOOTSTRAP_ICONS = existsSync(BI_FONT_CSS);

/** Run the script synchronously via the current node binary. */
function runScript(): { status: number | null; stderr: string; stdout: string } {
  const r = spawnSync(process.execPath, [SCRIPT_PATH], { encoding: 'utf8' });
  return { status: r.status, stderr: r.stderr, stdout: r.stdout };
}

/* ===========================================================================
 * Characterization — the script copies the expected assets end-to-end.
 *
 * Skipped when bootstrap-icons is not installed (e.g. before `npm install`),
 * since the unguarded bootstrap-icons copy would then legitimately fail.
 * ========================================================================= */
describe.skipIf(!HAS_BOOTSTRAP_ICONS)(
  'scripts/copy-assets.mjs — end-to-end asset copy (characterization)',
  () => {
    it('exits 0 and copies src/app.css -> wwwroot/dist/app.css byte-for-byte', () => {
      const res = runScript();
      expect(res.status, `script stderr:\n${res.stderr}`).toBe(0);
      expect(existsSync(DEST_CSS), 'wwwroot/dist/app.css must exist').toBe(true);
      expect(readFileSync(DEST_CSS, 'utf8')).toBe(readFileSync(SRC_CSS, 'utf8'));
    });

    it('vendors bootstrap-icons CSS + fonts under wwwroot/dist/icons/', () => {
      expect(existsSync(resolve(DIST, 'icons', 'bootstrap-icons.css'))).toBe(true);
      expect(existsSync(resolve(DIST, 'icons', 'fonts', 'bootstrap-icons.woff2'))).toBe(true);
      expect(existsSync(resolve(DIST, 'icons', 'fonts', 'bootstrap-icons.woff'))).toBe(true);
    });
  },
);

/* ===========================================================================
 * Error-handling fix — the src/app.css copy must swallow ONLY ENOENT.
 *
 * These structural assertions fail against the current bare-`catch {}` source
 * and pass once the catch guards on `err.code !== 'ENOENT'` and re-throws.
 * ========================================================================= */
describe('scripts/copy-assets.mjs — src/app.css copy swallows only ENOENT', () => {
  it('wraps the src/app.css copyFile in a try/catch', () => {
    expect(SOURCE).toMatch(/try\s*\{[\s\S]*?copyFile\s*\(\s*srcPath/);
  });

  it('does NOT use a bare `catch {}` that swallows every error', () => {
    // `catch {` (no binding) silently eats all errors; `catch (err) {` does not.
    // This regex matches ONLY the bare form, never `catch (err) {`.
    expect(SOURCE).not.toMatch(/catch\s*\{/);
  });

  it('binds the caught error, guards on ENOENT, and re-throws the rest', () => {
    expect(SOURCE).toMatch(/catch\s*\(\s*\w+\s*\)/);
    expect(SOURCE).toMatch(/\.code\s*!==\s*['"]ENOENT['"]/);
    expect(SOURCE).toMatch(/throw\s+\w+/);
  });
});

/* ===========================================================================
 * Contrast — the bootstrap-icons copies must NOT swallow errors.
 *
 * Those copies are unguarded on purpose: a missing bootstrap-icons package must
 * fail the build loudly. Pinning this guards against accidentally wrapping them
 * in the same ENOENT-only catch.
 * ========================================================================= */
describe('scripts/copy-assets.mjs — bootstrap-icons copies propagate errors', () => {
  it('calls copyFile directly inside the asset loop (no try/catch around it)', () => {
    const loopMatch = SOURCE.match(
      /for\s*\(\s*const\s*\[\s*from\s*,\s*to\s*\]\s*of\s*biAssets\s*\)\s*\{([\s\S]*?)\}/,
    );
    expect(loopMatch, 'the `for (const [from, to] of biAssets)` loop must exist').not.toBeNull();
    expect(loopMatch![1]).toMatch(/await\s+copyFile/);
    expect(loopMatch![1]).not.toMatch(/\btry\s*\{/);
  });

  it('maps exactly the three expected bootstrap-icons assets', () => {
    expect(SOURCE).toMatch(/\[\s*'bootstrap-icons\.css'\s*,\s*'bootstrap-icons\.css'\s*\]/);
    expect(SOURCE).toMatch(
      /\[\s*'fonts\/bootstrap-icons\.woff2'\s*,\s*'fonts\/bootstrap-icons\.woff2'\s*\]/,
    );
    expect(SOURCE).toMatch(
      /\[\s*'fonts\/bootstrap-icons\.woff'\s*,\s*'fonts\/bootstrap-icons\.woff'\s*\]/,
    );
  });
});

/* ===========================================================================
 * Behavioral proof — a non-ENOENT error must actually crash the script.
 *
 * Race-free: it chmods the DESTINATION `wwwroot/dist/app.css` (unread by any
 * other test) to 000 so `copyFile` throws `EACCES` on overwrite. The script
 * must re-throw non-ENOENT errors and exit non-zero (it must not silently
 * swallow EACCES). Skipped on Windows where POSIX permission bits are not
 * honored.
 *
 * Permissions are always restored in `finally` so a failure cannot leave the
 * build output unreadable.
 * ========================================================================= */
describe.skipIf(!HAS_BOOTSTRAP_ICONS || process.platform === 'win32')(
  'scripts/copy-assets.mjs — surfaces non-ENOENT errors at runtime (behavioral)',
  () => {
    it('re-throws EACCES (read-only destination) instead of swallowing it', () => {
      // Baseline: the destination must exist so the copy hits an *overwrite*
      // EACCES (a create-in-readonly-dir EACCES would also trip the unguarded
      // bootstrap-icons mkdir and muddy the result).
      const baseline = runScript();
      expect(baseline.status, `baseline run failed:\n${baseline.stderr}`).toBe(0);
      expect(existsSync(DEST_CSS), 'dest must exist before making it read-only').toBe(true);

      chmodSync(DEST_CSS, 0o000);
      try {
        const res = runScript();
        expect(res.status, `script stderr:\n${res.stderr}`).not.toBe(0);
      } finally {
        chmodSync(DEST_CSS, 0o644);
      }
    });
  },
);
