/**
 * El `supabaseAdmin` que ven los módulos en los tests (lo instala `setup.ts`).
 * Sin `setFakeAdmin`, cualquier acceso lanza: ningún test llega a producción
 * por olvido.
 */
let current: object | null = null;

export const testAdmin = new Proxy(
  {},
  {
    get(_, prop) {
      if (!current) {
        throw new Error(
          `Un test ha usado el supabaseAdmin real (.${String(prop)}): llama antes a setFakeAdmin(fake.client).`,
        );
      }
      return Reflect.get(current, prop);
    },
  },
);

/** Apunta `supabaseAdmin` a un doble hasta el final del test (`afterEach` lo suelta). */
export function setFakeAdmin(client: object): void {
  current = client;
}

export function resetFakeAdmin(): void {
  current = null;
}
