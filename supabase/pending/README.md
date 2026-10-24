# Migraciones pendientes a propósito

Los archivos de esta carpeta **no están aplicados en producción** y no deben estarlo todavía. Viven
fuera de `supabase/migrations/` para que `supabase db push` no los ejecute: esa orden aplica todo
lo que encuentra en `migrations/` y no consta en el historial remoto.

Para aplicar uno: se devuelve a `supabase/migrations/` con su mismo nombre y entonces sí,
`supabase db push`.

| Archivo                                        | Espera a                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261011120000_server_only_columns.sql`       | Ticket 39. Que deje de usarse cualquier build del móvil anterior a `85a4b13` (escriben `daily_logs.guide` con la sesión: con esto aplicado dejarían de guardar la guía) y una semana sin escrituras directas a esas columnas. Su rollback está en `supabase/rollbacks/`. Al aplicarla: su test pasa de `pending/tests/` a `supabase/tests/`, y en `monthly_plans_rls.test.sql` cambian M10 (ya no escribe su fila, solo la borra) y M11 (ya no crea su fila). |
| `20261024150100_households_insert_via_rpc.sql` | Ticket 37, punto 5. Que deje de usarse cualquier build del móvil anterior a la que crea el hogar con `create_household` (las de antes insertan en `households` ellas mismas y dejarían de poder crear un hogar). Su rollback está en `supabase/rollbacks/`. Al aplicarla: su test pasa de `pending/tests/` a `supabase/tests/`, y en `household_rls.test.sql` L01 pasa a crear el hogar con `create_household` (el INSERT directo queda DENEGADO).            |
| `20261024170100_health_consent_guard.sql`      | Ticket 30. Que esté desplegada la web que pide el consentimiento de los datos de salud (el onboarding de antes los guarda sin él y fallaría al guardar). Las builds del móvil de antes solo fallan al CAMBIAR un dato de salud sin consentimiento, y con la web desplegada esa persona ya lo ha dado o lo ha rechazado (hoja al abrir la app). Su rollback está en `supabase/rollbacks/`. Al aplicarla: su test pasa de `pending/tests/` a `supabase/tests/`. |

## Tests de una migración pendiente

`supabase test db` corre contra lo que hay en `supabase/migrations/`, así que no ve estas. Una
migración pendiente puede traer su pgTAP en `supabase/pending/tests/<mismo nombre>.test.sql`:
`scripts/check-pending-migrations.sh` (job `db` del CI) la aplica sobre la base de datos local,
corre el test en la misma transacción y lo deshace todo. Así se sabe que sigue aplicando sobre el
esquema de hoy aunque tarde semanas en tocarle.
