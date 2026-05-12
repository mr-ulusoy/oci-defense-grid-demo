import js from "@eslint/js";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "infra/terraform/.terraform/**"]
  },
  js.configs.recommended,
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        Phaser: "readonly",
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        URLSearchParams: "readonly",
        fetch: "readonly",
        crypto: "readonly",
        performance: "readonly",
        setInterval: "readonly",
        Buffer: "readonly",
        console: "readonly",
        process: "readonly"
      }
    }
  }
];
