# 03 — Carrusel de semanas en móvil

Status: ready
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

- [ ] Simulador: al abrir Hoy se ve la semana actual sin salto; deslizar a la anterior y la
      siguiente encaja sin tirones; el scroll vertical de Hoy sigue funcionando al arrastrar en
      diagonal.
- [ ] Simulador: no pasa de la semana del alta ni de la última semana permitida; los chevrons se
      apagan en los límites.
- [ ] Simulador: "Hoy" desde 5 semanas atrás hace fundido + salto, no un barrido largo.
- [ ] Simulador: el anillo se desliza entre días de la misma semana; el panel cambia de altura
      animado y se pliega al irse a otra semana.
- [ ] Reducir movimiento activado en el simulador: solo fundidos.
- [ ] Capturas de pantalla de cada punto.

## Comments
