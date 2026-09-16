# 03 — Carrusel de semanas en móvil

Status: hecho, verificado en simulador iOS (2026-09-16), sin commitear. Pendiente: límite de
alta, salto lejano con fundido, reducir movimiento, capturas formales.
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
      se apagan en el límite. **No verificado**: el límite de la semana del alta (`appStartedOn`)
      — el perfil demo usado no tenía fecha de alta útil para probarlo.
- [ ] Simulador: "Hoy" desde 5 semanas atrás hace fundido + salto, no un barrido largo. Probado
      solo el salto cercano (scrollToIndex animado, distancia 1); el camino de fundido
      (`Math.abs(delta) > 2`) no se ha visto en vivo.
- [x] Simulador: el anillo se desliza entre días de la misma semana; el panel cambia de altura
      animado y se pliega al irse a otra semana (confirmado con el swipe nativo: seleccionar un
      día de la semana pasada y deslizar a "Esta semana" pliega el panel solo).
- [ ] Reducir movimiento activado en el simulador: solo fundidos. No probado (requiere activar el
      ajuste de accesibilidad del simulador).
- [ ] Capturas de pantalla de cada punto. Se tomaron capturas de verificación durante la sesión,
      no guardadas como archivos para el ticket.

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

  **Pendiente**: probar el límite de la semana del alta, el salto lejano con fundido (>2 semanas),
  "Reducir movimiento" activado, y guardar capturas de pantalla formales para el ticket.
