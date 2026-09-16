# 03 — Carrusel de semanas en móvil

Status: hecho y verificado por completo en simulador iOS (2026-09-16).
Blocked by: 01
Tamaño: M

## Qué

La tira de la semana de Hoy (iOS) se desliza entre semanas con paginado nativo, cabecera con
etiqueta y chevrons, anillo de selección animado y panel del día con transición de altura.

## Por qué

Petición del usuario: ver semanas anteriores y siguientes con un scroll y una animación muy limpia.
Móvil va primero por la regla de paridad (memoria `native-ios-app`).

## Diseño

### `mobile/components/week-pager.tsx` (sustituye a `week-strip.tsx`)

- Props: `today`, `appStartedOn`, `selected`, `onSelect(date)`, `visibleWeek`,
  `onVisibleWeekChange(monday)`, `logsFor(date)`, `todayHabits`, `renderBadge?(date)` (el ticket 05 lo
  usa para el lápiz).
- `FlatList` horizontal: `pagingEnabled`, `showsHorizontalScrollIndicator={false}`,
  `decelerationRate="fast"`, `windowSize={3}`, `getItemLayout` con el ancho medido,
  `initialScrollIndex` = semana visible.
- **Se monta solo después de `onLayout`** (ancho conocido): así no hay salto de la semana 0 a la
  actual.
- `onMomentumScrollEnd` → índice → `onVisibleWeekChange`.
- Cada página es la fila de 7 casillas actual (mismas clases, semáforo sin rojo, fin de semana
  futuro teñido). Solo las páginas a ±2 de la visible pintan casillas; el resto, un `View` del mismo
  alto.
- Días `before-start`: `opacity 0.35`, sin semáforo, `disabled`.

### Cabecera

- `‹  {weekLabel}  ›` + píldora "Hoy" si `visibleWeek !== weekStartOf(today)`.
- Chevrons: `scrollToIndex({ animated: true })` si la distancia es ≤ 2; si no, fundido de 180 ms del
  carril + `animated: false` + fundido de vuelta.
- Etiqueta: `Animated.Text` con `entering`/`exiting` (`FadeIn`/`FadeOut` + `translateX` de 6 px en la
  dirección), 200 ms, `Easing.bezier(0.22, 1, 0.36, 1)`.
- Chevrons desactivados (opacidad) en los límites de `weekStripBounds`.

### Anillo de selección

- Un único `Animated.View` absoluto por página con el borde `primary`, posición `x` en un valor
  compartido → `withTiming(x, { duration: 350, easing })`. Si la selección viene de otra semana, se
  coloca sin animar.

### Panel del día (en `mobile/app/(app)/hoy.tsx`)

- Contenedor `Animated.View` con `layout={LinearTransition.duration(350).easing(...)}`.
- Contenido con `key={openDay}`, `entering` = fundido + 12 px desde la izquierda o la derecha según
  el día nuevo sea anterior o posterior; `exiting` = fundido.
- Al cambiar de semana, si `openDay` no pertenece a ella → `setOpenDay(null)` (se pliega).
- `useReducedMotion()`: sin desplazamientos, solo fundidos.

### Datos

- Semáforos: `useQueries` de `["logs", month]` (`fetchLogsForMonth`) para `monthsOfWeek` de la
  semana visible y sus vecinas.
- Planes: `useQueries` de `["plan", month]` para los mismos meses.
- `ScrollView` de Hoy con `directionalLockEnabled`.

## Archivos

- `mobile/components/week-pager.tsx` (nuevo); borrar `mobile/components/week-strip.tsx` si no queda
  ningún uso
- `mobile/app/(app)/hoy.tsx`
- `mobile/lib/daily.ts` (si falta `fetchLogsForMonth`)

## Criterios de aceptación

- [x] Simulador: al abrir Hoy se ve la semana actual sin salto; deslizar a la anterior y la
      siguiente encaja sin tirones; el scroll vertical de Hoy sigue funcionando al arrastrar en
      diagonal.
- [x] Simulador: no pasa de la última semana permitida (el mes que viene bloqueado); los chevrons
      se apagan en el límite. Confirmado también el límite de la semana del alta (`appStartedOn`):
      con el perfil demo (alta 28 de julio de 2026), la semana "27 jul – 2 ago" es la primera
      navegable, el 27 (antes del alta) sale apagado y sin poder tocarse, el chevron izquierdo
      queda deshabilitado, y el 28 (día del alta) es editable con normalidad.
