import { createFileRoute } from "@tanstack/react-router";

import { captchaPageHtml } from "@/lib/captcha-page";

// La página del reto de Turnstile para el WebView de la app nativa (ticket 29;
// ver src/lib/captcha-page.ts). No es un espejo de una server function: es la
// única forma de que el móvil consiga un token, porque Cloudflare solo lo da en
// los dominios del widget. Sin sesión, como el resto de /api/v1/auth/*: quien
// la abre todavía no ha entrado. Sin clave de sitio, la página dice "off" y la
// app sigue sin esperar. Su script va en línea: cuando la CSP deje
// `'unsafe-inline'` por nonces (ticket 37), esta respuesta necesitará el suyo.
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

export const Route = createFileRoute("/api/v1/auth/captcha")({
  server: {
    handlers: {
      GET: () =>
        new Response(captchaPageHtml(SITE_KEY), {
          headers: {
            "content-type": "text/html; charset=utf-8",
            // Cada apertura pide un token nuevo: nada de una copia guardada.
            "cache-control": "no-store",
          },
        }),
    },
  },
});
