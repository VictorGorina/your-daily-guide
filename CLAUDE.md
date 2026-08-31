# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Este repositorio contiene dos apps que comparten el mismo backend de Supabase pero **no** son un
monorepo (no hay `packages/shared/`, cada una instala sus propias dependencias):

- **Web** (raíz, `src/`): la app principal. TanStack Start + React + TypeScript + Tailwind v4,
  gestionada con **Bun**.
- **Móvil** (`mobile/`): app nativa de iOS en Expo/React Native, gestionada con **npm** (Metro no
  corre sobre Bun). Tiene su propio [mobile/AGENTS.md](mobile/AGENTS.md) — léelo antes de tocar
  código ahí.

Este archivo cubre sobre todo la web. Para la arquitectura en detalle (con el porqué de cada
decisión), lee también [AGENTS.md](AGENTS.md) en la raíz — este CLAUDE.md resume lo esencial, pero
AGENTS.md tiene la explicación larga de varias piezas no obvias.

## Comandos (web, raíz del repo)

```sh
bun install       # instalar dependencias
bun run dev       # servidor de desarrollo, http://localhost:8080
bun run build     # build de producción (preset Vercel vía Nitro)
bun run preview   # sirve el build de producción en local
bun run lint      # ESLint
bun run typecheck # tsc del código de app (los *.test.ts van aparte, ver docs/agents/testing.md)
bun run test      # suite de lógica pura con el runner de Bun
bun run format    # Prettier --write
```

`bun run test` cubre la lógica pura donde un bug pasa desapercibido — plan, compra, fechas,
parsers de la salida de la IA — con el runner de Bun (sin dependencias nuevas). Ver
[docs/agents/testing.md](docs/agents/testing.md). No hay tests de componentes ni E2E todavía;
Vitest es el siguiente escalón cuando hagan falta.

Necesitas un `.env` con tus propias claves (Supabase + `OPENROUTER_API_KEY` para el coach; VAPID y
`CRON_SECRET` para las notificaciones push — ver la lista completa de variables en `.env` o en
AGENTS.md).

## Comandos (móvil, `mobile/`)

```sh
cd mobile
npx expo start     # Metro, requiere Xcode para el simulador
npx expo run:ios   # compila y lanza en el simulador
```

Detalles importantes (versiones fijadas, `ios/` autogenerado, locale UTF-8 para `pod install`,
caché de Metro) están en [mobile/AGENTS.md](mobile/AGENTS.md) — no los repitas de memoria, léelos
antes de tocar algo ahí.

## Arquitectura de la web

**Stack:** TanStack Start (React con SSR) + TypeScript + Tailwind v4 + Supabase + OpenRouter
(`google/gemini-2.5-flash` vía `@openrouter/ai-sdk-provider`, ver
[src/lib/ai-provider.server.ts](src/lib/ai-provider.server.ts)). Se despliega en Vercel (preset
`vercel` de Nitro, configurado en [vite.config.ts](vite.config.ts)).

**Rutas:** enrutado por archivos en `src/routes/`, según las convenciones de TanStack Start (no
las de Next.js/Remix) — están explicadas en [src/routes/README.md](src/routes/README.md).
`src/routes/routeTree.gen.ts` es autogenerado; no se edita a mano.

**Server-only:** los módulos que solo deben ejecutarse en el servidor se nombran `*.server.ts`
(TanStack Start no usa el paquete `server-only` de Next.js; un lint en
[eslint.config.js](eslint.config.js) prohíbe importarlo y explica la alternativa).

**API HTTP espejo (`/api/v1/*`):** cada server function de la web tiene también una ruta HTTP en
[src/routes/api/v1/](src/routes/api/v1), porque la app móvil no puede llamar server functions de
TanStack Start (dependen del bundle web) y necesita HTTP normal. La ruta no duplica lógica: invoca
la misma server function vía `apiPost` ([src/lib/api-route.server.ts](src/lib/api-route.server.ts)),
así que la sesión, la validación y las políticas RLS son idénticas por los dos caminos. Al añadir
una operación nueva, exponerla en la API son tres líneas — la lógica de negocio vive en un único
sitio. Ojo: `apiPost` devuelve `500` tanto para fallos reales como para errores de validación
pensados para enseñarse en pantalla; el cliente debe guiarse por el campo `error` del JSON, no
solo por el código HTTP.

**Supabase:** [src/integrations/supabase/client.ts](src/integrations/supabase/client.ts) es el
cliente de navegador; `client.server.ts` el de servidor. `auth-middleware.ts` valida la sesión (web
y, vía cabecera `Authorization`, también las peticiones de `/api/v1/*`). Las migraciones SQL viven
en `supabase/migrations/`.

