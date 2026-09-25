# 01 — Preferencia "ver calorías y macros" (onboarding + Ajustes)

Status: done en código (2026-09-25); falta aplicar la migración
Blocked by: —
Tamaño: M
Fase: 1

## Qué

Cada persona decide si quiere ver kcal, macros y objetivos. Se pregunta en el onboarding, **toda la
app se despliega según esa respuesta** y se puede cambiar cuando quiera en Ajustes, que lo explica
claramente (decisión D3 del spec).

## Por qué

Hallazgo H10: ahora la barra de kcal y macros se pinta para todo el mundo y nadie puede elegir. Este
plan hace las cifras más precisas y más visibles, así que la elección tiene que existir antes.

## Diseño

### Dato

- Migración: `profiles.nutrition_numbers text not null default 'mostrar' check (nutrition_numbers in
  ('mostrar', 'ocultar'))`.
- **Relleno de las cuentas existentes** (no han respondido la pregunta): `ocultar` para quien tiene
  `ed_history` en `activa` o `pasada`, porque hoy el coach ya no les da cifras; `mostrar` para el
  resto, que es lo que ven ahora. Así nadie nota un cambio al desplegar, y cualquiera lo cambia en
  Ajustes. Las cuentas nuevas eligen en el onboarding: no se deduce de nada.
- Tipos: `src/lib/daily.ts` (`Profile`), `mobile/lib/daily.ts`, `src/integrations/supabase/types.ts`.

### Función única

`showsNutritionNumbers(profile): boolean` en `src/lib/macros.ts` (y su copia en
`mobile/lib/macros.ts`): `true` salvo con `nutrition_numbers === "ocultar"`. Es el **único** punto de
lectura; ningún componente mira el campo directamente.

### Onboarding (web `src/routes/_authenticated/onboarding.tsx`, móvil `mobile/app/(app)/onboarding.tsx`)

- Una pregunta en la pantalla del objetivo, justo después del peso objetivo:
  **"¿Quieres ver calorías y macros en la app?"**
  - "Sí, enséñamelas" → `mostrar`
  - "No, prefiero no verlas" → `ocultar`
- Texto de ayuda visible bajo las opciones: **"Los platos se calculan igual en los dos casos. Puedes
  cambiarlo cuando quieras en Ajustes."**
- Encaja con la memoria `onboarding-direction` (recortar preguntas que no aporten): esta cambia lo
  que muestra toda la app, así que se gana su sitio.

### Ajustes

- `PROFILE_SECTIONS` ([src/lib/profile-fields.ts](../../../src/lib/profile-fields.ts)), sección "Cómo
  te acompaño": campo `nutrition_numbers`, `kind: "chips"`, label "Ver calorías y macros", opciones
  con `valueMap` a `mostrar`/`ocultar`.
- `help`: **"Puedes cambiarlo cuando quieras. Si eliges «No», la app no te enseña calorías, macros
  ni objetivos en ninguna pantalla, ni el coach te habla de cifras. Tus platos se siguen calculando
  igual y las recetas mantienen sus cantidades."**
- Al estar en `PROFILE_FIELDS`, el coach también puede cambiarlo por chat (`actualizar_perfil`).

### Qué se oculta con `ocultar` (y qué no)

| Superficie | Con `ocultar` |
|---|---|
| Hoy: `MacroBars` (web `hoy.tsx`, móvil `hoy.tsx`) | no se pinta |
| Hoy: fila de "calorías del día" de la guía | texto sin cifras (tono según `docs/design-guidelines.md`) |
| Detalle de día (`day-detail-sheet.tsx` y su equivalente móvil) | sin barra ni kcal |
| Receta (ticket 09) | sin kcal ni macros; **los gramos se quedan** |
| Plan: kcal por día (ticket 10) | no se muestra |
| `goalImpact` (texto con kcal y fechas) | el prompt pide texto sin cifras de kcal |
| Coach (`coachSystemPrompt`) | línea: "No quiere ver cifras: nunca des kcal, macros ni objetivos numéricos" |
| Push y repaso nocturno (`push-dispatch.server.ts`) | revisar copy; sin cifras |

- En `coachSystemPrompt`, la regla de cifras sale de `edLine` y pasa a depender de esta
  preferencia. El resto de `edLine` (delicadeza, no hablar de "compensar") se queda.
- El servidor **sigue calculando** objetivos, raciones y macros: se necesitan para escalar los
  platos y para la compra. Solo cambia lo que se enseña.

## Criterios de aceptación

- [ ] La pregunta aparece en el onboarding web y móvil, con el texto de ayuda.
- [ ] Con `ocultar`: ningún número de kcal, gramos de macro, porcentaje ni objetivo en Hoy, el
      detalle de día, la receta, el impacto sobre el objetivo, el chat ni las notificaciones; web y
      móvil.
- [ ] Con `mostrar`: todo igual que ahora.
- [ ] En Ajustes, el campo y su ayuda se ven y el cambio se aplica al momento.
- [ ] Relleno de la migración comprobado con una consulta de solo lectura (recuento por valor).
- [ ] Test puro de `showsNutritionNumbers`.
- [ ] `bun run lint`, `bun run typecheck` y `bun run test` en verde.

## Verificación

- Navegador con el **perfil demo** (memoria `verify-with-demo-profile`): Ajustes → "No, prefiero no
  verlas" → Hoy, detalle de día y chat sin cifras → volver a "Sí".
- Onboarding web: recorrerlo con una cuenta de prueba nueva y comprobar que la pregunta guarda el
  valor.
- Simulador iOS: onboarding, Ajustes y Hoy.

## Comments

- 2026-09-25 — **Hecho en código** (web y móvil). Migración en
  `supabase/migrations/20260925120000_profiles_nutrition_numbers.sql` (con el relleno por
  `ed_history`; en producción hay 1 cuenta con `activa`), **sin aplicar**: Supabase se migra a mano.
  Hasta entonces `saveProfile` omite la columna (PGRST204), Ajustes y el onboarding no enseñan el
  control (`hasProfileColumn`) y el coach mantiene la regla antigua de `ed_history` como
  salvaguarda. Con `ocultar` también se ocultan las cifras de las tarjetas de picoteo, deporte y
  balance y la opción de apuntar kcal a mano (el criterio es "ningún número de kcal en Hoy"). Las
  push no citaban cifras. El `help` de los campos ahora se ve al editar en Ajustes (antes no se
  pintaba en ninguna app). La pregunta del onboarding sube la versión del borrador a `v3`.