- [x] Simulador: "Hoy" desde varias semanas atrás (probado desde "27 jul – 2 ago", 7 semanas antes)
      hace fundido + salto directo a "Esta semana" sin recorrer las semanas intermedias, y pliega
      el panel del día abierto al llegar.
- [x] Simulador: el anillo se desliza entre días de la misma semana; el panel cambia de altura
      animado y se pliega al irse a otra semana (confirmado con el swipe nativo: seleccionar un
      día de la semana pasada y deslizar a "Esta semana" pliega el panel solo).
- [x] Reducir movimiento activado en el simulador (`defaults write com.apple.Accessibility
      ReduceMotionEnabled -bool true` + relanzar la app): unas 16 navegaciones e interacciones
      seguidas (chevrons, cambios de semana, selección de días en semanas distintas) sin el
      cuelgue de UI documentado en `mobile/AGENTS.md` — la app siguió respondiendo con
      normalidad en todo momento.
- [x] Capturas de pantalla de cada punto, guardadas en
      `.scratch/hoy-semanas-editables/screenshots/`: `01-hoy-completa.png` (tira de "Esta
      semana"), `02-semana-cruce-mes.png` ("28 sep – 4 oct", días de dos meses en la misma fila),
      `03-limite-mes-bloqueado.png` (chevron derecho apagado en la última semana de septiembre),
      `04-limite-semana-alta.png` (27 jul apagado, chevron izquierdo apagado).

## Comments

- 2026-09-16 — Hecho y verificado en el simulador iOS (iPhone 17 Pro, perfil demo con hogar "Leo").
  `mobile/components/week-pager.tsx` (nuevo, sustituye a `week-strip.tsx`, borrado) + cambios en
  `mobile/app/(app)/hoy.tsx`: estado `visibleWeek`, `useQueries` de logs/plan para la semana visible
  y sus dos vecinas (cubre semanas a caballo entre meses), plegado de `openDay` al cambiar de semana,
  `DayPanel` que reutiliza `DayDetailBody`/`DayMenu` según el día sea pasado o no.

  **Verificado en vivo**: paginado nativo por swipe entre semanas (incluida una semana que cruza de
  septiembre a octubre, "28 sep – 4 oct" con los días 28-30 y 1-4 en la misma fila); chevrons con
  scroll animado y límite superior correcto (se bloquea justo en la última semana del mes, antes de
  que el mes siguiente esté desbloqueado); etiqueta "Esta semana"/"Semana pasada"/"Próxima semana" +
  rango de fechas; píldora "Hoy" que aparece/desaparece y salta de vuelta; selección de día con
  anillo animado que se mueve entre días de la misma semana; plegado del día abierto al cambiar de
  semana (por swipe); panel de día futuro (`DayMenu`) y pasado (`DayDetailBody`, con el semáforo
  verde/naranja real y "Comí lo del plan"/"Comí distinto" editables) renderizando con los datos
  correctos de la semana visible, no solo del mes en curso.

  **Bug real encontrado y corregido**: faltaba `directionalLockEnabled` en el `ScrollView` exterior
  de Hoy (lo pedía el diseño del ticket) — sin él, un gesto horizontal sobre la tira podía perderse
  contra el scroll vertical de la pantalla.

  **Cuelgue de UI investigado y evitado**: la primera versión animaba la etiqueta de la cabecera y
  el panel del día con una función "entering" a medida de Reanimated que combinaba `opacity` +
  `transform` en el mismo objeto de animación. Tras varias navegaciones seguidas en el simulador, la
  app dejaba de responder al tacto por completo (no solo el carrusel — toda la pantalla, incluida la
  barra de pestañas). Se sustituyó por `FadeIn`/`FadeOut` (presets nativos, solo opacidad) en los dos
  sitios y el problema desapareció en una sesión de prueba mucho más larga y agresiva después. No se
  investigó la causa raíz a fondo — queda una tarea en background (`task_b21f5df1`) para confirmarla
  y, si es un problema real de Reanimated 4, documentarlo en `mobile/AGENTS.md`. Coste: se pierde el
  desplazamiento lateral de 6-12px que pedía el diseño original; el fundido solo ya cumple la curva
  de movimiento del proyecto.

  Puertas: `mobile/npx tsc --noEmit` limpio, `bun run lint`/`typecheck`/`test` (345/345) en verde
  desde la raíz, Prettier sin cambios en los archivos tocados.

- 2026-09-16 — Cerrados los cuatro pendientes, en simulador iOS (iPhone 17 Pro, perfil demo con
  hogar "Leo"). Puertas re-verificadas tras traer la rama a este worktree: `bun run
  typecheck`/`lint`/`test` (352/352) en verde desde la raíz, `mobile/npx tsc --noEmit` limpio.

  **Límite de la semana del alta**: el perfil demo tiene `app_started_on` = 28 de julio de 2026.
  Retrocediendo con el chevron izquierdo se llega a "27 jul – 2 ago" como primera semana
  navegable; el chevron izquierdo queda deshabilitado ahí (confirmado por color de trazo:
  (209,205,198) atenuado vs (131,121,108) normal, la misma proporción que predice `opacity: 0.3`
  sobre el fondo). Dentro de esa semana, el 27 (lunes, antes del alta) sale con el texto atenuado
  (opacidad 0.35 medida por color) y no responde al toque; el 28 (día del alta) sí abre su panel
  con normalidad. Exactamente el comportamiento del diseño.

  **Salto lejano con fundido**: pulsar la píldora "Hoy" desde "27 jul – 2 ago" (7 semanas de
  distancia) salta directo a "Esta semana" sin recorrer las semanas intermedias y pliega el panel
  del día que había quedado abierto, tal y como especifica el diseño (`Math.abs(delta) > 2` →
  fundido de 180 ms + salto sin animar en vez de `scrollToIndex` animado).

  **Límite superior (mes bloqueado)**: avanzando con el chevron derecho, la última semana
  navegable es "28 sep – 4 oct" (cruza de septiembre a octubre, con los días de ambos meses en la
  misma fila y datos correctos en los dos). El chevron derecho queda deshabilitado ahí — octubre
  no está desbloqueado porque quedan más de `NEXT_MONTH_UNLOCK_DAYS` (7) días para fin de mes.

  **Reducir movimiento**: activado con `xcrun simctl spawn <udid> defaults write
  com.apple.Accessibility ReduceMotionEnabled -bool true` y relanzando la app (el ajuste solo se
  lee al montar). Unas 16 interacciones seguidas — chevrons adelante/atrás, selección de días en
  semanas distintas, apertura/cierre de panel — sin rastro del cuelgue de UI que documenta
  `mobile/AGENTS.md`: la app respondió con normalidad en todo momento. Ajuste restaurado a `false`
  al terminar.

  **Capturas guardadas** en `.scratch/hoy-semanas-editables/screenshots/`: `01-hoy-completa.png`,
  `02-semana-cruce-mes.png`, `03-limite-mes-bloqueado.png`, `04-limite-semana-alta.png`.

  Nota de proceso: este ticket ya estaba resuelto en la rama `claude/sleepy-zhukovsky-ab234e`
  (commits `4859a14` y `158a0f5`, ambos supersets directos de esta rama) cuando se pidió empezarlo
  aquí; se trajeron con `git merge --ff-only` en vez de reimplementar, y esta sesión se centró en
  cerrar los cuatro pendientes que el propio ticket dejaba anotados.

  **Dos ajustes de la propia verificación en vivo, pedidos por el usuario al revisarla:**

  - **Contraste del fin de semana.** El tinte `--weekend`/`--weekend-foreground`
    (`#f7e2ce`/`#a85f24`) era casi indistinguible de `bg-secondary` (`#eae6dd`) — solo 13/4/15 de
    diferencia en RGB, frente a los 60+ del resto de estados de la tira (warning, success). Se
    sube a `#f0c99a`/`#7a4614` en claro y `#4a3418`/`#f5c08a` en oscuro (`src/styles.css`,
    `mobile/components/week-pager.tsx`, tabla de `docs/design-guidelines.md` §2), verificado en
    ambos temas con el navegador (`getComputedStyle` sobre las celdas) y en el simulador. Mismo
    mecanismo de aplicación de antes (clases Tailwind en web, `style` inline en móvil), solo
    cambia el valor.
  - **Píldora "Hoy" ambigua.** Se leía como una etiqueta de estado ("este día es hoy") en vez de
    un botón de acción ("volver a la semana de hoy"), aunque aparece exactamente donde dice el
    spec (fuera de la semana actual). Se cambia el texto a "Volver a hoy" en
    `mobile/components/week-pager.tsx`; la píldora sigue cabiendo en la cabecera sin romper el
    layout (verificado en el simulador) y el comportamiento no cambia.

  Puertas re-verificadas tras ambos ajustes: `bun run typecheck`/`lint`/`test` (352/352) y
  `bun run format` en verde, `mobile/npx tsc --noEmit` limpio.
