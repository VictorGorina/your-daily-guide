# Domain Docs

Cómo deben consumir las skills de ingeniería la documentación de dominio de este repo al explorar
el código.

## Antes de explorar, leer esto

- **`CONTEXT.md`** en la raíz del repo, o
- **`CONTEXT-MAP.md`** en la raíz si existe: apunta a un `CONTEXT.md` por contexto. Leer cada uno
  que sea relevante para el tema.
- **`docs/adr/`**: leer las ADR que toquen el área en la que se va a trabajar. En repos
  multi-context, revisar también `src/<context>/docs/adr/` para decisiones específicas de ese
  contexto.

Si alguno de estos archivos no existe, **seguir en silencio**. No señalar su ausencia; no sugerir
crearlos por adelantado. La skill `/domain-modeling` (a la que se llega también desde
`/grill-with-docs` y `/improve-codebase-architecture`) los crea de forma perezosa cuando algún
término o decisión de verdad se resuelve.

## Estructura de archivos

Repo single-context (este repo):

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-....md
│   └── 0002-....md
└── src/
```

Repo multi-context (presencia de `CONTEXT-MAP.md` en la raíz):

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← decisiones de todo el sistema
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← decisiones específicas de ese contexto
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## Usar el vocabulario del glosario

Cuando la salida nombre un concepto de dominio (en el título de un issue, una propuesta de
refactor, una hipótesis, el nombre de un test), usar el término tal como está definido en
`CONTEXT.md`. No derivar a sinónimos que el glosario evite explícitamente.

Si el concepto que hace falta no está todavía en el glosario, eso es una señal: o se está
inventando lenguaje que el proyecto no usa (reconsiderar), o hay un vacío real (anotarlo para
`/domain-modeling`).

## Señalar conflictos con ADRs

Si la salida contradice una ADR existente, señalarlo explícitamente en vez de pisarla en
silencio:

> _Contradice la ADR-0007 (event-sourced orders), pero merece la pena reabrirla porque…_
