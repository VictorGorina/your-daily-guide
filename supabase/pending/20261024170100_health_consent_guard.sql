-- Ticket 30 de la auditoría (RGPD art. 9.2.a), segunda parte: sin
-- consentimiento no se guarda ningún dato de salud del perfil, y retirarlo los
-- borra. Rollback: supabase/rollbacks/20261024170100_health_consent_guard.sql.
-- Tests: supabase/pending/tests/20261024170100_health_consent_guard.test.sql.
--
-- `saveProfile` escribe directo del cliente a Supabase, así que esta es la
-- única frontera. La lista de columnas es `HEALTH_PROFILE_FIELDS`
-- (src/lib/health-consent.ts, copia en mobile/lib/); un test de Bun comprueba
-- que este archivo nombra cada una.
--
-- Las filas de hoy con datos de salud y sin consentimiento no se tocan: la app
-- les pide el consentimiento al abrirse. Por eso en un UPDATE solo cuentan los
-- campos que CAMBIAN a un valor: si no, cualquier escritura del perfil de esa
-- persona (la zona horaria que Hoy guarda al abrirse) fallaría. Vaciar un campo
-- siempre se puede.
--
-- NO APLICAR antes de que esté desplegada la web que pide el consentimiento:
-- el onboarding de antes guarda datos de salud sin él y fallaría. Ver
-- supabase/pending/README.md.

CREATE OR REPLACE FUNCTION public.profiles_require_health_consent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Retirarlo borra los datos (Ajustes → Privacidad), lo mande o no el cliente.
  IF TG_OP = 'UPDATE' AND OLD.health_consent_at IS NOT NULL AND NEW.health_consent_at IS NULL THEN
    NEW.medical_conditions := NULL;
    NEW.medications := NULL;
    NEW.supplements := NULL;
    NEW.pregnancy_status := NULL;
    NEW.menstrual_cycle := NULL;
    NEW.ed_history := NULL;
    NEW.food_relationship := NULL;
    NEW.past_struggles := NULL;
    NEW.allergy_severity := NULL;
    NEW.alcohol := NULL;
    NEW.smoking := NULL;
    RETURN NEW;
  END IF;

  IF NEW.health_consent_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- El upsert de `saveProfile` (INSERT … ON CONFLICT DO UPDATE) dispara primero
  -- este trigger con la fila PROPUESTA, sin el consentimiento guardado. Si la
  -- fila ya existe, decide el disparo del UPDATE, que ve la fila real.
  IF TG_OP = 'INSERT' THEN
    IF EXISTS (SELECT 1 FROM public.profiles WHERE id = NEW.id) THEN
      RETURN NEW;
    END IF;
    IF NEW.medical_conditions IS NOT NULL OR NEW.medications IS NOT NULL
       OR NEW.supplements IS NOT NULL OR NEW.pregnancy_status IS NOT NULL
       OR NEW.menstrual_cycle IS NOT NULL OR NEW.ed_history IS NOT NULL
       OR NEW.food_relationship IS NOT NULL OR NEW.past_struggles IS NOT NULL
       OR NEW.allergy_severity IS NOT NULL OR NEW.alcohol IS NOT NULL
       OR NEW.smoking IS NOT NULL THEN
      RAISE EXCEPTION 'Falta el consentimiento para guardar datos de salud'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.medical_conditions IS NOT NULL AND NEW.medical_conditions IS DISTINCT FROM OLD.medical_conditions)
     OR (NEW.medications IS NOT NULL AND NEW.medications IS DISTINCT FROM OLD.medications)
     OR (NEW.supplements IS NOT NULL AND NEW.supplements IS DISTINCT FROM OLD.supplements)
     OR (NEW.pregnancy_status IS NOT NULL AND NEW.pregnancy_status IS DISTINCT FROM OLD.pregnancy_status)
     OR (NEW.menstrual_cycle IS NOT NULL AND NEW.menstrual_cycle IS DISTINCT FROM OLD.menstrual_cycle)
     OR (NEW.ed_history IS NOT NULL AND NEW.ed_history IS DISTINCT FROM OLD.ed_history)
     OR (NEW.food_relationship IS NOT NULL AND NEW.food_relationship IS DISTINCT FROM OLD.food_relationship)
     OR (NEW.past_struggles IS NOT NULL AND NEW.past_struggles IS DISTINCT FROM OLD.past_struggles)
     OR (NEW.allergy_severity IS NOT NULL AND NEW.allergy_severity IS DISTINCT FROM OLD.allergy_severity)
     OR (NEW.alcohol IS NOT NULL AND NEW.alcohol IS DISTINCT FROM OLD.alcohol)
     OR (NEW.smoking IS NOT NULL AND NEW.smoking IS DISTINCT FROM OLD.smoking) THEN
    RAISE EXCEPTION 'Falta el consentimiento para guardar datos de salud'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Va antes que `profiles_stamp_health_consent` (orden alfabético), así que ve
-- la fecha tal como la manda el cliente; da igual: solo mira si es nula.
DROP TRIGGER IF EXISTS profiles_require_health_consent ON public.profiles;
CREATE TRIGGER profiles_require_health_consent
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_require_health_consent();
