import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
	// 1. JS base config
	{
		files: ["**/*.{js,mjs,cjs,ts,mts,cts}"],
		languageOptions: {
			globals: globals.browser,
		},
		plugins: { js },
		extends: ["js/recommended"],
	},

	// 2. TypeScript ESLint rules (spread first)
	...tseslint.configs.recommended,

	// 3. Your project-specific TypeScript overrides (must come last!)
	{
		files: ["**/*.{ts,mts,cts}"],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"no-console": "off",
		},
	},
]);
