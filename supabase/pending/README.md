# Migraciones pendientes a propósito

Los archivos de esta carpeta **no están aplicados en producción** y no deben estarlo todavía. Viven
fuera de `supabase/migrations/` para que `supabase db push` no los ejecute: esa orden aplica todo
lo que encuentra en `migrations/` y no consta en el historial remoto.

Para aplicar uno: se devuelve a `supabase/migrations/` con su mismo nombre y entonces sí,
`supabase db push`.

| Archivo                        | Espera a                                                                                                                                                              |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261001130000_retention.sql` | Publicar la política de privacidad nueva, que anuncia los plazos de borrado (chat a 180 días, cuotas e intentos de unión). Su rollback está en `supabase/rollbacks/`. |
