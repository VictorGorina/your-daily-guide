import { cleanShopping, type ShoppingList, withOwnedMark } from "@/lib/plan-shared";
import { ValidationError } from "@/lib/validation-error";
import { resolveShoppingRow, updateShoppingState } from "../plan/rows.server";

/** Cuerpo de `toggleShoppingOwned`, aparte para poder probarlo (ticket 21). */
export async function toggleShoppingOwnedHandler({
  data,
  context,
}: {
  data: { month: string; itemName: string; trip: number; source: "fridge" | "store" | null };
  context: { supabase: unknown; userId: string };
}): Promise<{ shopping: ShoppingList }> {
  // La lista puede ser la de la casa: cualquier miembro con cuenta marca su
  // estado, aunque la escritura vaya a la fila del planificador (issue 06).
  const target = await resolveShoppingRow(context.supabase, context.userId);
  // La marca se pone sobre la lista más reciente: otra marca que llegue a la
  // vez se conserva. Es idempotente ("fijar a `source`"), así que un
  // reintento no la deshace.
  let shopping: ShoppingList = [];
  try {
    await updateShoppingState<{ shopping?: unknown }>(
      context.supabase,
      target,
      data.month,
      "shopping",
      (row) => {
        const current = cleanShopping(row.shopping);
        if (!current.length) return null;
        shopping = withOwnedMark(current, data.itemName, data.trip, data.source);
        return { shopping };
      },
    );
  } catch (error) {
    console.error("toggleShoppingOwned", error);
    throw new Error("No hemos podido guardar el cambio");
  }
  if (!shopping.length) throw new ValidationError("Todavía no hay lista de la compra este mes");

  return { shopping };
}
