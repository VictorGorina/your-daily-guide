import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

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
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
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
      "no-restricted-syntax": [
        "error",
        {
          selector: 'ImportDeclaration[source.value="@/integrations/supabase/client.server"]',
          message:
            'No importes aquí el cliente de servicio arriba del todo: cárgalo dentro del handler con await import("@/integrations/supabase/client.server").',
        },
      ],
    },
  },
  eslintPluginPrettier,
);
