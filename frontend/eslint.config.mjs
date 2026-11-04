import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { fixupConfigRules } from "@eslint/compat";

// Current React/import plugins still use rule APIs removed in ESLint 10.
// Adapt those APIs, without disabling their checks.
const config = [
  ...fixupConfigRules([...nextVitals, ...nextTs]),
  { ignores: [".next/**", "node_modules/**"] },
];

export default config;
