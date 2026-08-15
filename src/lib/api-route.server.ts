/**
 * Expone una server function existente como handler HTTP POST.
 *
 * React Native no sabe llamar server functions de TanStack Start (dependen del
 * bundle web), así que la app nativa necesita HTTP normal. En vez de duplicar la
 * lógica, la ruta invoca aquí dentro la MISMA server function que usa la web: su
 * middleware lee la cabecera Authorization de esta petición, con lo que la
 * sesión y las políticas RLS son idénticas por los dos caminos. Un único sitio
 * donde vive cada operación.
 *
 * Lo que sí aporta este envoltorio es traducir los errores a códigos HTTP: el
 * middleware lanza excepciones (pensadas para el canal RPC de la web) que sin
 * esto saldrían todas como 500, incluida la falta de sesión.
 */
/** Firma común a las server functions, con o sin `inputValidator`. */
type ServerFn<TOutput> = (opts: { data: never }) => Promise<TOutput>;

export function apiPost<TOutput>(fn: ServerFn<TOutput>) {
  return async ({ request }: { request: Request }): Promise<Response> => {
    let data: unknown = undefined;
    if (request.headers.get("content-type")?.includes("application/json")) {
      try {
        data = await request.json();
      } catch {
        return Response.json({ error: "JSON no válido" }, { status: 400 });
      }
    }

    try {
      // El tipo de `data` lo fija el inputValidator de cada server function; aquí
      // llega como JSON sin tipar y es ese validador quien lo comprueba.
      const result = await fn({ data } as { data: never });
      return Response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error inesperado";
      // El middleware de auth prefija sus mensajes con "Unauthorized"; sin sesión
      // la respuesta debe ser 401 para que el cliente sepa que toca reautenticar
      // en vez de reintentar.
      const status = message.startsWith("Unauthorized") ? 401 : 500;
      if (status === 500) console.error("apiPost", error);
      return Response.json({ error: message }, { status });
    }
  };
}
