import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  COACH_MODEL,
  coachSystemPrompt,
  createAiProvider,
  requireAiKey,
} from "@/lib/ai-provider.server";
import { assertCleanFood } from "@/lib/assert-clean-food";
import { updatePlanRowCas } from "@/lib/plan-rows.server";
import {
  asCadence,
  cadenceOf,
  carryOwnedByName,
  cleanPantryExtras,
  cleanPlan,
  cleanShopping,
  cleanTripActuals,
  cleanTripConfirmations,
  cleanTripReceipts,
  ingredientNames,
  isCanonicalShopping,
  monthCoverage,
  type MonthlyPlan,
  normName,
  type PantryExtra,
  parseJsonLoose,
  repartitionTrips,
  type ShoppingCadence,
  type ShoppingList,
  type TripActuals,
  type TripConfirmations,
  type TripReceipts,
  tripsForCoverage,
  withoutStoreMarks,
  withPantryExtra,
  withTripActual,
  withTripConfirmed,
} from "@/lib/plan-shared";
import { RateLimitError } from "@/lib/rate-limit-error";
import { UserFacingError, ValidationError } from "@/lib/validation-error";
import { zonedTodayISO } from "@/lib/zoned-date";
import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { readShoppingRow, resolveShoppingRow, updateShoppingState } from "../plan/rows.server";
import { keepCleanReceiptNames, toggleShoppingOwnedHandler } from "./state.server";

/**
 * Cambia la cadencia de compra (semanal/bisemanal/mensual). No regenera el plan
 * ni llama a la IA: la lista canónica ya guarda el desglose por semana, así que
 * cambiar de cadencia solo cambia cómo se agrupa en pantalla (`projectTrips`).
 * Una lista antigua (sin desglose) se reparte con `repartitionTrips` como antes,
 * y `carryOwnedByName` conserva las marcas "en casa"/"comprado".
 */
export const recadenceMonthlyPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; cadence?: ShoppingCadence }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const cadence: ShoppingCadence = asCadence(input?.cadence) ?? "mensual";
    return { month: input.month, cadence };
  })
  .handler(async ({ data, context }): Promise<{ plan: MonthlyPlan; shopping: ShoppingList }> => {
    let plan = null as MonthlyPlan | null;
    let shopping: ShoppingList = [];
    const write = await updatePlanRowCas(
      context.supabase as never,
      context.userId,
      data.month,
      "plan, shopping",
      (row) => {
        const current = cleanPlan(row.plan);
        if (!current) throw new ValidationError("Todavía no hay plan de este mes");
        const prevShopping = cleanShopping(row.shopping);
        plan = { ...current, cadence: data.cadence };
        // Una lista canónica no cambia al cambiar de cadencia (la pantalla la
        // re-proyecta): no se reescribe, para no pisar una marca que llegue a la
        // vez. Salvo al entrar o salir de la optimizada, que cambia qué lleva
        // cada compra: ahí se quitan las marcas "comprado" (`withoutStoreMarks`).
        // Una antigua se reparte entre EXACTAMENTE las compras que la
        // pantalla va a enseñar para esta cobertura: repartir entre más las
        // dejaría fuera de la vista (ver `repartitionTrips`).
        const before = current.cadence ?? cadenceOf(prevShopping);
        const regrouped = (before === "optimizada") !== (data.cadence === "optimizada");
        if (isCanonicalShopping(prevShopping)) {
          if (!regrouped) {
            shopping = prevShopping;
            return { plan };
          }
          shopping = withoutStoreMarks(prevShopping);
          return { plan, shopping };
        }
        const tripCount = tripsForCoverage(
          data.cadence,
          current.coverage ?? monthCoverage(data.month, zonedTodayISO()),
        );
        shopping = carryOwnedByName(
          prevShopping,
          repartitionTrips(prevShopping, data.cadence, tripCount),
        );
        return { plan, shopping };
      },
    ).catch((error: unknown) => {
      if (error instanceof ValidationError) throw error;
      console.error("recadenceMonthlyPlan", error);
      throw new UserFacingError("No hemos podido cambiar la frecuencia de la compra");
    });
    if (!write.latest || !plan) throw new ValidationError("Todavía no hay plan de este mes");

    return { plan, shopping };
  });

/**
 * Marca un ingrediente como comprado ("fridge": ya lo tenía en casa, "store":
 * lo ha comprado en el súper) o lo deja sin decidir (source null) — no cambia
 * la lista en sí (cantidades y precio siguen igual), solo anota de dónde ha
 * salido cada uno. La marca es por ingrediente Y compra: un mismo fresco puede
 * hacer falta en varias compras y marcar una no marca las demás. En la lista
 * canónica eso vive en `ownedTrips[trip]`; en una lista antigua, en el `owned`
 * de la fila de ese `trip`.
 */
