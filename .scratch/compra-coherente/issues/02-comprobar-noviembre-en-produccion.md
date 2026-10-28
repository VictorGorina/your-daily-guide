# Comprobar que la reparación de noviembre corrió bien

Status: open
Type: task

La comprobación de la compra corre la primera vez que el usuario abra Plan en la web (o en una
build nueva de iOS) con noviembre: el plan ya tiene `fit` pero no `shoppingCheck`.

Mirar, en solo lectura (`bun run db`, nunca escribir en su fila):

- `monthly_plans` de 2026-11 del usuario (`1379c493-…`): `plan.shoppingCheck` (`added`,
  `raised`), `plan.outMarked`, qué días tienen `out`, y que la compra tenga `dayQty`.
- Logs de Vercel: la línea `shoppingCheck 2026-11: …` y eventos `shopping_check_failed`.
- Prueba en seco del 2026-10-27: añadiría lechuga y puerro y subiría espinacas congeladas. Si
  `markMealsOut` marcó comidas fuera, puede salir menos.

Si añade cosas que no tocan (un sustituto que debería contar, un básico), ajustar `SUBSTITUTES`
o `BASICS` en `src/lib/shopping/coverage.server.ts`.

Además, el martes 27 de octubre el calabacín estaba en la compra de los días 25-31 marcado "en
casa": si el usuario no lo tenía, debe desmarcarlo él.
