-- Peso objetivo: el objetivo pasa de categórico (goal_type) a un número concreto
-- (target_weight_kg). La dirección (perder/ganar/mantener) se deduce comparando
-- current_weight_kg vs target_weight_kg. Los campos legacy (goal_type, goal_amount,
-- goal_target_date) se mantienen para backward compat.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS target_weight_kg numeric;

-- Migración de datos legacy: derivar target_weight_kg de los campos actuales.

-- "perder" → target = start_weight - goal_amount
UPDATE profiles SET target_weight_kg = start_weight_kg - goal_amount
WHERE target_weight_kg IS NULL
  AND goal_type IN ('perder', 'perder peso')
  AND goal_amount IS NOT NULL
  AND start_weight_kg IS NOT NULL;

-- "ganar" → target = start_weight + goal_amount
UPDATE profiles SET target_weight_kg = start_weight_kg + goal_amount
WHERE target_weight_kg IS NULL
  AND goal_type IN ('ganar', 'ganar músculo', 'ganar musculo')
  AND goal_amount IS NOT NULL
  AND start_weight_kg IS NOT NULL;

-- "mantener" → target = start_weight (o current si no hay start)
UPDATE profiles SET target_weight_kg = COALESCE(start_weight_kg, current_weight_kg)
WHERE target_weight_kg IS NULL
  AND goal_type = 'mantener'
  AND (start_weight_kg IS NOT NULL OR current_weight_kg IS NOT NULL);
