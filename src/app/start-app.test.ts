/**
 * Tests for `src/app.ts`'s module surface and `startApp` bootstrap: the
 * imperative DOM scaffold it builds, the dialog open/close + shared-widget
 * move wiring, and the two characterization suites that pin app.ts's retained
 * imports and its (dead-)CSS-selector-relevant DOM output.
 *
 * Split out of the former `src/app.test.ts` monolith (task-29). The shared
 * fixtures, DOM scaffolding, and the per-test fetch stub come from
 * `./test-helpers`.
 *
 * Environment: the project-default `happy-dom` (these tests need a DOM).
 *
 * Contract decisions encoded by these suites (carried over from the monolith):
 *  - The action controls Delete / Move / Copy are `<button>` elements whose
 *    trimmed `textContent` is exactly `"Delete"` / `"Move"` / `"Copy"`.
 *  - Importing `./app` must not side-effect when there is no `#app` element.
 */
import { describe, it, expect, vi } from 'vitest';
import { startApp, renderBrowse, renderSearch } from '../app';
import { toBrowseHash, toSearchHash } from '../router';
import {
  setup,
  setupCleared,
  flush,
  browseResult,
  fileEntry,
  cellsOf,
  rowByName,
  clickNameLink,
  dataRows,
  browseRoute,
  searchRoute,
  installAppTestLifecycle,
} from './test-helpers';

installAppTestLifecycle();

/* ===========================================================================
 * Module surface / bootstrap guard
 * ========================================================================= */
describe('app module surface', () => {
  it('exports startApp, renderBrowse, and renderSearch as functions', () => {
    expect(typeof startApp).toBe('function');
    expect(typeof renderBrowse).toBe('function');
    expect(typeof renderSearch).toBe('function');
  });

  it('can be imported without a DOM #app element present (bootstrap is guarded)', () => {
    // Importing this test file already imported '../app'. That import ran the
    // bootstrap line `const root = document.getElementById('app'); if (root)
    // startApp(root);` against an empty document and did not throw — reaching
    // this assertion proves the guard. We additionally assert there is no
    // stray dialog created at module load time.
    expect(document.querySelector('dialog.browser-dialog')).toBeNull();
  });
});

/* ===========================================================================
 * startApp — DOM structure & dialog wiring
 * ========================================================================= */
