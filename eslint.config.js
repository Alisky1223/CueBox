import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  { ignores: ["dist/", "coverage/", "**/.wrangler/"] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "no-control-regex": "off",
    },
  },
  {
    files: ["worker/**/*.js"],
    languageOptions: {
      globals: { ...globals.serviceworker, WebSocketPair: "readonly", WebSocketRequestResponsePair: "readonly" },
    },
  },
  prettier,
];
