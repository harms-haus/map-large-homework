/**
 * Shared services for the file-browser app modules.
 *
 * The file-browser is split across several focused modules (dom-builders,
 * render-browse, render-search, toolbar-handlers, render-orchestrator). They
 * all need access to three cross-cutting things that `startApp` establishes
 * once per mount:
 *
 *   - the {@link ApiClient} singleton (used for fetches and download URLs);
 *   - the DOM element refs the render helpers write into (results, status,
 *     breadcrumb, search input);
 *   - a "render hook" that action-button handlers and the upload handler call
 *     to trigger a fresh route dispatch (used instead of importing the
 *     orchestrator directly, which would create a module cycle: orchestrator →
 *     render-browse → dom-builders → orchestrator).
 *
 * Centralizing them here keeps the cross-module dependency graph acyclic and
 * makes the re-bind-on-remount contract explicit — replacing the bare
 * module-level `let resultsEl!: HTMLElement` variables that used to live in
 * `app.ts`. `render-orchestrator.init` re-binds the refs every mount, so the
 * render helpers always target the most recently mounted app.
 */
import { ApiClient } from '../api.js';

/** The DOM element refs established by each `startApp` mount. */
export interface DomRefs {
  results: HTMLElement;
  status: HTMLElement;
  breadcrumb: HTMLElement;
  searchInput: HTMLInputElement;
}

/* -------------------------------------------------------------------------
 * API singleton
 *
 * Created once at module load, exactly as the original `app.ts` created
 * `const api = new ApiClient();` at its top level. The constructor performs
 * no I/O, so creating it before `fetch` is stubbed in a test is safe.
 * ---------------------------------------------------------------------- */
const api = new ApiClient();

/** The shared API client (used for fetches and download-URL construction). */
export function getApi(): ApiClient {
  return api;
}

/* -------------------------------------------------------------------------
 * DOM refs — rebound by `render-orchestrator.init` on every `startApp` mount
 * so `renderBrowse` / `renderSearch` always target the most recent mount.
 *
 * The definite-assignment assertions mirror the original `let resultsEl!:
 * HTMLElement` pattern: the refs are uninitialized only until the first
 * `init()` call, which always runs before any render helper reads them.
 * ---------------------------------------------------------------------- */
let results!: HTMLElement;
let status!: HTMLElement;
let breadcrumb!: HTMLElement;
let searchInput!: HTMLInputElement;

/** Bind the DOM refs for the current mount. Called from the orchestrator's `init`. */
export function setRefs(refs: DomRefs): void {
  results = refs.results;
  status = refs.status;
  breadcrumb = refs.breadcrumb;
  searchInput = refs.searchInput;
}

export function getResults(): HTMLElement {
  return results;
}

export function getStatus(): HTMLElement {
  return status;
}

export function getBreadcrumb(): HTMLElement {
  return breadcrumb;
}

export function getSearchInput(): HTMLInputElement {
  return searchInput;
}

/* -------------------------------------------------------------------------
 * Render hook
 *
 * Action-button handlers (in dom-builders) and the upload handler (in
 * toolbar-handlers) call `rerender()` to trigger a fresh route dispatch. They
 * cannot import `render` from render-orchestrator.ts directly without creating
 * the cycle noted above, so the orchestrator registers its `render` function
 * here during `init` and the callers invoke it indirectly through `rerender`.
 * ---------------------------------------------------------------------- */
let renderHook: () => Promise<void> = async () => {};

/** Register the route-dispatching render function. */
export function setRenderHook(fn: () => Promise<void>): void {
  renderHook = fn;
}

/** Trigger a fresh render via the registered hook. No-op until `setRenderHook` is called. */
export function rerender(): Promise<void> {
  return renderHook();
}
