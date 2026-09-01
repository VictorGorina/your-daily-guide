# 02 — Roster e identidad: UI web + móvil

Status: hecho en código (rama `familia-comidas-compartidas`); web verificada con perfil demo;
**simulador iOS pendiente**
Blocked by: 01

## Implementado

- `src/routes/_authenticated/hogar.tsx` + `mobile/app/(app)/hogar.tsx`:
  - Sin hogar → "Unirme a una familia" en dos pasos: código → `openSlots` → "¿Quién eres?"
    (solo huecos `uses_app` sin reclamar) → `claimSlot`. Rama "sin sitio libre" con
    "Probar otro código".
  - Con hogar → sección **"La mesa"**: fila por miembro con avatar, nombre (editable inline
    solo para el creador), chips `Planifica` (ChefHat) / `Tú` / `Sin cuenta` / `Pendiente`,
    selector de ración Poco/Normal/Mucho (→ `portion` 0.8/1/1.2), y acciones de creador
    "Ya usa la app" (D4) / "Que planifique la casa" / "Quitar". Formulario "Añadir a alguien
    a la mesa" (nombre + usa/no usa la app + ración) solo para el creador.
  - `joinHousehold` fuera de la UI (la lib lo conserva `@deprecated`).
- `bun run lint` / `typecheck` / `test` verdes; `tsc` de `mobile/` verde.

## Verificación web (perfil demo, servidor local)

- Crear hogar → el creador entra como planificador con el nombre de su perfil; aparece la
  pestaña "Familia" en la barra inferior.
- Añadir "Marta" (usa la app) → fila con chip "Pendiente".
- Segundo perfil demo, código `B27FAY3V` → "¿Quién eres?" lista solo "Marta" (Alex ya
  reclamado); reclamar → "¡Ya estás en la familia!" y Marta ve la mesa en modo lectura
  (sin editar nombres, sin formulario de añadir). Sin errores de consola.

## Pendiente

- **Simulador iOS**: la app en marcha tiene un bucle de alerta "El coach no ha podido
  responder ahora mismo" (no relacionado con este cambio) que impide interactuar, y corre un
  bundle anterior. Repasar en el simulador cuando esté despejado: crear hogar, añadir hueco,
  flujo "¿quién eres?".
- Niños: el selector de ración se añade en el issue 04 con la columna `household_children.portion`.
- `join_household` sigue viva en BD; neutralizarla del todo cuando el flujo nuevo esté
  verificado en las dos apps.

## Objetivo

## Objetivo

La pestaña Familia deja declarar la mesa al crear y elegir quién eres al unirte.

## Tareas

1. **Crear / sin hogar** (`src/routes/_authenticated/hogar.tsx` + `mobile/app/(app)/hogar.tsx`):
   - "Unirme con un código" → tras meter el código, llamar a `openSlots(code)`:
     - con huecos → pantalla "¿Quién eres?" con la lista de `display_name`; tocar uno →
       `claimSlot(code, memberId)`.
     - sin huecos → mensaje "Pídele a quien creó la familia que te añada" + botón para
       reintentar.
   - Quitar el `joinHousehold` directo.
2. **Con hogar — sección "La mesa"** (sustituye a la lista de miembros actual):
   - Fila por miembro adulto: nombre (editable si eres el creador), chip "Tú" / "Sin cuenta"
     / "Pendiente" (hueco `uses_app` sin reclamar), chip "Planifica" en el `is_planner`.
   - Solo el creador: "Añadir a alguien" → nombre + toggle "¿Usa la app?" + ración/apetito;
     `addAdultSlot`. Editar/quitar huecos (`updateMember` / `removeMember`), reasignar
     planificador (`setPlanner`, solo a miembros con cuenta).
   - En un hueco "Sin cuenta": acción "Ya usa la app" → `updateMember(id, { uses_app: true })`
     (D4); pasa a "Pendiente" y se puede reclamar con el código, conservando su ración.
   - Niños: la sección "Peques en casa" ya existe; añadir el campo ración/apetito → `portion`
     en `household_children` (el campo de esquema entra en 04; aquí dejar el input listo o
     esperar a 04 — coordinar).
   - Texto de ayuda: "La compra se calcula para todos los de esta lista."
3. **`bottom-nav`**: sin cambios (la pestaña ya aparece con `hasHousehold`).
4. Copiar todo a `mobile/` con `lucide-react-native`; `Alert`/`Share` como el resto del
   archivo.

## Verificación

- Navegador con **perfil demo** (memoria `verify-with-demo-profile`): crear familia, añadir
  un hueco con app y otro sin app, comprobar que el navegador de "¿quién eres?" solo lista el
  hueco con app y sin reclamar.
- Simulador iOS: misma pasada, captura tras recargar.

## Hecho cuando

Crear-declarar-mesa y unirse-eligiendo-identidad funcionan en las dos apps; lint/typecheck
limpios; capturas adjuntas.
