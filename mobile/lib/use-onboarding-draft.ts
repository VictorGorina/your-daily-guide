import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

// v2: el recorte de preguntas (issue 06) desplaza las claves posicionales `si-qi`,
// así que un borrador guardado con el guion anterior restauraría respuestas en la
// pregunta equivocada. Subir la versión descarta esos borradores a medias.
// v3: la pregunta de ver cifras (ticket 01 de `precision-nutricional`) entra en
// "Hacia dónde vamos" y desplaza las de detrás.
// v4: "Hacia dónde vamos" pasa al peso objetivo (como la web) y la pregunta de
// sugerencias de comportamiento sale de "Cómo te acompaño": cambian las claves de
// las dos pantallas.
const DRAFT_STORAGE_KEY = "peppers-onboarding-progress-v4";

/**
 * El progreso del onboarding ("Guardar y salir"): respuestas, preguntas
 * aparcadas, por dónde ibas, la fecha de nacimiento en ISO y si ya pasaste la
 * portada. Se lee de AsyncStorage una vez al montar y se guarda en cada cambio.
 * La clave empieza por `peppers-onboarding-progress-`, que `user-storage.ts`
 * borra al cambiar de cuenta (ticket 18).
 */
export function useOnboardingDraft() {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Record<string, true>>({});
  const [curKey, setCurKey] = useState("0-0");
  const [dob, setDob] = useState<string | null>(null);
  const [introDismissed, setIntroDismissed] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hidratación del progreso guardado: se lee una vez al montar. Quien pinta
  // espera a `hydrated` para no parpadear el chat vacío.
  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(DRAFT_STORAGE_KEY)
      .then((raw) => {
        if (!alive || !raw) return;
        const saved = JSON.parse(raw) as {
          answers?: Record<string, string>;
          skipped?: Record<string, true>;
          curKey?: string;
          dob?: string | null;
          introDismissed?: boolean;
        };
        if (saved.answers) setAnswers(saved.answers);
        if (saved.skipped) setSkipped(saved.skipped);
        if (saved.curKey) setCurKey(saved.curKey);
        if (saved.dob) setDob(saved.dob);
        if (saved.introDismissed) setIntroDismissed(true);
      })
      .catch(() => {
        /* progreso corrupto: se empieza de cero */
      })
      .finally(() => {
        if (alive) setHydrated(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Persistencia del progreso: se borra al completar el onboarding con éxito.
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({ answers, skipped, curKey, dob, introDismissed }),
    ).catch(() => {
      /* almacenamiento bloqueado: no es crítico */
    });
  }, [answers, skipped, curKey, dob, introDismissed, hydrated]);

  const clearDraft = useCallback(() => {
    AsyncStorage.removeItem(DRAFT_STORAGE_KEY).catch(() => {});
  }, []);

  return {
    answers,
    setAnswers,
    skipped,
    setSkipped,
    curKey,
    setCurKey,
    dob,
    setDob,
    introDismissed,
    setIntroDismissed,
    hydrated,
    clearDraft,
  };
}
