import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// En flat config, si dos bloques configuran la misma regla para un archivo, el
// último la sustituye entera (las opciones no se combinan). Por eso cada
// restricción vive en una constante y los bloques más específicos repiten las
// generales además de añadir las suyas.
const serverOnlyPackage = {
  name: "server-only",
  message:
    "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
};

// En este despliegue (Nitro, preset `vercel`) su `waitUntil` no hace nada y no
// avisa: así se perdió un correo (ticket 15). El puente que funciona es el de
// la petición.
const vercelFunctionsPackage = {
  name: "@vercel/functions",
  message:
    "Su `waitUntil` no hace nada en este despliegue. Usa `afterResponse` de `@/lib/after-response.server`.",
};

const supabaseAdminStaticImport = {
  selector: 'ImportDeclaration[source.value="@/integrations/supabase/client.server"]',
  message:
    'No importes aquí el cliente de servicio arriba del todo: cárgalo dentro del handler con await import("@/integrations/supabase/client.server").',
};

// La tabla de composición (~200 alimentos, 44 KB) solo la necesita el servidor: desde
// fuera de src/lib/nutrition/ se usa a través de sus funciones, y el bundle del
// navegador no debe llevarla (scripts/check-client-bundle.sh lo comprueba en la
// salida del build; esto lo para antes, en el código).
const FOODS_DATA_MESSAGE =
  "La tabla de composición (foods.data) no puede llegar al bundle del navegador: impórtala solo desde src/lib/nutrition/, un *.server.ts o un test, o, desde el cliente, usa módulos de @/lib/nutrition/ que no la carguen (energy, portion).";

const foodsDataImport = { regex: "(^|/)foods\\.data(\\.ts)?$", message: FOODS_DATA_MESSAGE };

const foodsDataDynamicImport = {
  selector: "ImportExpression[source.value=/(^|\\/)foods\\.data(\\.ts)?$/]",
  message: FOODS_DATA_MESSAGE,
};

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      ".tanstack",
      ".vercel",
      ".wrangler",
      "mobile",
      "src/routeTree.gen.ts",
      // Salida de Playwright (smoke E2E).
      "playwright-report",
      "test-results",
      // Worktrees de Claude Code: copias completas del repo que no son código de la app.
      ".claude",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": ["error", { paths: [serverOnlyPackage, vercelFunctionsPackage] }],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // El cliente con la clave de servicio se salta RLS. Importarlo arriba del
    // todo solo es seguro dentro de otro `*.server.ts`: los archivos de ruta y
    // los `*.functions.ts` se empaquetan también para el navegador, así que ahí
    // hay que cargarlo dentro del handler con `await import(...)`. El selector
    // mira solo los import estáticos, que son los que arrastran el módulo al
    // bundle; los dinámicos siguen permitidos.
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["**/*.server.ts"],
    rules: {
      "no-restricted-syntax": ["error", supabaseAdminStaticImport],
    },
  },
  {
    // foods.data: fuera de su carpeta, de un *.server.ts o de un test, ni
    // import estático ni dinámico (un import() también acaba en el navegador,
    // como chunk aparte). Repite las restricciones generales: ver arriba.
    files: ["src/**/*.ts", "src/**/*.tsx"],
    ignores: ["**/*.server.ts", "**/*.test.ts", "src/lib/nutrition/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [serverOnlyPackage, vercelFunctionsPackage], patterns: [foodsDataImport] },
      ],
      "no-restricted-syntax": ["error", supabaseAdminStaticImport, foodsDataDynamicImport],
    },
  },
  eslintPluginPrettier,
);
