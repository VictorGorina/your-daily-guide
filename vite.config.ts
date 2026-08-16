import { fileURLToPath } from "node:url";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import tailwindcss from "@tailwindcss/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type PluginOption, type UserConfig } from "vite";
import tsConfigPaths from "vite-tsconfig-paths";

// Config propia de Vite + TanStack Start, sin envoltorios externos: monta a
// mano lo mismo que antes montaba el paquete de configuración de la
// plantilla original (TanStack Start, React, Tailwind v4, alias de rutas y
// el build de producción para Vercel vía Nitro), para que el proyecto no
// dependa de nada fuera de este repositorio.
export default defineConfig(async ({ command, mode }): Promise<UserConfig> => {
  const isDevBuild = command === "build" && mode === "development";

  // Expone las variables de entorno con prefijo VITE_ como import.meta.env.*
  // en el bundle del cliente (comportamiento estándar de Vite, explícito
  // aquí porque lo hacíamos vía loadEnv en vez de dejarlo implícito).
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const envDefine = Object.fromEntries(
    Object.entries(env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)]),
  );

  const plugins: PluginOption[] = [];

  if (mode === "development") {
    const { devtools } = await import("@tanstack/devtools-vite");
    plugins.push(
      devtools({
        logging: false,
        eventBusConfig: { enabled: false },
        enhancedLogs: { enabled: false },
        consolePiping: { enabled: false },
        removeDevtoolsOnBuild: false,
        injectSource: { enabled: true },
      }),
    );
  }

  plugins.push(tailwindcss());
  plugins.push(tsConfigPaths({ projects: ["./tsconfig.json"] }));

  plugins.push(
    tanstackStart({
      // Evita que código pensado solo para el servidor (rutas server/, "server-only")
      // acabe colándose en el bundle del cliente.
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
      // src/server.ts es nuestro wrapper de errores SSR; ver ese archivo.
      server: { entry: "server" },
    }),
  );

  // Nitro solo hace falta al construir para producción/preview, no en `vite dev`.
  if (command === "build") {
    const { nitro } = await import("nitro/vite");
    plugins.push(nitro({ defaultPreset: "vercel" }));
  }

  plugins.push(viteReact());

  return {
    define: envDefine,
    ...(isDevBuild
      ? {
          environments: {
            client: { define: { "process.env.NODE_ENV": JSON.stringify("development") } },
          },
          esbuild: { keepNames: true },
        }
      : {}),
    css: { transformer: "lightningcss" as const },
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
      dedupe: [
        "react",
        "react-dom",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "@tanstack/react-query",
        "@tanstack/query-core",
        // ai-sdk pide zod v3, el proyecto usa v4: sin dedupe se rompía la
        // inicialización del módulo en /chat (dos instancias de zod a la vez).
        "zod",
      ],
    },
    optimizeDeps: {
      include: [
        "react",
        "react-dom",
        "react-dom/client",
        "react/jsx-runtime",
        "react/jsx-dev-runtime",
        "zod",
      ],
      ignoreOutdatedRequests: true,
    },
    server: {
      host: "::",
      port: 8080,
      watch: { awaitWriteFinish: { stabilityThreshold: 1000, pollInterval: 100 } },
    },
    plugins,
  };
});
