-- Familia — bebés que aún no comen del plato de la mesa.
--
-- Hasta ahora un bebé se daba de alta como un "peque" más: contaba como comensal
-- del plato compartido, inflaba la lista de la compra del hogar y la IA lo
-- planificaba comiendo lo mismo que la mesa. `feeding_stage` separa esa etapa:
--   'pecho'      → pecho o biberón: no se planifica comida, ración 0.
--   'triturados' → potitos y triturados: su propio puré aparte, ración pequeña.
--   'mesa'       → ya come del plato de la familia (comportamiento de siempre).
--
-- Aplicar a mano en el SQL Editor (ver docs/agents/verification.md).

ALTER TABLE public.household_children
  ADD COLUMN IF NOT EXISTS feeding_stage text NOT NULL DEFAULT 'mesa';

ALTER TABLE public.household_children DROP CONSTRAINT IF EXISTS household_children_feeding_stage_check;
ALTER TABLE public.household_children
  ADD CONSTRAINT household_children_feeding_stage_check
  CHECK (feeding_stage IN ('pecho', 'triturados', 'mesa'));

-- Un bebé de pecho/biberón tiene ración 0 (no se le compra comida): el rango de
-- `portion` pasa de "> 0" a ">= 0".
ALTER TABLE public.household_children DROP CONSTRAINT IF EXISTS household_children_portion_range;
ALTER TABLE public.household_children
  ADD CONSTRAINT household_children_portion_range CHECK (portion >= 0 AND portion <= 5);

-- Las filas existentes siguen como estaban: ya comen del plato de la mesa.
UPDATE public.household_children SET feeding_stage = 'mesa' WHERE feeding_stage IS NULL;
