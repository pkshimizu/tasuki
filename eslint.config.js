import js from "@eslint/js";
import prettier from "eslint-config-prettier/flat";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist/**", "coverage/**"]),
  js.configs.recommended,
  tseslint.configs.recommended,
  { languageOptions: { globals: globals.node } },
  // 整形は Prettier に任せる。ESLint の書式ルールと競合しないよう最後に置く
  prettier,
]);
