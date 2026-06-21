/**
 * Shared services for the file-browser app modules.
 *
 * The file-browser is split across several focused modules (menus, rows,
 * breadcrumb, icons, tables — re-exported as a group via the dom-builders
 * barrel — plus render-browse, render-search, toolbar-handlers, and
 * render-orchestrator). They all need access to three cross-cutting things
 * that `startApp` establishes once per mount:
 *
 *   - the {@link ApiClient} singleton (used for fetches and download URLs);
 *   - the DOM element refs the render helpers write into (results, status,
 *     breadcrumb, search input);
 *   - a "render hook" that action-button handlers and the upload handler call
 *     to trigger a fresh route dispatch (used instead of importing the
 *     orchestrator directly, which would create a module cycle: orchestrator →
 *     render-browse → rows → menus → icons → context → orchestrator).
 *
 * Centralizing them here keeps the cross-module dependency graph acyclic and
 * makes the re-bind-on-remount contract explicit: the module-level element
 * refs are rebound by `render-orchestrator.init` on every mount, so the
 * render helpers always target the most recently mounted app.
 */
import { ApiClient } from '../api.js';
import type { MenuState } from './menus.js';

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
 * Created once at module load. The constructor performs
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
 * The definite-assignment assertions guarantee the refs are uninitialized only
 * until the first `init()` call, which always runs before any render helper
 * reads them.
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
 * Menu state — rebound by `render-orchestrator.init` on every `startApp` mount
 *
 * The per-mount menu open/close state (created by `createMenuState` in
 * menus.js) so the row/directory menu single-open invariant is scoped to the
 * current mount, not a module-level singleton that would cross-contaminate
 * re-mounts. The `MenuState` type is imported TYPE-ONLY here (erased at build
 * time) so this does not introduce a runtime cycle with menus.js / icons.js,
 * which import these accessors at runtime.
 * ---------------------------------------------------------------------- */
let menuState!: MenuState;

/** Bind the per-mount menu state. Called from the orchestrator's `init`. */
export function setMenuState(state: MenuState): void {
  menuState = state;
}

/** The per-mount menu open/close state (row + directory menus). */
export function getMenuState(): MenuState {
  return menuState;
}

/* -------------------------------------------------------------------------
 * Render hook
 *
 * Action-button handlers (the menu items built in menus.js via the
 * action-button wrapper in icons.js) and the upload handler (in
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
