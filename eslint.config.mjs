import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["lib/pose-landmarker.ts"],
    rules: {
      "no-new-func": "off",
      "no-implied-eval": "off",
      "@typescript-eslint/no-implied-eval": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "public/mediapipe-bridge.js",
    "lib/posture.check.ts",
    "lib/fatigue.check.ts",
  ]),
]);

export default eslintConfig;