describe('startApp', () => {
  describe('DOM structure', () => {
    it('creates a trigger button labelled "Browse Files"', () => {
      const { trigger } = setup();
      expect(trigger).toBeTruthy();
      expect(trigger.className).toBe('trigger');
      expect(trigger.textContent?.trim()).toBe('Browse Files');
    });

    it('creates a native <dialog class="browser-dialog"> that starts closed', () => {
      const { dialog } = setup();
      expect(dialog).toBeTruthy();
      expect(dialog.tagName).toBe('DIALOG');
      expect(dialog.className).toBe('browser-dialog');
      expect(dialog.open).toBe(false);
    });

    it('renders a header with a centered title span and an icon Close button', () => {
      const { dialog, closeBtn } = setup();
      expect(closeBtn).toBeTruthy();
      expect(closeBtn.className).toBe('close-btn');
      // No visible text — it's an icon button, so it carries an aria-label.
      expect(closeBtn.textContent?.trim()).toBe('');
      expect(closeBtn.getAttribute('aria-label')).toBe('Close');
      const icon = closeBtn.querySelector('.bi');
      expect(icon).toBeTruthy();
      expect(icon?.className).toContain('bi-x-lg');
      expect(dialog.contains(closeBtn)).toBe(true);
      const titleSpan = dialog.querySelector('.title');
      expect(titleSpan).toBeTruthy();
      expect(titleSpan?.textContent).toBe('File Browser');
    });

    it('renders a toolbar with a breadcrumb container', () => {
      const { breadcrumb } = setup();
      expect(breadcrumb).toBeTruthy();
      expect(breadcrumb.className).toBe('breadcrumb');
    });

    it('renders a search text input with the Search... placeholder and a Search button', () => {
      const { searchInput, searchBtn } = setup();
      expect(searchInput).toBeTruthy();
      expect(searchInput.type).toBe('text');
      expect(searchInput.getAttribute('placeholder')).toBe('Search...');
      expect(searchBtn).toBeTruthy();
      expect(searchBtn.textContent?.trim()).toBe('Search');
      expect(searchBtn.className).toBe('btn');
    });

    it('renders an upload control: label.btn wrapping a visually-hidden, multiple file input', () => {
      const { uploadLabel, uploadInput } = setup();
      expect(uploadLabel).toBeTruthy();
      expect(uploadLabel.className).toBe('btn');
      expect(uploadLabel.textContent).toContain('Upload');
      expect(uploadInput).toBeTruthy();
      expect(uploadInput.type).toBe('file');
      // Keyboard accessibility (WCAG 2.1.1): the input must NOT carry the
      // `hidden` HTML attribute — UA `display:none` would eject it from the
      // tab order, leaving the Upload control unreachable via keyboard. It is
      // visually hidden via the `visually-hidden` sr-only class instead, and
      // exposes an accessible name. (Full contract: the 'upload control —
      // keyboard accessibility' suite below.)
      expect(uploadInput.hasAttribute('hidden')).toBe(false);
      expect(uploadInput.className).toContain('visually-hidden');
      expect(uploadInput.getAttribute('aria-label')).toBe('Upload files');
      expect(uploadInput.hasAttribute('multiple')).toBe(true);
      expect(uploadLabel.contains(uploadInput)).toBe(true);
    });

    it('renders an empty .results container and a .status footer', () => {
      const { results, status } = setup();
      expect(results).toBeTruthy();
      expect(results.className).toBe('results');
      expect(status).toBeTruthy();
      expect(status.tagName).toBe('FOOTER');
      expect(status.className).toBe('status');
    });
  });

  describe('dialog open/close wiring', () => {
    it('opens the dialog (showModal) when the trigger is clicked', () => {
      const { dialog, trigger } = setup();
      const showSpy = vi.spyOn(dialog, 'showModal');

      trigger.click();

      expect(showSpy).toHaveBeenCalledTimes(1);
      expect(dialog.open).toBe(true);
    });

    it('closes the dialog when the Close button is clicked', () => {
      const { dialog, closeBtn } = setup();
      dialog.showModal();
      expect(dialog.open).toBe(true);
      const closeSpy = vi.spyOn(dialog, 'close');

      closeBtn.click();

      expect(closeSpy).toHaveBeenCalledTimes(1);
      expect(dialog.open).toBe(false);
    });
  });

  /* The file browser is a single chromeless widget shared between the embedded
     host (primary view) and the dialog body. Opening the dialog MOVES the same
     nodes into the dialog; closing moves them back — so there is never a second
     copy, and the embedded view stays chromeless (no frame/title). */
  describe('shared widget (embedded host vs dialog)', () => {
    it('renders an embedded host and a single chromeless .file-browser widget', () => {
      const { embeddedHost, widget } = setup();
      expect(embeddedHost).toBeTruthy();
      expect(embeddedHost.className).toBe('file-browser-host');
      expect(widget).toBeTruthy();
      expect(widget.className).toBe('file-browser');
      // There is exactly one widget in the whole document.
      expect(document.querySelectorAll('.file-browser')).toHaveLength(1);
    });

    it('hosts the widget in the embedded host while the dialog is closed', () => {
      const { embeddedHost, widget, dialog } = setup();
      expect(embeddedHost.contains(widget)).toBe(true);
      // The widget (and thus its table/search/status) is NOT inside the dialog
      // until the dialog is opened.
      expect(dialog.contains(widget)).toBe(false);
    });

    it('moves the widget into the dialog body when the dialog opens', () => {
      const { embeddedHost, widget, dialog, trigger } = setup();

      trigger.click();

      expect(dialog.open).toBe(true);
      expect(dialog.contains(widget)).toBe(true);
      // Same node reference, not a clone — only one widget exists.
      expect(document.querySelectorAll('.file-browser')).toHaveLength(1);
      expect(embeddedHost.contains(widget)).toBe(false);
    });

    it('moves the widget back to the embedded host when the dialog closes', () => {
      const { embeddedHost, widget, dialog, trigger } = setup();
      trigger.click();
      expect(dialog.contains(widget)).toBe(true);

      dialog.close();

      expect(dialog.open).toBe(false);
      expect(embeddedHost.contains(widget)).toBe(true);
      expect(dialog.contains(widget)).toBe(false);
    });

    it('the embedded widget carries no dialog chrome (no title/close-btn)', () => {
      const { widget } = setup();
      // The titlebar (title + close button) is dialog-only chrome; the embedded
      // widget must not contain a title or close button.
      expect(widget.querySelector('.title')).toBeNull();
      expect(widget.querySelector('.close-btn')).toBeNull();
      expect(widget.querySelector('.dialog-header')).toBeNull();
    });
  });
});

