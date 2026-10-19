// Semantic gate: type-aware ESLint rules over src. Runs in `pnpm lint:semantic`.
// These rules need the TypeScript program (projectService); they catch semantic
// errors that a plain type-check misses: misused promises, unreachable branches,
// unsafe casts, dead conditionals, and unused declarations.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "scripts/**", "*.mjs", "vitest.config.ts"]
  },
  ...tseslint.configs.strictTypeChecked,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      "@typescript-eslint/no-unnecessary-condition": [
        "error",
        { allowConstantLoopConditions: true }
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }
      ],
      // Handlers are uniformly async by interface contract even when sync.
      "@typescript-eslint/require-await": "off",
      // Display formatting of numbers in demo output is intentional.
      "@typescript-eslint/restrict-template-expressions": "off",
      // Catch variables are already `unknown` under TS 4.4+; explicit annotation adds noise.
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "off"
    }
  }
);
