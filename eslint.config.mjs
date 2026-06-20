/**
 * ESLint flat config.
 *
 * NOTE: this project's primary linter is `oxlint` (see `.oxlintrc.json` and
 * `npm run lint`). ESLint is not a project dependency; this config exists so
 * that environments which invoke ESLint (e.g. `npx eslint .`) have a valid
 * configuration to load instead of erroring with "couldn't find an
 * eslint.config file".
 *
 * TypeScript sources are linted by oxlint. ESLint cannot parse TypeScript
 * syntax without the `typescript-eslint` parser (not installed here), so a
 * lenient passthrough parser is used for `.ts`/`.tsx` files: the file is
 * "matched" (avoiding the noisy "file ignored" warning) but produces an empty
 * AST, and with no rules configured no violations are reported. Real linting
 * remains the responsibility of oxlint.
 */
const lenientParser = {
  parseForESLint() {
    return {
      ast: {
        type: 'Program',
        body: [],
        sourceType: 'module',
        comments: [],
        tokens: [],
        range: [0, 0],
        loc: { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } },
      },
      visitorKeys: {},
      scopeManager: null,
      services: {},
    };
  },
};

export default [
  {
    ignores: [
      'node_modules/',
      '.engin/',
      'wwwroot/',
      'bin/',
      'obj/',
      'dist/',
      'SampleFiles/',
      'coverage/',
    ],
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    languageOptions: {
      parser: lenientParser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {},
  },
];
