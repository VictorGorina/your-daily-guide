# Relevo — fase 2 de `precision-nutricional` (2026-09-25)

Para retomar en una sesión nueva. El detalle de cada ticket está en sus `## Comments`
(`issues/05, 06, 14, 16, 17, 18, 21, 22, 23`) y el resumen en el `spec.md`.

## Estado

- **Implementado en código, SIN COMMIT y sin desplegar**, en el checkout principal
  (`/Users/v/your-daily-guide`, rama `main`): tickets 05, 06, 14, 16, 17, 18, 21, 22 y 23, en web y
  en la app iOS. Puertas en verde al cerrar: `bun run test` (702), `bun run typecheck`, `npx tsc` en
  `mobile/`, `scripts/check-shared-drift.sh` y `bun run lint` (0 errores).
- **Supabase de producción: hecho.** Tablas `dish_recipes` y `foods_extra` creadas y
  `increment_dish_recipe_hits` cerrada a `anon`/`authenticated` (migración
  `20260925160000_dish_recipes_revoke_anon.sql`). Comprobado con la clave publishable: no puede
  insertar, modificar ni llamar a la función; la clave de servicio sí.
- **Falta** `USDA_FDC_API_KEY` en `.env` y Vercel (clave gratuita de api.data.gov). Sin ella el
  código funciona y no busca en USDA.

## Mediciones

- `bun run eval:recipes` (GPT-5, 3 pasadas): sesgo +21,5 % → **+6,6 %**, error por ración 23,2 % →
  **10,8 %**, proteína 23,3 % → **10,4 %**, casado de la tabla 64,7 % → **100 %**, sin descomponer
  24 → 1/225. Empeora la densidad (5,2 % → 12,6 %, masa de líquido de cremas y guisos).
- `bun run eval:plan-lite`: **5/21 días a ±15 % del objetivo** (se pedía ≥ 70 %), sesgo a la baja en
  las tres tipologías; 8/42 comidas principales de un solo componente. La estructura de la comida
  en el prompt no cierra el día.

## Decisiones pendientes del usuario

1. **Subir a `main`**: el usuario ha dicho "subiremos a main luego". La otra sesión (worktree
   `.claude/worktrees/sleepy-hofstadter-88081f`, registro de deporte y picoteo del chat) sube lo
   suyo por separado. Al integrar, chocan `guided-log-sheet.tsx` (web y móvil) y `chat.tsx` (web y
   móvil): en la versión de esa sesión el camino de actividad guarda con `logExercise` y la prop
   `weightKg` de `GuidedLogSheet` que añadí aquí sobra — quedarse con la suya y quitar la prop.
2. **El plan se queda corto frente al objetivo** (14, 21 y 23 debían salir juntos para evitarlo).
   Opciones planteadas: adelantar el ticket 10 (el código escala las raciones de cada día hasta el
   objetivo), desplegar solo lo independiente, o esperar.

## Lo que no se hizo

- A/B de modelos del 05 (Flash con y sin razonamiento).
- Kcal antes de guardar en "comí distinto" (17).
- Sustituir un plato del plan que no se deja calcular (06): hoy queda "calculando" y se reintenta.
- Prueba de hogar (media de los adultos) en el navegador y verificación en el simulador iOS.
- Chistorra y muesli sin fuente fiable; verificar con USDA los `fdcId` de la patata (170026 /
  170438) y del salmón crudo (175167).