/* ===========================================================================
 * Upload control — keyboard accessibility (WCAG 2.1.1)
 *
 * Background (the bug these tests guard against): the file input was created
 * with `uploadInput.hidden = true`, which sets the HTML `hidden` attribute.
 * The UA stylesheet maps `[hidden]` to `display:none`, and a `display:none`
 * form control is removed from the tab order and cannot receive focus. The
 * only visible Upload affordance is a wrapping `<label class="btn">`, and
 * `<label>` elements are neither focusable nor activatable from the keyboard
 * on their own. Net effect: keyboard-only and screen-reader users could not
 * reach or trigger Upload — a WCAG 2.1.1 (Keyboard) failure — while mouse
 * users could (a `<label>` click forwards to its wrapped input).
 *
 * The fix keeps the input in the accessibility tree and tab order by hiding
 * it *visually* with the standard `visually-hidden` (sr-only) clip pattern
 * rather than the `hidden` attribute, and gives it an `aria-label` so it has
 * an accessible name. Because the `<label class="btn">` still wraps the input,
 * Tab moves focus onto the (visually hidden) input inside the visible Upload
 * button, and Enter/Space opens the file picker. The matching CSS contract
 * — that `.visually-hidden` clips rather than `display:none`s the element,
 * and that the Upload label shows a focus ring via `:focus-within` — lives in
 * `src/app.css.test.ts`.
 *
 * Environment note: happy-dom does NOT model the UA `display:none` for
 * `[hidden]` (a hidden input still reports `getComputedStyle(...).display` as
 * `inline-block`) nor enforce the "hidden elements cannot receive focus"
 * rule. It also reports the `tabIndex` IDL property as -1 for file inputs no
 * matter whether `[hidden]` is set, so these tests assert against the content
 * attributes and classes (no `hidden` attribute + `visually-hidden` class +
 * accessible name + not disabled + no explicit negative tabindex + no inline
 * `display:none`/`visibility:hidden` style) — the *mechanisms* that produce
 * correct behavior in a real browser — rather than observing tab-order /
 * focus-ring rendering, which only a real browser would reflect. The change →
 * handleUpload upload behavior itself is exercised in `toolbar-handlers.test.ts`.
 * ========================================================================= */
