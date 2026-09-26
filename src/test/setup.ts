/**
 * Preload de `bun test` (ver `bunfig.toml`). En local `bun test` carga el
 * `.env`, así que un test que tocara el `supabaseAdmin` de verdad hablaría con
 * la base de datos de producción con la clave de servicio. Aquí se sustituye
 * `client.server` para toda la suite: por defecto cualquier acceso lanza, y un
 * test que lo necesite lo apunta a su doble con `setFakeAdmin(fake.client)`.
 */
import { afterEach, mock } from "bun:test";

import { resetFakeAdmin, testAdmin } from "./admin";

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: testAdmin }));

afterEach(resetFakeAdmin);
