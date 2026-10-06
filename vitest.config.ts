import { fileURLToPath } from "node:url";

import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Tests de COMPONENTES (ticket 25 de la auditoría): React Testing Library sobre
// jsdom. Config aparte de vite.config.ts a propósito: aquí no va el plugin de
// TanStack Start (ni su protección de imports, ni Nitro), solo React y el
// alias `@`. La lógica pura sigue con `bun test`; el sufijo `.vitest.tsx` hace
// que cada runner vea solo lo suyo (`bun test` recoge `*.test.*`). Ver
// docs/agents/testing.md.
export default defineConfig({
  plugins: [viteReact()],
  // El mismo alias `@/*` de tsconfig.json.
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.vitest.tsx"],
    setupFiles: ["./src/test/vitest-setup.ts"],
    // Un test que se queda esperando algo que no llega falla pronto.
    testTimeout: 10_000,
    restoreMocks: true,
  },
});
