import { createContext, type RefObject, useContext } from "react";

/** Lo que comparten el campo, su botón de dictar y la onda (`DictationField`). */
export type DictationState = {
  listening: boolean;
  /** Lo llama `DictateButton`: si escucha y dónde leer el volumen de la voz. */
  report: (listening: boolean, level: RefObject<number>) => void;
  /** `null` hasta el primer dictado. */
  level: RefObject<number> | null;
};

export const DictationContext = createContext<DictationState | null>(null);

export const useDictationField = () => useContext(DictationContext);
