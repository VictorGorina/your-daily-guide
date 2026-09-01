# Code review: checklist del proyecto

Lista de lo que se corrige una y otra vez en este repo. La usa la skill `/senda-review`
(ver [.claude/skills/senda-review/SKILL.md](../../.claude/skills/senda-review/SKILL.md)) y
merece la pena repasarla también al final de cualquier cambio no trivial, antes de decir
que está terminado.

No sustituye a `/code-review` (que busca bugs de corrección genéricos) — esto es lo
**específico de este proyecto**: convenciones, invariantes de dominio y decisiones de diseño
ya tomadas que un cambio nuevo tiende a romper sin querer.

## Formato y lenguaje

- [ ] `bun run lint` pasa. Prettier: `printWidth` 100, comillas dobles, `;` siempre. Este es
      el olvido más frecuente del historial — no lo dejes para el CI.
- [ ] Identificadores, tipos y columnas de BD en **inglés**; strings de usuario y comentarios
      en **español**. Nada de identificadores en español en código nuevo.
- [ ] Excepciones que se quedan en español a propósito: nombres y claves de argumentos de las
      herramientas del coach (`cambiar_plato`, `fecha`, `comida`, `plato`, `motivo`) porque
      van tejidos en el prompt español, y las URLs de ruta (`/hoy`, `/hogar`, `/ajustes`) por
      su radio de impacto (router, ~130 enlaces, deep links nativos, redirect de OAuth).

## Frontera cliente / servidor

- [ ] Lógica que solo debe correr en servidor → módulo `*.server.ts`, nunca importado desde
      cliente. El lint prohíbe el paquete `server-only` de Next; la alternativa es el sufijo
      o `@tanstack/react-start/server-only`.
- [ ] Solo llegan al bundle del cliente las variables con prefijo `VITE_`. Ningún secreto
      (service role, `OPENROUTER_API_KEY`, VAPID privada, `CRON_SECRET`) fuera del servidor.
- [ ] Se usa el cliente de usuario de Supabase donde las políticas RLS bastan; la service
      role solo cuando de verdad hace falta saltárselas.

## API HTTP espejo (`/api/v1/*`)

- [ ] Toda server function nueva tiene su ruta HTTP equivalente bajo
      [src/routes/api/v1/](../../src/routes/api/v1), porque la app móvil no puede llamar
      server functions de TanStack Start.
- [ ] La ruta **no** duplica lógica: invoca la misma server function vía `apiPost`
      ([src/lib/api-route.server.ts](../../src/lib/api-route.server.ts)). Añadir una operación
      a la API son tres líneas.
- [ ] El cliente se guía por el campo `error` del JSON, **no** por el código HTTP: `apiPost`
      devuelve `500` tanto para fallos reales como para errores de validación pensados para
      enseñarse en pantalla ("Mes no válido").

## Invariantes del plan y la compra

Definidos en [src/lib/plan.functions.ts](../../src/lib/plan.functions.ts) y
[src/lib/plan-shared.ts](../../src/lib/plan-shared.ts). Romperlos es el fallo clásico.

- [ ] **El día de hoy no se toca nunca.** `setPlanMeal` cambia un plato de hoy en adelante
      tal cual lo pide la persona (sin IA). `adjustMonthlyPlan` recoloca solo días futuros.
- [ ] Un cambio a mano se guarda en campos propios del día (`breakfast`/`snack` en `PlanDay`)
      y manda sobre la rotación semanal. `mergeFuturePlan` los conserva: una recolocación
      automática posterior no pisa `breakfast`/`snack`/`extras`.
- [ ] **La lista de la compra nunca cambia** por un cambio de plan. Si un plato pide algo no
      comprado, se guarda igual y los ingredientes que faltan quedan en `PlanDay.extras`
      como aviso.
- [ ] El emparejamiento de un `ShoppingItem` al marcarlo "comprado" (`toggleShoppingOwned`)
      es por `name` + `trip` juntos, nunca solo por `name`. **Excepción deliberada:**
      `carryOwnedByName` (al cambiar de cadencia) empareja **solo por `name`** a propósito —
      el reparto de `trip` se rehace de cero y sus números viejos ya no significan nada, y
      "en casa" es un estado de mes.
- [ ] Los tramos de compra (`tripDayRange`, `groupByTrip`) se calculan con `tripsOfCadence`,
      no escaneando los datos: un tramo sin artículos sigue apareciendo vacío.
- [ ] El estado de una comida es **por usuario**, nunca se sincroniza al hogar.

## Diseño y paridad web / móvil

- [ ] Sigue [docs/design-guidelines.md](../design-guidelines.md): un solo naranja de marca
      por pantalla, sin bordes de 1px (jerarquía por fondo y radio), solo dos sombras en toda
      la app, cero emoji, sin blanco ni negro puro. El historial muestra deriva aquí.
- [ ] Sin mecánicas de castigo: nada de rojo en el semáforo de cumplimiento, saltar una
      comida es neutro, la racha es "impulso" (EMA, nunca se resetea a cero).
- [ ] Cualquier color cambiado en la web (`oklch()` en [src/styles.css](../../src/styles.css))
      se replica **a mano** en [mobile/tailwind.config.js](../../mobile/tailwind.config.js)
      convertido a hex. Son dos copias, no una fuente compartida.
- [ ] Cambio en superficie compartida (`/api/v1/*`, auth, esquema, o pantalla que existe en
      las dos apps) → aplicado también en `mobile/` y verificado en el simulador
      (screenshot tras recargar) antes de cerrar. `mobile/` tiene su propia copia de cada
      pantalla y sus imports de icono (`lucide-react-native`).

## Datos, seguridad y migraciones

- [ ] Cambio de esquema → migración nueva en `supabase/migrations/` con el prefijo de
      timestamp del formato existente. Se aplica a mano pegándola en el SQL Editor.
- [ ] Políticas RLS consideradas para cualquier tabla nueva o columna sensible.
- [ ] Toda lectura de `monthly_plans` que espere **una sola fila propia** filtra por
      `.eq("user_id", …)` explícitamente, no se apoya solo en la RLS. Desde la feature
      Familia hay una policy de SELECT permisiva (un miembro del hogar ve también la fila
      del planificador), así que un `.maybeSingle()` sin ese filtro devuelve 2 filas y
      lanza `PGRST116` para un no planificador. En server functions se usa el helper
      `ownPlanRow` de [src/lib/plan.functions.ts](../../src/lib/plan.functions.ts).
- [ ] Parámetros de redirect validados con `safeInternalPath`
      ([src/lib/safe-next.ts](../../src/lib/safe-next.ts)) — rechaza `//host`, `/\host` y
      URLs absolutas.
- [ ] Nada de datos personales en query strings ni en logs.

## Onboarding y coach

- [ ] El onboarding se queda largo (~25 preguntas, una vez). No propongas recortarlo: la
      fricción se arregla con edición posterior (`perfil.tsx`, herramienta `actualizar_perfil`
      del coach) y con movimiento, no con menos preguntas.
- [ ] `profiles.tone` (relajado/neutro/exigente) afecta a **tres** superficies desde un solo
      campo: copy y frecuencia del push, repaso nocturno (`NightlyReviewSheet`) y prompt del
      coach (`toneLine`). Si tocas una, revisa las tres.
- [ ] El coach es una burbuja flotante (`coach-fab.tsx`), no una pestaña de navegación.

## Cómo mantener esto vivo

Después de una ronda de review o cuando el usuario corrige algo que no está aquí: añade la
entrada. La lista solo sirve si refleja lo que de verdad se corrige hoy. Revísala cada pocas
semanas y borra lo que ya sea automático.
