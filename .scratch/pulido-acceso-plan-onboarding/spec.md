# Spec — Pulido: acceso por correo, familia, plan/compra y onboarding

Status: los 6 issues implementados (2026-09-07). 01–05 commiteados en `main`
(commits `02b04c3`…`59b7804`); 06 (recorte del onboarding) hecho, sin commitear
todavía.
Autor: sesión Claude Code, 2026-09-07
Feature slug: `pulido-acceso-plan-onboarding`

## Resumen en una frase

Lote de ocho incidencias reportadas por el usuario tras usar la app en real: el alta por
correo está rota de punta a punta (correo en spam → cuenta sin confirmar → error en inglés
sin salida), "añadir adulto" no se comporta como espera, el plan no reacciona a cambios del
hogar ni de la despensa, la lista de la compra pide cantidades imposibles de comprar, y el
onboarding tiene preguntas que no se ganan su sitio.

**Este documento es el handoff.** El análisis de abajo está verificado contra el código, la
base de datos de producción y el navegador — no son hipótesis. Una sesión nueva puede
empezar por el issue 01 sin releer nada más.

---

## Lo ya hecho en la sesión de análisis (no repetir)

1. **La cuenta `cagafanta@gmail.com` (el usuario) ya está confirmada a mano.** Se puso
   `email_confirmed_at` vía Auth Admin API con la `SUPABASE_SERVICE_ROLE_KEY`, con permiso
   explícito del usuario. Ya puede entrar con su contraseña. Esto **no** arregla el bug para
   nadie más: el issue 01 sigue siendo necesario.
2. Memorias actualizadas: `onboarding-direction` (el usuario revierte su negativa a recortar
   el onboarding), `plan-shopping-quantities` (redondeo solo de presentación) y
   `plan-auto-regeneration` (nueva; el recálculo debe ser automático y silencioso).

---

## Diagnóstico verificado, incidencia por incidencia

### ⓵ + ⓶ — El correo de confirmación cae en spam y deja la cuenta muerta

Son **una sola cadena de fallo**, no dos incidencias.

- El correo de **recuperar contraseña** lo manda nuestro backend con Resend y plantilla
  propia (`passwordResetEmail` en `src/lib/email.server.ts`), pero el de **confirmación de
  alta no**: `src/components/auth-flow.tsx:166` llama a `supabase.auth.signUp()`, así que
  ese correo sale del SMTP de Supabase con su plantilla genérica. De ahí el spam.
- Estado real de la cuenta del usuario en producción antes del arreglo manual:

  ```
  created_at:           2026-08-16    identidad: email (con contraseña)
  confirmation_sent_at: 2026-08-16    ← enviado UNA vez, nunca más
  email_confirmed_at:   null          ← nunca confirmado
  last_sign_in_at:      null          ← nunca llegó a entrar
  recovery_sent_at:     2026-08-29    ← intentó recuperar contraseña
  ```

- Al pulsar *Entrar*, Supabase devuelve `Email not confirmed` y
  `src/components/auth-flow.tsx:187` hace `toast.error(error.message)`: enseña el texto
  **crudo en inglés**, que no menciona la contraseña ni nada reconocible. Eso es el "error
  raro que no dice nada" que reportó el usuario.
- **No existe ningún camino de reenvío de confirmación** en toda la app (verificado por
  búsqueda en web y móvil: cero coincidencias). Volver a "Crear cuenta" tampoco sirve:
  Supabase oculta que la cuenta ya existe y la app enseña "Te he enviado un correo" sin que
  llegue nada.

### ⓷ — "Añadir adulto no funciona": NO reproducido

Probado en vivo con perfil demo en el servidor local, siendo el creador del hogar: el
`INSERT` en `household_members` devuelve **201** y "Marta" aparece tanto en la lista de la
mesa como en "¿Cuándo come cada uno en casa?". El camino web funciona.

Dos causas plausibles que sí están en el código y que explican lo que vio el usuario:

- Todo el bloque "Añadir a alguien a la mesa" está tras `isCreator`
  (`src/routes/_authenticated/hogar.tsx:699`), y la policy RLS
  `"creator inserts household slots"` (migración `20260901160000_household_roster.sql:345`)
  solo deja insertar al **creador**. Quien se unió a un hogar ajeno —aunque sea el
  planificador— no ve el formulario y **no se le explica por qué**.
- `onError: () => toast.error("No hemos podido añadir a esa persona")`
  (`src/routes/_authenticated/hogar.tsx:207`) **descarta el error real**, así que ningún
  fallo es diagnosticable ni por el usuario ni por nosotros.

Aviso: puede que lo que el usuario llame "no funciona" sea en realidad ⓻ — añadió a alguien
y ni el plan ni la compra cambiaron.

### ⓸ — Pidió "comida, merienda, cena" y le apareció el snack

`meals_to_plan` es **texto libre**. Se guarda y se inyecta en el prompt como una frase
(`src/lib/ai-provider.server.ts:134`), pero **nada lo hace cumplir**: los slots están fijos
en `MEAL_SLOTS = ["desayuno","comida","cena","snack"]` (`src/lib/plan-shared.ts:11`) y la
rotación semanal siempre emite `breakfasts[]` y `snacks[]`.

