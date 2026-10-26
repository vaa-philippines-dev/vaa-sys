import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Claude Code worktrees: other checkouts of this repo, linted there.
    ".claude/**",
    // Reference copy of the legacy Apps Script CMS, not part of the app.
    "legacy/**",
    "src/generated/**",
  ]),
]);

export default eslintConfig;
