import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "dist/**",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
      "js/*.js",
      "js/*.js.map",
      "generate-puzzles.js",
      "sw.js",
      "icons/generate-icons.cjs",
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.es2022,
        vitest: "readonly",
        expect: "readonly",
        describe: "readonly",
        test: "readonly",
        it: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        vi: "readonly",
      },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none",
        },
      ],
      "no-console": "off",
    },
  },
];
