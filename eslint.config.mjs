import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

/**
 * Configuration ESLint « flat » du projet.
 * Les deux presets officiels de Next.js suffisent : règles React, hooks,
 * accessibilité de base, Core Web Vitals et TypeScript.
 */
const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'],
  },
];

export default eslintConfig;
