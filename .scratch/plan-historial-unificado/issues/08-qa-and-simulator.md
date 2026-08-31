# 08 — QA end-to-end + verificación en simulador iOS

Status: todo
Blocked by: 07

Usar el login demo para todo lo que mute datos (memoria `verify-with-demo-profile`), nunca la
cuenta real del usuario.

## Web (`bun run dev`, http://localhost:8080)

- [ ] Mes en curso: pasado con semáforo, hoy con anillo, futuro neutro. `‹` no pasa del primer
      mes con datos. `›` bloqueado si faltan >7 días de mes.
- [ ] Detalle de día pasado: comidas (plan / distinto / salteo / sin registrar), plato
      sugerido cuando hubo cambio, barra de macros (o aviso si no hay guía), corrección
      retroactiva persiste y refresca el semáforo.
- [ ] Mes pasado: solo lectura en Ingredientes, sin botón regenerar, calendario navegable.
- [ ] `/historial` → `/plan`. `/plan?month=<mes+1>` cuando está permitido abre ese mes; con
      un mes fuera de rango, se recorta a `bounds`.
- [ ] Generar un mes pasado desde devtools/API → error, sin llamada al modelo (revisar logs).
- [ ] Fecha de alta: `‹` para en el mes de `app_started_on`; días de ese mes anteriores al
      alta salen inertes ("Antes de empezar a usar Peppers"), los posteriores con semáforo.
- [ ] Usuario existente (backfill): `app_started_on = created_at::date`, navegación coherente.
- [ ] Onboarding nuevo fija `app_started_on`; reeditar el perfil no lo cambia.

## Simular "última semana del mes"

Ajustar la fecha (o un helper de test) para `daysLeftInMonth <= 7`:

- [ ] `›` desbloquea el mes+1; "Crear plan de {mes}" funciona (cobertura día 1→fin).
- [ ] Ingredientes del mes+1 accionable: marcar "en casa", Modo compra, guardar gasto.
- [ ] Push de renovación (`RENEWAL_DAYS_LEFT` = 7) coincide con el desbloqueo; su link abre
      `/plan?month=<mes+1>`.
- [ ] Hogar: generar el mes+1 propaga las comidas compartidas al otro miembro.

## Simulador iOS (`mobile/`, memoria `native-ios-app`)

- [ ] `npx expo run:ios`; screenshot de: subpestaña Plan (mes actual con logs), detalle de
      día, Ingredientes de un mes pasado (solo lectura), navegador de mes.
- [ ] Verificar que Hoy no ha cambiado de aspecto tras extraer `MacroBars`.

## Regresión

- [ ] `bun test`, `bun run typecheck`, `bun run lint`, `bun run build` limpios.
- [ ] `bun run format` aplicado.
