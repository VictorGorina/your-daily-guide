-- Ingredientes que la persona ya tiene en casa y NO están en la lista de la
-- compra del mes (añadidos a mano o detectados al escanear un tiquet). El
-- planificador los trata como disponibles al recolocar; `shopping` no se toca.
ALTER TABLE public.monthly_plans ADD COLUMN IF NOT EXISTS pantry_extras jsonb;

-- Resumen del tiquet escaneado por compra: { [trip]: { total, itemCount, scannedAt } }.
-- El importe también se copia a trip_actuals (misma columna que el gasto a mano),
-- para que el tracking de gasto real no dependa de esta columna.
ALTER TABLE public.monthly_plans ADD COLUMN IF NOT EXISTS trip_receipts jsonb;
