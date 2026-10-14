// ESLint flat config. Mirrors AVNetworkMonitor's Pylint role: catch bugs, not
// style (Prettier owns formatting). Security sinks are also gated by
// .hooks/check_dom_sinks.sh so a disabled rule can't hide them.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "out/**", "release/**", "coverage/**", "node_modules/**", "src/flash/picoflash/**", ".claude/**", "tmp/**"] },
  // An eslint-disable that no longer suppresses anything is an error, so the
  // list in docs/LINT_SUPPRESSIONS.md can't go stale (F47).
  { linterOptions: { reportUnusedDisableDirectives: "error" } },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React Compiler advisories. Warn, not fail, so a new case is reviewed;
      // the one left is listed in docs/LINT_SUPPRESSIONS.md (CI caps warnings).
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-restricted-syntax": [
        "error",
        { selector: "MemberExpression[property.name=/^(innerHTML|outerHTML)$/]", message: "No raw HTML sinks; render through React." },
        { selector: "CallExpression[callee.name='eval']", message: "No eval." },
        { selector: "NewExpression[callee.name='Function']", message: "No new Function()." },
      ],
    },
  },
  // The error pass (CLAUDE.md "Error pass", docs/ERROR_PASS_2026-10.md): no
  // silent failure. Every promise is awaited, returned, or ends in a handler:
  // .catch(shown("key")) when the user should see it, .catch(logged("why"))
  // when not. \`void\` only goes in front of a handled chain (ignoreVoid off),
  // and an async function can't be handed to a void callback (onClick) where
  // its rejection would be lost. No empty blocks, catch included; what each
  // catch does is a verdict that tools/list_errors.mjs --check gates.
  {
    files: ["src/**/*.{ts,tsx}", "electron/**/*.ts"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      "@typescript-eslint/no-floating-promises": ["error", { ignoreVoid: false }],
      "@typescript-eslint/no-misused-promises": "error",
      "no-empty": ["error", { allowEmptyCatch: false }],
    },
  },
  {
    files: ["electron/**/*.ts", "*.config.{ts,js}", "tools/**/*.{js,mjs}", ".hooks/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", Buffer: "readonly", fetch: "readonly", URL: "readonly" } },
  },
  {
    // The static download page (site/): plain browser script.
    files: ["site/**/*.js"],
    languageOptions: { sourceType: "script", globals: { window: "readonly", document: "readonly", navigator: "readonly", fetch: "readonly" } },
  },
);
