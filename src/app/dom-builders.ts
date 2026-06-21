/**
 * Barrel re-export of the focused DOM-builder modules.
 *
 * The DOM-builder logic lives in focused modules under `src/app/`:
 *  - `./menus.js`       — menu lifecycle, viewport-edge positioning, per-mount
 *                         menu state, the per-row ⋮ menu, and the directory
 *                         context menu.
 *  - `./rows.js`        — browse / search / parent table-row builders.
 *  - `./breadcrumb.js`  — breadcrumb populator and in-app navigation links.
 *  - `./icons.js`       — Bootstrap Icons glyph and action-button builders.
 *  - `./tables.js`      — generic results-table skeleton builder.
 *
 * This barrel exists so existing `import ... from './dom-builders'` paths
 * (notably the test suites) keep resolving. New production code should
 * import from the focused modules directly.
 */
export * from './menus.js';
export * from './rows.js';
export * from './breadcrumb.js';
export * from './icons.js';
export * from './tables.js';