export const toggleShoppingOwned = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      month: string;
      itemName: string;
      trip: number;
      source: "fridge" | "store" | null;
    }) => {
      if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
      const itemName = String(input?.itemName ?? "").trim();
      if (!itemName) throw new ValidationError("Falta el ingrediente");
      const trip = Number(input?.trip);
      if (!Number.isFinite(trip) || trip < 0) throw new ValidationError("Viaje no válido");
      const source = input?.source === "fridge" || input?.source === "store" ? input.source : null;
      return { month: input.month, itemName, trip: Math.round(trip), source };
    },
  )
  .handler(toggleShoppingOwnedHandler);

/**
 * Guarda lo que se ha gastado de verdad en un viaje de compra concreto. Los
 * precios de `shopping` son la estimación de la IA hecha al generar el plan;
 * esto es aparte y no los toca, para poder comparar estimado contra real.
 */
export const setTripActual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; trip: number; amount: number | null }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const trip = Number(input?.trip);
    if (!Number.isFinite(trip) || trip < 0) throw new ValidationError("Viaje no válido");
    const amount = input?.amount == null ? null : Number(input.amount);
    if (amount != null && (!Number.isFinite(amount) || amount < 0)) {
      throw new ValidationError("Importe no válido");
    }
    return { month: input.month, trip: Math.round(trip), amount };
  })
  .handler(async ({ data, context }): Promise<{ trip_actuals: TripActuals }> => {
    // El gasto real de la compra de la casa lo puede anotar cualquier miembro
    // (issue 06): resuelve la fila objetivo y escribe solo esa columna.
    const target = await resolveShoppingRow(context.supabase, context.userId);
    let next: TripActuals = {};
    const { latest } = await updateShoppingState<{ trip_actuals?: unknown }>(
      context.supabase,
      target,
      data.month,
      "trip_actuals",
      (row) => {
        next = withTripActual(cleanTripActuals(row.trip_actuals), data.trip, data.amount);
        return { trip_actuals: next };
      },
    ).catch((error: unknown) => {
      console.error("setTripActual", error);
      throw new UserFacingError("No hemos podido guardar el gasto");
    });
    if (!latest) throw new ValidationError("Todavía no hay plan de este mes");

    return { trip_actuals: next };
  });

/**
 * Añade o quita un ingrediente de la "despensa extra" del mes: cosas que la
 * persona ya tiene en casa y NO salen de la lista de la compra (añadidas a mano
 * o detectadas al escanear un tiquet). El planificador las trata como
 * disponibles al recolocar los días futuros; la lista de la compra (`shopping`)
 * no se toca nunca por esto. El emparejamiento al quitar es por nombre
 * normalizado (`normName`), no por igualdad exacta.
 */
export const setPantryExtra = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; name: string; qty?: string; remove?: boolean }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const name = String(input?.name ?? "")
      .trim()
      .slice(0, 80);
    if (!name) throw new ValidationError("Falta el ingrediente");
    assertCleanFood(name);
    const qty = String(input?.qty ?? "")
      .trim()
      .slice(0, 40);
    return { month: input.month, name, qty, remove: Boolean(input?.remove) };
  })
  .handler(async ({ data, context }): Promise<{ pantry_extras: PantryExtra[] }> => {
    // La despensa "ya lo tenemos en casa" es del hogar (issue 06): cualquier
    // miembro la edita, aunque viva en la fila del planificador.
    const target = await resolveShoppingRow(context.supabase, context.userId);
    let next: PantryExtra[] = [];
    const { latest } = await updateShoppingState<{ pantry_extras?: unknown }>(
      context.supabase,
      target,
      data.month,
      "pantry_extras",
      (row) => {
        next = withPantryExtra(
          cleanPantryExtras(row.pantry_extras),
          data,
          new Date().toISOString(),
        );
        return { pantry_extras: next };
      },
    ).catch((error: unknown) => {
      console.error("setPantryExtra", error);
      throw new UserFacingError("No hemos podido guardar el ingrediente");
    });
    if (!latest) throw new ValidationError("Todavía no hay plan de este mes");

    return { pantry_extras: next };
  });

export type ReceiptScan = {
  trip_actuals: TripActuals;
  pantry_extras: PantryExtra[];
  trip_receipts: TripReceipts;
  total: number;
  itemCount: number;
  added: string[];
  discarded: { name: string; reason: string }[];
};

