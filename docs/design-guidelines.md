# Guidelines de UI (v1, agosto 2026)

Extraídas del rediseño de la pantalla Hoy y del resto de pestañas. Todos los valores descritos
aquí son los que hay hoy en el diseño, no propuestas — este documento existe para que un cambio
nuevo no se aparte de ellos por accidente. Fuente: proyecto de Claude Design "Rediseño Peppers
nutrición" → `Guidelines UI.dc.html` (ver [docs/agents/domain.md](agents/domain.md) sobre cómo se
gestionan los diseños del proyecto).

## 1. Principios

- **Una acción por fila.** Cada comida se resuelve desde su propia fila. Sin desplegables ni pasos
  intermedios: registrar es un toque.
- **El color es dato, no adorno.** Los colores de categoría solo pintan comida. Nunca botones de
  sistema, nunca navegación.
- **Un solo naranja por pantalla.** El naranja de marca es la acción principal. Si aparece dos
  veces, una de las dos está mal.
- **Sin bordes.** La jerarquía se construye con fondo y radio, no con líneas. Los divisores se
  reservan para listas largas.

## 2. Color

### Base

| Nombre     | Hex       | Uso                                                     |
| ---------- | --------- | ------------------------------------------------------- |
| Hueso      | `#F3F1ED` | Fondo de toda la app. Nunca blanco puro.                |
| Papel      | `#FBFAF7` | Superficie elevada: tarjetas, nav, botones secundarios. |
| Arena      | `#EAE6DD` | Raíles de barras, fondo de segmentados, días inactivos. |
| Grafito    | `#3E3D39` | Texto principal, iconos activos, día de hoy.            |
| Topo       | `#83796C` | Texto secundario, etiquetas mono, iconos inactivos.     |
| Topo claro | `#A8A093` | Autorías, metadatos, tercer nivel.                      |

### Función

| Nombre           | Hex       | Uso                                                   |
| ---------------- | --------- | ----------------------------------------------------- |
| Naranja Peppers  | `#FF8A3D` | Acción única: FAB, CTA, viñetas, estado `:target`.    |
| Naranja tinte    | `#FFE7D3` | Hover de superficies pulsables.                       |
| Verde fresco     | `#6DBE7B` | Progreso conseguido. Día cumplido: `#4CAE64`.         |
| Amarillo mostaza | `#F2C14E` | Aviso suave: día a medias, presupuesto al límite.     |
| Gris salto       | `#F0EDE7` | Comida saltada. Se acompaña de `opacity .55`.         |
| Fin de semana    | `#F7E2CE` | Sábado y domingo en la tira semanal. Texto `#A85F24`. |

### Sistema de comida — un color por categoría

| Categoría | Tinte de fondo | Color puro |
| --------- | -------------- | ---------- |
| Cereales  | `#F3EADE`      | `#D7B58A`  |
| Pescado   | `#E4EFF8`      | `#4C9BD6`  |
| Aves      | `#FCF3DE`      | `#F2C14E`  |
| Legumbres | `#EFE7DF`      | `#9A7655`  |
| Verduras  | `#E7F3E9`      | `#6DBE7B`  |
| Carne     | `#FAE9E9`      | `#E57373`  |
| Fruta     | `#FFEEE1`      | `#FF8A3D`  |
| Lácteos   | `#FBF6EA`      | `#F5E6C8`  |

**Cómo se tiñe:** todo tinte sale del mismo cálculo, `color-mix(in oklab, categoría X%, #FBFAF7)`.
Tres porcentajes fijos y ninguno más — fila normal **13%**, fila de la siguiente comida **22%**,
hueco del icono **20%**. El color puro al 100% solo aparece en el botón de confirmar de esa fila.

## 3. Tipografía

| Rol                | Fuente  | Tamaño / peso   | Notas                             |
| ------------------ | ------- | --------------- | --------------------------------- |
| Título de pantalla | Outfit  | 40px / 600      | tracking −.03em, line-height .98  |
| Título secundario  | Outfit  | 34px / 600      | pantallas sin nombre propio       |
| Sección            | Outfit  | 21px / 600      | tracking −.02em                   |
| Nombre de plato    | Outfit  | 16.5px / 500    | line-height 1.2, text-wrap pretty |
| Cifra destacada    | Outfit  | 24–26px / 600   | unidad al lado en mono 11px       |
| Etiqueta UI        | Figtree | 11.5–13px / 600 | nombre de comida, botones, tabs   |
| Cuerpo             | Figtree | 12.5–13px / 400 | line-height 1.45–1.55             |
| Nav inferior       | Figtree | 9.5px / 600     | único caso bajo 10px permitido    |
| Dato               | DM Mono | 11–11.5px / 500 | horas, precios, gramos            |
| Micro-etiqueta     | DM Mono | 9.5–11px / 500  | uppercase, tracking .06–.10em     |

- **Outfit** — títulos y cifras. Geométrica circular, pesos 500 y 600, siempre con
  `letter-spacing` negativo.
- **Figtree** — interfaz y cuerpo. Todo lo que se lee y se toca: etiquetas, párrafos, botones,
  navegación.
- **DM Mono** — datos. Gramos, horas, precios, porcentajes y micro-etiquetas en versalitas.
  Tabular: las cifras no bailan al actualizarse.

## 4. Forma y espacio

### Radios

| Valor | Uso                                |
| ----- | ---------------------------------- |
| 26px  | Barra de navegación                |
| 20px  | Fila de comida, tarjeta            |
| 16px  | Bloque secundario, botón terciario |
| 14px  | Día de la semana, chip             |
| 99px  | Todo lo circular y las pastillas   |

