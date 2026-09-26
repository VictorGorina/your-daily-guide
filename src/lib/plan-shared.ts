// Barrel: la lógica pura del plan y de la compra vive en `src/lib/plan/` y
// `src/lib/shopping/`, un módulo por tema (ticket 26 de la auditoría). Este
// archivo solo los reexporta para que el resto de la app siga importando de
// `@/lib/plan-shared`. Los módulos no importan de aquí, sino entre ellos: así no
// hay ciclos en ejecución (`bunx madge --circular src/lib/plan src/lib/shopping`).
export * from "./plan/slots";
export * from "./plan/types";
export * from "./shopping/model";
export * from "./shopping/state";
export * from "./plan/month";
export * from "./shopping/trips";
export * from "./shopping/clean";
export * from "./plan/grid";
export * from "./plan/parse";
export * from "./plan/constraints";
export * from "./plan/habits";
export * from "./plan/merge";
export * from "./plan/compensation";
export * from "./plan/fit-mark";
export * from "./plan/household";
export * from "./plan/prompt-text";
