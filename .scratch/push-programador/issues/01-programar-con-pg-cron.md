# 01 — Programar `/api/cron/dispatch` con pg_cron + pg_net

Status: deferred
Blocked by: — (lo aplica el usuario en el SQL Editor cuando decida)
Tamaño: S

## Qué

Llamar a `POST https://www.peppersfam.es/api/cron/dispatch` cada 15 minutos desde Supabase, con la
cabecera `x-cron-secret` leída de Vault. Después, quitar el `schedule` del workflow de GitHub.

## Pasos para el usuario (SQL Editor, un bloque cada vez)

### A) Extensiones

```sql
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
```

Si da error de permisos: Database → Extensions → activar `pg_cron` y `pg_net`.

### B) Secreto en Vault (NO va al repo)

Copiar el valor al portapapeles sin mostrarlo:

```bash
grep -E '^CRON_SECRET=' /Users/v/your-daily-guide/.env | cut -d= -f2- | tr -d '"\r\n' | pbcopy
```

```sql
select vault.create_secret('PEGA_AQUI_EL_CRON_SECRET', 'cron_secret', 'Cabecera x-cron-secret para /api/cron/dispatch');
```

Después de ejecutarlo, borrar esa consulta del editor (Supabase guarda el historial).

### C) Programación

```sql
select cron.schedule(
  'push-dispatch',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://www.peppersfam.es/api/cron/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 20000
  );
  $$
);
```

Usar `www.` directamente: el dominio sin `www` redirige (308) y `pg_net` no sigue redirecciones.

### D) Verificación (a los ~20 minutos)

```sql
select r.created, r.status_code, r.content, r.error_msg
from net._http_response r
order by r.created desc
limit 5;
```

Esperado: `status_code` 200 y `content` tipo `{"sent":…,"errors":0}`. 401 → el secreto de Vault no
coincide con `CRON_SECRET` de Vercel. Si no hay filas:

```sql
select start_time, status, return_message
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'push-dispatch')
order by start_time desc
limit 5;
```

## Pasos para Claude (cuando D salga bien)

1. `.github/workflows/push-dispatch.yml`: quitar `schedule` y dejar solo `workflow_dispatch` (para
   lanzarlo a mano). Así no se duplican llamadas: la deduplicación por `*_push_sent_on` no es atómica
   si dos llamadas coinciden en el mismo segundo.
2. Migración en `supabase/migrations/<fecha>_push_dispatch_pg_cron.sql` con los bloques A y C,
   **sin** el bloque B, con un comentario que explique que el secreto se crea a mano en Vault.
3. Actualizar CLAUDE.md y AGENTS.md (sección de notificaciones push: hoy dicen que el disparo lo hace
   un workflow de GitHub Actions cada 15 min).
4. Commit a `main` (flujo del repo).

## Criterios de aceptación

- [ ] `net._http_response` muestra 200 cada 15 minutos durante al menos 1 hora.
- [ ] Un aviso de mañana llega a su hora con una cuenta de prueba (poner `morning_time` al siguiente
      cuarto de hora en Ajustes, con notificaciones activadas en el dispositivo).
- [ ] El workflow de GitHub ya no tiene `schedule`.
- [ ] La migración del repo no contiene ningún secreto.

## Comments