Encima el concepto que pidió no existe: los chips del onboarding ofrecen "Snacks", no
"Merienda" (`src/routes/_authenticated/onboarding.tsx:208-212`), y la etiqueta visible es
"Snack" (`MEAL_SLOT_LABEL`). En castellano de casa, la merienda **es** ese slot.

### ⓹ — "Septiembre de 2026" se corta

Confirmado en pantalla a 375 px. `src/routes/_authenticated/plan.tsx:504` usa
`text-[28px]` + `truncate` en un contenedor flanqueado por dos botones de 32 px. Se lee
"Septiembre de …". El usuario propone dos filas: mes arriba, año debajo.

### ⓺ — Cantidades imposibles de comprar

Reproducido cambiando la cadencia a **Semanal** en el perfil demo. La lista real pedía:

```
Zanahoria 214 g · Espinacas frescas 143 g · Calabacín 286 g · Tomate triturado 357 ml
Salmón congelado 179 g · Café 71 g · Cúrcuma 7 g · Curry 7 g
```

Con cadencia mensual los números salen redondos (900 g, 1,5 kg) porque la IA emite `weekQty`
redondos y el mes suma 4 semanas; el problema aparece al trocear por compra en
`projectTrips`.

**Trampa crítica:** `weekQty` es el modelo canónico y la invariante del proyecto es
*Σ entre compras = lo que pide el mes*, estable al cambiar de cadencia, cubierta por tests en
`src/lib/plan-shared.test.ts`. Si se redondea el dato guardado, se rompe. **Redondear solo al
pintar, en `formatQty`.** Además `7 g de cúrcuma` demuestra que un redondeo plano a la decena
convertiría cantidades pequeñas en `0 g`: el paso debe escalar con la magnitud y nunca bajar
a cero.

### ⓻ — El plan no reacciona a la despensa ni a los miembros

Confirmado que hoy no pasa nada: `setPantryExtra` (`src/lib/plan.functions.ts:748`) solo
escribe `pantry_extras`, y `addAdultSlot` / `addChild` no tocan el plan. `syncHouseholdPlan`
solo espeja las comidas del planificador; no recalcula platos ni cantidades.

**Era deliberado** — CLAUDE.md dice literalmente que la despensa extra se trata como
disponible al recolocar "sin disparar regeneración". El usuario pide revertirlo.

### ⓼ — El onboarding tiene demasiadas preguntas

Recuento real: **37 preguntas base + hasta 5 follow-ups condicionales**, en 6 pantallas
("Sobre ti" 7, "Tu día a día" 6, "Cómo comes hoy" 10, "Tu casa" 4, "Hacia dónde vamos" 6,
"Cómo te acompaño" 4). Definidas en `src/routes/_authenticated/onboarding.tsx`, con copia
propia en `mobile/app/(app)/onboarding.tsx`.

---

## Decisiones tomadas por el usuario (2026-09-07)

- **D1 — Recálculo automático y silencioso.** Se le ofrecieron tres opciones y se le
  recomendó la intermedia (reescalar cantidades sin IA + banner "Actualizar" para lo que
  necesita IA), advirtiendo explícitamente que la automática gasta una llamada de pago y con
  cuota en cada cambio. **Eligió la automática igualmente.** No re-proponer un paso de
  confirmación como ahorro de coste.
- **D2 — Confirmar la cuenta del usuario a mano.** Hecho, ver arriba.

---

## Restricciones que atraviesan todo el lote

- **No es un monorepo.** `mobile/lib/plan-shared.ts`, `mobile/lib/household.ts` y las
  pantallas de `mobile/app/(app)/` son **copias a mano** de las de la web. Los issues 03, 04
  y 06 tocan ficheros duplicados: un arreglo sin replicar se convierte en un bug nuevo en iOS.
- **Idioma:** identificadores en inglés, textos de pantalla en español (y `en.json` al día).
- **Espejo `/api/v1`:** cada server function nueva necesita su ruta HTTP para el móvil.
- **Verificación:** puertas estáticas (`bun run lint`, `typecheck`, `test`) y navegador con
  **perfil demo** para cualquier cosa que mute datos — nunca la cuenta real del usuario.

## Orden de ejecución

`01 → 02 → 03 → 04 → 05 → 06`. El 01 va primero porque hoy está dejando gente fuera de la app.

---

## Aviso sobre el árbol de trabajo (2026-09-07)

Al cerrar la sesión de análisis había **17 ficheros modificados sin commitear que no son de
este lote** (el repo estaba limpio al empezar): un refactor `capitalizeFirst` repartido entre
web y móvil, tocando `plan.tsx`, `hoy.tsx`, `hogar.tsx`, `ajustes.tsx`, `plan-shared.ts`,
`day-detail-sheet.tsx` y varios `components/ui/`. Parece trabajo en curso de otra sesión.

Consecuencias para este lote:

- **El issue 03 choca de frente**: ese refactor ya cambió la línea de la cabecera del mes
  (`src/routes/_authenticated/plan.tsx`, ahora `capitalizeFirst(monthTitle(month))` sin la
  clase `capitalize`). Las referencias a números de línea de este spec y de los issues son de
  **antes** de esos cambios; releer el fichero antes de editar.
- El issue 04 también toca `plan-shared.ts`, que está modificado.
- Confirmar con el usuario qué es ese trabajo y si está terminado **antes** de empezar, para no
  pisarlo ni mezclarlo en el mismo commit.