/**
 * Lee la foto de un tiquet de compra con el modelo de visión y hace dos cosas
 * sin tocar nunca la lista de la compra (`shopping`):
 *  1. Guarda el importe real de la compra en `trip_actuals[trip]` (misma columna
 *     que el gasto a mano) y un resumen en `trip_receipts[trip]`.
 *  2. De los productos del tiquet que NO estén ya cubiertos por la compra ni por
 *     la despensa extra, añade a `pantry_extras` los que encajan en los
 *     objetivos y la dieta de la persona (`source: "receipt"`) y descarta el
 *     resto devolviendo el motivo, para enseñarlo en pantalla.
 * La imagen no se guarda: se manda al modelo y se descarta.
 */
export const scanTripReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; trip: number; imageBase64: string; mime?: string }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const trip = Number(input?.trip);
    if (!Number.isFinite(trip) || trip < 0) throw new ValidationError("Viaje no válido");
    const imageBase64 = String(input?.imageBase64 ?? "").trim();
    if (!imageBase64) throw new ValidationError("Falta la foto del tiquet");
    if (imageBase64.length > 4_500_000) {
      throw new ValidationError(
        "La foto es demasiado grande: baja la calidad e inténtalo otra vez",
      );
    }
    const mime = /^image\/(jpeg|png|webp|heic)$/.test(input?.mime ?? "")
      ? input!.mime!
      : "image/jpeg";
    return { month: input.month, trip: Math.round(trip), imageBase64, mime };
  })
  .handler(async ({ data, context }): Promise<ReceiptScan> => {
    const key = requireAiKey();

    const { enforceUserRateLimit } = await import("@/lib/rate-limit.server");
    await enforceUserRateLimit(context.userId, "receipt");

    // La foto del tiquet la sube quien va al súper — puede no ser el
    // planificador (issue 06). El perfil para clasificar los productos es
    // siempre el de quien llama; la fila de compra, la que resuelva el hogar.
    const target = await resolveShoppingRow(context.supabase, context.userId);
    const [{ data: profile }, row] = await Promise.all([
      context.supabase.from("profiles").select("*").eq("id", context.userId).maybeSingle(),
      readShoppingRow<{
        shopping?: unknown;
        pantry_extras?: unknown;
        trip_actuals?: unknown;
        trip_receipts?: unknown;
      }>(
        context.supabase,
        target,
        data.month,
        "shopping, pantry_extras, trip_actuals, trip_receipts",
      ),
    ]);
    const typed = row;
    const shopping = cleanShopping(typed?.shopping);
    const pantryExtras = cleanPantryExtras(typed?.pantry_extras);
    const tripActuals = cleanTripActuals(typed?.trip_actuals);
    const tripReceipts = cleanTripReceipts(typed?.trip_receipts);

    const ai = createAiProvider(key, context.userId);
    const dataUrl = `data:${data.mime};base64,${data.imageBase64}`;

    // 1) Leer el tiquet (visión).
    const receipt = await (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { text } = await generateText({
            model: ai(COACH_MODEL),
            temperature: 0,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text:
                      `Esta es la foto de un tiquet de compra de supermercado${
                        (profile as { country?: string | null } | null)?.country &&
                        (profile as { country?: string | null }).country !== "ES"
                          ? ` de ${(profile as { country?: string | null }).country}`
                          : " en España"
                      }. ` +
                      "Extrae el importe total pagado y la lista de productos con su precio. " +
                      "Ignora descuentos, puntos, IVA desglosado y medios de pago. " +
                      'Devuelve SOLO JSON: {"total_eur": number, "store": string, "items": [{"name": string (producto, en minúsculas y sin marca si se puede), "price_eur": number}]}. ' +
                      "Sin markdown ni texto alrededor.",
                  },
                  { type: "image", image: dataUrl },
                ],
              },
            ],
          });
          const parsed = (parseJsonLoose(text) ?? {}) as {
            total_eur?: unknown;
            store?: unknown;
            items?: unknown;
          };
          const total = Number(parsed.total_eur);
          const items = (Array.isArray(parsed.items) ? parsed.items : [])
            .map((it) => {
              const o = (it ?? {}) as Record<string, unknown>;
              const name = String(o.name ?? "")
                .trim()
                .toLowerCase()
                .slice(0, 80);
              const price = Number(o.price_eur);
              return name
                ? { name, price_eur: Number.isFinite(price) && price >= 0 ? price : 0 }
                : null;
            })
            .filter((x): x is { name: string; price_eur: number } => Boolean(x))
            .slice(0, 80);
          if (Number.isFinite(total) && total >= 0) {
            return {
              total: Math.round(total * 100) / 100,
              store: String(parsed.store ?? ""),
              items,
            };
          }
        } catch (e) {
          // Tope de gasto: otro intento no lo cambia, y "foto más nítida" confundiría.
          if (e instanceof RateLimitError) throw e;
          console.error("scanTripReceipt vision", e);
        }
      }
      throw new UserFacingError("No hemos podido leer el tiquet. Prueba con una foto más nítida.");
    })();

    // 2) Quitar lo que ya está cubierto (mismo nombre exacto) y clasificar el
    // resto: el modelo decide, viendo la lista de la compra, si un producto ya
    // lo tiene por un equivalente ("tomate pera" lo cubre "tomate triturado"),
    // si encaja con sus objetivos, o si se descarta.
    const availableNames = new Set([
      ...shopping.flatMap((g) => g.items.map((i) => normName(i.name))),
      ...pantryExtras.map((e) => normName(e.name)),
    ]);
    const candidateItems = receipt.items.filter((i) => !availableNames.has(normName(i.name)));
    const boughtList = ingredientNames(shopping);

    let added: string[] = [];
    const discarded: { name: string; reason: string }[] = [];

    if (candidateItems.length) {
      try {
        const { text } = await generateText({
          model: ai(COACH_MODEL),
          system: coachSystemPrompt(profile as never),
          temperature: 0.2,
          prompt:
            `Ingredientes que ya tiene comprados este mes: ${boughtList || "ninguno"}\n\n` +
            `Productos del tiquet a clasificar: ${JSON.stringify(candidateItems.map((i) => i.name))}\n\n` +
            "Para cada producto elige una opción:\n" +
            '- "cubierto": ya lo tiene por un equivalente de la lista de arriba (p. ej. "tomate pera" lo cubre "tomate triturado", "aceite oliva 1l" lo cubre "aceite de oliva virgen extra").\n' +
            '- "encaja": es nuevo y sirve para sus platos (base mediterránea; respeta sus restricciones, alergias, patrón de alimentación y objetivo).\n' +
            '- "descartar": es un ultraprocesado, un capricho o choca con sus restricciones o su objetivo.\n' +
            'Devuelve SOLO JSON: {"decisiones": [{"name": string (igual que te lo doy), "estado": "cubierto"|"encaja"|"descartar", "motivo": string (máx. 8 palabras, solo si "descartar")}]}. Sin markdown.',
        });
        const parsed = (parseJsonLoose(text) ?? {}) as { decisiones?: unknown };
        const decisions = new Map<string, { estado: string; motivo: string }>();
        for (const d of Array.isArray(parsed.decisiones) ? parsed.decisiones : []) {
          const o = (d ?? {}) as Record<string, unknown>;
          const name = String(o.name ?? "")
            .trim()
            .toLowerCase();
          if (name) {
            decisions.set(normName(name), {
              estado: String(o.estado ?? "encaja"),
              motivo: String(o.motivo ?? "").trim(),
            });
          }
        }
        for (const item of candidateItems) {
          const d = decisions.get(normName(item.name));
          if (d?.estado === "cubierto") continue;
          if (d?.estado === "descartar") {
            discarded.push({ name: item.name, reason: d.motivo || "no encaja con tu objetivo" });
          } else {
            added.push(item.name);
          }
        }
      } catch (e) {
        // Si la clasificación falla, no inventamos: se descartan todos con un
        // motivo genérico en vez de meter cosas raras en la despensa.
        console.error("scanTripReceipt classify", e);
        for (const item of candidateItems) {
          discarded.push({ name: item.name, reason: "no se pudo comprobar" });
        }
        added = [];
      }
    }

    // 3) Persistir: importe real + resumen del tiquet + extras que encajan,
    // sobre la versión más reciente (leer y clasificar el tiquet tarda, y
    // entretanto otro miembro puede anotar un gasto o un extra).
    const nowIso = new Date().toISOString();
    const receiptSummary = {
      total: receipt.total,
      itemCount: receipt.items.length,
      scannedAt: nowIso,
    };
    const clean = keepCleanReceiptNames(added);
    if (clean.dropped) {
      const { logEvent } = await import("@/lib/log.server");
      logEvent("info", "receipt_items_dropped", { count: clean.dropped });
    }
    added = clean.kept;
    const fromReceipt = added.map((name) => ({
      name,
      source: "receipt" as const,
      addedAt: nowIso,
    }));
    let nextActuals: TripActuals = { ...tripActuals, [data.trip]: receipt.total };
    let nextReceipts: TripReceipts = { ...tripReceipts, [data.trip]: receiptSummary };
    let nextPantry = cleanPantryExtras([...pantryExtras, ...fromReceipt]);
    await updateShoppingState<{
      pantry_extras?: unknown;
      trip_actuals?: unknown;
      trip_receipts?: unknown;
    }>(
      context.supabase,
      target,
      data.month,
      "pantry_extras, trip_actuals, trip_receipts",
      (row) => {
        nextActuals = { ...cleanTripActuals(row.trip_actuals), [data.trip]: receipt.total };
        nextReceipts = { ...cleanTripReceipts(row.trip_receipts), [data.trip]: receiptSummary };
        nextPantry = cleanPantryExtras([...cleanPantryExtras(row.pantry_extras), ...fromReceipt]);
        return {
          trip_actuals: nextActuals,
          trip_receipts: nextReceipts,
          pantry_extras: nextPantry,
        };
      },
    ).catch((error: unknown) => {
      console.error("scanTripReceipt save", error);
      throw new UserFacingError(
        "Hemos leído el tiquet pero no hemos podido guardarlo. Inténtalo otra vez.",
      );
    });

    return {
      trip_actuals: nextActuals,
      pantry_extras: nextPantry,
      trip_receipts: nextReceipts,
      total: receipt.total,
      itemCount: receipt.items.length,
      added,
      discarded,
    };
  });