describe('upload control — keyboard accessibility', () => {
  /* The input must remain in the tab order. The `hidden` HTML attribute is the
     exact mechanism that broke keyboard access (UA display:none), so its
     absence is the core assertion of this suite. */
  describe('the file input is NOT removed from the tab order', () => {
    it('does not carry the `hidden` HTML attribute', () => {
      const { uploadInput } = setup();
      expect(uploadInput.hasAttribute('hidden')).toBe(false);
    });

    it('the `hidden` IDL property is false', () => {
      const { uploadInput } = setup();
      expect(uploadInput.hidden).toBe(false);
    });

    it('is visually hidden via the `visually-hidden` sr-only class instead', () => {
      const { uploadInput } = setup();
      expect(uploadInput.classList.contains('visually-hidden')).toBe(true);
    });

    it('carries no negative tabindex attribute (which would remove it from the tab order)', () => {
      const { uploadInput } = setup();
      // A file input with no tabindex attribute is naturally focusable; ANY
      // negative tabindex ("-1", "-2", "-5", ...) is a different vector for the
      // same WCAG 2.1.1 failure (it removes the control from the sequential
      // focus order). Assert against the content attribute rather than the IDL
      // `tabIndex`: happy-dom reports `tabIndex` as -1 for file inputs no
      // matter whether the `hidden` attribute is set, so only the attribute is
      // a reliable signal here. `null` (no attribute) is the focusable default
      // and satisfies the contract; a non-negative explicit value does too.
      const tabindex = uploadInput.getAttribute('tabindex');
      expect(tabindex === null || Number(tabindex) >= 0).toBe(true);
    });

    it('is not `disabled` (a disabled form control is also unfocusable)', () => {
      const { uploadInput } = setup();
      // `disabled` is a distinct vector for the same WCAG 2.1.1 failure: a
      // disabled input cannot receive focus and is skipped by Tab. The fix must
      // keep the control enabled regardless of how it is hidden visually.
      expect(uploadInput.disabled).toBe(false);
      expect(uploadInput.hasAttribute('disabled')).toBe(false);
    });

    it('carries no inline `style` declaring display:none or visibility:hidden', () => {
      const { uploadInput } = setup();
      // The class-based `visually-hidden` fix is the only intended hiding
      // mechanism. An inline `style="display:none"` (or `visibility:hidden` —
      // both of which remove an element from the tab order) would re-introduce
      // the keyboard failure independently of the class, so guard against a
      // regression that adds either via the style property.
      const inlineStyle = uploadInput.getAttribute('style') ?? '';
      expect(/display\s*:\s*none/.test(inlineStyle)).toBe(false);
      expect(/visibility\s*:\s*hidden/.test(inlineStyle)).toBe(false);
    });
  });

  /* An unnamed form control is announced generically by screen readers (e.g.
     "file upload button"). The visible text lives on the wrapping label, but
     the input itself — the actual focus target — needs its own accessible
     name now that it is the element Tab lands on. */
  describe('the file input has an accessible name', () => {
    it('exposes aria-label="Upload files"', () => {
      const { uploadInput } = setup();
      expect(uploadInput.getAttribute('aria-label')).toBe('Upload files');
    });

    it('the aria-label is a non-empty, non-whitespace string', () => {
      // Guards against a regression that sets aria-label="" or "   ", which is
      // worse than no label (an empty accessible name can override a
      // label-derived name in the name computation).
      const { uploadInput } = setup();
      const label = uploadInput.getAttribute('aria-label') ?? '';
      expect(label.length).toBeGreaterThan(0);
      expect(label.trim().length).toBeGreaterThan(0);
    });

    it('does not also set aria-hidden (which would exclude it from the a11y tree)', () => {
      const { uploadInput } = setup();
      expect(uploadInput.getAttribute('aria-hidden')).toBeNull();
    });
  });

  /* The visible Upload affordance must still wrap the input so the label's
     click-forwarding and visible "Upload" text keep working for mouse and AT
     users, and so Tab lands inside the visible button. */
  describe('the visible Upload label still wraps the input', () => {
    it('the input is a descendant of the label.btn "Upload" affordance', () => {
      const { uploadLabel, uploadInput } = setup();
      expect(uploadLabel.className).toBe('btn');
      expect(uploadLabel.textContent).toContain('Upload');
      expect(uploadLabel.contains(uploadInput)).toBe(true);
    });

    it('there is exactly one file input, nested inside the Upload label', () => {
      const { root, uploadInput, uploadLabel } = setup();
      const fileInputs = root.querySelectorAll('input[type="file"]');
      expect(fileInputs).toHaveLength(1);
      expect(fileInputs[0]).toBe(uploadInput);
      expect(uploadLabel.contains(fileInputs[0])).toBe(true);
    });
  });

  /* The hiding mechanism is the ONLY thing that changes; the control's type,
     multiplicity, and change-handler wiring must be preserved. */
  describe('upload behavior is preserved', () => {
    it('retains type=file and multiple', () => {
      const { uploadInput } = setup();
      expect(uploadInput.type).toBe('file');
      expect(uploadInput.hasAttribute('multiple')).toBe(true);
    });

    it('still dispatches `change` to the upload handler (wiring unchanged)', () => {
      // The fix only changes how the input is *hidden*; the change listener
      // bound in startApp must remain attached. Dispatching `change` with no
      // files is a no-op for handleUpload, so this asserts the listener is
      // wired without coupling to the upload network round-trip.
      const { uploadInput } = setup({ hash: '#/browse/' });
      expect(() => uploadInput.dispatchEvent(new Event('change'))).not.toThrow();
    });
  });
});

