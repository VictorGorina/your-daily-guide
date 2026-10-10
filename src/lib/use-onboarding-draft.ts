import { useCallback, useEffect, useRef, useState } from "react";

// v2: el recorte de preguntas (issue 06) desplaza las claves posicionales `si-qi`,
// así que un borrador guardado con el guion anterior restauraría respuestas en la
// pregunta equivocada. Subir la versión descarta esos borradores a medias.
// v3: la pregunta de ver cifras (ticket 01 de `precision-nutricional`) entra en
// "Hacia dónde vamos" y desplaza las de detrás.
const DRAFT_STORAGE_KEY = "peppers-onboarding-progress-v3";

/**
 * El progreso del onboarding ("Guardar y salir"): respuestas y saltos por clave
 * de nodo (no por índice: la lista plana cambia de longitud con los follow-ups),
 * por dónde ibas, la fecha de nacimiento en ISO y si ya pasaste la portada. Se
 * lee de `localStorage` una vez al montar y se guarda en cada cambio. La clave
 * empieza por `peppers-onboarding-progress-`, que `user-storage.ts` borra al
 * cambiar de cuenta (ticket 18).
 */
export function useOnboardingDraft() {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [skipped, setSkipped] = useState<Record<string, true>>({});
  const [curKey, setCurKey] = useState("0-0");
  // Fecha de nacimiento en ISO (YYYY-MM-DD), capturada directamente del selector
  // de fecha: no dependemos de que la IA la extraiga bien del texto.
  const [dob, setDob] = useState<string | null>(null);
  const [introDismissed, setIntroDismissed] = useState(false);
  const hydrated = useRef(false);

  // Hidratación del progreso guardado: se lee una vez al montar.
  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (!raw) return;
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
    } catch {
      /* progreso corrupto: se ignora y se empieza de cero */
    }
  }, []);

  // Persistencia del progreso: cualquier cambio en respuestas/saltos/posición se
  // guarda en local. Se borra al completar el onboarding con éxito.
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem(
        DRAFT_STORAGE_KEY,
        JSON.stringify({ answers, skipped, curKey, dob, introDismissed }),
      );
    } catch {
      /* almacenamiento lleno o bloqueado: no es crítico */
    }
  }, [answers, skipped, curKey, dob, introDismissed]);

  const clearDraft = useCallback(() => {
    try {
      localStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch {
      /* nada que limpiar */
    }
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
    clearDraft,
  };
}
