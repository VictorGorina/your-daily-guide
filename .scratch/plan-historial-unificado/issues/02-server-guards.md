# 02 — Fecha de alta + barreras de servidor: generar plan, sync de hogar, push a 7 días

Status: todo
Blocked by: 01

## Objetivo

Guardar la fecha de alta por usuario (Punto 4), que nunca se gaste IA en planificar meses
pasados, que el mes siguiente solo se pueda generar en la última semana (Punto 6), y que
preparar el mes que viene por adelantado propague bien las comidas compartidas del hogar.

## Tareas

### Migración — `profiles.app_started_on`

`supabase/migrations/<ts>_profile_app_started_on.sql`:

```sql
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS app_started_on date;
UPDATE public.profiles
  SET app_started_on = created_at::date
  WHERE app_started_on IS NULL AND onboarding_completed;
```

- Regenerar `src/integrations/supabase/types.ts`; añadir `app_started_on: string | null` al
  tipo `Profile` en `src/lib/daily.ts` **y** `mobile/lib/daily.ts`.
- Onboarding (`src/routes/_authenticated/onboarding.tsx` ~L596 y el de `mobile/`): en el
  `saveProfile({ onboarding_completed: true, ... })` añadir `app_started_on: todayISO()`
  **solo si el valor actual es `null`** (no pisar en reediciones).
- `demo-profile.ts` (web + `mobile/lib/`): fijar `app_started_on` ~40 días atrás.

### `src/lib/plan.functions.ts` — `generateMonthlyPlan`

En `.validator(...)` (ojo: ya está renombrado de `.inputValidator`), tras validar el formato
del mes:

```ts
const today = madridTodayISO();
const currentMonth = today.slice(0, 7);
if (input.month < currentMonth) throw new Error("No se planifican meses pasados");
const nm = nextMonthISO(today);
if (input.month > nm) throw new Error("Solo puedes preparar hasta el mes que viene");
if (input.month === nm && !isNextMonthUnlocked(today)) {
  throw new Error("Aún no toca preparar el mes que viene; podrás la última semana del mes");
}
```

- Importar `nextMonthISO`, `isNextMonthUnlocked` de `plan-shared`.
- No tocar `adjustMonthlyPlan` ni `setPlanMeal` (ya bloquean el pasado a su manera).
- Verificar que `/api/v1/plan/generate` hereda la barrera (mismo server fn) y que el mensaje
  llega como `{ error }` (convención AGENTS.md).

### `src/lib/household.server.ts` — `syncSharedMeals`

```ts
const cursor =
  opts.month > opts.today.slice(0, 7)
    ? { weekIndex: -1, dayIndex: -1, dayName: "" }
    : planCursor(opts.today);
```

Así, al generar el plan del mes que viene por adelantado, todas las semanas cuentan como
"futuras" y las comidas compartidas se copian al plan de los demás miembros.

### `src/lib/push-dispatch.server.ts`

- `RENEWAL_DAYS_LEFT` → `NEXT_MONTH_UNLOCK_DAYS` (7); comentario "A 7 días o menos…".
- `renewalCopy`: `url` del push `/hoy` → `/plan?month=${nextMonth}`.

## Hecho cuando

- Migración aplica y backfillea; `types.ts` y `Profile` regenerados en web y mobile.
- Onboarding nuevo fija `app_started_on`; reeditar el perfil no lo cambia.
- Generar un mes pasado desde la API devuelve el error, sin llamar al modelo.
- Generar el mes+1 con >7 días restantes devuelve el error; con ≤7, funciona.
- Con un hogar de prueba, generar el mes+1 copia los desayunos/comidas compartidas al otro
  miembro (revisar `monthly_plans` del otro `user_id`).
- `bun test`, `typecheck`, `lint` limpios.
