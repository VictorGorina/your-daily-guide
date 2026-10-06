import { createFileRoute } from "@tanstack/react-router";

// Universal Links de iOS (ticket 38, MOB-02): Apple lee este archivo para saber
// qué app puede abrir enlaces de este dominio. Así los enlaces de confirmar la
// cuenta y de restablecer la contraseña pedidos desde el móvil llegan a Peppers
// por https, y no por `dailyguide://`, un esquema que cualquier otra app puede
// registrar para quedarse con los tokens del enlace.
//
// Solo los enlaces con `?app=1` (los pone `auth.server.ts` cuando la petición
// viene del móvil): los del flujo web se siguen abriendo en el navegador aunque
// el iPhone tenga la app. Es una ruta y no un archivo de `public/` porque no
// lleva extensión y Apple lo quiere como `application/json`.
const APP_ID = "WR7LMWQ7ZQ.com.victorgorina.dailyguide";

const association = {
  applinks: {
    details: [
      {
        appIDs: [APP_ID],
        components: [
          { "/": "/confirmado", "?": { app: "1" } },
          { "/": "/restablecer", "?": { app: "1" } },
        ],
      },
    ],
  },
};

export const Route = createFileRoute("/.well-known/apple-app-site-association")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify(association), {
          headers: {
            "content-type": "application/json",
            "cache-control": "public, max-age=3600",
          },
        }),
    },
  },
});
