import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Flat-config (ESLint v9+) configuration for the TypeScript frontend under
// `src/` and the Node build scripts under `scripts/`. Generated/build output
// (wwwroot, bin, obj) and the reference `SampleFiles/` are ignored. Note
// typescript-eslint's recommended config disables `no-undef` for TS files
// (the TypeScript compiler handles undefined-reference checks), so DOM/Node
// globals such as `document`, `window` and `console` do not need declaring.
export default tseslint.config(
    {
        ignores: [
            "node_modules/",
            "wwwroot/",
            "bin/",
            "obj/",
            "SampleFiles/",
            "**/*.js",
        ],
    },
    {
        files: ["**/*.ts"],
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
    },
    {
        files: ["scripts/**/*.mjs"],
        extends: [js.configs.recommended],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
        },
    },
);