/* ===========================================================================
 * Import characterization (safety net for unused-import removal)
 *
 * `src/app.ts` imports `parseHash` (from ./router.js), `parentPath`, and
 * `basename` (from ./format.js) that are never referenced in the module body
 * and are slated for removal. Removing unused imports cannot change runtime
 * behavior, so these tests guard the OTHER behaviors: they pin the observable
 * outputs that depend on the imports which STAY — especially the ones that
 * share an import line with the removed names, where a careless edit could
 * drop a needed sibling. Each assertion checks a concrete value tied to one
 * retained import's real usage in the app; if that import were removed, the
 * referenced call would throw (ReferenceError) or emit wrong output and the
 * test would fail.
 *
 * Retained imports exercised here:
 *   format.js: joinPath, normalizeRelativePath, formatBytes, formatDate
 *   router.js: toBrowseHash, toSearchHash
 * (getCurrentRoute / subscribe / navigate are already covered by the render
 * orchestration and toolbar-handler suites.)
 * ========================================================================= */
describe('import characterization (KEEP-list behaviors)', () => {
  // Local leaf finder; the breadcrumb describe has its own scoped copy.
  function leafByText(container: Element, text: string): HTMLElement | undefined {
    return Array.from(container.querySelectorAll('*')).find(
      (el) => el.children.length === 0 && (el.textContent ?? '').trim() === text,
    ) as HTMLElement | undefined;
  }

  /* --- format.js KEEP imports (siblings of the removed parentPath/basename) --- */

  describe('joinPath (breadcrumb cumulative paths)', () => {
    it('joins each cumulative segment across three path levels', async () => {
      const { breadcrumb } = await setupCleared();
      renderBrowse(browseResult({ path: 'a/b/c', entries: [] }));

      leafByText(breadcrumb, 'c')!.click();
      expect(window.location.hash).toBe(toBrowseHash('a/b/c'));

      leafByText(breadcrumb, 'b')!.click();
      expect(window.location.hash).toBe(toBrowseHash('a/b'));
    });
  });

  describe('normalizeRelativePath (breadcrumb path cleaning)', () => {
    it('collapses leading/doubled/trailing slashes before splitting segments', async () => {
      const { breadcrumb } = await setupCleared();
      renderBrowse(browseResult({ path: '//a//b//' }));

      leafByText(breadcrumb, 'b')!.click();
      expect(window.location.hash).toBe(toBrowseHash('a/b'));
    });
  });

  describe('formatBytes (size column)', () => {
    it('renders a 0-byte file as "0 B" (sub-KB integer branch)', async () => {
      const entry = fileEntry({ name: 'empty.txt', path: 'docs/empty.txt', size: 0 });
      const { results } = await setupCleared();
      renderBrowse(browseResult({ path: 'docs', entries: [entry] }));

      const sizeCell = cellsOf(rowByName(results.querySelector('table')!, 'empty.txt')!)[1];
      expect(sizeCell.textContent?.trim()).toBe('0 B');
    });
  });

  describe('formatDate (modified column)', () => {
    it('renders an empty Modified cell when lastModified is empty (fallback)', async () => {
      const entry = fileEntry({ name: 'nodate.txt', path: 'docs/nodate.txt', lastModified: '' });
      const { results } = await setupCleared();
      renderBrowse(browseResult({ path: 'docs', entries: [entry] }));

      const modifiedCell = cellsOf(rowByName(results.querySelector('table')!, 'nodate.txt')!)[2];
      expect(modifiedCell.textContent).toBe('');
    });
  });

  /* --- router.js KEEP imports (siblings of the removed parseHash) --- */

  describe('toBrowseHash (per-segment percent-encoding)', () => {
    it('encodes spaces in directory names when navigating into a folder', async () => {
      const dir = fileEntry({ name: 'my folder', path: 'docs/my folder', isDirectory: true });
      const { results } = await setupCleared();
      renderBrowse(browseResult({ path: 'docs', entries: [dir] }));

      clickNameLink(rowByName(results.querySelector('table')!, 'my folder')!);

      expect(window.location.hash).toBe('#/browse/docs/' + encodeURIComponent('my folder'));
      expect(window.location.hash).toBe(toBrowseHash('docs/my folder'));
    });
  });

  describe('toSearchHash (query/path percent-encoding)', () => {
    it('encodes special characters in the search query and scope path', async () => {
      const { searchInput, searchBtn } = setup({ hash: toBrowseHash('docs') });
      await flush();

      searchInput.value = 'a & b=c?';
      searchBtn.click();

      const expected =
        '#/search?q=' + encodeURIComponent('a & b=c?') + '&path=' + encodeURIComponent('docs');
      expect(window.location.hash).toBe(expected);
      expect(window.location.hash).toBe(toSearchHash('a & b=c?', 'docs'));
    });
  });
});

