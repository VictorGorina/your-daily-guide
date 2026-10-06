import { Mic } from "lucide-react-native";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Pressable } from "react-native";

import { useDictationField } from "../lib/dictation-context";
import { useDictation } from "../lib/use-dictation";

/**
 * Botón de "mantener pulsado para dictar". Ver `lib/use-dictation.ts` para el
 * porqué (reconocimiento nativo del dispositivo, sin proveedor propio).
 */
export function DictateButton({
  onText,
  className = "",
}: {
  onText: (text: string) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const { state, start, stop, level } = useDictation(onText);
  const listening = state === "listening";

  // Va siempre dentro de un `DictationField`: la onda del campo sale de aquí.
  const report = useDictationField()?.report;
  useEffect(() => {
    report?.(listening, level);
  }, [report, listening, level]);

  return (
    <Pressable
      accessibilityRole="button"
      onPressIn={() => void start()}
      onPressOut={stop}
      hitSlop={8}
      accessibilityLabel={t("dictation.holdTo", { action: t("dictation.label").toLowerCase() })}
      className={`h-9 w-9 items-center justify-center rounded-full active:opacity-70 ${
        listening ? "bg-foreground" : "bg-secondary"
      } ${className}`}
    >
      <Mic size={16} color={listening ? "#fbfaf7" : "#6b6256"} />
    </Pressable>
  );
}
