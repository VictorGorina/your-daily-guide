# Issue tracker: Local Markdown

Issues y specs para este repo viven como archivos markdown en `.scratch/`.

## Conventions

- Una carpeta por feature: `.scratch/<feature-slug>/`
- El spec es `.scratch/<feature-slug>/spec.md`
- Los tickets de implementación son un archivo por ticket en
  `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numerados desde `01`, nunca un único archivo
  con todos los tickets juntos
- El estado de triage se registra como una línea `Status:` cerca del principio de cada archivo de
  issue (ver `triage-labels.md` para las cadenas de cada rol, si esa skill llega a instalarse)
- Comentarios e historial de conversación se añaden al final del archivo bajo un encabezado
  `## Comments`

## Cuando una skill dice "publicar en el issue tracker"

Crear un archivo nuevo bajo `.scratch/<feature-slug>/` (creando el directorio si hace falta).

## Cuando una skill dice "consultar el ticket correspondiente"

Leer el archivo en la ruta referenciada. El usuario normalmente pasará la ruta o el número de
issue directamente.

## Operaciones de wayfinding

Usadas por `/wayfinder`. El **mapa** es un archivo con un archivo **hijo** por ticket.

- **Mapa**: `.scratch/<effort>/map.md` (el cuerpo de Notes / Decisions-so-far / Fog).
- **Ticket hijo**: `.scratch/<effort>/issues/NN-<slug>.md`, numerado desde `01`, con la pregunta
  en el cuerpo. Una línea `Type:` registra el tipo de ticket (`research`/`prototype`/`grilling`/
  `task`); una línea `Status:` registra `claimed`/`resolved`.
- **Bloqueos**: una línea `Blocked by: NN, NN` cerca del principio. Un ticket se desbloquea cuando
  todos los archivos que lista están `resolved`.
- **Frontier**: escanear `.scratch/<effort>/issues/` en busca de archivos abiertos, sin bloquear y
  sin reclamar; gana el de número más bajo.
- **Claim**: poner `Status: claimed` y guardar antes de empezar a trabajar.
- **Resolve**: añadir la respuesta bajo un encabezado `## Answer`, poner `Status: resolved`, y
  luego añadir un puntero de contexto (gist + enlace) a las Decisions-so-far del `map.md`.