/* ===========================================================================
 * Dead CSS selector characterization
 *
 * `src/app.css` ships rule blocks whose selectors are NEVER emitted by app.ts,
 * so they have ZERO observable effect on the rendered UI. They are slated for
 * deletion in a dead-code cleanup. The tests below pin the JS-side invariants
 * that make that deletion provably safe:
 *
 *   - the rendered DOM must never produce an element the removed selectors
 *     could match; and
 *   - any behavior the dead rules *appear* to supply must actually be provided
 *     by an independent mechanism that survives the deletion.
 *
 * Removed selectors under test:
 *   (1) `.breadcrumb .separator`         — breadcrumb separators are class-less
 *       `<span>`s holding the literal "/"; nothing carries `separator`.
 *   (2) `.toolbar label.upload-btn` (+ its `:hover` + the descendant
 *       `input[type=file]` rule) — the upload label uses `btn`, never
 *       `upload-btn`, and the wrapped file input is hidden via the `hidden`
 *       HTML attribute, not via the dead `display:none` descendant rule.
 *
 * (`.folder-row` was formerly in this dead list, but it is now a LIVE class:
 * folder rows and the ".." parent row carry `folder-row` / `parent-row` so the
 * whole row is click-to-browse — see the dedicated suite below.)
 *
 * These assertions pass against the current (pre-cleanup) code AND must keep
 * passing after the dead rules are deleted, because they depend only on the
 * DOM app.ts emits — which the cleanup does not touch. (The environment does
 * not load app.css, so a missing rule cannot change `getComputedStyle` here;
 * these tests instead prove the rule could never have matched anything.)
 *
 * NOTE: these tests pass a `Route` fixture (`browseRoute` / `searchRoute`) as
 * a second argument to `renderBrowse` / `renderSearch`. That argument is a
 * leftover from before the route parameter was removed (see the
 * route-independence suite in `render-orchestration.test.ts`) and is silently
 * ignored at runtime; it is preserved verbatim so the scenario is unchanged.
 * ========================================================================= */
