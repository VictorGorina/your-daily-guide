// Barrel de las server functions del plan y de la compra (ticket 26 de la
// auditoría): cada tema vive en un `*.functions.ts` de `src/lib/plan/` o
// `src/lib/shopping/`, y las rutas web y `/api/v1/*` siguen importando de aquí.
// Solo se reexportan módulos `*.functions.ts`. Los helpers compartidos van en
// `*.server.ts` y no se reexportan: un export que no es `createServerFn`
// conserva su cuerpo en el bundle del cliente y arrastra con él los imports de
// servidor (quien los necesite, como `day-settle` o `plan-eval`, los importa del
// módulo `.server`).
export type { MonthlyPlan, ShoppingItem, ShoppingList } from "@/lib/plan-shared";
export * from "./shopping/state.functions";
export * from "./plan/dishes.functions";
export * from "./plan/coach.functions";
export * from "./plan/generate.functions";
export * from "./plan/fit.functions";
export * from "./plan/reflow.functions";