### Espaciado

| Valor | Uso                                |
| ----- | ---------------------------------- |
| 20px  | Margen lateral de pantalla         |
| 64px  | Aire superior (bajo el status bar) |
| 200px | Colchón inferior por nav + FAB     |
| 26px  | Entre bloques de la pantalla       |
| 10px  | Entre filas de una lista           |
| 18px  | Padding interior de tarjeta        |

Solo hay dos sombras en toda la app, y las dos son elevaciones flotantes: el FAB
`0 6px 18px -6px rgba(0,0,0,.35)` y la barra de navegación `0 6px 22px -14px rgba(0,0,0,.25)`. Las
tarjetas no llevan sombra: se separan del fondo por color.

## 5. Componentes

### Fila de comida

El componente central de la app. Rejilla de tres columnas: `40px · minmax(0,1fr) · auto`, con
12px de separación y padding `13px 14px`.

- **Izquierda** — círculo de 40px con el tinte de la categoría al 20% y el dibujo del ingrediente
  a 28px.
- **Centro** — comida y hora en una línea, plato debajo, categoría en mono versalita. Tres
  niveles, siempre en ese orden.
- **Derecha** — las tres acciones a la vista: otra cosa y saltar en 30px sobre papel, confirmar en
  34px con el color puro de la categoría.

**Estados.** Pendiente: tres botones. Hecha: el círculo de confirmación se queda fijo con un `pop`
de 350ms. Saltada: fondo gris salto, opacidad .55, plato en topo y la cruz en arena. Siguiente
comida: mismo diseño, tinte al 22% en lugar del 13% — no hay tarjeta destacada ni badge.

### Botones

Primario: naranja, texto papel, radio 99px, padding vertical 13px, Figtree 600 13.5px, ancho
completo. Secundario: papel sobre hueso, texto topo, hover a naranja. Circular de acción: 34px
primario, 30px secundario. Hover siempre `scale(1.08)` en 200ms.

### Segmentado y chips

Pastilla de arena con 4px de padding; el activo es papel sobre grafito. Chips de tres en tres,
radio 14px. Las etiquetas de estado en listas van en mono 9px versalita dentro de una pastilla
teñida.

### Barras de progreso

Raíl de arena, radio 99px. Macros a 5px en rejilla de cuatro; barras de una sola métrica a 6px.
Debajo, etiqueta mono versalita y valor mono. El relleno anima 1.1s.

### Nav inferior y FAB

Cuatro pestañas, papel al 94% con `blur(12px)`, a 30px del borde. La activa lleva el icono sobre
un rectángulo grafito de 38×32 y radio 14px. El FAB es de 56px, naranja, a 104px del fondo, con un
anillo que respira cada 2.4s.

## 6. Iconografía

Dos familias que no se mezclan nunca en el mismo hueco.

- **Iconos de sistema · Lucide** — trazo de 2 (2.2 en la cruz, 2.6 en el check para que gane peso
  sobre color). Tamaños 14–17px según el hueco. Sin relleno, siempre `currentColor` o topo. Cero
  emoji en toda la app.
- **Dibujos de ingrediente · propios** — 68 SVGs en `viewBox 0 0 40 40`, trazo marrón cálido
  `#8B7B65` de 1.5–1.7, rellenos suaves y silueta orgánica dibujada a mano. Se muestran a 28px
  dentro del círculo de 40px, como `background-image` centrado y contenido.

## 7. Movimiento

Una sola curva para todo: `cubic-bezier(.22, 1, .36, 1)`. Sin rebotes, sin confeti, sin
celebraciones.

| Evento                   | Duración  | Notas                                                       |
| ------------------------ | --------- | ----------------------------------------------------------- |
| Entrada de bloque        | 500–550ms | Sube 10px y aparece. Escalonado por bloque, nunca por fila. |
| Confirmar comida         | 350ms     | Pop de .94 a 1.04 a 1. Solo el círculo, no la fila.         |
| Relleno de barra         | 1100ms    | Transición de anchura. Lenta a propósito: se lee el avance. |
| Cambio de estado de fila | 350ms     | Fondo y opacidad a la vez.                                  |
| Hover                    | 200ms     | Escala 1.08 en pulsables; cambio de fondo en superficies.   |
| Anillo del FAB           | 2.4s ∞    | Único bucle infinito permitido en la app.                   |

## 8. Tono de voz

Segunda persona, minúscula sostenida en microcopy, sin signos de exclamación. Se habla de comida,
no de métricas: «Salmón al horno», no «Comida 2 · 620 kcal». Las cifras se dan en unidades que el
usuario reconoce (gramos, euros, kcal) y sin decimales cuando no aportan. El coach informa y no
regaña: nunca «te lo saltaste», sino la fila en gris y ya está.

## 9. Qué no hacer

- Bordes de 1px para separar tarjetas del fondo.
- Un color de categoría en un botón de sistema o en la nav.
- Dos naranjas compitiendo en la misma pantalla.
- Esconder una acción frecuente detrás de un despliegue.
- Emoji, gradientes de fondo o texto en cursiva.
- Blanco puro o negro puro en cualquier superficie.
- Más de tres niveles de profundidad de navegación.
- Zonas de toque por debajo de 30px.

## Nota sobre web vs. móvil

La web define estos tokens como `oklch()` en [src/styles.css](../src/styles.css); React Native no
entiende `oklch`, así que `mobile/tailwind.config.js` guarda los mismos valores ya convertidos a
hex a mano — son dos copias, no una fuente compartida. Si se retoca un color aquí, hay que
replicarlo en los dos sitios (ver también [CLAUDE.md](../CLAUDE.md)).
