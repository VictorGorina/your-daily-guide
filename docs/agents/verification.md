# Verificación: cómo se demuestra que un cambio funciona

Este repo no tiene entorno de staging ni base de datos local. La regla es: **no des un
cambio por terminado sin una prueba concreta de que funciona y de que no ha roto otra cosa.**
"Debería funcionar" no cuenta. Este documento lista las comprobaciones disponibles y cuándo
aplica cada una.

## 1. Puertas estáticas (siempre, antes de dar nada por hecho)

```sh
bun run lint                    # ESLint + Prettier (falla si el formato no está aplicado)
bun run typecheck               # tsc del código de app
bun run typecheck:test          # tsc con los *.test.ts dentro (ver docs/agents/testing.md)
bun test                        # suite de lógica pura (ver docs/agents/testing.md)
```

Las cuatro corren en segundos y son las mismas que ejecuta el CI en cada PR
([.github/workflows/ci.yml](../../.github/workflows/ci.yml)). Si tocas lógica de plan,
compra, fechas o parsers, **añade o actualiza el test** antes de cerrar — es la única
defensa contra el bucle "arreglo un bug y salen dos".

## 2. Comprobación en el navegador (web)

Cuando el cambio se ve o se ejecuta en la app web:

1. `preview_start` con la config `your-daily-guide-dev` de [.claude/launch.json](../../.claude/launch.json)
   (levanta `bun run dev` en el 8080).
2. Recarga si no hay HMR.
3. Revisa `read_console_messages`, `preview_logs` y `read_network_requests` en busca de
   errores — no solo la pantalla.
4. `read_page` para verificar contenido y estructura; `computer` / `form_input` para probar
   interacciones y volver a leer.
5. `resize_window` para responsive y modo oscuro si tocaste layout o tema.
6. Cierra con un `screenshot` para el usuario si hubo cambio visual.

### Perfil demo obligatorio para cualquier cambio que mute datos

El preview corre contra el proyecto **real** de Supabase. Para cualquier comprobación que
escriba datos (registrar una comida, cambiar ajustes, generar un plan) entra con el botón
**"Probar con un perfil aleatorio"** de la pantalla de login: crea un perfil demo
desechable. La cuenta real del usuario es solo para miradas de lectura. Esto fue una
corrección directa: cambiar los ajustes reales del usuario para probar algo no está
permitido.

Trucos útiles con el perfil demo:

- Para un registro de un día pasado: `PATCH` de la fila `daily_logs` del demo con un
  `log_date` anterior vía API REST.
- Para confirmar que una migración llegó: sondea columnas por PostgREST con una columna
  falsa como control (real = 200, falsa = 400).
- Los guardados `onBlur` necesitan un evento `focusout` (no `blur`) para disparar a través
  de la delegación de eventos de React.

## 3. Base de datos

Las migraciones van con la **CLI de Supabase** (ticket 24 de la auditoría), ya no pegando SQL en
el panel. El historial remoto (`supabase_migrations.schema_migrations`) tiene registradas todas las
de `supabase/migrations/` desde la línea base del 2026-10-04.

```sh
export SUPABASE_DB_PASSWORD="$(grep -E '^SUPABASE_DB_PASSWORD=' .env | cut -d= -f2-)"
supabase migration list       # local frente a remoto; deben coincidir
supabase db push --dry-run    # qué se aplicaría, sin aplicarlo
supabase db push              # aplica SOLO lo que falta en el historial
bun run db:types              # después: regenera los tipos de las dos apps
```

- Hace falta `supabase login` (una vez por máquina) y `SUPABASE_DB_PASSWORD` en `.env`. En una red
  sin IPv6, `supabase link --project-ref tocmrlmxrwylyniyjtlv` para que use el pooler IPv4.
- `db push` va contra producción: antes, siempre `--dry-run`, y que lo pida la persona.
- Si alguien aplica algo a mano en el SQL Editor, hay que registrarlo después con
  `supabase migration repair --status applied <versión>`, o el siguiente `db push` lo repetirá.
- Una migración que no debe aplicarse todavía vive en `supabase/pending/` (ver su README), no en
  `migrations/`: `db push` ejecuta todo lo que encuentra ahí.
- `bun run db:types` (`scripts/db-types.sh`) lee el esquema de producción y escribe
  `src/integrations/supabase/types.ts` y su copia `mobile/lib/database.types.ts`, ya formateados.
  No se editan a mano: una tabla o columna nueva llega con su migración y con esta orden, en el
  mismo commit. `check-shared-drift.sh` falla si las dos copias difieren.
- No hay Docker en esta máquina: `supabase db diff`, `start` y `reset` no funcionan.

Para inspeccionar datos desde la terminal, `scripts/db.ts` (atajo `bun run db`) es un
inspector de solo lectura por PostgREST — no ejecuta SQL, solo `select` / count / probe:

```sh
bun run db profiles --count                     # nº de filas
bun run db profiles --probe menstrual_cycle     # ¿existe la columna? (tras una migración)
bun run db daily_logs --eq log_date=2026-08-29 --select id,meals --limit 5
```

Usa la `SUPABASE_SERVICE_ROLE_KEY` y se salta RLS: es para mirar, no para escribir. Nunca
escribas en la BD real para "probar" — usa el perfil demo desde la app.

Los datos de salud, el texto libre, los nombres y el código de invitación de personas reales salen
enmascarados (`SENSITIVE_COLUMNS` en `scripts/db-mask.ts`): sin `--select` ni aparecen, y pedidos
con `--select` salen como `"[oculto]"`. `--unmask` los enseña con un aviso en rojo; no lo uses
en una sesión de agente, porque lo impreso acaba en la transcripción. Una columna sensible
nueva se añade a esa lista. Para comprobar un cambio, suele bastar con mirar los nombres
(`bun run db profiles --limit 1 2>/dev/null | jq '.[0] | keys'`).

`bun run foods:review --mark` y `bun run recipes:review --mark`, los dos únicos scripts que
escriben, enseñan la fila y piden `s/N` antes de hacerlo; sin terminal interactiva se niegan
salvo con `--yes`.

Si en algún momento se quiere consultar la BD desde el chat sin salir a la terminal, el MCP
oficial de Supabase (`@supabase/mcp-server-supabase --read-only --project-ref <id>`) en un
`.mcp.json` lo hace — necesita un _personal access token_ de la cuenta de Supabase, no la
service-role key. No está montado a propósito: el script cubre el caso sin credenciales
nuevas.

## 4. App móvil (`mobile/`)

Codebase aparte: `mobile/` tiene su propia copia de cada pantalla y sus propios imports de
iconos (`lucide-react-native`, no `lucide-react`). Si el cambio toca una superficie
compartida (rutas `/api/v1/*`, auth, esquema de Supabase, o una pantalla que existe en las
dos apps):

1. Aplícalo **primero** en `mobile/` (lee [mobile/AGENTS.md](../../mobile/AGENTS.md)).
2. Verifícalo en el simulador de iOS: screenshot tras recargar.
3. Solo entonces está terminado. No asumas que un cambio en `src/` basta, y no esperes a
   que el usuario note la diferencia.

Claude no puede manejar un iPhone físico — solo el simulador.

## 5. Qué significa "terminado"

- Puertas estáticas en verde (`lint`, `tsc`, `test`).
- Prueba concreta del camino que tocaste (test nuevo, screenshot, respuesta de red, o log
  del servidor) — enséñala, no la resumas.
- Si algo falla o se saltó un paso, dilo con la salida real. No hay crédito por decir que
  funciona cuando no se ha comprobado.
