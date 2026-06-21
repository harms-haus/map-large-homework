/**
 * Shared services for the file-browser app modules.
 *
 * Centralizes the three cross-cutting things `startApp` establishes once per
 * mount: the {@link ApiClient} singleton, the DOM element refs the render
 * helpers write into, and a render hook that action/upload handlers call to
 * trigger a fresh route dispatch. The hook is used instead of importing the
 * orchestrator directly, which would create a module cycle (orchestrator →
 * render-browse → rows → menus → icons → context → orchestrator).
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

// API singleton. The constructor performs no I/O, so creating it before
// `fetch` is stubbed in a test is safe.
const api = new ApiClient();

export function getApi(): ApiClient {
  return api;
}

// DOM refs — rebound by the orchestrator's `init` on every mount so the render
// helpers always target the most recent mount. The definite-assignment
// assertions hold until the first `init()`, which always runs before any
// render helper reads them.
let results!: HTMLElement;
let status!: HTMLElement;
let breadcrumb!: HTMLElement;
let searchInput!: HTMLInputElement;

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

let menuState!: MenuState;

export function setMenuState(state: MenuState): void {
  menuState = state;
}

export function getMenuState(): MenuState {
  return menuState;
}

let renderHook: () => Promise<void> = async () => {};

export function setRenderHook(fn: () => Promise<void>): void {
  renderHook = fn;
}

/** Trigger a fresh render via the registered hook. No-op until `setRenderHook`. */
export function rerender(): Promise<void> {
  return renderHook();
}