**Plan de comidas — dos caminos deliberadamente separados** (ver
[src/lib/plan.functions.ts](src/lib/plan.functions.ts) y
[src/lib/plan-shared.ts](src/lib/plan-shared.ts)):

- `setPlanMeal` cambia un plato de un día concreto tal cual lo pide la persona, sin IA de por
  medio — así es verificable que se aplicó lo pedido.
- `adjustMonthlyPlan` recoloca varios días futuros para compensar (comió de más, hizo ejercicio);
  el día de hoy nunca se toca.

Un cambio a mano se guarda en campos propios del día (`breakfast`/`snack` en `PlanDay`) y manda
sobre la rotación semanal por defecto; una recolocación automática posterior los respeta y no los
pisa (`mergeFuturePlan`). La lista de la compra nunca cambia — si un plato pide algo no comprado,
se guarda igual y aparece como aviso en `PlanDay.extras`.

**Pantalla Plan — navegación de meses y unificación de Historial.** La pantalla tiene dos
subpestañas (Plan e Ingredientes; ya no hay "Historial") y un selector `‹ mes ›` en la cabecera
que gobierna toda la pantalla. El calendario del mes es el navegador del historial: los días
pasados llevan el semáforo de cumplimiento (`ratioSignal`, sin rojo) y abren un detalle reducido
del día (`day-detail-sheet.tsx`). El navegador no baja del mes de `profiles.app_started_on` ni
sube más allá del mes que viene, y este último solo se puede generar/accionar en su última semana
(`isNextMonthUnlocked`, umbral `NEXT_MONTH_UNLOCK_DAYS = 7`, el mismo del aviso push de
renovación). `generateMonthlyPlan` rechaza en servidor los meses pasados y el mes que viene aún
bloqueado. Meses pasados: solo lectura. Helpers de mes en `plan-shared.ts` (`planMonthStatus`,
`isMonthActionable`, `planNavBounds`, `addMonths`, `monthTitle`).

**Notificaciones push:** Web Push real (VAPID) vía `@pushforge/builder`, elegido porque solo usa
Web Crypto API (el paquete `web-push` de npm no funciona en el runtime de despliegue). El disparo
periódico no usa un cron nativo de la plataforma — un workflow de GitHub Actions
([.github/workflows/push-dispatch.yml](.github/workflows/push-dispatch.yml)) llama cada 15 min a
`POST /api/cron/dispatch`, que reutiliza
[src/lib/push-dispatch.server.ts](src/lib/push-dispatch.server.ts). El tono de perfil
(`profiles.tone`) afecta al copy y a la frecuencia en tres sitios distintos (push, repaso nocturno,
prompt del coach) a partir de un único campo.

## Convenciones de código

- Alias de imports: `@/*` apunta a `src/*` (ver `tsconfig.json` y `components.json`).
- Componentes de UI: shadcn/ui, estilo `new-york`, iconos de `lucide-react`, en
  `src/components/ui/`.
- Formato: Prettier (`printWidth` 100, comillas dobles, `;` siempre) — corre `bun run format`
  antes de dar algo por terminado.
- El código de la app móvil vuelve a convertir la misma paleta de color de la web (definida como
  `oklch()` en `src/styles.css`) a hex en `mobile/tailwind.config.js`, porque React Native no
  entiende `oklch`. Si cambias un color en la web, hay que replicarlo ahí a mano — son dos copias.
- Guidelines de UI (color, tipografía, radios, espaciado, componentes, movimiento, tono de voz):
  [docs/design-guidelines.md](docs/design-guidelines.md). Consúltalo antes de tocar estilos para
  no apartarte de los valores ya establecidos.

## Agent skills

### Issue tracker

Issues y specs viven como markdown en `.scratch/`. Ver `docs/agents/issue-tracker.md`.

### Domain docs

Documentación de dominio en modo single-context (`CONTEXT.md` + `docs/adr/` en la raíz). Ver
`docs/agents/domain.md`.

### Verificación

Cómo se demuestra que un cambio funciona en este repo: puertas estáticas (`lint`, `typecheck`,
`test`), preview del navegador con perfil demo para cualquier cosa que mute datos, y sin base
de datos local. Ver `docs/agents/verification.md` y `docs/agents/testing.md`.

### Code review

Checklist de convenciones e invariantes específicas del proyecto (idioma, frontera
cliente/servidor, espejo `/api/v1`, invariantes de plan y compra, paridad web/móvil), más allá
del `/code-review` genérico. La aplica la skill `/senda-review`. Ver
`docs/agents/code-review.md`.
