import { defineConfig, devices } from "@playwright/test";

// Smoke E2E (ticket 25 de la auditoría): el build de producción servido en
// local, contra el Supabase LOCAL (`supabase start`, con `supabase/seed.sql`)
// y con un OpenRouter de mentira (`e2e/mock-openrouter.ts`). Lo lanza el job
// `e2e` del CI; en una máquina con Docker, `supabase start` y después
// `bash scripts/e2e.sh`. Ver docs/agents/testing.md.

const APP_PORT = 4173;
const MOCK_PORT = 4010;

const supabaseUrl = process.env.E2E_SUPABASE_URL ?? "";
const anonKey = process.env.E2E_SUPABASE_ANON_KEY ?? "";
const serviceKey = process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ?? "";

// El smoke ESCRIBE (marca una comida, crea el día). Solo puede apuntar a una
// base local: con las variables de un `.env` de verdad no arranca.
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(supabaseUrl) || !anonKey || !serviceKey) {
  throw new Error(
    "Los tests E2E solo corren contra el Supabase local: lánzalos con `bash scripts/e2e.sh` " +
      "(pone E2E_SUPABASE_URL, E2E_SUPABASE_ANON_KEY y E2E_SUPABASE_SERVICE_ROLE_KEY).",
  );
}

export default defineConfig({
  testDir: "e2e",
  testMatch: "*.spec.ts",
  // Un solo navegador y en serie: todos los tests comparten la base y a Ana.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    locale: "es-ES",
    // La misma zona que la base (`current_date` del seed decide el mes del plan).
    timezoneId: "UTC",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Pixel 7"] } }],
  webServer: [
    {
      command: "bun e2e/mock-server.ts",
      url: `http://127.0.0.1:${MOCK_PORT}/health`,
      env: { MOCK_OPENROUTER_PORT: String(MOCK_PORT) },
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      // El build de siempre con el preset `node-server` de Nitro en vez del de
      // Vercel: el mismo código, pero como un servidor que se puede arrancar
      // aquí (`vite preview` no sabe servir la salida de Vercel).
      command: "bun run build && node .output/server/index.mjs",
      url: `http://127.0.0.1:${APP_PORT}/api/health`,
      timeout: 240_000,
      reuseExistingServer: false,
      stdout: "pipe",
      env: {
        NITRO_PRESET: "node-server",
        HOST: "127.0.0.1",
        PORT: String(APP_PORT),
        // El navegador las recibe en el build; el servidor las lee al arrancar.
        VITE_SUPABASE_URL: supabaseUrl,
        VITE_SUPABASE_PUBLISHABLE_KEY: anonKey,
        SUPABASE_URL: supabaseUrl,
        SUPABASE_PUBLISHABLE_KEY: anonKey,
        SUPABASE_SERVICE_ROLE_KEY: serviceKey,
        OPENROUTER_API_KEY: "e2e",
        OPENROUTER_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/api/v1`,
        PUBLIC_URL: `http://127.0.0.1:${APP_PORT}`,
        // Nada de esto en el smoke: ni CAPTCHA, ni Sentry, ni inglés.
        VITE_TURNSTILE_SITE_KEY: "",
        VITE_SENTRY_DSN: "",
        SENTRY_DSN: "",
        VITE_I18N_EN: "",
      },
    },
  ],
});
