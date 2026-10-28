# Build de iOS y verificación en el iPhone

Status: open
Type: task

Las dos tandas cambian código del cliente móvil (no hay OTA): barras de macros con kcal y
exceso, candado del mes, regla nueva de la optimizada (`stockUpAmounts`/`stocksUp`), reparto por
días (`dayQty` en `tripAmount`) y el disparo de la comprobación de la compra en planes ya
ajustados (`plan.shoppingCheck` en `mobile/app/(app)/(tabs)/plan.tsx`).

- El usuario lanza la build (`eas build … --auto-submit` en su terminal; ver memoria
  `infra-deploy`). Las builds 7-9 del 2026-10-26 son anteriores.
- Verificado en el simulador con una ruta temporal (barras, píldoras, candado), no en el
  dispositivo. Tras instalar: Hoy con comidas marcadas por encima del 100 %, Plan en noviembre
  (candado hacia diciembre) e Ingredientes en optimizada.

Antes, el usuario tiene que poner "Ver calorías y macros" en "Sí, enséñamelas" (su cuenta
tenía "ocultar"): si no, no verá ninguna barra en ninguna app.
