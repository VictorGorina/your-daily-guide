# 04 — Carrusel de semanas en web

Status: hecho y verificado en navegador con perfil demo (2026-09-16).
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

- [x] Navegador (perfil demo, viewport 375 px): mismos puntos que el ticket 03 (sin salto al cargar
      e hidratar, arrastre con encaje, límites, "Hoy" lejano con fundido, anillo, panel).
- [x] Escritorio: arrastre con ratón y flechas del teclado.
- [x] Sin errores en consola (hidratación incluida).
- [x] Captura comparada con la del simulador: misma estructura y mismos estados.

## Comments

- 2026-09-16 — Hecho y verificado en el navegador integrado (perfil demo anónimo, sesión ya
  iniciada — `is_anonymous: true`, sin email, confirmado antes de tocar nada). `src/components/
  week-pager.tsx` (nuevo, sustituye a `week-strip.tsx`, borrado) + cambios en
  `src/routes/_authenticated/hoy.tsx`: estado `visibleWeek`, `useQueries` de logs/plan para la
  semana visible y sus dos vecinas, plegado de `openDay` al cambiar de semana, `DayPanel` (nuevo)
  que reutiliza `DayDetailBody`/`DayMenu` según el día sea pasado o no, con `motion.div layout` +
  `AnimatePresence` para la transición de altura y el deslizamiento lateral según el día se toque
  a la izquierda o la derecha del anterior.

  **Verificado en vivo** (desktop 1024×768 y viewport móvil 375×812, recargando entre pruebas):
  arrastre con ratón (`left_click_drag`) y swipe simulado deslizan entre semanas con encaje limpio
  en ambos anchos; flechas de teclado (`ArrowLeft`/`ArrowRight`) con foco en la tira cambian de
  semana igual que los chevrons; etiqueta "Esta semana"/"Semana pasada"/"Próxima semana"/rango de
  fechas (incluida una semana a caballo entre meses, "28 sep – 4 oct"); píldora "Volver a hoy" que
  aparece fuera de la semana actual y salta de vuelta con fundido (sin recorrer las semanas
  intermedias) en vez de animación continua; límite hacia atrás en la semana de alta del perfil
  (chevron izquierdo `disabled`, confirmado por DOM, con los días anteriores al alta atenuados y
  sin click) y límite hacia delante en la última semana del mes en curso (chevron derecho
  `disabled`, octubre aún bloqueado); anillo de selección (`motion.span layoutId`) que se mueve
  entre días de la misma semana y se recoloca sin animar al reabrir en otra; panel de día pasado
  (`DayDetailBody`, semáforo real) y futuro (`DayMenu`, con receta) con los datos correctos de la
  semana visible; el panel se pliega solo al cambiar de semana con el día abierto. Cero errores de
  consola en toda la sesión (arranque, hidratación, y las interacciones de arriba). Estructura y
  estados comparados contra las capturas del simulador de móvil
  (`.scratch/hoy-semanas-editables/screenshots/01-hoy-completa.png` y `04-limite-semana-alta.png`):
  mismo layout de cabecera, misma tira de 7 celdas, mismo fin de semana teñido, misma píldora
  "Volver a hoy" y mismo patrón de días atenuados antes del alta.

  **No verificado en esta sesión**: "reducir movimiento" (`prefers-reduced-motion`) está
  implementado (Embla salta sin animar y el anillo usa `transition: { duration: 0 }` cuando
  `useReducedMotion()` de `motion` da `true`, mismo criterio que móvil), pero esta sesión no tenía
  forma de emular esa preferencia del sistema operativo en el navegador integrado — a diferencia
  del simulador iOS, que sí se pudo forzar con `defaults write`. Queda pendiente de una pasada
  manual si hace falta blindarlo.

  **Nota de entorno, no del código**: la preview local se quedó atascada en "starting" al arrancar
  porque el puerto 8080 (el que fija `.claude/launch.json`) lo ocupaba un proceso Vite huérfano de
  23 h en un worktree sin sesión activa (`sleepy-zhukovsky-ab234e`); se paró ese proceso concreto
  (dejando intactos los de la sesión activa `xenodochial-bhaskara-534d47-02` en 8081/8082) y al
  reiniciar la preview aterrizó en 8080 sin problema.

  Puertas: `bun run typecheck`/`lint`/`test` (352/352) y `bun run format` en verde desde la raíz.
  `lint` no introduce errores nuevos (los 30 preexistentes son de copias en `.claude/worktrees/*`,
  ajenos a este cambio).
