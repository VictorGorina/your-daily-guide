import { Check, Loader2 } from "lucide-react";

import { balanceNote, type DayAdjustmentRecord, type DayBalance } from "@/lib/day-balance";
import type { MealChange } from "@/lib/plan-shared";

/**
 * "Balance de hoy" en la pestaña Hoy (feature `balance-del-dia`).
 *
 * Es la respuesta a una petición concreta del usuario: que la persona VEA que
 * lo que hace tiene efecto sobre el plan de los próximos días, porque eso es lo
 * que genera confianza. Por eso la tarjeta no es un aviso de "hecho", sino una
 * cuenta que cuadra — el desglose por origen es lo que hace legible la
 * causalidad: la persona ve sus tres palancas (platos cambiados, picoteo,
 * deporte) sumando a un solo número, y debajo lo que ese número ha movido.
 *
 * Va DEBAJO de "Registrar deporte", el último de los botones que la alimentan:
 * todo lo que suma queda por encima, así que se lee como el resumen de la
 * pantalla.
 *
 * Dos tempos, y los dos importan:
 *
 * - **El número es inmediato.** Sale de la tabla de composición y de
 *   `estimateExerciseKcal`, que son deterministas: está calculado en cuanto se
 *   guarda el picoteo o el plato, sin esperar a ninguna IA.
 * - **Los platos movidos tardan.** Necesitan la ventana de calma y la llamada
 *   al modelo. Entre medias se dice "Ajustando tus próximos días…".
 *
 * Y cuando el plan NO se mueve, la tarjeta lo dice igualmente (`balanceNote`):
 * un "no he cambiado nada" explicado demuestra que el sistema estaba mirando,
 * y es justo el caso que antes se quedaba mudo.
 *
 * Sustituye a los tres sitios donde esto vivía antes (el bloque de ajuste de
 * `snack-card`, el de `exercise-card` y el badge "i" de cada fila de comida),
 * que se atribuían el mismo reajuste tres veces. Copia en
 * `mobile/components/day-balance-card.tsx`.
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

function Line({ label, kcal }: { label: string; kcal: number }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      <span className="font-num text-[11.5px] tabular-nums text-muted-foreground">
        {signed(kcal)}
      </span>
    </div>
  );
}

function ChangeChip({ change }: { change: MealChange }) {
  return (
    <div className="rounded-xl bg-secondary/60 px-3 py-2.5">
      <span className="font-num text-[10.5px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
        {weekdayShort(change.date)} · {change.slotLabel}
      </span>
      <div className="mt-1 flex items-start gap-1.5 text-[13px] leading-snug">
        <span className="text-muted-foreground line-through">{change.before}</span>
        <span className="shrink-0 text-muted-foreground">→</span>
        <span className="text-foreground">{change.after}</span>
      </div>
    </div>
  );
}

export function DayBalanceCard({
  balance,
  record,
  settling,
  failed,
  onShowAdjustment,
}: {
  balance: DayBalance;
  record: DayAdjustmentRecord | null;
  /** Hay un asentamiento pendiente o en vuelo. */
  settling: boolean;
  /** El último asentamiento falló. */
  failed: boolean;
  onShowAdjustment: () => void;
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
  const note = busy ? null : balanceNote(balance, record?.lastOutcome);

  return (
    <section className="animate-rise mt-6 rounded-[20px] bg-surface px-3.5 py-3.5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold tracking-[0.01em] text-foreground">
          Balance de hoy
        </h3>
        <span className="flex items-baseline gap-1">
          <span
            className={`font-num text-[22px] font-semibold tabular-nums ${
              settled ? "text-success" : "text-foreground"
            }`}
          >
            {signed(balance.net)}
          </span>
          <span className="font-num text-[10.5px] text-muted-foreground">kcal</span>
        </span>
      </div>

      {/* El desglose es lo que hace legible la causalidad: sus tres palancas
          sumando a un solo número. Solo se pinta la línea que aporta algo. */}
      <div className="mt-2.5 space-y-1">
        {meals !== 0 ? <Line label="Comidas cambiadas" kcal={meals} /> : null}
        {snacks !== 0 ? <Line label="Picoteo" kcal={snacks} /> : null}
        {exercise !== 0 ? <Line label="Deporte" kcal={exercise} /> : null}
      </div>

      {busy ? (
        <p className="mt-3 flex items-center gap-2 text-[12px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden />
          Ajustando tus próximos días…
        </p>
      ) : changes.length ? (
        <>
          <p className="mt-3 text-[12.5px] leading-[1.45] text-foreground">
            He movido{" "}
            <span className="font-medium">
              {changes.length} {changes.length === 1 ? "plato" : "platos"}
            </span>{" "}
            de los próximos días para absorberlo.
          </p>
          <div className="mt-2 space-y-1.5">
            {changes.slice(0, INLINE_CHANGES).map((c) => (
              <ChangeChip key={`${c.date}-${c.slot}`} change={c} />
            ))}
          </div>
          {changes.length > INLINE_CHANGES ? (
            <button
              type="button"
              onClick={onShowAdjustment}
              className="mt-2.5 text-left text-[12px] font-medium text-primary"
            >
              Ver los {changes.length} cambios
            </button>
          ) : null}
        </>
      ) : failed ? (
        <p className="mt-3 text-[12px] text-muted-foreground">
          No he podido revisar el plan ahora; lo intento de nuevo más tarde.
        </p>
      ) : note ? (
        <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-[1.45] text-foreground">
          {settled ? (
            <Check className="mt-[2px] h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
          ) : null}
          <span>{note}</span>
        </p>
      ) : null}
    </section>
  );
}
