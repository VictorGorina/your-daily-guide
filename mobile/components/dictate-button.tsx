import { Mic } from "lucide-react-native";
import { Pressable } from "react-native";

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
  const { state, start, stop } = useDictation(onText);
  const listening = state === "listening";

  return (
    <Pressable
      onPressIn={() => void start()}
      onPressOut={stop}
      hitSlop={8}
      accessibilityLabel="Mantén pulsado para dictar"
      className={`h-9 w-9 items-center justify-center rounded-full active:opacity-70 ${
        listening ? "bg-foreground" : "bg-secondary"
      } ${className}`}
    >
      <Mic size={16} color={listening ? "#fbfaf7" : "#83796c"} />
    </Pressable>
  );
}