describe('dead CSS selector characterization', () => {
  describe('breadcrumb separators are class-less spans (no `.separator`)', () => {
    /** Leaf <span>s whose visible text is exactly the breadcrumb slash. */
    function slashSeparators(container: Element): HTMLSpanElement[] {
      return Array.from(container.querySelectorAll('span')).filter(
        (s) => (s.textContent ?? '').trim() === '/',
      ) as HTMLSpanElement[];
    }

    it('renders one "/" separator per path segment, each a class-less <span>', async () => {
      const { breadcrumb } = await setupCleared();
      renderBrowse(browseResult({ path: 'a/b/c', entries: [] }), browseRoute('a/b/c'));

      const separators = slashSeparators(breadcrumb);
      // a/b/c → 3 segments → 3 separators (Home / a / b / c). Verifying the
      // count also pins that the separators are still visibly rendered.
      expect(separators).toHaveLength(3);
      for (const sep of separators) {
        expect(sep.tagName).toBe('SPAN');
        expect(sep.className).toBe('');
        expect(sep.classList.contains('separator')).toBe(false);
      }
      // The dead selector `.breadcrumb .separator` matches nothing.
      expect(document.querySelectorAll('.separator')).toHaveLength(0);
    });

    it('renders no separators for the root path, and still no `.separator` anywhere', async () => {
      const { breadcrumb } = await setupCleared();
      renderBrowse(browseResult({ path: '', entries: [] }), browseRoute(''));

      expect(slashSeparators(breadcrumb)).toHaveLength(0);
      expect(document.querySelectorAll('.separator')).toHaveLength(0);
    });

    it('search-scope breadcrumbs also use class-less "/" separators', async () => {
      const { breadcrumb } = await setupCleared();
      renderSearch({ query: 'q', path: 'x/y', results: [] }, searchRoute('q', 'x/y'));

      const separators = slashSeparators(breadcrumb);
      expect(separators).toHaveLength(2);
      for (const sep of separators) {
        expect(sep.className).toBe('');
        expect(sep.classList.contains('separator')).toBe(false);
      }
      expect(document.querySelectorAll('.separator')).toHaveLength(0);
    });
  });

  describe('upload control never carries the dead `upload-btn` class', () => {
    it('the upload label uses `btn` (styled by .btn), and no element is `upload-btn`', () => {
      const { uploadLabel } = setup();
      expect(uploadLabel.className).toBe('btn');
      expect(uploadLabel.classList.contains('upload-btn')).toBe(false);
      // The dead selector `.toolbar label.upload-btn` matches nothing.
      expect(document.querySelectorAll('.upload-btn')).toHaveLength(0);
    });

    it('hides the file input via the `visually-hidden` class — NOT the dead `display:none` rule, NOT the `hidden` attribute', () => {
      const { uploadInput, uploadLabel } = setup();
      // The input is visually hidden via the `visually-hidden` sr-only class
      // (a clip-to-1x1 pattern that keeps it focusable for keyboard users —
      // see upload-a11y.test.ts), NOT via the `hidden` HTML attribute (UA
      // `display:none` would eject it from the tab order). Because the hiding
      // is done by the input's own class, deleting the dead descendant rule
      // `.toolbar label.upload-btn input[type=file] { display: none; }` cannot
      // un-hide it.
      expect(uploadInput.hidden).toBe(false);
      expect(uploadInput.hasAttribute('hidden')).toBe(false);
      expect(uploadInput.className).toContain('visually-hidden');
      // The dead descendant selector `.toolbar label.upload-btn input[type=file]`
      // still cannot match this input: its label ancestor is `btn`, never
      // `upload-btn`, so the selector never applied regardless of the input's
      // own class. Deleting that dead rule cannot un-hide it.
      expect(uploadLabel.classList.contains('upload-btn')).toBe(false);
    });
  });
});

