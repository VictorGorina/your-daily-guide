-- Familia — issue 04: la ración de cada niño entra en el cálculo de la compra,
-- igual que ya hace `household_members.portion` para los adultos.
--
-- Aplicar a mano en el SQL Editor (ver docs/agents/verification.md).

ALTER TABLE public.household_children
  ADD COLUMN IF NOT EXISTS portion numeric NOT NULL DEFAULT 0.5;

ALTER TABLE public.household_children DROP CONSTRAINT IF EXISTS household_children_portion_range;
ALTER TABLE public.household_children
  ADD CONSTRAINT household_children_portion_range CHECK (portion > 0 AND portion <= 5);

-- Backfill por edad (misma tabla que `childBasePortion` en household-shared.ts):
-- 1–3 años → 0.3, 4–8 → 0.5, 9–13 → 0.75, 14+ → 1.0, sin edad → 0.5.
UPDATE public.household_children
  SET portion = CASE
    WHEN age IS NULL THEN 0.5
    WHEN age <= 3 THEN 0.3
    WHEN age <= 8 THEN 0.5
    WHEN age <= 13 THEN 0.75
    ELSE 1.0
  END;
