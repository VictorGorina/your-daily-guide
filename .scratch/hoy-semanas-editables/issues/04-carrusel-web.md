# 04 — Carrusel de semanas en web

Status: ready
Blocked by: 01, 03
Tamaño: M

## Qué

El mismo carrusel del ticket 03 en la web: Embla para el gesto y `motion` para anillo, etiqueta y
panel.

## Por qué

Paridad: "la app web y la app iOS tienen que ser iguales en todo" (memoria `native-ios-app`).

## Diseño

### `src/components/week-pager.tsx` (sustituye a `week-strip.tsx`)

- Mismas props que en móvil.
- `useEmblaCarousel({ startIndex, align: "start", containScroll: false, duration: 22 })` usado
  directamente (sin el wrapper `ui/carousel.tsx`, que trae flechas propias).
- Viewport: `overflow-hidden` + `touch-action: pan-y pinch-zoom`. Slides: `flex-[0_0_100%]`.
- **SSR sin salto:** el contenedor sale del servidor con
  `style={{ transform: translate3d(-${startIndex * 100}%, 0, 0) }}`, para que Embla arranque donde
  ya está pintado.
- Evento `select` → `onVisibleWeekChange`.
- Render por ventana (±2) igual que en móvil.

### Cabecera, anillo, panel

- Chevrons y "Hoy": `emblaApi.scrollTo(i)` si la distancia es ≤ 2; si no, fundido de 180 ms +
  `scrollTo(i, true)` (salto).
- Etiqueta: `AnimatePresence mode="popLayout"` con `x: ±6`, `opacity`, 200 ms, `ease: [0.22, 1, 0.36, 1]`.
- Anillo: `motion.span` con `layoutId={`week-ring-${monday}`}` dentro de la casilla seleccionada,
  350 ms.
- Panel en `src/routes/_authenticated/hoy.tsx`: `motion.div layout` + `AnimatePresence
  mode="popLayout"` con `key={openDay}`, entrada con 12 px desde el lado del día tocado.
- `useReducedMotion()` de `motion`: solo fundidos; Embla con `duration` mínima.
- Teclado: flechas izquierda/derecha con foco en la tira cambian de semana.

### Datos

Igual que el ticket 03: `useQueries` de `["logs", month]` y `["plan", month]`. Las invalidaciones
con `["logs"]` y `["plan"]` casan por prefijo.

## Archivos

- `src/components/week-pager.tsx` (nuevo); borrar `src/components/week-strip.tsx` si no queda uso
- `src/routes/_authenticated/hoy.tsx`

## Criterios de aceptación

- [ ] Navegador (perfil demo, viewport 375 px): mismos puntos que el ticket 03 (sin salto al cargar
      e hidratar, arrastre con encaje, límites, "Hoy" lejano con fundido, anillo, panel).
- [ ] Escritorio: arrastre con ratón y flechas del teclado.
- [ ] Sin errores en consola (hidratación incluida).
- [ ] Captura comparada con la del simulador: misma estructura y mismos estados.

## Comments
