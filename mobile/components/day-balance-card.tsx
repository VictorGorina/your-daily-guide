import { Check } from "lucide-react-native";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import {
  absorbedNote,
  balanceNote,
  type DayAdjustmentRecord,
  type DayBalance,
} from "../lib/day-balance";
import type { MealChange } from "../lib/plan-shared";

/**
 * "Balance de hoy" en la pestaña Hoy (feature `balance-del-dia`). Copia nativa
 * de `src/components/day-balance-card.tsx` — el porqué largo está allí.
 *
 * En corto: la persona tiene que VER que lo que hace mueve el plan de los
 * próximos días, porque eso es lo que genera confianza. Por eso no es un aviso
 * de "hecho" sino una cuenta que cuadra — el desglose por origen (platos
 * cambiados, picoteo, deporte) hace legible la causalidad — y por eso cuando el
 * plan NO se mueve también lo dice.
 */

/** Platos que se enseñan sin abrir la hoja. Los demás, tras "Ver". */
const INLINE_CHANGES = 2;

const weekdayShort = (date: string) => {
  const d = new Date(`${date}T00:00:00`);
  const label = d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
};

/** "+180" / "−50". Signo tipográfico, no guion. */
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)}`;

function Line({ label, kcal, showNumbers }: { label: string; kcal: number; showNumbers: boolean }) {
  return (
    <View className="flex-row items-baseline justify-between">
      <Text className="font-body text-[12.5px] text-muted-foreground">{label}</Text>
      {showNumbers ? (
        <Text className="font-mono text-[11.5px] text-muted-foreground">{signed(kcal)}</Text>
      ) : null}
    </View>
  );
}

function ChangeChip({ change }: { change: MealChange }) {
  return (
    <View className="rounded-2xl bg-secondary/60 px-3 py-2.5">
      <Text className="font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
        {weekdayShort(change.date)} · {change.slotLabel}
      </Text>
      <View className="mt-1 flex-row flex-wrap items-start gap-1.5">
        <Text className="font-body text-[13px] text-muted-foreground line-through">
          {change.before}
        </Text>
        <Text className="font-body text-[13px] text-muted-foreground">→</Text>
        <Text className="font-body text-[13px] text-foreground">{change.after}</Text>
      </View>
    </View>
  );
}

export function DayBalanceCard({
  balance,
  record,
  settling,
  failed,
  onShowAdjustment,
  showNumbers = true,
  onlyRoutineExercise = false,
}: {
  balance: DayBalance;
  /** El deporte de hoy fue solo de su rutina: ya iba en el objetivo (ticket 16). */
  onlyRoutineExercise?: boolean;
  record: DayAdjustmentRecord | null;
  /** Hay un asentamiento pendiente o en vuelo. */
  settling: boolean;
  /** El último asentamiento falló. */
  failed: boolean;
  onShowAdjustment: () => void;
  /** `false` con la preferencia de no ver cifras (ticket 01): sin números de kcal. */
  showNumbers?: boolean;
}) {
  const changes = record?.adjustment?.changes ?? [];
  if (!balance.active && !changes.length) return null;

  // Un intento fallido deja el desvío otra vez pendiente (se reintenta solo),
  // así que `settling` volvería a ser cierto y taparía el aviso con el spinner
  // de "Ajustando…" indefinidamente. El fallo manda.
  const busy = settling && !failed;

  const { meals, snacks, exercise } = balance.sources;
  // Un día que se anula solo (deporte contra picoteo) no es cero de verdad: el
  // verde dice "esto está cuadrado", que es la lectura correcta.
  const settled = !busy && !failed && Math.abs(balance.net) < 100 && (snacks > 0 || meals !== 0);
  const note = busy ? null : balanceNote(balance, record?.lastOutcome, { onlyRoutineExercise });

  return (
    <View className="mt-6 rounded-[20px] bg-surface px-3.5 py-3.5">
      <View className="flex-row items-baseline justify-between">
        <Text className="font-body-semibold text-[13px] text-foreground">Balance de hoy</Text>
        {showNumbers ? (
          <View className="flex-row items-baseline gap-1">
            <Text
              className={`font-mono text-[22px] ${settled ? "text-success" : "text-foreground"}`}
            >
              {signed(balance.net)}
            </Text>
            <Text className="font-mono text-[10.5px] text-muted-foreground">kcal</Text>
          </View>
        ) : null}
      </View>

      {/* El desglose es lo que hace legible la causalidad: sus tres palancas
          sumando a un solo número. Solo se pinta la línea que aporta algo. */}
      <View className="mt-2.5 gap-1">
        {meals !== 0 ? (
          <Line label="Comidas cambiadas" kcal={meals} showNumbers={showNumbers} />
        ) : null}
        {snacks !== 0 ? <Line label="Picoteo" kcal={snacks} showNumbers={showNumbers} /> : null}
        {exercise !== 0 ? <Line label="Deporte" kcal={exercise} showNumbers={showNumbers} /> : null}
      </View>

      {busy ? (
        <View className="mt-3 flex-row items-center gap-2">
          <ActivityIndicator size="small" color="#ff8a3d" />
          <Text className="font-body text-[12px] text-muted-foreground">
            Ajustando tus próximos días…
          </Text>
        </View>
      ) : changes.length ? (
        <>
          <Text className="mt-3 font-body text-[12.5px] leading-[18px] text-foreground">
            He movido{" "}
            <Text className="font-body-medium">
              {changes.length} {changes.length === 1 ? "plato" : "platos"}
            </Text>{" "}
            de los próximos días para absorberlo.
          </Text>
          {absorbedNote(record?.adjustment, showNumbers) ? (
            <Text className="mt-1 font-body text-[12px] text-muted-foreground">
              {absorbedNote(record?.adjustment, showNumbers)}
            </Text>
          ) : null}
          <View className="mt-2 gap-1.5">
            {changes.slice(0, INLINE_CHANGES).map((c) => (
              <ChangeChip key={`${c.date}-${c.slot}`} change={c} />
            ))}
          </View>
          {changes.length > INLINE_CHANGES ? (
            <Pressable onPress={onShowAdjustment} className="mt-2.5 active:opacity-70">
              <Text className="font-body-medium text-[12px] text-primary">
                Ver los {changes.length} cambios
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : failed ? (
        <Text className="mt-3 font-body text-[12px] text-muted-foreground">
          No he podido revisar el plan ahora; lo intento de nuevo más tarde.
        </Text>
      ) : note ? (
        <View className="mt-3 flex-row items-start gap-2">
          {settled ? <Check size={13} color="#4cae64" style={{ marginTop: 2 }} /> : null}
          <Text className="flex-1 font-body text-[12.5px] leading-[18px] text-foreground">
            {note}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
