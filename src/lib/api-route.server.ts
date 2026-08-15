import { authFromRequest, type RequestAuth } from "@/lib/request-auth.server";

/**
 * Envuelve una operación de negocio como handler HTTP POST autenticado.
 *
 * Las server functions de TanStack Start solo saben llamarse desde el bundle
 * web; la app nativa necesita HTTP normal. En vez de duplicar la lógica, cada
 * operación vive en una función `(auth, data) => resultado` y se expone por los
 * dos caminos: la server function existente y una ruta /api/v1/*. Este helper es
 * el lado HTTP — la validación de entrada se comparte pasando el mismo
 * `validate` que usa el `inputValidator` de la server function.
 */
export function apiHandler<TInput, TOutput>(op: {
  validate: (input: never) => TInput;
  run: (auth: RequestAuth, data: TInput) => Promise<TOutput>;
}) {
  return async ({ request }: { request: Request }): Promise<Response> => {
    const auth = await authFromRequest(request);
    if (!auth) return new Response("Unauthorized", { status: 401 });

    let input: unknown = undefined;
    if (request.headers.get("content-type")?.includes("application/json")) {
      try {
        input = await request.json();
      } catch {
        return new Response("JSON no válido", { status: 400 });
      }
    }

    let data: TInput;
    try {
      data = op.validate(input as never);
    } catch (error) {
      // Los validadores lanzan mensajes pensados para leerse en pantalla
      // ("Mes no válido"), así que se devuelven tal cual como 400.
      return jsonError(error, 400);
    }

    try {
      return Response.json(await op.run(auth, data));
    } catch (error) {
      console.error("apiHandler", error);
      return jsonError(error, 500);
    }
  };
}

function jsonError(error: unknown, status: number): Response {
  const message = error instanceof Error ? error.message : "Error inesperado";
  return Response.json({ error: message }, { status });
}