/**
 * "Fija" (o deshace) los ingredientes de un tramo de compra: la persona
 * confirma que ese tramo ya está resuelto (comprado o en casa) y deja de
 * pedir más marcas. Cuando quedan fijados TODOS los tramos del mes, también
 * marca `confirmed_at` del plan — es la señal que ya usa `syncSharedMeals`
 * para no tocar la compra de alguien cuyo mes ya está cerrado del todo; si se
 * deshace cualquier tramo, `confirmed_at` se limpia otra vez.
 */
export const setTripConfirmed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { month: string; trip: number; confirmed: boolean }) => {
    if (!/^\d{4}-\d{2}$/.test(input?.month ?? "")) throw new ValidationError("Mes no válido");
    const trip = Number(input?.trip);
    if (!Number.isFinite(trip) || trip < 0) throw new ValidationError("Viaje no válido");
    return { month: input.month, trip: Math.round(trip), confirmed: Boolean(input?.confirmed) };
  })
  .handler(async ({ data, context }): Promise<{ confirmed_trips: TripConfirmations }> => {
    // Fijar un tramo de la compra de la casa lo puede hacer cualquier miembro
    // (issue 06); `confirmed_at` se cierra en la fila del planificador cuando
    // todos los tramos quedan fijados — `syncSharedMeals` lo respeta.
    const target = await resolveShoppingRow(context.supabase, context.userId);
    let next = null as TripConfirmations | null;
    await updateShoppingState<{
      plan?: unknown;
      shopping?: unknown;
      confirmed_trips?: unknown;
    }>(context.supabase, target, data.month, "plan, shopping, confirmed_trips", (row) => {
      const shopping = cleanShopping(row.shopping);
      if (!shopping.length) return null;
      const confirmed = withTripConfirmed(
        cleanTripConfirmations(row.confirmed_trips),
        data.trip,
        data.confirmed ? zonedTodayISO() : null,
      );

      // El número "oficial" de tramos es el de la cadencia guardada, no el que
      // se deduzca de los datos (un tramo sin artículos asignados no debe contar
      // de menos y dar por fijado el mes entero antes de tiempo).
      const planRow = cleanPlan(row.plan);
      const cadence = planRow?.cadence ?? cadenceOf(shopping);
      // El nº de compras sale de la cobertura real del plan, igual que en
      // pantalla (`tripsForCoverage`): con una cadencia semanal sobre los
      // últimos 12 días del mes hay 2 compras, no 4, y esperar a 4 dejaría el
      // mes sin poder fijarse nunca.
      const allConfirmed =
        Object.keys(confirmed).length >=
        tripsForCoverage(cadence, planRow?.coverage ?? monthCoverage(data.month, zonedTodayISO()));
      next = confirmed;
      return {
        confirmed_trips: confirmed,
        confirmed_at: allConfirmed ? new Date().toISOString() : null,
      };
    }).catch((error: unknown) => {
      console.error("setTripConfirmed", error);
      throw new UserFacingError("No hemos podido fijar los ingredientes");
    });
    if (!next) throw new ValidationError("Todavía no hay lista de la compra este mes");

    return { confirmed_trips: next };
  });
