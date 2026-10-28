# Vigilar los primeros días y pulir

Status: open
Type: task

Cosas vistas al entregar que no se tocaron:

- **Ajo "20 g (≈4 ud)":** la tabla de piezas (`PRODUCE_UNIT_GRAMS`, 5 g) cuenta dientes y la IA
  cuenta cabezas en "ud". Decidir si el ajo en "ud" son cabezas (~50 g).
- **Lechuga en gramos pequeños** ("80 g"): una lechuga se compra entera. Quizá una pieza
  aproximada en `PRODUCE_UNIT_GRAMS`.
- **Café:** la receta trae la taza; se compra molido con un factor estimado (0,05, `BOUGHT_AS`).
- **Verificación de recolocaciones:** vigilar en los logs `reflow_changes_dropped` (por qué se
  descartan: `sin-receta`, `compra`, `objetivo`) y `reflow_verify_failed`. Si se descartan
  demasiados y el balance del día compensa poco, revisar `MAX_LOSS` o las familias.
- **Comidas fuera:** solo se marcan (`PlanDay.out`), no se enseñan en la pantalla. Si el usuario
  pregunta por qué algo no está en la compra, probablemente sea eso.