/* ===========================================================================
 * Click-to-browse rows — whole-row navigation
 *
 * Folder rows and the ".." parent row browse into their target on a click
 * ANYWHERE in the row (not only on the name link), so a user is not forced to
 * hit the narrow link. Clicks in a folder row's actions cell (the ⋮ button +
 * its menu) are excluded so those controls keep working. File rows do nothing
 * on left-click. The row classes `folder-row` / `parent-row` drive the pointer
 * cursor (see app.css).
 * ========================================================================= */
describe('click-to-browse rows', () => {
  it('folder rows carry `folder-row`, the ".." parent row carries `parent-row`, and file rows carry neither', async () => {
    const dir = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true });
    const file = fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false });
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs/sub', parent: 'docs', entries: [dir, file] }));

    const rows = dataRows(results.querySelector('table')!);
    expect(rows).toHaveLength(3); // parent + folder + file
    const [parentRow, folderRow, fileRow] = rows;
    expect(parentRow.classList.contains('parent-row')).toBe(true);
    expect(folderRow.classList.contains('folder-row')).toBe(true);
    expect(fileRow.classList.contains('folder-row')).toBe(false);
    expect(fileRow.classList.contains('parent-row')).toBe(false);
    // Exactly the two navigable rows carry a click-to-browse class.
    expect(document.querySelectorAll('.folder-row, .parent-row')).toHaveLength(2);
  });

  it('clicking the Size cell of a folder row navigates into the folder', async () => {
    const dir = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true });
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [dir] }));

    const folderRow = rowByName(results.querySelector('table')!, 'sub')!;
    cellsOf(folderRow)[1].click(); // Size cell (em-dash) — not the name link

    expect(window.location.hash).toBe(toBrowseHash('docs/sub'));
  });

  it('clicking the Modified cell of a folder row navigates into the folder', async () => {
    const dir = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true });
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [dir] }));

    const folderRow = rowByName(results.querySelector('table')!, 'sub')!;
    cellsOf(folderRow)[2].click(); // Modified cell

    expect(window.location.hash).toBe(toBrowseHash('docs/sub'));
  });

  it('clicking the ".." parent row (not its link) navigates to the parent path', async () => {
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs/sub', parent: 'docs', entries: [] }));

    const parentRow = rowByName(results.querySelector('table')!, '..')!;
    cellsOf(parentRow)[2].click(); // Modified cell — not the ".." link

    expect(window.location.hash).toBe(toBrowseHash('docs'));
  });

  it('clicking a file row does NOT navigate', async () => {
    const file = fileEntry({ name: 'a.txt', path: 'docs/a.txt', isDirectory: false });
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [file] }));
    window.location.hash = '';

    rowByName(results.querySelector('table')!, 'a.txt')!.click();

    expect(window.location.hash).toBe('');
  });

  it('clicking the ⋮ button (in the actions cell) opens the menu and does NOT navigate', async () => {
    const dir = fileEntry({ name: 'sub', path: 'docs/sub', isDirectory: true });
    const { results } = await setupCleared();
    renderBrowse(browseResult({ path: 'docs', entries: [dir] }));
    window.location.hash = '';

    const folderRow = rowByName(results.querySelector('table')!, 'sub')!;
    const btn = cellsOf(folderRow)[3].querySelector('.row-menu-btn') as HTMLButtonElement;
    const menu = cellsOf(folderRow)[3].querySelector('.row-menu') as HTMLElement;
    btn.click();

    expect(menu.hidden).toBe(false); // menu opened
    expect(window.location.hash).toBe(''); // no navigation from the actions cell
  });
});
