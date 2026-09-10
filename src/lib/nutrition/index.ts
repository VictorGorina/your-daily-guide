/**
 * Punto de entrada del módulo de nutrición — solo lo PURO (casar ingredientes,
 * sumar macros y precio). La descomposición de un plato con el modelo vive en
 * `./resolve-dish.server` y se importa aparte, siempre desde código de servidor.
 */

export * from "./nutrition";
