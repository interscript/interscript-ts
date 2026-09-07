/**
 * Ambient declarations for playground hosts: the package is loaded
 * ahead of user code (CDN import or bundler) and injected as globals.
 * Reference this file from the editor's tsconfig `include` (or via a
 * triple-slash directive) to get full autocomplete on the injected
 * bindings — the types come straight from the published package.
 */

/** The map layer, as injected by the host. */
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- a top-level import would turn this ambient file into a module
declare const interscript: typeof import("./index.js")

/** The neural layer (`import ... from "interscript/ml"`), when injected. */
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- same: must stay ambient
declare const ml: typeof import("./ml/index.js")
