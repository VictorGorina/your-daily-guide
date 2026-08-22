-- Gasto real por viaje de compra: { [trip]: totalEuros }, introducido a mano
-- por la persona tras comprar. Los precios de `shopping` siguen siendo la
-- estimación de la IA; esto es lo que de verdad se gastó en cada viaje.
ALTER TABLE public.monthly_plans ADD COLUMN IF NOT EXISTS trip_actuals jsonb;
