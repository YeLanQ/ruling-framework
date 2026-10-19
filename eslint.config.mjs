// Quality gate: ESLint over src. Runs in `pnpm lint`.
// Semantic (type-aware) rules live in eslint.config.semantic.mjs (`pnpm lint:semantic`).
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "scripts/**", "*.mjs"]
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }
      ],
      "no-console": "error"
    }
  }
);
